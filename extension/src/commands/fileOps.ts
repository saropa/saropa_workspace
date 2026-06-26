import * as vscode from "vscode";
import * as path from "path";
import { Pin, pinKind, PinScope } from "../model/pin";
import { PinStore } from "../model/pinStore";
import { runStatusRegistry } from "../exec/runStatus";
import { l10n } from "../i18n/l10n";

// Lightweight file-manager operations on a pinned file, run from the Pins view
// (roadmap Later / Exploratory: "Filesystem operations from the tree"). The Pins
// view already lists the files a user actually works with; these let them create,
// duplicate, rename, copy, and delete those files without round-tripping through the
// Explorer. All five act on a file pin's resolved target; a non-file pin (recipe /
// url / shell / command / macro) has no file on disk and is rejected with a naming
// message. The plain "Duplicate File" here is distinct from "Use as Template…",
// which copies AND rewrites the file's identifiers across case styles — this one is
// a byte-for-byte copy.

// The pin's display name for messages: its label, else the target's basename.
function pinName(pin: Pin): string {
  return pin.label ?? (pin.path.split("/").pop() ?? pin.path);
}

// Resolve a file pin to its on-disk URI, surfacing the same warnings the open/run
// paths use when the pin is not a file or cannot be resolved. Returns undefined
// (after showing the message) when there is nothing to act on.
function resolveFilePin(store: PinStore, pin: Pin): vscode.Uri | undefined {
  if (pinKind(pin) !== "file") {
    vscode.window.showWarningMessage(l10n("fileOps.notFile", { name: pinName(pin) }));
    return undefined;
  }
  const uri = store.resolveUri(pin);
  if (!uri) {
    vscode.window.showWarningMessage(l10n("pin.missingFile", { path: pin.path }));
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

// Pin a freshly-created file in the SAME scope as the pin it came from, so a
// duplicate of a project pin becomes a project pin and a duplicate of a global pin
// becomes a global one. A project pin requires the file to sit inside a workspace
// folder; a file created beside an existing project pin always does, so addPin
// succeeds. Failure to pin is non-fatal — the file exists and is open regardless —
// so it is logged via the returned flag, not thrown.
async function pinNewFile(
  store: PinStore,
  uri: vscode.Uri,
  scope: PinScope
): Promise<void> {
  // A file outside any workspace folder cannot be a project pin; fall back to a
  // global pin so the new file is still pinned rather than silently unpinned.
  const inFolder = vscode.workspace.getWorkspaceFolder(uri) !== undefined;
  const effective: PinScope = scope === "project" && !inFolder ? "global" : scope;
  await store.addPin(uri, effective);
}

// Create a new, empty file in the pinned file's own directory, pin it (same scope),
// and open it. The Pins-view counterpart to right-clicking a folder in the Explorer
// and choosing New File, but anchored to where the user's pinned files already live.
export async function newFileHere(store: PinStore, pin: Pin): Promise<void> {
  const uri = resolveFilePin(store, pin);
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
  await pinNewFile(store, target, pin.scope);
  await vscode.window.showTextDocument(target, { preview: false });
  vscode.window.showInformationMessage(
    l10n("fileOps.created", { name: name.trim() })
  );
}

// Byte-for-byte copy of the pinned file into a non-colliding sibling, pinned (same
// scope) and opened. Distinct from "Use as Template…", which also rewrites the
// file's identifiers; this is a plain copy for when the user just wants another one.
export async function duplicateFile(store: PinStore, pin: Pin): Promise<void> {
  const uri = resolveFilePin(store, pin);
  if (!uri) {
    return;
  }
  if (!(await exists(uri))) {
    vscode.window.showWarningMessage(l10n("pin.missingFile", { path: pin.path }));
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
  await pinNewFile(store, target, pin.scope);
  await vscode.window.showTextDocument(target, { preview: false });
  const newName = target.path.split("/").pop() ?? target.fsPath;
  vscode.window.showInformationMessage(
    l10n("fileOps.duplicated", { name: newName, source: base + ext })
  );
}

// Rename the pinned file on disk and re-point the pin at the new name, so the pin
// (and its run config, schedule, icon) survives the rename intact. A project pin
// can only be re-pointed inside its own workspace folder; a rename keeps the file
// in the same directory, so that always holds. The file is renamed first, then the
// pin updated — if the pin update somehow fails, the file move has still happened,
// and updatePinPath is a pure metadata write that does not fail for an in-folder
// target.
export async function renameFileOnDisk(store: PinStore, pin: Pin): Promise<void> {
  const uri = resolveFilePin(store, pin);
  if (!uri) {
    return;
  }
  if (!(await exists(uri))) {
    vscode.window.showWarningMessage(l10n("pin.missingFile", { path: pin.path }));
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
  // Re-point the pin so it keeps tracking the file under its new name. An auto-pin
  // or recipe pin has no stored path to update (it is recomputed), so the rename
  // there simply removes the matched file; that is acceptable and rare.
  await store.updatePinPath(pin, target);
  vscode.window.showInformationMessage(
    l10n("fileOps.renamed", { from: current, to: input.trim() })
  );
}

// Copy the pinned file into a user-picked folder (the one-step "copy then paste
// elsewhere" gesture, without a hidden clipboard). Aborts rather than overwrite an
// existing file at the destination. The copy is NOT pinned — it landed somewhere the
// user chose, which may be outside the workspace; they can pin it from there if they
// want.
export async function copyFileTo(store: PinStore, pin: Pin): Promise<void> {
  const uri = resolveFilePin(store, pin);
  if (!uri) {
    return;
  }
  if (!(await exists(uri))) {
    vscode.window.showWarningMessage(l10n("pin.missingFile", { path: pin.path }));
    return;
  }
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFiles: false,
    canSelectFolders: true,
    openLabel: l10n("fileOps.copyToOpenLabel"),
    title: l10n("fileOps.copyToTitle", { name: pinName(pin) }),
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

// Delete the pinned file from disk (to the OS trash, so it is recoverable) after a
// modal confirm that names the file, then offer to unpin the now-dangling pin. The
// pin is NOT auto-removed: a deletion may be deliberate-but-temporary, and leaving
// the pin lets the user relocate or re-create the file. useTrash means the file is
// recoverable from the OS trash, so this is not the irreversible operation a hard
// delete would be.
export async function deleteFile(store: PinStore, pin: Pin): Promise<void> {
  const uri = resolveFilePin(store, pin);
  if (!uri) {
    return;
  }
  const fileName = uri.path.split("/").pop() ?? uri.fsPath;
  if (!(await exists(uri))) {
    vscode.window.showWarningMessage(l10n("pin.missingFile", { path: pin.path }));
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
  // The file is gone; offer to drop the pin too. Declining keeps the pin so it can
  // be relocated to a moved/re-created file later (the pin flags itself missing).
  const unpin = l10n("fileOps.deleteUnpinAction");
  const after = await vscode.window.showInformationMessage(
    l10n("fileOps.deleted", { name: fileName }),
    unpin
  );
  if (after === unpin) {
    await store.removePin(pin);
    // Drop any last-run badge so it does not outlive the pin.
    runStatusRegistry.clear(pin.id);
  }
}
