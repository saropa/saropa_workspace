import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";

// A scratch format the user can pick: a display label, the codicon shown beside it
// in the picker, and the VS Code language id that drives syntax highlighting. No
// file extension is involved — the buffer is never written to disk.
interface ScratchFormat {
  label: string;
  icon: string;
  languageId: string;
}

// The offered formats, covering the throwaway buffers developers reach for most
// (notes, a JSON payload, a SQL query, a JS snippet, plain text). Ordered most-
// common first so the default highlighted item fits the typical case.
function scratchFormats(): ScratchFormat[] {
  return [
    { label: l10n("scratch.format.markdown"), icon: "markdown", languageId: "markdown" },
    { label: l10n("scratch.format.json"), icon: "json", languageId: "json" },
    { label: l10n("scratch.format.sql"), icon: "database", languageId: "sql" },
    { label: l10n("scratch.format.javascript"), icon: "symbol-method", languageId: "javascript" },
    { label: l10n("scratch.format.plaintext"), icon: "file", languageId: "plaintext" },
  ];
}

// Open a throwaway in-memory scratch buffer (WOW #6): an untitled document that
// lives only while VS Code is open, never touches disk, and never shows up in
// `git status` — the clean alternative to littering the repo root with temp.json /
// scratch.md / query.sql. The user picks a format for highlighting; Escape cancels.
//
// untitled: documents are in-memory only. An empty untitled buffer is discarded
// silently on close (no save prompt), so a scratchpad never nags or persists unless
// the user deliberately saves it somewhere.
export async function newScratchpad(): Promise<void> {
  const formats = scratchFormats();
  const items: (vscode.QuickPickItem & { languageId: string })[] = formats.map(
    (format) => ({
      label: format.label,
      iconPath: new vscode.ThemeIcon(format.icon),
      languageId: format.languageId,
    })
  );
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: l10n("scratch.placeholder"),
  });
  if (!picked) {
    return;
  }
  const doc = await vscode.workspace.openTextDocument({
    language: picked.languageId,
    content: "",
  });
  await vscode.window.showTextDocument(doc, { preview: false });
  // Name the format in the toast so the action is tied to what was created, and
  // tell the user the one fact that makes a scratchpad safe to use freely: it is
  // memory-only and invisible to git until they choose to save it.
  vscode.window.showInformationMessage(
    l10n("scratch.created", { format: picked.label })
  );
}
