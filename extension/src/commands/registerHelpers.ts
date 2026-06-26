import * as vscode from "vscode";
import { Shortcut } from "../model/shortcut";
import { asShortcut } from "./shortcutSelection";

// Shared command-registration helpers for the three shortcut command registrars
// (pinCommands, pinConfigCommands, pinManagementCommands). Before this, each file
// re-declared the same `reg` closure and repeated the `asShortcut(arg)` guard at the top
// of nearly every handler — the dominant source of length in those registrars.
//
// `reg`         registers a command and pushes its Disposable to context.subscriptions
//               (so it is torn down on reload — a leaked command double-fires).
// `regShortcut` is the common case: a handler whose only argument is the menu/keybinding
//               target resolved to a Shortcut. It normalizes the argument via asShortcut
//               and runs the body only when a shortcut is present, so each handler drops
//               from a 5-line guard block to one line. Handlers that need the raw
//               argument, extra parameters, or a no-shortcut branch keep using `reg`
//               directly.
export interface ShortcutCommandRegistrar {
  reg(id: string, handler: (...args: unknown[]) => unknown): void;
  regShortcut(id: string, run: (shortcut: Shortcut) => unknown): void;
}

export function shortcutCommandRegistrar(
  context: vscode.ExtensionContext
): ShortcutCommandRegistrar {
  const reg = (id: string, handler: (...args: unknown[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  };
  const regShortcut = (id: string, run: (shortcut: Shortcut) => unknown): void => {
    reg(id, (arg: unknown) => {
      const shortcut = asShortcut(arg);
      return shortcut ? run(shortcut) : undefined;
    });
  };
  return { reg, regShortcut };
}
