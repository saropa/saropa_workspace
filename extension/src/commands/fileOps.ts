import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Shortcut, shortcutKind, ShortcutScope } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { runStatusRegistry } from "../exec/runStatus";
import { l10n } from "../i18n/l10n";

// Lightweight file-manager operations on a file shortcut's target, run from the Shortcuts
// view (roadmap Later / Exploratory: "Filesystem operations from the tree"). The Shortcuts
// view already lists the files a user actually works with; these let them create,
// duplicate, rename, copy, and delete those files without round-tripping through the
// Explorer. All five act on a file shortcut's resolved target; a non-file shortcut (recipe /
// url / shell / command / macro) has no file on disk and is rejected with a naming
// message. The plain "Duplicate File" here is distinct from "Use as Template…",
// which copies AND rewrites the file's identifiers across case styles — this one is
// a byte-for-byte copy.

// The shortcut's display name for messages: its label, else the target's basename.
function shortcutName(shortcut: Shortcut): string {
  return shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
}

// Resolve a file shortcut to its on-disk URI, surfacing the same warnings the open/run
// paths use when the shortcut is not a file or cannot be resolved. Returns undefined
// (after showing the message) when there is nothing to act on.
function resolveFileShortcut(store: ShortcutStore, shortcut: Shortcut): vscode.Uri | undefined {
  if (shortcutKind(shortcut) !== "file") {
    vscode.window.showWarningMessage(l10n("fileOps.notFile", { name: shortcutName(shortcut) }));
    return undefined;
  }
  const uri = store.resolveUri(shortcut);
  if (!uri) {
    vscode.window.showWarningMessage(l10n("pin.missingFile", { path: shortcut.path }));
    return undefined;
  }
  return uri;
}

// Whether a URI already exists on disk. Used to avoid clobbering a file with a copy
// or rename — an overwritten file is unrecoverable from here.
async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

// Find a non-colliding "<base> <suffix>[ n]<ext>" URI in a directory, so Duplicate
// never overwrites: "report.md" -> "report copy.md" -> "report copy 2.md" -> …
// Bounded so a directory already full of copies cannot loop forever; the caller
// treats undefined as "could not find a free name".
async function uniqueSiblingUri(
  dir: vscode.Uri,
  base: string,
  ext: string,
  suffix: string
): Promise<vscode.Uri | undefined> {
  for (let n = 1; n <= 1000; n++) {
    const tag = n === 1 ? suffix : `${suffix} ${n}`;
    const candidate = vscode.Uri.joinPath(dir, `${base} ${tag}${ext}`);
    if (!(await exists(candidate))) {
      return candidate;
    }
  }
  return undefined;
}

// Add a freshly-created file as a shortcut in the SAME scope as the shortcut it came
// from, so a duplicate of a project shortcut becomes a project shortcut and a duplicate
// of a global shortcut becomes a global one. A project shortcut requires the file to sit
// inside a workspace folder; a file created beside an existing project shortcut always
// does, so addShortcut succeeds. Failure to add is non-fatal — the file exists and is
// open regardless — so it is logged via the returned flag, not thrown.
async function addNewShortcut(
  store: ShortcutStore,
  uri: vscode.Uri,
  scope: ShortcutScope
): Promise<void> {
  // A file outside any workspace folder cannot be a project shortcut; fall back to a
  // global shortcut so the new file is still saved rather than silently dropped.
  const inFolder = vscode.workspace.getWorkspaceFolder(uri) !== undefined;
  const effective: ShortcutScope = scope === "project" && !inFolder ? "global" : scope;
  await store.addShortcut(uri, effective);
}

// Create a new, empty file in the shortcut file's own directory, add it as a shortcut
// (same scope), and open it. The Shortcuts-view counterpart to right-clicking a folder
// in the Explorer and choosing New File, but anchored to where the user's shortcut files
// already live.
export async function newFileHere(store: ShortcutStore, shortcut: Shortcut): Promise<void> {
  const uri = resolveFileShortcut(store, shortcut);
  if (!uri) {
    return;
  }
  const dir = vscode.Uri.joinPath(uri, "..");
  const ext = path.extname(uri.fsPath);
  const name = await vscode.window.showInputBox({
    title: l10n("fileOps.newTitle"),
    prompt: l10n("fileOps.newPrompt"),
    // Pre-fill the source file's extension so a new sibling of the same type takes
    // one keystroke (type the base, keep the extension).
    value: ext,
    valueSelection: [0, 0],
    validateInput: (v) =>
      v.trim().length === 0 ? l10n("fileOps.newEmpty") : undefined,
  });
  if (name === undefined) {
    return;
  }
  const target = vscode.Uri.joinPath(dir, name.trim());
  if (await exists(target)) {
    vscode.window.showWarningMessage(
      l10n("fileOps.exists", { name: name.trim() })
    );
    return;
  }
  await vscode.workspace.fs.writeFile(target, new Uint8Array());
  await addNewShortcut(store, target, shortcut.scope);
  await vscode.window.showTextDocument(target, { preview: false });
  vscode.window.showInformationMessage(
    l10n("fileOps.created", { name: name.trim() })
  );
}

