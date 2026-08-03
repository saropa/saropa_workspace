// Command handlers for the Notes view: new, new-from-clipboard, delete, rename,
// open-folder, and refresh. Each command emits visible feedback that names the
// item acted on (no silent async). The scope picker (project vs global) is shown
// only when a workspace folder is open; otherwise notes default to global.
import * as path from "path";
import * as vscode from "vscode";
import { NoteStore, ensureDir, ensureNoteExtension } from "../model/noteStore";
import { NoteTreeItem } from "../views/notesProvider";
import { l10n } from "../i18n/l10n";
import { formatBytes } from "../exec/metricFormat";

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
      const raw = await vscode.workspace.fs.readFile(item.note.uri);
      if (raw.byteLength > COPY_SIZE_LIMIT) {
        void vscode.window.showWarningMessage(
          l10n("notes.copyTooLarge", {
            name: item.note.filename,
            size: formatBytes(raw.byteLength),
          })
        );
        return;
      }
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
      console.error("[Notes] copy link failed:", item.note.uri.fsPath, err);
      void vscode.window.showWarningMessage(
        l10n("notes.copyFailed", { name: item.note.filename })
      );
    }
  });

  reg("saropaWorkspace.copyNoteHtml", async (arg: unknown) => {
    const item = asNoteItem(arg);
    if (!item) {
      return;
    }
    try {
      const raw = await vscode.workspace.fs.readFile(item.note.uri);
      if (raw.byteLength > COPY_SIZE_LIMIT) {
        void vscode.window.showWarningMessage(
          l10n("notes.copyTooLarge", {
            name: item.note.filename,
            size: formatBytes(raw.byteLength),
          })
        );
        return;
      }
      if (hasBinaryContent(raw)) {
        void vscode.window.showWarningMessage(
          l10n("notes.copyBinary", { name: item.note.filename })
        );
        return;
      }
      const text = Buffer.from(raw).toString("utf-8");
      const html = markdownToHtml(text);
      await vscode.env.clipboard.writeText(html);
      void vscode.window.showInformationMessage(
        l10n("notes.copiedHtml", { name: item.note.filename })
      );
    } catch (err) {
      console.error("[Notes] copy as HTML failed:", item.note.uri.fsPath, err);
      void vscode.window.showWarningMessage(
        l10n("notes.copyFailed", { name: item.note.filename })
      );
    }
  });

  reg("saropaWorkspace.refreshNotes", () => {
    store.fire();
  });
}

function asNoteItem(arg: unknown): NoteTreeItem | undefined {
  return arg instanceof NoteTreeItem ? arg : undefined;
}

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

/**
 * Converts common Markdown constructs to HTML for rich-text clipboard paste.
 * Covers headings, bold, italic, inline code, code blocks, links, images,
 * unordered/ordered lists, blockquotes, horizontal rules, and paragraphs.
 * Not a full CommonMark parser — intentionally minimal with zero dependencies.
 */
export function markdownToHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inCode = false;
  let inList: "ul" | "ol" | null = null;
  let inBlockquote = false;

  const esc = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const inlineMarkup = (line: string): string => {
    let s = esc(line);
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/__(.+?)__/g, "<strong>$1</strong>");
    s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
    s = s.replace(/_(.+?)_/g, "<em>$1</em>");
    return s;
  };

  const closeList = (): void => {
    if (inList) {
      out.push(inList === "ul" ? "</ul>" : "</ol>");
      inList = null;
    }
  };

  const closeBlockquote = (): void => {
    if (inBlockquote) {
      out.push("</blockquote>");
      inBlockquote = false;
    }
  };

  for (const raw of lines) {
    const line = raw;

    if (/^```/.test(line)) {
      if (inCode) {
        out.push("</code></pre>");
        inCode = false;
      } else {
        closeList();
        closeBlockquote();
        out.push("<pre><code>");
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      out.push(esc(line));
      continue;
    }

    if (/^---+$|^\*\*\*+$|^___+$/.test(line.trim())) {
      closeList();
      closeBlockquote();
      out.push("<hr>");
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      closeList();
      closeBlockquote();
      const level = headingMatch[1].length;
      out.push(`<h${level}>${inlineMarkup(headingMatch[2])}</h${level}>`);
      continue;
    }

    const bqMatch = line.match(/^>\s?(.*)/);
    if (bqMatch) {
      closeList();
      if (!inBlockquote) {
        out.push("<blockquote>");
        inBlockquote = true;
      }
      out.push(`<p>${inlineMarkup(bqMatch[1])}</p>`);
      continue;
    }

    const ulMatch = line.match(/^[\s]*[-*+]\s+(.*)/);
    if (ulMatch) {
      closeBlockquote();
      if (inList !== "ul") {
        closeList();
        out.push("<ul>");
        inList = "ul";
      }
      out.push(`<li>${inlineMarkup(ulMatch[1])}</li>`);
      continue;
    }

    const olMatch = line.match(/^[\s]*\d+\.\s+(.*)/);
    if (olMatch) {
      closeBlockquote();
      if (inList !== "ol") {
        closeList();
        out.push("<ol>");
        inList = "ol";
      }
      out.push(`<li>${inlineMarkup(olMatch[1])}</li>`);
      continue;
    }

    closeList();
    closeBlockquote();

    if (!line.trim()) {
      continue;
    }

    out.push(`<p>${inlineMarkup(line)}</p>`);
  }

  if (inCode) { out.push("</code></pre>"); }
  closeList();
  closeBlockquote();

  return out.join("\n");
}
