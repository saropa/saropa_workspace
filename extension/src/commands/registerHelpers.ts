import * as vscode from "vscode";
import { Pin } from "../model/pin";
import { asPin } from "./pinSelection";

// Shared command-registration helpers for the three pin command registrars
// (pinCommands, pinConfigCommands, pinManagementCommands). Before this, each file
// re-declared the same `reg` closure and repeated the `asPin(arg)` guard at the top
// of nearly every handler — the dominant source of length in those registrars.
//
// `reg`    registers a command and pushes its Disposable to context.subscriptions
//          (so it is torn down on reload — a leaked command double-fires).
// `regPin` is the common case: a handler whose only argument is the menu/keybinding
//          target resolved to a Pin. It normalizes the argument via asPin and runs
//          the body only when a pin is present, so each handler drops from a 5-line
//          guard block to one line. Handlers that need the raw argument, extra
//          parameters, or a no-pin branch keep using `reg` directly.
export interface PinCommandRegistrar {
  reg(id: string, handler: (...args: unknown[]) => unknown): void;
  regPin(id: string, run: (pin: Pin) => unknown): void;
}

export function pinCommandRegistrar(
  context: vscode.ExtensionContext
): PinCommandRegistrar {
  const reg = (id: string, handler: (...args: unknown[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  };
  const regPin = (id: string, run: (pin: Pin) => unknown): void => {
    reg(id, (arg: unknown) => {
      const pin = asPin(arg);
      return pin ? run(pin) : undefined;
    });
  };
  return { reg, regPin };
}
