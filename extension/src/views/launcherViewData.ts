import * as vscode from "vscode";
import * as path from "path";
import { ShortcutStore } from "../model/shortcutStore";
import { FolderWatchStore, isGlobalWatch, watchAlertsIn } from "../model/folderWatch";
import { l10n } from "../i18n/l10n";
import { buildLauncherItems, LauncherItem } from "./launcherItems";
import { watchLauncherItem } from "./launcherWatchItem";
import { fileLauncherItem } from "./launcherFileItem";
import { scriptLauncherItem } from "./launcherScriptItem";
import { hasInteractiveTokens } from "../exec/promptTokens";
import { ProjectFilesTreeProvider, formatRelativeTime } from "./projectFilesProvider";
import { ScriptsTreeProvider } from "./scriptsTreeProvider";
import { glyphForCategory, ProjectFileInfo } from "../model/projectFiles";

// The pure data-assembly layer for the Saropa Workspace panel webview host (launcherView.ts): turns
// the store/watch/project-files state into the flat item list and header object the webview
// renders. Kept apart from the class so the "what goes on screen" logic reads independently
// of the lifecycle/message-routing concerns launcherView.ts keeps.

// A pane that a header toggle chip can show or hide.
export type LauncherFilter = LauncherItem["pane"];

// One count shown in the header's meta line. When `pane` is set, the stat is a toggle chip
// that shows/hides that pane section; when omitted, the stat is an informational label
// (e.g. the scheduled-rituals count, which is not tied to a single pane).
export interface LauncherStat {
  readonly pane?: LauncherFilter;
  readonly icon: string;
  readonly text: string;
}

// The header's leading block, posted with every data message. `project` is the current
// folder name; `version` is the pre-localized "v{x}" label (undefined when no manifest
// declares one); `stats` is the non-empty count summary.
export interface LauncherHeader {
  readonly project: string;
  readonly version: string | undefined;
  readonly stats: readonly LauncherStat[];
}

// Assemble every launcher row: the shortcut + recipe cards (the two existing panes), then
// the watch cards and the project-file cards (the two flat panes). Each watch/file card is
// formatted by the vscode-free builders in launcherWatchItem/launcherFileItem; the caller
// supplies the bits those builders cannot compute (the watch's unseen tally, a file's
// shortcut state and freshness clock). `files` is the already-scanned surfaced-file set the
// caller passes in so the disk scan runs once per paint (shared with the header's
// version/stats).
export function buildAllItems(
  store: ShortcutStore,
  watchStore: FolderWatchStore,
  files: readonly ProjectFileInfo[],
  scriptsProvider: ScriptsTreeProvider
): LauncherItem[] {
  const items = buildLauncherItems(store);
  items.push(...buildWatchItems(watchStore));
  items.push(...buildFileItems(files, store));
  items.push(...buildScriptItems(scriptsProvider));
  return items;
}

function buildWatchItems(watchStore: FolderWatchStore): LauncherItem[] {
  const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  const items: LauncherItem[] = [];
  for (const w of watchStore.list()) {
    if (!watchAlertsIn(w, folders)) {
      continue;
    }
    items.push(
      watchLauncherItem({
        id: w.id,
        label: w.label ?? path.basename(w.target),
        target: w.target,
        isFile: w.isFile,
        mode: w.mode,
        enabled: w.enabled,
        unseen: watchStore.unseenCount(w.id),
        isGlobal: isGlobalWatch(w),
      })
    );
  }
  return items;
}

function buildFileItems(
  files: readonly ProjectFileInfo[],
  store: ShortcutStore
): LauncherItem[] {
  const now = Date.now();
  const categoryOrder: string[] = [];
  for (const f of files) {
    if (!categoryOrder.includes(f.category)) {
      categoryOrder.push(f.category);
    }
  }
  const fileName = (name: string): string => name.split("/").pop() ?? name;
  const ordered = [...files].sort((a, b) => {
    const byCategory =
      categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category);
    if (byCategory !== 0) {
      return byCategory;
    }
    return fileName(a.name).localeCompare(fileName(b.name), undefined, {
      sensitivity: "base",
    });
  });
  return ordered.map((f) =>
    fileLauncherItem({
      path: f.uri.fsPath,
      fileName: fileName(f.name),
      version: f.version,
      relative: formatRelativeTime(f.modified, now),
      isShortcut: store.findShortcutByUri(f.uri, "project") !== undefined,
      category: f.category,
      categoryGlyph: glyphForCategory(f.category),
    })
  );
}

