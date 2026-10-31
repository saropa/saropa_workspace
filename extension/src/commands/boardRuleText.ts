import { promises as fsp } from "node:fs";
import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";
import { decodeRules } from "../board/ruleAssign";
import { pathExists } from "./boardFileSource";

// Release Board, the read and guard helpers every rules-file write shares: reading the file as
// strict UTF-8, noticing a symbolic link or an unsaved copy open in an editor, and turning a write
// error into one plain sentence. boardRuleAssign re-exports the ones other modules import from it.

// What reading the rules file found: no file, its text, or a file that is not plain UTF-8.
export type RulesRead = { kind: "none" } | { kind: "text"; text: string } | { kind: "encoding" };

// Reads the rules file as strict UTF-8; the guards and Undo compare two reads to see a change made meanwhile.
export async function readRules(uri: vscode.Uri): Promise<RulesRead> {
  if (!(await pathExists(uri))) {
    return { kind: "none" };
  }
  const text = decodeRules(await vscode.workspace.fs.readFile(uri));
  return text === undefined ? { kind: "encoding" } : { kind: "text", text };
}

// True when two reads hold the same thing: the same kind, and for text the same text.
export const sameRead = (a: RulesRead, b: RulesRead): boolean => a.kind === b.kind && (a.kind !== "text" || a.text === (b as { text: string }).text);

// True when the path is a symbolic link (the rules file or its folder): a write would go through it.
export async function isLink(uri: vscode.Uri): Promise<boolean> {
  try {
    return ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.SymbolicLink) !== 0;
  } catch {
    return false;
  }
}

// True when a document open in an editor has unsaved edits and is this file, by its real path or by
// the path the workspace uses (`shown`), compared without regard to letter case so a case-insensitive
// disk cannot hide an open copy. A false positive only leaves the file alone.
export async function hasUnsavedEdits(real: string, shown: vscode.Uri | undefined): Promise<boolean> {
  const names = [real, shown?.fsPath].filter((x): x is string => x !== undefined).map((x) => x.toLowerCase());
  for (const d of vscode.workspace.textDocuments) {
    if (!d.isDirty || d.uri.scheme !== "file") {
      continue;
    }
    if (names.includes(d.uri.fsPath.toLowerCase())) {
      return true;
    }
    try {
      if (names.includes((await fsp.realpath(d.uri.fsPath)).toLowerCase())) {
        return true;
      }
    } catch {
      // A document with no file on disk is not this one.
    }
  }
  return false;
}

// True when the rules file or its folder is a symbolic link: a write would go through it.
export async function linkedRules(root: vscode.WorkspaceFolder, uri: vscode.Uri): Promise<boolean> {
  return (await isLink(vscode.Uri.joinPath(root.uri, ".saropa"))) || (await isLink(uri));
}

// True when the file has unsaved edits open, by the workspace path or the real path (letter case ignored).
export async function hasUnsavedCopy(uri: vscode.Uri): Promise<boolean> {
  return hasUnsavedEdits(await fsp.realpath(uri.fsPath).catch(() => uri.fsPath), uri);
}

// A write error as one plain sentence for the problems list. The raw text goes to the log only.
export function plainWriteError(e: unknown, file: string): string {
  const raw = e instanceof Error ? e.message : String(e);
  console.error(`Release Board: writing ${file} failed: ${raw}`);
  const code = String((e as { code?: unknown } | null)?.code ?? "");
  const text = `${code} ${raw}`;
  const kind = /EACCES|EPERM|EROFS|NoPermissions|permission|read-only/i.test(text)
    ? "permission"
    : /ENOSPC|EDQUOT|no space|disk full/i.test(text)
      ? "space"
      : /ENOENT|FileNotFound|no such file/i.test(text)
        ? "missing"
        : "other";
  return l10n(`releaseBoard.patch.fail.${kind}`, { file });
}
