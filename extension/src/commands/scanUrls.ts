import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { Shortcut } from "../model/shortcut";
import { detectUrlCandidates, UrlCandidate } from "../recipes/urlCandidates";
import { l10n } from "../i18n/l10n";

// Scan the open project(s) for the URLs they already declare — the git remote's web
// views, the manifest / docs-site URLs — and let the user turn any of them into
// website shortcuts in one multi-select step. The candidate set is derived from
// structured sources (see detectUrlCandidates), not a text scrape, so it is the
// near-zero-noise set of URLs a developer would actually pin. Discovered URLs belong
// to the repo, so they land in PROJECT scope (committed, shared with the team); a user
// can move one to global afterward.

// The href a stored shortcut opens, when it is a url shortcut; undefined otherwise.
// The flat ShortcutAction carries url as optional, so prove it is a string.
function urlOf(shortcut: Shortcut): string | undefined {
  const action = shortcut.action;
  return action?.kind === "url" && typeof action.url === "string" ? action.url : undefined;
}

// Run the URL scan, drop candidates already pinned in either scope, and let the user
// multi-select which of what remains to add as project-scoped url shortcuts. Distinguishes
// "nothing discoverable" from "already added everything" so an empty result never
// reads as a scan failure.
export async function scanProjectUrls(store: ShortcutStore): Promise<void> {
  const found = await detectUrlCandidates();

  // Drop candidates already saved as a url shortcut in either scope, so re-running the
  // scan surfaces only what is new rather than re-offering — and re-adding — dupes.
  const existing = new Set(
    [...store.getProjectShortcuts(), ...store.getGlobalShortcuts()]
      .map(urlOf)
      .filter((u): u is string => u !== undefined)
  );
  const candidates = found.filter((c) => !existing.has(c.url));

  if (candidates.length === 0) {
    // Distinguish "the project declares no discoverable URLs" from "you already pinned
    // them all" so the empty result is not mistaken for a scan failure.
    vscode.window.showInformationMessage(
      found.length === 0 ? l10n("scanUrls.none") : l10n("scanUrls.allAdded")
    );
    return;
  }

  type CandidateItem = vscode.QuickPickItem & { candidate: UrlCandidate };
  const items: CandidateItem[] = candidates.map((candidate) => ({
    // The curated set is high-value by construction, so every row is pre-checked —
    // the user confirms with Enter, or unchecks the few they do not want.
    label: candidate.icon ? `$(${candidate.icon}) ${candidate.label}` : candidate.label,
    description: candidate.url,
    detail: candidate.description,
    candidate,
    picked: true,
  }));

  const picks = await vscode.window.showQuickPick(items, {
    title: l10n("scanUrls.title"),
    placeHolder: l10n("scanUrls.placeholder"),
    canPickMany: true,
    matchOnDescription: true,
    matchOnDetail: true,
  });
  // Esc (undefined) or confirming with nothing checked adds nothing.
  if (!picks || picks.length === 0) {
    return;
  }

  // Add each picked URL in pick order. No anchor: this is a bulk discovery action from
  // the view title, so entries append to the project scope's top level.
  let added = 0;
  for (const pick of picks) {
    const ok = await store.addUrlShortcut(pick.candidate.url, "project", pick.candidate.label);
    if (ok) {
      added += 1;
    }
  }

  if (added === 0) {
    // The one failure path for project scope is no workspace folder open — which cannot
    // happen here (candidates require a folder), but the guard keeps the toast honest.
    vscode.window.showWarningMessage(l10n("url.noWorkspace"));
    return;
  }
  vscode.window.showInformationMessage(l10n("scanUrls.added", { count: added }));
}
