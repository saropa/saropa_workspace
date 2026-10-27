// OutputChannel for the vscode test stub: keeps what was written so a test can read it back.
// Split out of vscode.ts.

/** The stub channel: the OutputChannel surface plus the text written to it. */
export interface FakeOutputChannel {
  readonly name: string;
  /** Every line written with appendLine since the last clear, in order. */
  readonly lines: string[];
  /** Every string written with append since the last clear, in order. */
  readonly appended: string[];
  appendLine(value: string): void;
  append(value: string): void;
  clear(): void;
  show(preserveFocus?: boolean): void;
  hide(): void;
  replace(value: string): void;
  dispose(): void;
}

// The store's getOutputChannel() constructs one lazily on an error/diagnostic path; most
// tests do not read it, but those that do find the lines here.
export function createOutputChannel(name: string): FakeOutputChannel {
  const lines: string[] = [];
  const appended: string[] = [];
  return {
    name,
    lines,
    appended,
    appendLine(value: string): void {
      lines.push(value);
    },
    append(value: string): void {
      appended.push(value);
    },
    clear(): void {
      lines.length = 0;
      appended.length = 0;
    },
    show(): void {},
    hide(): void {},
    replace(): void {},
    dispose(): void {},
  };
}
