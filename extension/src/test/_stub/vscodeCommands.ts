// vscode.commands for the test stub: registered handlers (callable through
// __registeredCommands) and a log of executeCommand calls. Split out of vscode.ts.

import { Disposable } from "./vscodeExtras";

// commands.executeCommand: the analytics preview calls it to open the Markdown
// preview, but the unit-tested path (buildReport) never reaches it. Modeled as an
// inert async no-op. Each call is recorded so a test that DOES care which command
// ran (the branch-set binder's on-switch shortcut runner) can assert it; the recording
// is cleared by __resetRecordedCommands.
const recordedCommands: Array<{ command: string; args: unknown[] }> = [];
// vscode.commands stand-in: executeCommand is an inert no-op that records the
// call, so a test that cares which command ran can assert against it afterward.
/** Stub of `vscode.commands`: registers handlers and records executed commands. */
export const commands = {
  // Keeps the handler so a test can call it through __registeredCommands.
  registerCommand(command: string, handler: (...args: unknown[]) => unknown): Disposable {
    registeredCommands.set(command, handler);
    return new Disposable(() => registeredCommands.delete(command));
  },
  executeCommand(command: string, ...rest: unknown[]): Promise<undefined> {
    recordedCommands.push({ command, args: rest });
    return Promise.resolve(undefined);
  },
};

// Handlers added by commands.registerCommand, by command id.
const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();
// The handlers registered with commands.registerCommand, by command id.
export function __registeredCommands(): ReadonlyMap<string, (...args: unknown[]) => unknown> {
  return registeredCommands;
}

// The commands executeCommand was called with since the last reset, for tests that
// assert a side-effecting command fired (e.g. saropaWorkspace.runPin).
export function __recordedCommands(): ReadonlyArray<{
  command: string;
  args: unknown[];
}> {
  return recordedCommands;
}
// Test-control hook: clears the recorded executeCommand call log between tests.
export function __resetRecordedCommands(): void {
  recordedCommands.length = 0;
}

