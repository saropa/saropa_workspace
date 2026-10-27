// Command handlers for the Notes view: new, new-from-clipboard, delete, rename,
// open-folder, and refresh. Each command emits visible feedback that names the
// item acted on (no silent async). The scope picker (project vs global) is shown
// only when a workspace folder is open; otherwise notes default to global.
import * as path from "path";
import * as vscode from "vscode";
import { NoteStore, ensureDir, ensureNoteExtension } from "../model/noteStore";
import { NoteTreeItem } from "../views/notesProvider";
import { l10n } from "../i18n/l10n";
import { formatBytes } from "../utils/formatBytes";
import { markdownToHtml } from "./noteMarkdown";

// Re-exported so existing import paths keep working.
export { markdownToHtml } from "./noteMarkdown";

interface ScopePickItem extends vscode.QuickPickItem {
  readonly scope: "project" | "global";
}

/** Registers every Notes view command; each handler is a named function below. */
export function registerNoteCommands(
  context: vscode.ExtensionContext,
  store: NoteStore
): void {
  const reg = (id: string, handler: (...args: unknown[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  };

  reg("saropaWorkspace.newNote", () => createNoteFlow(store, undefined));
  reg("saropaWorkspace.newNoteFromClipboard", () => newNoteFromClipboard(store));
  reg("saropaWorkspace.deleteNote", (arg: unknown) => deleteNote(store, arg));
  reg("saropaWorkspace.renameNote", (arg: unknown) => renameNote(store, arg));
  reg("saropaWorkspace.openNotesFolder", () => openNotesFolder(store));
  reg("saropaWorkspace.copyNoteContent", (arg: unknown) =>
    copyNote(arg, "copy failed", "notes.copied", (text) => text)
  );
  reg("saropaWorkspace.copyNoteLink", (arg: unknown) => copyNoteLink(arg));
  reg("saropaWorkspace.copyNoteHtml", (arg: unknown) =>
    copyNote(arg, "copy as HTML failed", "notes.copiedHtml", markdownToHtml)
  );
  reg("saropaWorkspace.refreshNotes", () => {
    store.fire();
  });
}

/**
 * Shared body of "New Note" and "New Note from Clipboard": pick a scope, ask for
 * a name, create the file, then open it. `content` is the initial text, if any.
 */
async function createNoteFlow(
  store: NoteStore,
  content: string | undefined
): Promise<void> {
  const scope = await pickNoteScope();
  if (!scope) {
    return;
  }
  const name = await vscode.window.showInputBox({
    prompt: l10n("notes.newPrompt"),
    placeHolder: l10n("notes.newPlaceholder"),
    validateInput: validateNoteName,
  });
  if (!name) {
    return;
  }
  const uri = await store.createNote(name, scope, content);
  if (uri) {
    await vscode.window.showTextDocument(uri);
    void vscode.window.showInformationMessage(
      l10n("notes.created", { name: ensureNoteExtension(name) })
    );
  } else {
    void vscode.window.showWarningMessage(
      l10n("notes.renameCollision", { name: ensureNoteExtension(name) })
    );
  }
}

/** Creates a note seeded with the clipboard text; warns when it is empty. */
async function newNoteFromClipboard(store: NoteStore): Promise<void> {
  const clip = await vscode.env.clipboard.readText();
  if (!clip) {
    void vscode.window.showWarningMessage(l10n("notes.clipboardEmpty"));
    return;
  }
  await createNoteFlow(store, clip);
}

/** Deletes the selected note after a modal confirmation. */
async function deleteNote(store: NoteStore, arg: unknown): Promise<void> {
  const item = asNoteItem(arg);
  if (!item) {
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    l10n("notes.deleteConfirm", { name: item.note.filename }),
    { modal: true },
    l10n("notes.deleteAction")
  );
  if (!confirm) {
    return;
  }
  await store.deleteNote(item.note.uri);
  void vscode.window.showInformationMessage(
    l10n("notes.deleted", { name: item.note.filename })
  );
}

/** Renames the selected note; a name collision is reported, not overwritten. */
async function renameNote(store: NoteStore, arg: unknown): Promise<void> {
  const item = asNoteItem(arg);
  if (!item) {
    return;
  }
  const oldName = item.note.filename.replace(/\.[^.]+$/, "");
  const newName = await vscode.window.showInputBox({
    prompt: l10n("notes.renamePrompt", { name: item.note.filename }),
    value: oldName,
    validateInput: validateNoteName,
  });
  if (!newName || newName === oldName) {
    return;
  }
  const newUri = await store.renameNote(item.note.uri, newName);
  if (newUri) {
    await vscode.window.showTextDocument(newUri);
    void vscode.window.showInformationMessage(
      l10n("notes.renamed", {
        oldName: item.note.filename,
        newName: ensureNoteExtension(newName),
      })
    );
  } else {
    void vscode.window.showWarningMessage(
      l10n("notes.renameCollision", { name: ensureNoteExtension(newName) })
    );
  }
}

/** Reveals the project notes folder (or the global one) in the OS file manager. */
async function openNotesFolder(store: NoteStore): Promise<void> {
  const dir = store.projectNotesDir() ?? store.globalNotesDir();
  await ensureDir(dir);
  await vscode.commands.executeCommand(
    "revealFileInOS",
    vscode.Uri.file(dir.fsPath)
  );
}

/**
 * Reads a note for the clipboard. Returns the text, or undefined after showing
 * the matching warning when the file is too large or looks binary.
 */
async function readNoteForClipboard(
  item: NoteTreeItem
): Promise<string | undefined> {
  const raw = await vscode.workspace.fs.readFile(item.note.uri);
  if (raw.byteLength > COPY_SIZE_LIMIT) {
    void vscode.window.showWarningMessage(
      l10n("notes.copyTooLarge", {
        name: item.note.filename,
        size: formatBytes(raw.byteLength),
      })
    );
    return undefined;
  }
  if (hasBinaryContent(raw)) {
    void vscode.window.showWarningMessage(
      l10n("notes.copyBinary", { name: item.note.filename })
    );
    return undefined;
  }
  return Buffer.from(raw).toString("utf-8");
}

/**
 * Copies a note's text (after `transform`) to the clipboard. `failLabel` names
 * the operation in the console log; `doneKey` is the success message key.
 */
async function copyNote(
  arg: unknown,
  failLabel: string,
  doneKey: "notes.copied" | "notes.copiedHtml",
  transform: (text: string) => string
): Promise<void> {
  const item = asNoteItem(arg);
  if (!item) {
    return;
  }
  try {
    const text = await readNoteForClipboard(item);
    if (text === undefined) {
      return;
    }
    await vscode.env.clipboard.writeText(transform(text));
    void vscode.window.showInformationMessage(
      l10n(doneKey, { name: item.note.filename })
    );
  } catch (err) {
    reportCopyFailure(failLabel, item, err);
  }
}

/** Copies a Markdown link to the note, using a workspace-relative path when possible. */
async function copyNoteLink(arg: unknown): Promise<void> {
  const item = asNoteItem(arg);
  if (!item) {
    return;
  }
  try {
    const folder = vscode.workspace.workspaceFolders?.[0];
    let displayPath = item.note.filename;
    if (folder) {
      const rel = vscode.workspace.asRelativePath(item.note.uri, false);
      if (!path.isAbsolute(rel)) {
        displayPath = rel;
      }
    }
    const link = `[${item.note.filename}](${displayPath})`;
    await vscode.env.clipboard.writeText(link);
    void vscode.window.showInformationMessage(
      l10n("notes.copiedLink", { name: item.note.filename })
    );
  } catch (err) {
    reportCopyFailure("copy link failed", item, err);
  }
}

/** Logs a clipboard-copy failure and tells the user which note it was. */
function reportCopyFailure(label: string, item: NoteTreeItem, err: unknown): void {
  console.error(`[Notes] ${label}:`, item.note.uri.fsPath, err);
  void vscode.window.showWarningMessage(
    l10n("notes.copyFailed", { name: item.note.filename })
  );
}

/** Narrows a command argument to a Notes tree item (or undefined). */
function asNoteItem(arg: unknown): NoteTreeItem | undefined {
  return arg instanceof NoteTreeItem ? arg : undefined;
}

/** Largest note the copy commands will put on the clipboard. */
const COPY_SIZE_LIMIT = 5 * 1024 * 1024; // 5 MB

// Rejects files that would produce garbled clipboard content: UTF-16 BOMs
// (whose null-interleaved bytes decode wrongly as UTF-8) and null bytes in
// the first 8 KB (a standard binary heuristic).
export function hasBinaryContent(raw: Uint8Array): boolean {
  if (raw.length >= 2) {
    if (raw[0] === 0xff && raw[1] === 0xfe) { return true; } // UTF-16 LE BOM
    if (raw[0] === 0xfe && raw[1] === 0xff) { return true; } // UTF-16 BE BOM
  }
  const sample = Math.min(raw.length, 8192);
  for (let i = 0; i < sample; i++) {
    if (raw[i] === 0) {
      return true;
    }
  }
  return false;
}

// Windows reserved device names that cannot be used as filenames.
const RESERVED_NAMES = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

/**
 * Input-box validator for note names: returns an error message, or undefined
 * when the name is usable as a file name on every platform.
 */
export function validateNoteName(value: string): string | undefined {
  if (!value.trim()) {
    return l10n("notes.nameRequired");
  }
  if (/[/\\:*?"<>|]/.test(value)) {
    return l10n("notes.nameInvalidChars");
  }
  if (/[. ]$/.test(value)) {
    return l10n("notes.nameTrailingDotSpace");
  }
  const stem = value.replace(/\.[^.]+$/, "").toLowerCase();
  if (RESERVED_NAMES.has(stem)) {
    return l10n("notes.nameReserved", { name: stem.toUpperCase() });
  }
  return undefined;
}

/** Asks project vs global; skips the prompt (global) when no folder is open. */
async function pickNoteScope(): Promise<"project" | "global" | undefined> {
  if (!vscode.workspace.workspaceFolders?.length) {
    return "global";
  }
  const items: ScopePickItem[] = [
    {
      label: l10n("notes.scopeProject"),
      description: l10n("notes.scopeProjectDesc"),
      scope: "project",
    },
    {
      label: l10n("notes.scopeGlobal"),
      description: l10n("notes.scopeGlobalDesc"),
      scope: "global",
    },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: l10n("notes.scopePrompt"),
  });
  return picked?.scope;
}
