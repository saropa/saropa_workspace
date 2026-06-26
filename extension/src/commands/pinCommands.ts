import * as vscode from "vscode";
import { PinStore } from "../model/pinStore";
import { PinFolderItem } from "../views/pinTreeItem";
import { DoubleClickDispatcher } from "../exec/doubleClick";
import { getOutputChannel } from "../exec/runner";
import { processRegistry } from "../exec/processRegistry";
import { runStatusRegistry } from "../exec/runStatus";
import { telemetry } from "../exec/telemetry";
import {
  detectFavoritesFiles,
  detectSettingsFavoritesCount,
  detectSabitovvtFavoritesCount,
  importAllDetected,
  detectSiblingFavorites,
  importSiblingFavorites,
  SiblingFavorites,
} from "../import/favoritesImport";
import { configureRun } from "./configureRun";
import { configureSchedule } from "./configureSchedule";
import { configureTriggers } from "./configureTriggers";
import { configureWatchLink } from "./configureWatchLink";
import { pinUntil, pinUntilBranchChange, clearPinExpiry } from "./configureExpiry";
import { configureAppearance } from "./configureAppearance";
import { tagPin } from "./tagPin";
import { setMetric } from "./setMetric";
import { simulateRun } from "./simulateRun";
import { showRunAnalytics } from "./runAnalytics";
import { configureBootSequence, runBootSequence } from "./bootSequence";
import { exportPinSet, importPinSet } from "./pinSetExport";
import { editPinsConfig } from "./editConfig";
import { newScratchpad } from "./scratchpad";
import { saveLayout, restoreLayout } from "./layoutPins";
import { suggestFromHistory } from "./ghostPins";
import { switchEnvProfile } from "./envProfiles";
import { diffLastRuns } from "./diffRuns";
import { useAsTemplate } from "./templatePin";
import {
  newFileHere,
  duplicateFile,
  renameFileOnDisk,
  copyFileTo,
  deleteFile,
  toggleFileLock,
} from "./fileOps";
import { enterFocusMode, exitFocusMode } from "./focusMode";
import { encodePinLink } from "../import/shareLink";
import { runOutputs } from "../exec/runOutputs";
import { promptMemory } from "../exec/promptMemory";
import { l10n } from "../i18n/l10n";
// The pin helpers split out of this file. The registration below stays a thin
// dispatcher; the open/peek surface, the run-execution hub, and the pin-picking /
// creation helpers live in their own sibling modules.
import {
  openPin,
  peekPin,
  toggleTail,
  toggleMask,
  toggleBranchLink,
  registerTailFollow,
} from "./pinInteraction";
import {
  runPinCommand,
  runWithLastParams,
  runPinOnDroppedFile,
  newRoutineFromSelection,
  createRoutineHooks,
} from "./pinExecution";
import {
  asPin,
  pathToCopy,
  editorTargetUri,
  targetUri,
  scopeFromAddGroupArg,
  resolvePinRef,
  runAnyPin,
  runPinWithOverrides,
  runTopPin,
  TOP_PIN_SLOTS,
  pinUri,
  pinToLine,
  removePinForUri,
  addAnnotation,
} from "./pinSelection";
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

  reg("saropaWorkspace.renamePin", async (arg: unknown) => {
    const pin = asPin(arg);
    if (!pin) {
      return;
    }
    const current = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    const label = await vscode.window.showInputBox({
      prompt: l10n("pin.renamePrompt", { name: current }),
      value: pin.label ?? "",
    });
    if (label !== undefined) {
      await store.renamePin(pin, label);
    }
  });

  reg("saropaWorkspace.configureRun", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await configureRun(store, pin);
    }
  });

  // Dry-run audit: show the exact command/cwd/env/location a run would use, in a
  // read-only Markdown preview, without executing anything. Available on every pin
  // kind (file, recipe, auto) since auditing a shared macro before running it is
  // the point.
  reg("saropaWorkspace.simulateRun", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await simulateRun(store, pin);
    }
  });

  // Drag-and-drop execution: run a script pin against a file dropped onto it from
  // the Explorer (WOW #8). Invoked by the tree's drop controller with the pin and
  // the dropped file's path.
  reg("saropaWorkspace.runPinOnFile", async (pinArg: unknown, fsPath: unknown) => {
    const pin = asPin(pinArg);
    if (pin && typeof fsPath === "string") {
      await runPinOnDroppedFile(store, pin, fsPath);
    }
  });

  // Filesystem operations on a pinned file, so the Pins view doubles as a light
  // file manager: create a sibling, duplicate, rename (re-pointing the pin), copy
  // elsewhere, and delete-to-trash. Each acts on the pin's resolved file; a
  // non-file pin is rejected with a naming message inside the handler.
  reg("saropaWorkspace.newFileHere", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await newFileHere(store, pin);
    }
  });
  reg("saropaWorkspace.duplicateFile", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await duplicateFile(store, pin);
    }
  });
  reg("saropaWorkspace.renameFileOnDisk", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await renameFileOnDisk(store, pin);
    }
  });
  reg("saropaWorkspace.copyFileTo", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await copyFileTo(store, pin);
    }
  });
  reg("saropaWorkspace.deleteFile", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await deleteFile(store, pin);
    }
  });
  // Lock / unlock the pinned file's read-only attribute at the filesystem level (a
  // single toggle — the lock state is an OS attribute read live, not stored on the pin).
  reg("saropaWorkspace.toggleFileLock", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await toggleFileLock(store, pin);
    }
  });

  // Diff a pin's last two background-run outputs to see what changed (WOW #20).
  reg("saropaWorkspace.diffLastRuns", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await diffLastRuns(pin);
    }
  });

  // Duplicate a file pin's target into a new file with a casing-aware rename, then
  // open it — the "template" boilerplate-buster (WOW #27).
  reg("saropaWorkspace.useAsTemplate", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await useAsTemplate(store, pin);
    }
  });

  // Copy a clickable Saropa import link for a pin to the clipboard, so its exact
  // configuration can be shared and re-imported in one click (WOW #4). The link
  // carries only the pin's configuration, never its id/scope — see shareLink.
  reg("saropaWorkspace.copyPinLink", async (arg: unknown) => {
    const pin = asPin(arg);
    if (!pin) {
      return;
    }
    const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    await vscode.env.clipboard.writeText(encodePinLink(pin));
    vscode.window.showInformationMessage(l10n("share.copied", { name }));
  });

  // Pin any file on disk — including one outside this workspace, in another repo —
  // as a global pin, without opening a second VS Code window (the "wormhole",
  // WOW #21). pinUri reports the result and offers run targets, the same as pinning
  // a file from the editor.
  reg("saropaWorkspace.pinExternalFile", async () => {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: l10n("external.openLabel"),
      title: l10n("external.title"),
    });
    if (picked && picked.length > 0) {
      await pinUri(store, picked[0], "global");
    }
  });

  reg("saropaWorkspace.stopPin", (arg: unknown) => {
    const pin = asPin(arg);
    if (!pin) {
      return;
    }
    const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    // Graceful stop: the pin shows a "stopping…" badge until the process exits,
    // and the registry auto-escalates to a forced kill if it does not.
    const stopping = processRegistry.stop(pin.id);
    if (stopping) {
      getOutputChannel().appendLine(
        l10n("run.stopped", { time: new Date().toLocaleString(), name })
      );
      vscode.window.showInformationMessage(l10n("run.stopMessage", { name }));
    } else {
      vscode.window.showInformationMessage(l10n("run.notRunning", { name }));
    }
  });

  // Force-kill the escape hatch: when a graceful Stop does not take, terminate the
  // process tree immediately.
  reg("saropaWorkspace.forceKillPin", (arg: unknown) => {
    const pin = asPin(arg);
    if (!pin) {
      return;
    }
    const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    const killed = processRegistry.forceKill(pin.id);
    if (killed) {
      getOutputChannel().appendLine(
        l10n("run.forceKilled", { time: new Date().toLocaleString(), name })
      );
      vscode.window.showInformationMessage(l10n("run.forceKillMessage", { name }));
    } else {
      vscode.window.showInformationMessage(l10n("run.notRunning", { name }));
    }
  });

  reg("saropaWorkspace.configureSchedule", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await configureSchedule(store, pin);
    }
  });

  reg("saropaWorkspace.configureTriggers", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await configureTriggers(store, pin);
    }
  });

  // Cross-file watch links (#25): link this pin to one or more file globs so saving
  // a matching file runs the pin in the background (e.g. save schema.graphql, run the
  // generate-types pin). Distinct from the own-file run-on-save toggle in Configure Run.
  reg("saropaWorkspace.configureWatchLink", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await configureWatchLink(store, pin);
    }
  });

  // Pause / unpause a stored pin's automatic execution. Pausing suspends the
  // scheduler, chain triggers/emits, idle, and run-on-save for it while keeping the
  // schedule/triggers intact; a manual run still works. Two commands so the menu can
  // show "Pause" on an active pin and "Unpause" on a paused one (gated by the
  // pin*Paused contextValue). Each names the pin in its toast. setPinPaused no-ops on
  // an auto/recipe pin (recomputed, not stored), and the menu gates those out anyway.
  reg("saropaWorkspace.pausePin", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
      await store.setPinPaused(pin, true);
      vscode.window.showInformationMessage(l10n("pause.paused", { name }));
    }
  });
  reg("saropaWorkspace.unpausePin", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
      await store.setPinPaused(pin, false);
      vscode.window.showInformationMessage(l10n("pause.unpaused", { name }));
    }
  });

  // Time-bomb / ephemeral pins (WOW #9): set a self-removal condition on a stored
  // pin (a wall-clock instant or leaving the current git branch) and clear it. Only
  // pins the user explicitly bombs ever auto-remove; the expiry engine (wired in
  // activate) sweeps them and offers Undo.
  reg("saropaWorkspace.pinUntil", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await pinUntil(store, pin);
    }
  });

  reg("saropaWorkspace.pinUntilBranchChange", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await pinUntilBranchChange(store, pin);
    }
  });

  reg("saropaWorkspace.clearPinExpiry", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await clearPinExpiry(store, pin);
    }
  });

  reg("saropaWorkspace.configureAppearance", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await configureAppearance(store, pin);
    }
  });

  // Assign mode tags to a pin (WOW #17); the tag picker drives the Pins-view mode
  // filter (saropaWorkspace.pickMode).
  reg("saropaWorkspace.tagPin", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await tagPin(store, pin);
    }
  });

  // Link a pin to the current git branch (or clear the link) — WOW #3. A linked pin
  // shows in the tree only while the owning folder is on that branch; switching
  // branches re-filters the view live. A single toggle since the row chip shows the
  // current state.
  reg("saropaWorkspace.toggleBranchLink", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await toggleBranchLink(store, pin);
    }
  });

  // Live metric badge (#24): give a file pin a size / line-count / last-modified
  // badge that updates as the file changes, with an optional size threshold that
  // warns + toasts when the file grows past it.
  reg("saropaWorkspace.setMetric", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await setMetric(store, pin);
    }
  });

  reg("saropaWorkspace.unpin", async (arg: unknown) => {
    const pin = asPin(arg);
    if (!pin) {
      return;
    }
    const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    await store.removePin(pin);
    // Drop any last-run badge so it does not outlive the pin (the id is reused
    // for an identical re-pin only after a fresh run records a new result).
    runStatusRegistry.clear(pin.id);
    // Drop any remembered run-parameter values for the gone pin so they do not
    // accumulate in workspace state.
    void promptMemory.forget(pin.id);
    // Drop any captured run outputs so they do not linger for a reused id.
    runOutputs.clear(pin.id);
    vscode.window.showInformationMessage(l10n("pin.removed", { name }));
  });

  // Copy a tree node's full path to the clipboard. Available on every file-backed
  // row across both views (file pins, recipes, and the Project Files list); a
  // non-file recipe copies its action target. Nodes with nothing to copy (scope
  // roots, group folders) are no-ops — the menu is gated to file-backed items.
  reg("saropaWorkspace.copyPath", async (arg: unknown) => {
    const value = pathToCopy(store, arg);
    if (!value) {
      return;
    }
    await vscode.env.clipboard.writeText(value);
    vscode.window.showInformationMessage(l10n("path.copied", { path: value }));
  });

  // Reveal the shared output channel (background-run output, scheduled-run log,
  // and the "Show Output" target from a failed-run toast).
  reg("saropaWorkspace.showOutput", () => getOutputChannel().show(true));

  registerPinManagementCommands(context, store);
}