// Byte-for-byte copy of the shortcut file into a non-colliding sibling, added as a
// shortcut (same scope) and opened. Distinct from "Use as Template…", which also
// rewrites the file's identifiers; this is a plain copy for when the user just wants
// another one.
export async function duplicateFile(store: ShortcutStore, shortcut: Shortcut): Promise<void> {
  const uri = resolveFileShortcut(store, shortcut);
  if (!uri) {
    return;
  }
  if (!(await exists(uri))) {
    vscode.window.showWarningMessage(l10n("pin.missingFile", { path: shortcut.path }));
    return;
  }
  const dir = vscode.Uri.joinPath(uri, "..");
  const ext = path.extname(uri.fsPath);
  const base = path.basename(uri.fsPath, ext);
  const target = await uniqueSiblingUri(dir, base, ext, l10n("fileOps.copySuffix"));
  if (!target) {
    vscode.window.showWarningMessage(l10n("fileOps.copyNoName", { name: base }));
    return;
  }
  // copy() with overwrite:false is belt-and-suspenders given uniqueSiblingUri
  // already proved the target is free; it guards a file racing into existence
  // between the check and the copy.
  await vscode.workspace.fs.copy(uri, target, { overwrite: false });
  await addNewShortcut(store, target, shortcut.scope);
  await vscode.window.showTextDocument(target, { preview: false });
  const newName = target.path.split("/").pop() ?? target.fsPath;
  vscode.window.showInformationMessage(
    l10n("fileOps.duplicated", { name: newName, source: base + ext })
  );
}

// Rename the shortcut file on disk and re-point the shortcut at the new name, so the
// shortcut (and its run config, schedule, icon) survives the rename intact. A project
// shortcut can only be re-pointed inside its own workspace folder; a rename keeps the
// file in the same directory, so that always holds. The file is renamed first, then the
// shortcut updated — if the shortcut update somehow fails, the file move has still
// happened, and updateShortcutPath is a pure metadata write that does not fail for an
// in-folder target.
export async function renameFileOnDisk(store: ShortcutStore, shortcut: Shortcut): Promise<void> {
  const uri = resolveFileShortcut(store, shortcut);
  if (!uri) {
    return;
  }
  if (!(await exists(uri))) {
    vscode.window.showWarningMessage(l10n("pin.missingFile", { path: shortcut.path }));
    return;
  }
  const dir = vscode.Uri.joinPath(uri, "..");
  const current = uri.path.split("/").pop() ?? uri.fsPath;
  const ext = path.extname(current);
  const input = await vscode.window.showInputBox({
    title: l10n("fileOps.renameTitle", { name: current }),
    prompt: l10n("fileOps.renamePrompt"),
    value: current,
    // Select the base name (not the extension) so the common case — change the
    // name, keep the type — is a straight overtype.
    valueSelection: [0, current.length - ext.length],
    validateInput: (v) =>
      v.trim().length === 0 ? l10n("fileOps.newEmpty") : undefined,
  });
  if (input === undefined || input.trim() === current) {
    return;
  }
  const target = vscode.Uri.joinPath(dir, input.trim());
  if (await exists(target)) {
    vscode.window.showWarningMessage(
      l10n("fileOps.exists", { name: input.trim() })
    );
    return;
  }
  await vscode.workspace.fs.rename(uri, target, { overwrite: false });
  // Re-point the shortcut so it keeps tracking the file under its new name. An
  // auto-shortcut or recipe shortcut has no stored path to update (it is recomputed),
  // so the rename there simply removes the matched file; that is acceptable and rare.
  await store.updateShortcutPath(shortcut, target);
  vscode.window.showInformationMessage(
    l10n("fileOps.renamed", { from: current, to: input.trim() })
  );
}

// Copy the shortcut file into a user-picked folder (the one-step "copy then paste
// elsewhere" gesture, without a hidden clipboard). Aborts rather than overwrite an
// existing file at the destination. The copy is NOT added as a shortcut — it landed
// somewhere the user chose, which may be outside the workspace; they can add it from
// there if they want.
export async function copyFileTo(store: ShortcutStore, shortcut: Shortcut): Promise<void> {
  const uri = resolveFileShortcut(store, shortcut);
  if (!uri) {
    return;
  }
  if (!(await exists(uri))) {
    vscode.window.showWarningMessage(l10n("pin.missingFile", { path: shortcut.path }));
    return;
  }
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFiles: false,
    canSelectFolders: true,
    openLabel: l10n("fileOps.copyToOpenLabel"),
    title: l10n("fileOps.copyToTitle", { name: shortcutName(shortcut) }),
  });
  if (!picked || picked.length === 0) {
    return;
  }
  const fileName = uri.path.split("/").pop() ?? uri.fsPath;
  const target = vscode.Uri.joinPath(picked[0], fileName);
  if (await exists(target)) {
    vscode.window.showWarningMessage(l10n("fileOps.exists", { name: fileName }));
    return;
  }
  await vscode.workspace.fs.copy(uri, target, { overwrite: false });
  const reveal = l10n("fileOps.revealAction");
  const choice = await vscode.window.showInformationMessage(
    l10n("fileOps.copiedTo", {
      name: fileName,
      folder: picked[0].path.split("/").pop() ?? picked[0].fsPath,
    }),
    reveal
  );
  if (choice === reveal) {
    await vscode.commands.executeCommand("revealFileInOS", target);
  }
}

