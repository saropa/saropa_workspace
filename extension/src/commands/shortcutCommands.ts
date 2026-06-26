import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { DoubleClickDispatcher } from "../exec/doubleClick";
import { telemetry } from "../exec/telemetry";
import { showRunAnalytics } from "./runAnalytics";
import { configureBootSequence, runBootSequence } from "./bootSequence";
import { exportShortcutSet, importShortcutSet } from "./shortcutSetExport";
import { editShortcutsConfig } from "./editConfig";
import { newScratchpad } from "./scratchpad";
import { saveLayout, restoreLayout } from "./layoutShortcuts";
import { suggestFromHistory } from "./ghostShortcuts";
import { switchEnvProfile } from "./envProfiles";
import { enterFocusMode, exitFocusMode } from "./focusMode";
import { l10n } from "../i18n/l10n";
// The shortcut helpers and the two sub-registrars split out of this file. The body below
// registers the workspace/run/open commands and delegates per-shortcut config and the
// group/adding/recipes/favorites commands to the sub-registrars.
import {
  openShortcut,
  peekShortcut,
  toggleTail,
  toggleMask,
  registerTailFollow,
} from "./shortcutInteraction";
import {
  runShortcutCommand,
  runWithLastParams,
  newRoutineFromSelection,
} from "./shortcutExecution";
import {
  resolveShortcutRef,
  runAnyShortcut,
  runShortcutWithOverrides,
  runTopShortcut,
  TOP_SHORTCUT_SLOTS,
} from "./shortcutSelection";
import { registerPinConfigCommands } from "./shortcutConfigCommands";
import { registerPinManagementCommands } from "./shortcutManagementCommands";
import { shortcutCommandRegistrar } from "./registerHelpers";

// Re-exported so extension.ts keeps importing the routine hooks factory from here.
export { createRoutineHooks } from "./shortcutExecution";

