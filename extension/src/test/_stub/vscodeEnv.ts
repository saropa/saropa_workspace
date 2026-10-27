// vscode.env stand-in for the test stub: a recording clipboard and openExternal, so a test
// can assert what was copied or opened. Split out of vscode.ts to keep that file small.

import type { Uri } from "./vscodeTypes";
import { __clipboardWrites, clearClipboardWrites, recordClipboardWrite } from "./vscodeExtras";

const externalOpens: string[] = [];

/** Stub of `vscode.env`: only the clipboard and openExternal the extension uses. */
export const env = {
  clipboard: {
    async writeText(value: string): Promise<void> {
      recordClipboardWrite(value);
    },
    async readText(): Promise<string> {
      const writes = __clipboardWrites();
      return writes[writes.length - 1] ?? "";
    },
  },
  async openExternal(target: Uri): Promise<boolean> {
    externalOpens.push(target.toString());
    return true;
  },
};

/** Test hook: the URLs openExternal was called with since the last reset, in order. */
export function __externalOpens(): readonly string[] {
  return externalOpens;
}

/** Test hook: empties the clipboard and the opened-URL log. */
export function __resetEnv(): void {
  clearClipboardWrites();
  externalOpens.length = 0;
}
