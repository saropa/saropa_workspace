// Extra vscode stand-ins used by the Release Board host tests: Disposable, the diagnostic
// severities, the Problems panel read, recorded warning dialogs and a rename-only edit. Re-exported by vscode.ts so "vscode" still
// resolves to one module.

import * as nodeFs from "node:fs";

// vscode.Disposable: runs the given function once on dispose. `from` bundles several.
export class Disposable {
  private done = false;
  constructor(private readonly fn: () => void) {}
  static from(...items: Array<{ dispose(): unknown }>): Disposable {
    return new Disposable(() => items.forEach((d) => d.dispose()));
  }
  dispose(): void {
    if (!this.done) {
      this.done = true;
      this.fn();
    }
  }
}

// vscode.DiagnosticSeverity: the board counts Problems by severity. Real numeric values.
export const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3,
} as const;

// Diagnostics (the Problems panel) as [uri, diagnostics] pairs, settable per test.
let diagnostics: Array<[{ toString(): string }, Array<{ severity: number }>]> = [];
// Test-control hook: installs what languages.getDiagnostics returns.
export function __setDiagnostics(next: Array<[{ toString(): string }, Array<{ severity: number }>]>): void {
  diagnostics = next;
}
// vscode.languages stand-in: only the Problems panel read.
export const languages = {
  getDiagnostics(): Array<[{ toString(): string }, Array<{ severity: number }>]> {
    return diagnostics;
  },
};


// Warning dialogs: every call is recorded and answered by a handler a test can replace. The
// default answer is "no choice" (the dialog was dismissed).
type Answer = (message: string, items: string[]) => string | undefined;
let warnings: string[] = [];
let answer: Answer = () => undefined;
// The messages window.showWarningMessage was called with since the last reset.
export function __warningMessages(): readonly string[] {
  return warnings;
}
// Test-control hook: chooses what a warning dialog answers (an item label, or undefined).
export function __setWarningAnswer(next: Answer): void {
  answer = next;
}
// Test-control hook: clears the recorded warnings, information messages and clipboard
// writes, and restores the dismiss-everything answers.
export function __resetWarnings(): void {
  warnings = [];
  answer = () => undefined;
  __resetInfo();
  clipboard = [];
}
// window.showWarningMessage: options objects are skipped, labels are passed to the handler.
export function recordWarning(message: string, rest: unknown[]): Promise<string | undefined> {
  warnings.push(message);
  return Promise.resolve(answer(message, rest.filter((x): x is string => typeof x === "string")));
}

// Every text written to the clipboard since the last reset, oldest first. vscode.env (in
// vscodeEnv.ts) records its writes here, so one reset clears them with the toasts.
let clipboard: string[] = [];
// Every text written to the clipboard since the last reset, oldest first.
export function __clipboardWrites(): readonly string[] {
  return clipboard;
}
// Called by env.clipboard.writeText.
export function recordClipboardWrite(text: string): void {
  clipboard.push(text);
}
// Test-control hook: forgets the recorded clipboard writes.
export function clearClipboardWrites(): void {
  clipboard = [];
}

// Information toasts: recorded like warnings, answered by a replaceable handler (default: dismissed).
let infos: string[] = [];
let infoAnswer: Answer = () => undefined;
// The messages window.showInformationMessage was called with since the last reset.
export function __infoMessages(): readonly string[] {
  return infos;
}
/** One information toast with the options object and button labels it was shown with. */
export interface InfoCall {
  readonly message: string;
  readonly options: unknown;
  readonly buttons: readonly string[];
}
let infoCalls: InfoCall[] = [];
// The full calls (message, options such as modal and detail, buttons) since the last reset.
export function __infoCalls(): readonly InfoCall[] {
  return infoCalls;
}
// Test-control hook: chooses what an information toast answers (a button label, or undefined).
export function __setInfoAnswer(next: Answer): void {
  infoAnswer = next;
}
// Test-control hook: clears the recorded information toasts and restores the dismiss answer.
export function __resetInfo(): void {
  infos = [];
  infoCalls = [];
  infoAnswer = () => undefined;
}
// window.showInformationMessage: option objects are skipped, labels are passed to the handler.
export function recordInfo(message: string, rest: unknown[]): Promise<string | undefined> {
  infos.push(message);
  const buttons = rest.filter((x): x is string => typeof x === "string");
  infoCalls.push({ message, options: rest.find((x) => typeof x === "object"), buttons });
  return Promise.resolve(infoAnswer(message, buttons));
}

// vscode.WorkspaceEdit, rename only: renameFile is queued and applyEdit performs it on disk.
export class WorkspaceEdit {
  readonly renames: Array<{ from: { fsPath: string }; to: { fsPath: string } }> = [];
  renameFile(from: { fsPath: string }, to: { fsPath: string }, _options?: unknown): void {
    this.renames.push({ from, to });
  }
  readonly creates: Array<{ fsPath: string; text: string }> = [];
  createFile(target: { fsPath: string }, _options?: unknown): void {
    this.creates.push({ fsPath: target.fsPath, text: "" });
  }
  insert(target: { fsPath: string }, _at: unknown, text: string): void {
    const c = this.creates.find((x) => x.fsPath === target.fsPath);
    if (c) {
      c.text += text;
    }
  }
}
// workspace.applyEdit: renames on disk; refuses (false) when a destination already exists.
export function applyEdit(edit: WorkspaceEdit): Promise<boolean> {
  if (edit.renames.some((r) => nodeFs.existsSync(r.to.fsPath))) {
    return Promise.resolve(false);
  }
  if (edit.creates.some((c) => nodeFs.existsSync(c.fsPath))) {
    return Promise.resolve(false);
  }
  edit.creates.forEach((c) => nodeFs.writeFileSync(c.fsPath, c.text));
  edit.renames.forEach((r) => nodeFs.renameSync(r.from.fsPath, r.to.fsPath));
  return Promise.resolve(true);
}
