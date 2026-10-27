// Shared helper for the command-registrar contract tests: runs a registrar against the
// vscode stub and returns the command ids it registered, in order, so a test can check
// them against the ids package.json declares.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { fakeContext } from "./_stub/context";

/** A context with a subscriptions list, as the real extension host provides. */
export type RegistrarContext = ReturnType<typeof fakeContext> & {
  subscriptions: { dispose(): void }[];
};

/** Builds a fresh context whose subscriptions list collects the registrations. */
export function registrarContext(): RegistrarContext {
  return Object.assign(fakeContext(), { subscriptions: [] as { dispose(): void }[] });
}

/** The package.json found by walking up from `start`, so the test works from src or from the bundle folder. */
function findPackageJson(start: string): string {
  for (let dir = start; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "package.json");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    if (path.dirname(dir) === dir) {
      throw new Error(`package.json not found above ${start}`);
    }
  }
}

/** Every command id package.json declares under contributes.commands, in file order. */
export function declaredCommandIds(): string[] {
  const file = findPackageJson(__dirname);
  const pkg = JSON.parse(fs.readFileSync(file, "utf8")) as {
    contributes: { commands: { command: string }[] };
  };
  return pkg.contributes.commands.map((c) => c.command);
}

/** Runs `register` and returns every id passed to commands.registerCommand, in order. */
export function captureRegistrations(register: () => void): string[] {
  const commands = vscode.commands as unknown as {
    registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => unknown;
  };
  const original = commands.registerCommand;
  const ids: string[] = [];
  commands.registerCommand = (id, handler) => {
    ids.push(id);
    return original.call(vscode.commands, id, handler);
  };
  try {
    register();
  } finally {
    commands.registerCommand = original;
  }
  return ids;
}

/** Ids that appear more than once in the list. */
export function duplicateIds(ids: readonly string[]): string[] {
  return ids.filter((id, i) => ids.indexOf(id) !== i);
}

/** Ids in `ids` that package.json does not declare. */
export function undeclaredIds(ids: readonly string[]): string[] {
  const declared = new Set(declaredCommandIds());
  return ids.filter((id) => !declared.has(id));
}
