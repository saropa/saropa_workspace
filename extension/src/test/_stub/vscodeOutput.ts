// No-op OutputChannel for the vscode test stub. Split out of vscode.ts.

// A no-op OutputChannel: the store's getOutputChannel() constructs one lazily on an
// error/diagnostic path. The tests do not assert on it; it must only not throw.
export function createOutputChannel(name: string): {
  name: string;
  appendLine(value: string): void;
  append(value: string): void;
  clear(): void;
  show(preserveFocus?: boolean): void;
  hide(): void;
  replace(value: string): void;
  dispose(): void;
} {
  return {
    name,
    appendLine(): void {},
    append(): void {},
    clear(): void {},
    show(): void {},
    hide(): void {},
    replace(): void {},
    dispose(): void {},
  };
}
