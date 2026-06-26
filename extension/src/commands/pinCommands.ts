import * as vscode from "vscode";
import { PinStore } from "../model/pinStore";
import { DoubleClickDispatcher } from "../exec/doubleClick";
import { telemetry } from "../exec/telemetry";
import { showRunAnalytics } from "./runAnalytics";
import { configureBootSequence, runBootSequence } from "./bootSequence";
import { exportPinSet, importPinSet } from "./pinSetExport";
import { editPinsConfig } from "./editConfig";
import { newScratchpad } from "./scratchpad";
import { saveLayout, restoreLayout } from "./layoutPins";
import { suggestFromHistory } from "./ghostPins";
import { switchEnvProfile } from "./envProfiles";
import { enterFocusMode, exitFocusMode } from "./focusMode";
import { l10n } from "../i18n/l10n";
// The pin helpers and the two sub-registrars split out of this file. The body below
// registers the workspace/run/open commands and delegates per-pin config and the
// group/pinning/recipes/favorites commands to the sub-registrars.
import {
  openPin,
  peekPin,
  toggleTail,
  toggleMask,
  registerTailFollow,
} from "./pinInteraction";
import {
  runPinCommand,
  runWithLastParams,
  newRoutineFromSelection,
} from "./pinExecution";
import {
  asPin,
  resolvePinRef,
  runAnyPin,
  runPinWithOverrides,
  runTopPin,
  TOP_PIN_SLOTS,
} from "./pinSelection";
import { registerPinConfigCommands } from "./pinConfigCommands";
import { registerPinManagementCommands } from "./pinManagementCommands";

// Re-exported so extension.ts keeps importing the routine hooks factory from here.
export { createRoutineHooks } from "./pinExecution";

