import * as vscode from "vscode";
import * as path from "path";
import { shortcutKind } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { l10n } from "../i18n/l10n";

// "Focus on Shortcut Files" (roadmap Later / Exploratory: files.exclude integration).
// Drive VS Code's `files.exclude` from the shortcut set so the Explorer shows only
// the shortcut files and the folders that lead to them — a favorites-only workspace
// view, as kdcro101 Favorites offers. Toggling off restores the exact prior
// `files.exclude` that was in effect, so the user's own excludes are never lost.
//
// files.exclude has no "show only" / negation operator, so focus is built the only
// way the setting allows: walk the directories on the path to each shortcut file and
// hide the siblings that are neither a shortcut file nor an ancestor of one. Folders
// with no shortcut file inside them are left untouched (a workspace root cannot be
// hidden, and blanking an unrelated root is not the intent).

// Whether focus mode is currently applied. Persisted in workspaceState so a window
// reload (which keeps the written files.exclude) re-establishes the toggle state and
// menu, and mirrored to a context key for the menu `when` clause.
const ACTIVE_KEY = "saropaWorkspace.focusMode.active";
const CONTEXT_KEY = "saropaWorkspace.focusActive";
// Per-folder snapshot of the files.exclude that was in effect before focus, keyed by
// folder URI, so toggling off restores exactly what was there (null = no prior
// folder-level value, restore to inherited).
const SAVED_PREFIX = "saropaWorkspace.focusMode.saved.";

function savedKey(folder: vscode.WorkspaceFolder): string {
  return SAVED_PREFIX + folder.uri.toString();
}

// The folder-relative, forward-slash path of a URI inside a workspace folder, or
// undefined when the URI is not under that folder. Used to map a resolved shortcut
// to a path that a folder-scoped files.exclude glob can match.
function relativeWithin(
  folder: vscode.WorkspaceFolder,
  uri: vscode.Uri
): string | undefined {
  const base = folder.uri.fsPath;
  // Require an exact match or a path-separator boundary so "/proj" does not match a
  // sibling "/project". A bare startsWith would wrongly claim files in sibling dirs.
  if (uri.fsPath !== base && !uri.fsPath.startsWith(base + path.sep)) {
    return undefined;
  }
  return uri.fsPath
    .slice(base.length)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

// Compute the files.exclude additions for one folder: hide every Explorer entry that
// is neither a shortcut file nor on the path to one. Only directories that lead to a
// shortcut file are scanned, so the walk is bounded by the shortcut set, not the
// tree size. Returns an empty map when the folder holds no shortcut files (it is
// then left alone).
async function computeExcludes(
  folder: vscode.WorkspaceFolder,
  shortcutRel: ReadonlySet<string>
): Promise<Record<string, true>> {
  if (shortcutRel.size === 0) {
    return {};
  }
  // keep = shortcut files + all their ancestor directories (these must stay visible).
  // dirs = the ancestor directories themselves (root included), the only places we
  // scan for siblings to hide.
  const keep = new Set<string>();
  const dirs = new Set<string>([""]);
  for (const rel of shortcutRel) {
    keep.add(rel);
    const parts = rel.split("/");
    for (let i = 1; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join("/");
      keep.add(ancestor);
      dirs.add(ancestor);
    }
  }
  const excludes: Record<string, true> = {};
  for (const dir of dirs) {
    const dirUri = dir === "" ? folder.uri : vscode.Uri.joinPath(folder.uri, dir);
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dirUri);
    } catch {
      // A directory that cannot be read (permissions, vanished) is skipped rather
      // than aborting the whole focus computation.
      continue;
    }
    // Hide each child that is not a kept file/ancestor. The glob is the child's
    // folder-relative path, which files.exclude matches against entries in that
    // folder.
    for (const [name] of entries) {
      const childRel = dir === "" ? name : `${dir}/${name}`;
      if (!keep.has(childRel)) {
        excludes[childRel] = true;
      }
    }
  }
  return excludes;
}