export function registerShortcutCommands(
  context: vscode.ExtensionContext,
  store: ShortcutStore,
  dispatcher: DoubleClickDispatcher
): void {
  const { reg, regShortcut } = shortcutCommandRegistrar(context);

  // The manual Refresh is the user's explicit "re-scan now" — clear the cached
  // glob/detection so newly-added files matching auto-shortcut patterns or new recipes
  // surface (a plain refresh reuses the caches for speed).
  reg("saropaWorkspace.refresh", () => store.rescan());

  reg("saropaWorkspace.runAnyPin", () => runAnyShortcut(store));

  // Compose the multi-selected shortcuts into one routine shortcut (runs them in sequence). The
  // tree passes (clickedItem, allSelectedItems[]) for a multi-select context action.
  reg("saropaWorkspace.newRoutineFromSelection", (item?: unknown, items?: unknown) =>
    newRoutineFromSelection(store, item, Array.isArray(items) ? items : [])
  );

  reg("saropaWorkspace.runPinWithOverrides", () => runShortcutWithOverrides(store));

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

  // Open the on-demand local run-analytics summary (most-run shortcuts, totals, the
  // session's success/failure split, last-run times) as a read-only Markdown
  // preview. Reads only on-device state; transmits nothing.
  reg("saropaWorkspace.showRunAnalytics", () => showRunAnalytics(store));

  // Define/reorder/enable the ordered shortcut set that runs on workspace open, and
  // run it on demand. The open-time confirm is wired in activate(); these are the
  // explicit, user-invoked entry points.
  reg("saropaWorkspace.configureBootSequence", () => configureBootSequence(store));
  reg("saropaWorkspace.runBootSequence", () => runBootSequence(store));

  // Export the user's shortcuts (and their groups) to a shareable, versioned file, and
  // import such a file back in. Import is idempotent and additive — it never
  // overwrites existing shortcuts, only adds the ones not already present.
  reg("saropaWorkspace.exportPins", () => exportShortcutSet(store));
  reg("saropaWorkspace.importPins", () => importShortcutSet(store));

  // Open the raw project shortcuts JSON for direct editing; the file watcher in
  // activate() refreshes the tree live when it is saved.
  reg("saropaWorkspace.editPinsConfig", () => editShortcutsConfig());

  // Focus the Explorer on shortcut files only by driving files.exclude (hide
  // everything not on the path to a shortcut), and restore it. Two commands gated
  // by the saropaWorkspace.focusActive context key so the title reads "Focus on
  // Pinned Files" when off and "Exit Focus on Pinned Files" when on.
  reg("saropaWorkspace.focusPinnedFiles", () => enterFocusMode(store, context));
  reg("saropaWorkspace.exitFocusPinnedFiles", () => exitFocusMode(context));

  // Open a throwaway in-memory scratch buffer (WOW #6): an untitled doc that never
  // touches disk and never shows in git status. No store interaction — it is a pure
  // editor action — so it takes no shortcut/store argument.
  reg("saropaWorkspace.newScratchpad", () => newScratchpad());

  // Save / restore a named editor-grid layout (WOW #19). Pure editor actions backed
  // by globalState (passed the extension context), so they take no shortcut/store arg.
  reg("saropaWorkspace.saveLayout", () => saveLayout(context));
  reg("saropaWorkspace.restoreLayout", () => restoreLayout(context));

  // Suggest shortcuts from frequently-typed shell commands (WOW #2): scans local shell
  // history read-only and offers the repeated complex commands as new shell shortcuts.
  reg("saropaWorkspace.suggestFromHistory", () => suggestFromHistory(store));

  // Swap the active .env between the project's .env.<name> profiles (WOW #10). A
  // pure file action — no shortcut/store argument.
  reg("saropaWorkspace.switchEnvProfile", () => switchEnvProfile());

  // Bind a specific shortcut to a key. The keybinding's `args` is matched against a
  // shortcut's id, label, file path, or basename (in that order), so a user can bind
  // by a human-friendly reference instead of an opaque id:
  //   { "key": "...", "command": "saropaWorkspace.runPinById", "args": "deploy.sh" }
  reg("saropaWorkspace.runPinById", (ref: unknown) => {
    const shortcut = resolveShortcutRef(store, ref);
    if (shortcut) {
      void runShortcutCommand(store, shortcut);
    } else {
      vscode.window.showWarningMessage(l10n("runTop.notFound", { ref: String(ref) }));
    }
  });

  // Generic "run the Nth shortcut" commands, bindable without knowing any id. The Nth
  // shortcut is the Nth in the tree's order (project shortcuts, then global) — reorder
  // shortcuts by dragging to designate which are "top". One command per slot so each binds
  // to its own key.
  for (let slot = 1; slot <= TOP_SHORTCUT_SLOTS; slot++) {
    reg(`saropaWorkspace.runTopPin${slot}`, () => runTopShortcut(store, slot));
  }

  // Click dispatcher entry point: defer to single/double-click logic by shortcut id.
  regShortcut("saropaWorkspace.activatePin", (shortcut) => dispatcher.activate(shortcut.id));

  regShortcut("saropaWorkspace.openPin", (shortcut) => void openShortcut(store, shortcut));
  regShortcut("saropaWorkspace.peekPin", (shortcut) => void peekShortcut(store, shortcut));

  // Tail-follow (WOW #5): toggle "auto-scroll to the end as the file grows" on a
  // file shortcut, and wire the listeners that keep followed docs pinned to their tail.
  regShortcut("saropaWorkspace.toggleTail", (shortcut) => void toggleTail(store, shortcut));
  registerTailFollow(context);

  // Masked / vault shortcut (WOW #26): toggle the screen-share guard on a stored file
  // shortcut — hides its identity in the tree and gates the open behind a reveal confirm.
  regShortcut("saropaWorkspace.toggleMask", (shortcut) => void toggleMask(store, shortcut));

  regShortcut("saropaWorkspace.runPin", (shortcut) => void runShortcutCommand(store, shortcut));

  // "Run now" — the same run path as runPin, exposed under a distinct title so a
  // scheduled shortcut's context menu reads "Run now" (firing ahead of the timer is
  // intentional) rather than a generic "Run". The handler is identical; only the
  // label differs, gated by the pinScheduled / pinRecipeScheduled contextValue.
  regShortcut("saropaWorkspace.runPinNow", (shortcut) => void runShortcutCommand(store, shortcut));

  regShortcut("saropaWorkspace.runPinLastParams", (shortcut) => void runWithLastParams(store, shortcut));

  registerPinConfigCommands(context, store);
  registerPinManagementCommands(context, store);
}
