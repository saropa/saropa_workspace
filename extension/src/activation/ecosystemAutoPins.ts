import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { detectEcosystemMarkers, EcosystemMarkers } from "../recipes/detectorEcosystem";
import { l10n } from "../i18n/l10n";
import { gatedNotice } from "./activationHelpers";

// BUG-010 follow-up: the shipped `autoPins.patterns` default was made language-
// agnostic (package.json, README.md, Makefile, .env.example) to stop biasing every
// project toward Dart/Flutter, but that regressed the out-of-the-box experience for
// this extension's actual Dart/Flutter users (they lost pubspec.yaml /
// analysis_options.yaml auto-pins with no replacement). This module restores that
// coverage WITHOUT reintroducing the bias: it detects the project's real ecosystem
// (reusing detectorEcosystem.ts's markers, the same ones the recipe detectors use)
// and seeds extra patterns into THIS workspace folder's own `autoPins.patterns`,
// rather than changing the shared global default that every project inherits.

// workspaceState key prefix latching a folder as already decided (seeded or
// deliberately skipped), keyed per folder so a multi-root workspace decides each
// folder independently. Written even when nothing was added, so a fresh project with
// no recognized ecosystem (e.g. a plain docs repo) is not re-probed on every future
// activation once there is nothing left to add.
const SEEDED_KEY_PREFIX = "saropaWorkspace.ecosystemAutoPinsSeeded.";

// Worth offering to every fresh project regardless of ecosystem — a config file most
// projects have but the current language-agnostic default (package.json, README.md,
// Makefile, .env.example) does not cover.
const ALWAYS_EXTRA_PATTERNS: readonly string[] = [".env"];

// Map detected ecosystem markers to the extra auto-pin patterns worth seeding for a
// fresh project of that type. Additive only: never removes or overrides the base
// language-agnostic default, so a project matching none of these still gets exactly
// what BUG-010 shipped. No overlap is possible between ecosystem blocks (each pattern
// is unique to its ecosystem), so a plain array is sufficient — no Set needed.
function ecosystemPatterns(markers: EcosystemMarkers): string[] {
  const patterns = [...ALWAYS_EXTRA_PATTERNS];
  if (markers.isFlutter || markers.isDart) {
    patterns.push("pubspec.yaml", "analysis_options.yaml");
  }
  if (markers.isDjango) {
    patterns.push("manage.py", "requirements.txt");
  }
  if (markers.isRust) {
    patterns.push("Cargo.toml");
  }
  if (markers.isGo) {
    patterns.push("go.mod");
  }
  return patterns;
}

// Decide a single workspace folder: detect its ecosystem, seed any missing auto-pin
// patterns, and return the list of patterns added (empty when nothing was written).
// Extracted from the main loop to keep seedEcosystemAutoPins under the 50-line cap.
async function seedFolder(
  context: vscode.ExtensionContext,
  store: ShortcutStore,
  folder: vscode.WorkspaceFolder
): Promise<string[]> {
  const seededKey = SEEDED_KEY_PREFIX + folder.uri.toString();
  // FRAGILE COUPLING: gatedNotice is designed for fire-and-forget UI notices (check →
  // latch → show), but here it is reused purely for its check-and-latch mechanics.
  // Because gatedNotice returns void, the decided patterns are threaded out through
  // this closure variable. If gatedNotice is ever refactored to change the timing of
  // the show callback (e.g., awaiting it before latching), this trick will silently
  // break. A dedicated checkAndLatch<T> helper without a show parameter would be
  // cleaner — tracked in hardening-sweep-batches-3-5 finish report.
  let added: string[] = [];
  // Reuses the check-latch-show gate from activationHelpers.ts (#27): the "already
  // decided" bail-out and the "latch after the decision is made" write are the same
  // shape as the notice sites there, even though this call has no UI "show" — the
  // aggregated toast for the whole workspace is shown once by the caller after every
  // folder has been decided, not per folder. Latching AFTER the check (rather than
  // before, as the two branches below used to do inline) means a thrown cfg.update()
  // leaves the folder unlatched and retried on the next activation, matching the
  // previous "latch after the write succeeds" comment.
  await gatedNotice(
    context.workspaceState,
    seededKey,
    async () => {
      // Only seed a project the user has not already curated — a folder with even
      // one explicit shortcut reflects a deliberate setup; silently adding more
      // auto-pin patterns there would surprise, not help. Returns [] (not
      // undefined) so the folder is still latched as decided.
      if (store.hasExplicitProjectShortcuts(folder)) {
        return [];
      }
      const markers = await detectEcosystemMarkers(folder);
      const extra = ecosystemPatterns(markers);
      const cfg = vscode.workspace.getConfiguration("saropaWorkspace", folder.uri);
      const current = cfg.get<string[]>("autoPins.patterns", []);
      const newPatterns = extra.filter((p) => !current.includes(p));
      if (newPatterns.length === 0) {
        return [];
      }
      // Written at WorkspaceFolder scope (not Workspace/Global): this is a
      // per-project signal derived from THIS folder's own files, and must never
      // leak into a sibling folder in a multi-root workspace or override a user's
      // own global customization for projects that do not match any detected
      // ecosystem.
      await cfg.update(
        "autoPins.patterns",
        [...current, ...newPatterns],
        vscode.ConfigurationTarget.WorkspaceFolder
      );
      return newPatterns;
    },
    (result) => {
      added = result;
    }
  );
  return added;
}

// Seed ecosystem-appropriate auto-pin patterns into every open workspace folder that
// is still "fresh" (no explicit shortcut added yet) and has not already been decided
// in a previous activation. Called once from the post-load tail in extension.ts —
// never on every activation, since the workspaceState latch makes every subsequent
// call for an already-decided folder a no-op.
export async function seedEcosystemAutoPins(
  context: vscode.ExtensionContext,
  store: ShortcutStore
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const addedByFolder: { folder: vscode.WorkspaceFolder; patterns: string[] }[] = [];

  for (const folder of folders) {
    try {
      const added = await seedFolder(context, store, folder);
      if (added.length > 0) {
        addedByFolder.push({ folder, patterns: added });
      }
    } catch (err) {
      // Log rather than swallow: a config-write failure or marker-detection crash
      // should be diagnosable, not silently dropped by the void call in extension.ts.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[saropa] ecosystemAutoPins failed for ${folder.name}: ${msg}`);
    }
  }

  if (addedByFolder.length === 0) {
    return;
  }

  // No explicit store.rescan() here (#25): each cfg.update("autoPins.patterns", ...)
  // call inside seedFolder above already fires VS Code's onDidChangeConfiguration,
  // which wireWatchers.ts's config listener turns into its own store.rescan() per
  // folder. Calling store.rescan() again here duplicated that work — N folder writes
  // plus one more rescan (N+1) — for no benefit: the notification below only needs to
  // know which patterns were added (computed above, not read back from the store), so
  // it does not depend on a rescan having completed by the time it runs, and the
  // listener-driven rescan(s) still land in time for the tree to show the new files
  // once VS Code delivers the config-change event.
  // No silent async: name what was added and where, once per affected folder.
  for (const { folder, patterns } of addedByFolder) {
    vscode.window.showInformationMessage(
      l10n("pin.autoEcosystemSeeded", {
        folder: folder.name,
        patterns: patterns.join(", "),
      })
    );
  }
}