// The folder-relative paths of every resolvable, non-recipe file shortcut that
// lives inside a given folder (project shortcuts are folder-relative already; a
// global shortcut is included when its absolute path happens to fall inside this
// folder).
function shortcutPathsIn(
  store: ShortcutStore,
  folder: vscode.WorkspaceFolder
): Set<string> {
  const out = new Set<string>();
  for (const shortcut of [...store.getProjectShortcuts(), ...store.getGlobalShortcuts()]) {
    if (shortcut.isRecipe || shortcutKind(shortcut) !== "file") {
      continue;
    }
    const uri = store.resolveUri(shortcut);
    if (!uri) {
      continue;
    }
    const rel = relativeWithin(folder, uri);
    if (rel && rel.length > 0) {
      out.add(rel);
    }
  }
  return out;
}

async function setActive(
  context: vscode.ExtensionContext,
  active: boolean
): Promise<void> {
  await context.workspaceState.update(ACTIVE_KEY, active);
  await vscode.commands.executeCommand("setContext", CONTEXT_KEY, active);
}

// Re-establish the context key on activation from the persisted flag, so a window
// reloaded while focus is active shows the "Exit Focus" action (not "Focus") and the
// applied files.exclude is correctly attributed to focus mode.
export async function initFocusMode(
  context: vscode.ExtensionContext
): Promise<void> {
  const active = context.workspaceState.get<boolean>(ACTIVE_KEY, false);
  await vscode.commands.executeCommand("setContext", CONTEXT_KEY, active);
}

// Enter focus: snapshot each folder's current files.exclude, then merge in the
// computed "hide everything but the favorites" globs. The user's own excludes are
// preserved in the merge and restored verbatim on exit.
export async function enterFocusMode(
  store: ShortcutStore,
  context: vscode.ExtensionContext
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    vscode.window.showWarningMessage(l10n("focus.noWorkspace"));
    return;
  }
  let hidden = 0;
  let foldersWithShortcuts = 0;
  for (const folder of folders) {
    const shortcutRel = shortcutPathsIn(store, folder);
    const excludes = await computeExcludes(folder, shortcutRel);
    if (Object.keys(excludes).length === 0) {
      continue;
    }
    foldersWithShortcuts++;
    hidden += Object.keys(excludes).length;
    const cfg = vscode.workspace.getConfiguration("files", folder.uri);
    const prior = cfg.inspect<Record<string, boolean>>("exclude")
      ?.workspaceFolderValue;
    // Save the prior value (null when there was no folder-level value) so exit can
    // restore exactly, then write the merged map at folder scope.
    await context.workspaceState.update(savedKey(folder), prior ?? null);
    await cfg.update(
      "exclude",
      { ...(prior ?? {}), ...excludes },
      vscode.ConfigurationTarget.WorkspaceFolder
    );
  }
  if (foldersWithShortcuts === 0) {
    // Nothing to hide: every open folder either has no shortcut files or only
    // shortcuts at its root. Tell the user rather than silently toggling a no-op on.
    vscode.window.showInformationMessage(l10n("focus.nothingToHide"));
    return;
  }
  await setActive(context, true);
  vscode.window.showInformationMessage(l10n("focus.entered", { count: hidden }));
}

// Exit focus: restore each folder's saved files.exclude (or clear our folder-level
// value when there was none), then drop the saved snapshots and the active flag.
export async function exitFocusMode(
  context: vscode.ExtensionContext
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    const key = savedKey(folder);
    // undefined => this folder was never focused (no snapshot); leave it untouched.
    const saved = context.workspaceState.get<Record<string, boolean> | null>(key);
    if (saved === undefined) {
      continue;
    }
    const cfg = vscode.workspace.getConfiguration("files", folder.uri);
    // saved === null means there was no folder-level value before focus; restoring
    // it to undefined removes our key and reverts to the inherited setting.
    await cfg.update(
      "exclude",
      saved ?? undefined,
      vscode.ConfigurationTarget.WorkspaceFolder
    );
    await context.workspaceState.update(key, undefined);
  }
  await setActive(context, false);
  vscode.window.showInformationMessage(l10n("focus.exited"));
}
