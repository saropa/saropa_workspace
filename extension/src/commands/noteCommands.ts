// Command handlers for the Notes view: new, new-from-clipboard, delete, rename,
// open-folder, and refresh. Each command emits visible feedback that names the
// item acted on (no silent async). The scope picker (project vs global) is shown
// only when a workspace folder is open; otherwise notes default to global.
import * as vscode from "vscode";
import { NoteStore, ensureDir, ensureNoteExtension } from "../model/noteStore";
import { NoteTreeItem } from "../views/notesProvider";
import { l10n } from "../i18n/l10n";

interface ScopePickItem extends vscode.QuickPickItem {
  readonly scope: "project" | "global";
}

export function registerNoteCommands(
  context: vscode.ExtensionContext,
  store: NoteStore
): void {
  const reg = (id: string, handler: (...args: unknown[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  };

  reg("saropaWorkspace.newNote", async () => {
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
    const uri = await store.createNote(name, scope);
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
  });

  reg("saropaWorkspace.newNoteFromClipboard", async () => {
    const clip = await vscode.env.clipboard.readText();
    if (!clip) {
      void vscode.window.showWarningMessage(l10n("notes.clipboardEmpty"));
      return;
    }
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
    const uri = await store.createNote(name, scope, clip);
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
  });

  reg("saropaWorkspace.deleteNote", async (arg: unknown) => {
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
  });

  reg("saropaWorkspace.renameNote", async (arg: unknown) => {
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
        l10n("notes.renameCollision", {
          name: ensureNoteExtension(newName),
        })
      );
    }
  });

  reg("saropaWorkspace.openNotesFolder", async () => {
    const dir = store.projectNotesDir() ?? store.globalNotesDir();
    await ensureDir(dir);
    await vscode.commands.executeCommand(
      "revealFileInOS",
      vscode.Uri.file(dir.fsPath)
    );
  });

  reg("saropaWorkspace.copyNoteContent", async (arg: unknown) => {
    const item = asNoteItem(arg);
    if (!item) {
      return;
    }
    try {
      const stat = await vscode.workspace.fs.stat(item.note.uri);
      if (stat.size > COPY_SIZE_LIMIT) {
        void vscode.window.showWarningMessage(
          l10n("notes.copyTooLarge", {
            name: item.note.filename,
            size: formatBytes(stat.size),
          })
        );
        return;
      }
      const raw = await vscode.workspace.fs.readFile(item.note.uri);
      if (hasBinaryContent(raw)) {
        void vscode.window.showWarningMessage(
          l10n("notes.copyBinary", { name: item.note.filename })
        );
        return;
      }
      const text = Buffer.from(raw).toString("utf-8");
      await vscode.env.clipboard.writeText(text);
      void vscode.window.showInformationMessage(
        l10n("notes.copied", { name: item.note.filename })
      );
    } catch (err) {
      console.error("[Notes] copy failed:", item.note.uri.fsPath, err);
      void vscode.window.showWarningMessage(
        l10n("notes.copyFailed", { name: item.note.filename })
      );
    }
  });

  reg("saropaWorkspace.copyNoteLink", async (arg: unknown) => {
    const item = asNoteItem(arg);
    if (!item) {
      return;
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    const displayPath = folder
      ? vscode.workspace.asRelativePath(item.note.uri, false)
      : item.note.filename;
    const link = `[${item.note.filename}](${displayPath})`;
    await vscode.env.clipboard.writeText(link);
    void vscode.window.showInformationMessage(
      l10n("notes.copiedLink", { name: item.note.filename })
    );
  });

  reg("saropaWorkspace.refreshNotes", () => {
    store.fire();
  });
}

function asNoteItem(arg: unknown): NoteTreeItem | undefined {
  return arg instanceof NoteTreeItem ? arg : undefined;
}

const COPY_SIZE_LIMIT = 5 * 1024 * 1024; // 5 MB

export function hasBinaryContent(raw: Uint8Array): boolean {
  const sample = Math.min(raw.length, 8192);
  for (let i = 0; i < sample; i++) {
    if (raw[i] === 0) {
      return true;
    }
  }
  return false;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Windows reserved device names that cannot be used as filenames.
const RESERVED_NAMES = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

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