// Delete the shortcut file from disk (to the OS trash, so it is recoverable) after a
// modal confirm that names the file, then offer to remove the now-dangling shortcut.
// The shortcut is NOT auto-removed: a deletion may be deliberate-but-temporary, and
// leaving the shortcut lets the user relocate or re-create the file. useTrash means the
// file is recoverable from the OS trash, so this is not the irreversible operation a
// hard delete would be.
export async function deleteFile(store: ShortcutStore, shortcut: Shortcut): Promise<void> {
  const uri = resolveFileShortcut(store, shortcut);
  if (!uri) {
    return;
  }
  const fileName = uri.path.split("/").pop() ?? uri.fsPath;
  if (!(await exists(uri))) {
    vscode.window.showWarningMessage(l10n("pin.missingFile", { path: shortcut.path }));
    return;
  }
  const confirm = l10n("fileOps.deleteConfirmAction");
  const choice = await vscode.window.showWarningMessage(
    l10n("fileOps.deleteConfirm", { name: fileName }),
    { modal: true, detail: l10n("fileOps.deleteDetail") },
    confirm
  );
  if (choice !== confirm) {
    return;
  }
  await vscode.workspace.fs.delete(uri, { useTrash: true });
  // The file is gone; offer to drop the shortcut too. Declining keeps the shortcut so
  // it can be relocated to a moved/re-created file later (the shortcut flags itself
  // missing).
  const remove = l10n("fileOps.deleteUnpinAction");
  const after = await vscode.window.showInformationMessage(
    l10n("fileOps.deleted", { name: fileName }),
    remove
  );
  if (after === remove) {
    await store.removeShortcut(shortcut);
    // Drop any last-run badge so it does not outlive the shortcut.
    runStatusRegistry.clear(shortcut.id);
  }
}

// The owner-write bit (0o200). A file is "writable" when this bit is set in its
// mode. Toggling it is how a read-only lock is set/cleared cross-platform: on
// Windows, Node maps clearing owner-write to the FILE_ATTRIBUTE_READONLY attribute
// and restoring it clears the attribute; on POSIX it flips the actual write bits.
const OWNER_WRITE = 0o200;

// Lock / unlock the shortcut file at the FILESYSTEM level by toggling its read-only
// attribute (not a VS Code-only guard) — the "stop me (or a script) from clobbering
// this by accident" gesture, straight from the Shortcuts view. A single toggle rather
// than two commands because the lock state is an OS attribute, not stored on the
// shortcut, so it is read live here and the toast names the resulting state
// (locked/unlocked) and the file. Read-only is cleared from owner-write only;
// group/other bits are preserved so a deliberate POSIX permission set is not flattened.
// A non-file shortcut is rejected with a naming message, like the other file operations.
export async function toggleFileLock(store: ShortcutStore, shortcut: Shortcut): Promise<void> {
  const uri = resolveFileShortcut(store, shortcut);
  if (!uri) {
    return;
  }
  const fileName = uri.path.split("/").pop() ?? uri.fsPath;
  let mode: number;
  try {
    mode = (await fs.promises.stat(uri.fsPath)).mode;
  } catch {
    // Missing/unreadable target: same stance as the other file ops — name it and stop
    // rather than failing the chmod with a cryptic errno.
    vscode.window.showWarningMessage(l10n("pin.missingFile", { path: shortcut.path }));
    return;
  }
  const currentlyWritable = (mode & OWNER_WRITE) !== 0;
  // Locking clears owner-write; unlocking restores it. Preserve every other permission
  // bit so a lock/unlock round-trip is a no-op on group/other permissions.
  const nextMode = currentlyWritable
    ? mode & ~OWNER_WRITE
    : mode | OWNER_WRITE;
  try {
    await fs.promises.chmod(uri.fsPath, nextMode);
  } catch (err) {
    vscode.window.showErrorMessage(
      l10n("fileOps.lockFailed", {
        name: fileName,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return;
  }
  // Name the file and the resulting state so the confirmation ties to a concrete
  // shortcut and tells the user what changed (the no-silent-async / name-the-item rules).
  vscode.window.showInformationMessage(
    currentlyWritable
      ? l10n("fileOps.locked", { name: fileName })
      : l10n("fileOps.unlocked", { name: fileName })
  );
}
