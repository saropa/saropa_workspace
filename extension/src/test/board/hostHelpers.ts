// Shared setup for the Release Board host-layer tests: a temp folder and an extension
// context whose storage points at it.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { fakeContext } from "../_stub/context";

// A fresh empty temp folder.
export function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "board-host-"));
}

// An in-memory context whose extension storage is the given folder.
export function contextIn(dir: string): vscode.ExtensionContext {
  return { ...fakeContext(), storageUri: vscode.Uri.file(dir), globalStorageUri: vscode.Uri.file(dir), subscriptions: [] } as vscode.ExtensionContext;
}

// The stub's test-control hooks, typed.
export const stub = vscode as unknown as {
  __setConfig(section: string, key: string, value: unknown): void;
  __setConfigAt(scope: "workspace" | "folder", section: string, key: string, value: unknown): void;
  __setWarningAnswer(next: (message: string, items: string[]) => string | undefined): void;
  __resetWarnings(): void;
  __warningMessages(): readonly string[];
  __resetConfig(): void;
  __setWorkspaceFolders(f: Array<{ uri: vscode.Uri; name: string; index: number }> | undefined): void;
  __resetRecordedCommands(): void;
  __recordedCommands(): ReadonlyArray<{ command: string; args: unknown[] }>;
  __setInstalledExtensions(ids: string[]): void;
  __setDiagnostics(next: Array<[vscode.Uri, Array<{ severity: number }>]>): void;
  __registeredCommands(): ReadonlyMap<string, (...args: unknown[]) => unknown>;
};