function buildScriptItems(scriptsProvider: ScriptsTreeProvider): LauncherItem[] {
  return scriptsProvider.scripts.map((script) =>
    scriptLauncherItem({
      id: script.id,
      label: script.label,
      description: script.description,
      icon: script.icon,
      tags: script.tags,
      hasParams: hasInteractiveTokens({
        id: `library:${script.id}`,
        path: script.entry,
        scope: "project",
        order: 0,
        exec: script.config,
      }),
    })
  );
}

// The launcher header's leading block: the current project (the first workspace folder),
// its declared version, and a compact count of what the board holds. The name is also
// painted synchronously from the initial HTML (renderHtml's projectName); posting it again
// here keeps it correct when the open folder changes. Version + stats are the asynchronous
// facets — version is read from the same already-scanned manifest set, stats from the built
// items — so the developer's "version and stats computed asynchronously" lands without a
// second disk scan.
export function buildHeader(
  store: ShortcutStore,
  files: readonly ProjectFileInfo[],
  items: readonly LauncherItem[]
): LauncherHeader {
  const primary = (vscode.workspace.workspaceFolders ?? [])[0];
  const project =
    primary?.name ?? vscode.workspace.name ?? l10n("launcher.noProject");
  const version = deriveProjectVersion(files, primary?.name);

  // Count by pane, omitting an empty bucket so the meta line stays a tight summary of
  // what is actually present rather than a row of zeros.
  const count = (pane: LauncherItem["pane"]): number =>
    items.reduce((n, it) => (it.pane === pane ? n + 1 : n), 0);
  // "Scheduled" means a live ritual: a stored shortcut whose schedule is switched ON
  // (schedule.enabled === true). Rendered as an informational label (no pane toggle) since
  // scheduled cards live inside "mine". With nothing enabled the count is 0 and pushStat
  // omits it.
  const scheduledRituals = [
    ...store.getProjectShortcuts(),
    ...store.getGlobalShortcuts(),
  ].filter((s) => s.schedule?.enabled === true).length;
  const stats: LauncherStat[] = [];
  const pushStat = (
    n: number,
    icon: string,
    key: string,
    pane?: LauncherFilter
  ): void => {
    if (n > 0) {
      stats.push({ pane, icon, text: l10n(key, { count: n }) });
    }
  };
  pushStat(count("mine"), "star-full", "launcher.statShortcuts", "mine");
  pushStat(count("recipes"), "lightbulb", "launcher.statRecipes", "recipes");
  // Scheduled is informational (no pane toggle): the count of shortcuts with an enabled
  // schedule. Scheduled cards live inside "mine", so a pane toggle would duplicate it.
  pushStat(scheduledRituals, "clock", "launcher.statScheduled");
  pushStat(count("watches"), "eye", "launcher.statWatches", "watches");
  pushStat(count("files"), "files", "launcher.statFiles", "files");
  pushStat(count("scripts"), "library", "launcher.statScripts", "scripts");
  stats.push({
    pane: "notes",
    icon: "note",
    text: l10n("launcher.statNotes", { count: count("notes") }),
  });

  return {
    project,
    version: version ? l10n("launcher.version", { version }) : undefined,
    stats,
  };
}

// The project's declared version, read from the already-scanned manifest set. Manifests are
// tried in a fixed precedence so a polyglot repo reports one stable version: the package
// manifests first (the authored project version), then CHANGELOG as a last resort (its
// newest released heading). Scoped to the primary folder so a sibling folder's manifest in a
// multi-root workspace never leaks into the header. Returns undefined when nothing declares
// one, which the caller renders as no version chip rather than an empty "v".
function deriveProjectVersion(
  files: readonly ProjectFileInfo[],
  primaryFolder: string | undefined
): string | undefined {
  const precedence = [
    "package.json",
    "pubspec.yaml",
    "Cargo.toml",
    "pyproject.toml",
    "CHANGELOG.md",
  ];
  const scoped = primaryFolder
    ? files.filter((f) => f.folderName === primaryFolder)
    : files;
  const baseName = (name: string): string => name.split("/").pop() ?? name;
  for (const manifest of precedence) {
    const hit = scoped.find((f) => baseName(f.name) === manifest && f.version);
    if (hit?.version) {
      return hit.version;
    }
  }
  return undefined;
}
