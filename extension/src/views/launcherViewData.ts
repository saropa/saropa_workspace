import * as vscode from "vscode";
import * as path from "path";
import { ShortcutStore } from "../model/shortcutStore";
import { FolderWatchStore, isGlobalWatch, watchAlertsIn, watchDisplayName, watchKind } from "../model/folderWatch";
import { l10n } from "../i18n/l10n";
import { buildLauncherItems, LauncherItem } from "./launcherItems";
import { watchLauncherItem } from "./launcherWatchItem";
import { fileLauncherItem } from "./launcherFileItem";
import { scriptLauncherItem } from "./launcherScriptItem";
import { adbLauncherItems } from "./launcherAdbItem";
import { hasInteractiveTokens } from "../exec/promptTokens";
import { ProjectFilesTreeProvider, formatRelativeTime } from "./projectFilesProvider";
import { ScriptsTreeProvider } from "./scriptsTreeProvider";
import { glyphForCategory, ProjectFileInfo } from "../model/projectFiles";
import type { AndroidProjectProfile } from "../model/androidProjectProfile";

// The pure data-assembly layer for the Saropa Workspace panel webview host (launcherView.ts): turns
// the store/watch/project-files state into the flat item list and header object the webview
// renders. Kept apart from the class so the "what goes on screen" logic reads independently
// of the lifecycle/message-routing concerns launcherView.ts keeps.

// One informational count shown in the header's meta line (e.g. the scheduled-rituals
// count). Build order step 7 (PLAN_Launcher_Restructure.md) removed the per-pane stats that
// used to also live here as toggle chips (mine/recipes/watches/files/scripts/mobileRemote/
// notes counts) — the left panel's category list (buildCategoryList(), launcherCategoryList.ts,
// build order step 3) already shows the same per-category counts via a strictly better
// single-select mechanism, so keeping a second, duplicate copy in the header was pure
// redundancy once that landed. What is left here is purely informational: nothing in
// `LauncherStat` is pane-tied any more, so there is nothing left to toggle.
export interface LauncherStat {
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
  readonly noProject: boolean;
}

// Assemble every launcher row: the shortcut + recipe cards (the two existing panes), then
// the watch cards, the project-file cards and the adb catalog cards (Mobile Remote
// Control). Each watch/file card is formatted by the vscode-free builders in
// launcherWatchItem/launcherFileItem; the caller supplies the bits those builders cannot
// compute (the watch's unseen tally, a file's shortcut state and freshness clock). `files`
// is the already-scanned surfaced-file set the caller passes in so the disk scan runs once
// per paint (shared with the header's version/stats). `androidProfile` is resolved by the
// caller exactly the way remoteControlPanel.ts resolves one (getAndroidProjectProfile on
// the first workspace folder) — undefined on a non-Android workspace, in which case
// adbLauncherItems still returns every catalog row, just with nothing profile-substituted.
export function buildAllItems(
  store: ShortcutStore,
  watchStore: FolderWatchStore,
  files: readonly ProjectFileInfo[],
  scriptsProvider: ScriptsTreeProvider,
  androidProfile?: AndroidProjectProfile
): LauncherItem[] {
  const items = buildLauncherItems(store);
  items.push(...buildWatchItems(watchStore));
  items.push(...buildFileItems(files, store));
  items.push(...buildScriptItems(scriptsProvider));
  items.push(...adbLauncherItems(androidProfile));
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
        // Single source of truth for watch display name — keeps owner/repo
        // intact for repo watches instead of path.basename mangling it.
        label: watchDisplayName(w),
        target: w.target,
        isFile: w.isFile,
        mode: w.mode,
        watchKind: watchKind(w),
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
// its declared version, and a small informational stat the left panel does not already
// surface. The name is also painted synchronously from the initial HTML (renderHtml's
// projectName); posting it again here keeps it correct when the open folder changes.
// Version + stats are the asynchronous facets — version is read from the same already-scanned
// manifest set — so the developer's "version and stats computed asynchronously" lands without
// a second disk scan.
//
// Build order step 7 (PLAN_Launcher_Restructure.md) removed every per-pane count this used to
// push (mine/recipes/watches/files/scripts/mobileRemote/notes) — each was also a header toggle
// chip duplicating a pane the left panel's category list (buildCategoryList(),
// launcherCategoryList.ts) already counts via a strictly better single-select mechanism. This
// function no longer needs the built item list at all as a result — only the store, for the
// one stat that has no per-pane home.
export function buildHeader(
  store: ShortcutStore,
  files: readonly ProjectFileInfo[]
): LauncherHeader {
  const primary = (vscode.workspace.workspaceFolders ?? [])[0];
  const project =
    primary?.name ?? vscode.workspace.name ?? l10n("launcher.noProject");
  const version = deriveProjectVersion(files, primary?.name);

  // "Scheduled" means a live ritual: a stored shortcut whose schedule is switched ON
  // (schedule.enabled === true). Scheduled cards live inside "mine", so this has no pane of
  // its own and the left panel has nowhere to show it — it stays here as a plain
  // informational stat. With nothing enabled the count is 0 and the stat is omitted.
  const scheduledRituals = [
    ...store.getProjectShortcuts(),
    ...store.getGlobalShortcuts(),
  ].filter((s) => s.schedule?.enabled === true).length;
  const stats: LauncherStat[] = [];
  if (scheduledRituals > 0) {
    stats.push({ icon: "clock", text: l10n("launcher.statScheduled", { count: scheduledRituals }) });
  }

  return {
    project,
    version: version ? l10n("launcher.version", { version }) : undefined,
    stats,
    noProject: !primary && !vscode.workspace.name,
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