export function registerPinCommands(
  context: vscode.ExtensionContext,
  store: PinStore,
  dispatcher: DoubleClickDispatcher
): void {
  const reg = (id: string, handler: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));

  // The manual Refresh is the user's explicit "re-scan now" — clear the cached
  // glob/detection so newly-added files matching auto-pin patterns or new recipes
  // surface (a plain refresh reuses the caches for speed).
  reg("saropaWorkspace.refresh", () => store.rescan());

  reg("saropaWorkspace.runAnyPin", () => runAnyPin(store));

  // Compose the multi-selected pins into one routine pin (runs them in sequence). The
  // tree passes (clickedItem, allSelectedItems[]) for a multi-select context action.
  reg("saropaWorkspace.newRoutineFromSelection", (item?: unknown, items?: unknown) =>
    newRoutineFromSelection(store, item, Array.isArray(items) ? items : [])
  );

  reg("saropaWorkspace.runPinWithOverrides", () => runPinWithOverrides(store));

  // Clear the local, on-device run history (the Recent group + palette recents).
  // Modal confirm because it is not undoable; the data never left the machine, so
  // there is nothing else to revoke.
  reg("saropaWorkspace.resetRunHistory", async () => {
    const confirm = l10n("telemetry.resetConfirmAction");
    const choice = await vscode.window.showWarningMessage(
      l10n("telemetry.resetConfirm"),
      { modal: true },
      confirm
    );
    if (choice === confirm) {
      await telemetry.reset();
      vscode.window.showInformationMessage(l10n("telemetry.resetDone"));
    }
  });

  // Open the on-demand local run-analytics summary (most-run pins, totals, the
  // session's success/failure split, last-run times) as a read-only Markdown
  // preview. Reads only on-device state; transmits nothing.
  reg("saropaWorkspace.showRunAnalytics", () => showRunAnalytics(store));

  // Define/reorder/enable the ordered pin set that runs on workspace open, and
  // run it on demand. The open-time confirm is wired in activate(); these are the
  // explicit, user-invoked entry points.
  reg("saropaWorkspace.configureBootSequence", () => configureBootSequence(store));
  reg("saropaWorkspace.runBootSequence", () => runBootSequence(store));

  // Export the user's pins (and their groups) to a shareable, versioned file, and
  // import such a file back in. Import is idempotent and additive — it never
  // overwrites existing pins, only adds the ones not already present.
  reg("saropaWorkspace.exportPins", () => exportPinSet(store));
  reg("saropaWorkspace.importPins", () => importPinSet(store));

  // Open the raw project pins JSON for direct editing; the file watcher in
  // activate() refreshes the tree live when it is saved.
  reg("saropaWorkspace.editPinsConfig", () => editPinsConfig());

  // Focus the Explorer on pinned files only by driving files.exclude (hide
  // everything not on the path to a favorite), and restore it. Two commands gated
  // by the saropaWorkspace.focusActive context key so the title reads "Focus on
  // Pinned Files" when off and "Exit Focus on Pinned Files" when on.
  reg("saropaWorkspace.focusPinnedFiles", () => enterFocusMode(store, context));
  reg("saropaWorkspace.exitFocusPinnedFiles", () => exitFocusMode(context));

  // Open a throwaway in-memory scratch buffer (WOW #6): an untitled doc that never
  // touches disk and never shows in git status. No store interaction — it is a pure
  // editor action — so it takes no pin/store argument.
  reg("saropaWorkspace.newScratchpad", () => newScratchpad());

  // Save / restore a named editor-grid layout (WOW #19). Pure editor actions backed
  // by globalState (passed the extension context), so they take no pin/store arg.
  reg("saropaWorkspace.saveLayout", () => saveLayout(context));
  reg("saropaWorkspace.restoreLayout", () => restoreLayout(context));

  // Suggest pins from frequently-typed shell commands (WOW #2): scans local shell
  // history read-only and offers the repeated complex commands as new shell pins.
  reg("saropaWorkspace.suggestFromHistory", () => suggestFromHistory(store));

  // Swap the active .env between the project's .env.<name> profiles (WOW #10). A
  // pure file action — no pin/store argument.
  reg("saropaWorkspace.switchEnvProfile", () => switchEnvProfile());

  // Bind a specific pin to a key. The keybinding's `args` is matched against a
  // pin's id, label, file path, or basename (in that order), so a user can bind
  // by a human-friendly reference instead of an opaque id:
  //   { "key": "...", "command": "saropaWorkspace.runPinById", "args": "deploy.sh" }
  reg("saropaWorkspace.runPinById", (ref: unknown) => {
    const pin = resolvePinRef(store, ref);
    if (pin) {
      void runPinCommand(store, pin);
    } else {
      vscode.window.showWarningMessage(l10n("runTop.notFound", { ref: String(ref) }));
    }
  });

  // Generic "run the Nth pin" commands, bindable without knowing any id. The Nth
  // pin is the Nth in the tree's order (project pins, then global) — reorder pins
  // by dragging to designate which are "top". One command per slot so each binds
  // to its own key.
  for (let slot = 1; slot <= TOP_PIN_SLOTS; slot++) {
    reg(`saropaWorkspace.runTopPin${slot}`, () => runTopPin(store, slot));
  }

  // Click dispatcher entry point: defer to single/double-click logic by pin id.
  reg("saropaWorkspace.activatePin", (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      dispatcher.activate(pin.id);
    }
  });

  reg("saropaWorkspace.openPin", (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      void openPin(store, pin);
    }
  });

  reg("saropaWorkspace.peekPin", (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      void peekPin(store, pin);
    }
  });

  // Tail-follow (WOW #5): toggle "auto-scroll to the end as the file grows" on a
  // file pin, and wire the listeners that keep followed docs pinned to their tail.
  reg("saropaWorkspace.toggleTail", (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      void toggleTail(store, pin);
    }
  });
  registerTailFollow(context);

  // Masked / vault pin (WOW #26): toggle the screen-share guard on a stored file
  // pin — hides its identity in the tree and gates the open behind a reveal confirm.
  reg("saropaWorkspace.toggleMask", (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      void toggleMask(store, pin);
    }
  });

  reg("saropaWorkspace.runPin", (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      void runPinCommand(store, pin);
    }
  });

  // "Run now" — the same run path as runPin, exposed under a distinct title so a
  // scheduled pin's context menu reads "Run now" (firing ahead of the timer is
  // intentional) rather than a generic "Run". The handler is identical; only the
  // label differs, gated by the pinScheduled / pinRecipeScheduled contextValue.
  reg("saropaWorkspace.runPinNow", (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      void runPinCommand(store, pin);
    }
  });

  reg("saropaWorkspace.runPinLastParams", (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      void runWithLastParams(store, pin);
    }
  });

  registerPinConfigCommands(context, store);
  registerPinManagementCommands(context, store);
}
