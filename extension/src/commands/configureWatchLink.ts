import * as vscode from "vscode";
import { Shortcut } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { l10n } from "../i18n/l10n";

// "Run This Shortcut When a File Changes" (#25 — cross-file watch links). A QuickPick hub
// to manage the glob patterns that trigger a shortcut on another file's save: list the
// current watches, add one by picking a file or typing a glob, remove individual
// entries, and save. The drag-to-link gesture from the pitch is deferred — the tree's
// internal drag already means "reorder," so dropping a file-shortcut onto a script-shortcut to
// link it would collide with that; this unambiguous command ships first.
//
// Edits accumulate in a local working copy; nothing persists until the user chooses
// Save (or Save & Clear when the list is emptied). Dismissing the hub (Esc) discards
// the working copy, so a canceled edit never reaches disk.

interface HubItem extends vscode.QuickPickItem {
  // "remove:<glob>" carries the glob to drop; the rest are fixed actions.
  id: string;
}

// "Run This Shortcut When a File Changes" command entry point (#25). Warns and exits
// for an auto-shortcut (nowhere to persist watch globs); otherwise loops a hub over a
// working copy of the glob list — add by file picker or typed glob, remove an entry —
// and persists it via setShortcutWatchGlobs on Save (or clears it when emptied).
export async function configureWatchLink(store: ShortcutStore, shortcut: Shortcut): Promise<void> {
  // Auto/recipe shortcuts are recomputed each refresh and never stored, so there is
  // nowhere to persist watch globs; surface that rather than silently failing,
  // matching configureRun's stance.
  if (shortcut.isAuto) {
    vscode.window.showWarningMessage(l10n("configure.autoUnsupported"));
    return;
  }

  const name = shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
  const title = l10n("watch.title", { name });
  // Working copy of the globs; de-duplicated as entries are added.
  const globs = [...(shortcut.exec?.runOnSaveGlobs ?? [])];

  for (;;) {
    const choice = await showHub(globs, title, name);
    if (!choice) {
      // Esc: discard the working copy, persist nothing.
      return;
    }
    if (choice === "save") {
      break;
    }
    if (choice === "addFile") {
      await addByFile(globs);
    } else if (choice === "addGlob") {
      await addByGlob(globs, name);
    } else if (choice.startsWith("remove:")) {
      const target = choice.slice("remove:".length);
      const at = globs.indexOf(target);
      if (at !== -1) {
        globs.splice(at, 1);
      }
    }
  }

  await store.setShortcutWatchGlobs(shortcut, globs);
  vscode.window.showInformationMessage(
    globs.length > 0
      ? l10n("watch.saved", { name, globs: globs.join(", ") })
      : l10n("watch.cleared", { name })
  );
}

// Render the hub: each current glob as a removable row, then the add actions and Save.
async function showHub(
  globs: string[],
  title: string,
  name: string
): Promise<string | undefined> {
  const items: HubItem[] = [
    ...globs.map((glob) => ({
      id: `remove:${glob}`,
      label: l10n("watch.remove", { glob }),
      iconPath: new vscode.ThemeIcon("close"),
    })),
    {
      id: "addFile",
      label: l10n("watch.addFile"),
      detail: l10n("watch.addFileDetail"),
      iconPath: new vscode.ThemeIcon("file"),
    },
    {
      id: "addGlob",
      label: l10n("watch.addGlob"),
      detail: l10n("watch.addGlobDetail"),
      iconPath: new vscode.ThemeIcon("symbol-string"),
    },
    {
      id: "save",
      label: l10n("watch.save"),
      detail: l10n("watch.saveDetail", { name }),
      iconPath: new vscode.ThemeIcon("check"),
    },
  ];

  // ignoreFocusOut: dismissing discards every edit, so only a deliberate Esc closes
  // the hub — a stray click outside must not lose the working copy.
  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder:
      globs.length > 0
        ? l10n("watch.hubPlaceholder")
        : l10n("watch.hubPlaceholderEmpty"),
    ignoreFocusOut: true,
  });
  return pick?.id;
}

// Pick a file and store its workspace-relative path as an exact-match glob. A literal
// path (no wildcards) matches only that one file, which is the common "watch this
// specific file" case; the user can broaden it later via Add a glob.
async function addByFile(globs: string[]): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: l10n("watch.openLabel"),
    title: l10n("watch.openTitle"),
  });
  if (!picked || picked.length === 0) {
    return;
  }
  // asRelativePath returns forward slashes and the absolute path for a file outside
  // the workspace — either form is matched by the save listener.
  const rel = vscode.workspace.asRelativePath(picked[0], false).replace(/\\/g, "/");
  addUnique(globs, rel);
}

// Type a glob pattern directly (e.g. **/*.graphql, src/**).
async function addByGlob(globs: string[], name: string): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: l10n("watch.title", { name }),
    prompt: l10n("watch.globPrompt", { name }),
    placeHolder: l10n("watch.globPlaceholder"),
    ignoreFocusOut: true,
    validateInput: (v) =>
      v.trim().length === 0 ? l10n("watch.globEmpty") : undefined,
  });
  if (value === undefined) {
    return;
  }
  const trimmed = value.trim();
  if (trimmed.length > 0) {
    addUnique(globs, trimmed.replace(/\\/g, "/"));
  }
}

// Append a glob unless it is already present (a re-add is a no-op, not a duplicate row).
function addUnique(globs: string[], glob: string): void {
  if (!globs.includes(glob)) {
    globs.push(glob);
  }
}
