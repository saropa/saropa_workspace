// Extra vscode stand-ins used by the Release Board host tests: Disposable, the diagnostic
// severities and the Problems panel read. Re-exported by vscode.ts so "vscode" still
// resolves to one module.

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

