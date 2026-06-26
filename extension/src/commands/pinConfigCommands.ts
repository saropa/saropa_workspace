import * as vscode from "vscode";
import { PinStore } from "../model/pinStore";
import { getOutputChannel } from "../exec/runner";
import { processRegistry } from "../exec/processRegistry";
import { runStatusRegistry } from "../exec/runStatus";
import { runOutputs } from "../exec/runOutputs";
import { promptMemory } from "../exec/promptMemory";
import { encodePinLink } from "../import/shareLink";
import { configureRun } from "./configureRun";
import { configureSchedule } from "./configureSchedule";
import { ScheduleEditorPanel } from "../views/scheduleEditorPanel";
import { configureTriggers } from "./configureTriggers";
import { configureWatchLink } from "./configureWatchLink";
import { pinUntil, pinUntilBranchChange, clearPinExpiry } from "./configureExpiry";
import { configureAppearance } from "./configureAppearance";
import { tagPin } from "./tagPin";
import { setMetric } from "./setMetric";
import { simulateRun } from "./simulateRun";
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
import { l10n } from "../i18n/l10n";
import { toggleBranchLink } from "./pinInteraction";
import { runPinOnDroppedFile } from "./pinExecution";
import { asPin, pathToCopy, pinUri } from "./pinSelection";
import { pinCommandRegistrar } from "./registerHelpers";

// Per-pin configuration and lifecycle command registrations (rename, run config,
// schedule/triggers/watch links, pause, expiry, appearance, tags, branch link,
// metric, file operations, stop/kill, unpin, copy). Split out of pinCommands so the
// main registrar stays under the size cap; registerPinCommands calls this. The
// guard-only handlers use regPin (resolve the argument to a pin, run only when
// present); handlers needing extra args or a no-pin branch use reg directly.
export function registerPinConfigCommands(
  context: vscode.ExtensionContext,
  store: PinStore
): void {
  const { reg, regPin } = pinCommandRegistrar(context);

  regPin("saropaWorkspace.renamePin", async (pin) => {
    const current = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    const label = await vscode.window.showInputBox({
      prompt: l10n("pin.renamePrompt", { name: current }),
      value: pin.label ?? "",
    });
    if (label !== undefined) {
      await store.renamePin(pin, label);
    }
  });

  regPin("saropaWorkspace.configureRun", (pin) => configureRun(store, pin));

  // Dry-run audit: show the exact command/cwd/env/location a run would use, in a
  // read-only Markdown preview, without executing anything. Available on every pin
  // kind (file, recipe, auto) since auditing a shared macro before running it is
  // the point.
  regPin("saropaWorkspace.simulateRun", (pin) => simulateRun(store, pin));

  // Drag-and-drop execution: run a script pin against a file dropped onto it from
  // the Explorer (WOW #8). Invoked by the tree's drop controller with the pin and
  // the dropped file's path — two arguments, so it stays a plain reg.
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
  regPin("saropaWorkspace.newFileHere", (pin) => newFileHere(store, pin));
  regPin("saropaWorkspace.duplicateFile", (pin) => duplicateFile(store, pin));
  regPin("saropaWorkspace.renameFileOnDisk", (pin) => renameFileOnDisk(store, pin));
  regPin("saropaWorkspace.copyFileTo", (pin) => copyFileTo(store, pin));
  regPin("saropaWorkspace.deleteFile", (pin) => deleteFile(store, pin));
  // Lock / unlock the pinned file's read-only attribute at the filesystem level (a
  // single toggle — the lock state is an OS attribute read live, not stored on the pin).
  regPin("saropaWorkspace.toggleFileLock", (pin) => toggleFileLock(store, pin));

  // Diff a pin's last two background-run outputs to see what changed (WOW #20).
  regPin("saropaWorkspace.diffLastRuns", (pin) => diffLastRuns(pin));

  // Duplicate a file pin's target into a new file with a casing-aware rename, then
  // open it — the "template" boilerplate-buster (WOW #27).
  regPin("saropaWorkspace.useAsTemplate", (pin) => useAsTemplate(store, pin));

  // Copy a clickable Saropa import link for a pin to the clipboard, so its exact
  // configuration can be shared and re-imported in one click (WOW #4). The link
  // carries only the pin's configuration, never its id/scope — see shareLink.
  regPin("saropaWorkspace.copyPinLink", async (pin) => {
    const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    await vscode.env.clipboard.writeText(encodePinLink(pin));
    vscode.window.showInformationMessage(l10n("share.copied", { name }));
  });

  // Pin any file on disk — including one outside this workspace, in another repo —
  // as a global pin, without opening a second VS Code window (the "wormhole",
  // WOW #21). pinUri reports the result and offers run targets, the same as pinning
  // a file from the editor. No pin argument, so it stays a plain reg.
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

  regPin("saropaWorkspace.stopPin", (pin) => {
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
  regPin("saropaWorkspace.forceKillPin", (pin) => {
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

  // Default schedule editor is the webview form (every field visible at once, live
  // next-run preview); the keyboard-only QuickPick wizard stays reachable as the
  // "Quick" variant for a fast edit without leaving the keyboard.
  regPin("saropaWorkspace.configureSchedule", (pin) =>
    ScheduleEditorPanel.show(context, store, pin)
  );
  regPin("saropaWorkspace.configureScheduleQuick", (pin) =>
    configureSchedule(store, pin)
  );
  regPin("saropaWorkspace.configureTriggers", (pin) => configureTriggers(store, pin));

  // Cross-file watch links (#25): link this pin to one or more file globs so saving
  // a matching file runs the pin in the background (e.g. save schema.graphql, run the
  // generate-types pin). Distinct from the own-file run-on-save toggle in Configure Run.
  regPin("saropaWorkspace.configureWatchLink", (pin) => configureWatchLink(store, pin));

  // Pause / unpause a stored pin's automatic execution. Pausing suspends the
  // scheduler, chain triggers/emits, idle, and run-on-save for it while keeping the
  // schedule/triggers intact; a manual run still works. Two commands so the menu can
  // show "Pause" on an active pin and "Unpause" on a paused one (gated by the
  // pin*Paused contextValue). Each names the pin in its toast. setPinPaused no-ops on
  // an auto/recipe pin (recomputed, not stored), and the menu gates those out anyway.
  regPin("saropaWorkspace.pausePin", async (pin) => {
    const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    await store.setPinPaused(pin, true);
    vscode.window.showInformationMessage(l10n("pause.paused", { name }));
  });
  regPin("saropaWorkspace.unpausePin", async (pin) => {
    const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    await store.setPinPaused(pin, false);
    vscode.window.showInformationMessage(l10n("pause.unpaused", { name }));
  });

  // Time-bomb / ephemeral pins (WOW #9): set a self-removal condition on a stored
  // pin (a wall-clock instant or leaving the current git branch) and clear it. Only
  // pins the user explicitly bombs ever auto-remove; the expiry engine (wired in
  // activate) sweeps them and offers Undo.
  regPin("saropaWorkspace.pinUntil", (pin) => pinUntil(store, pin));
  regPin("saropaWorkspace.pinUntilBranchChange", (pin) => pinUntilBranchChange(store, pin));
  regPin("saropaWorkspace.clearPinExpiry", (pin) => clearPinExpiry(store, pin));

  regPin("saropaWorkspace.configureAppearance", (pin) => configureAppearance(store, pin));

  // Assign mode tags to a pin (WOW #17); the tag picker drives the Pins-view mode
  // filter (saropaWorkspace.pickMode).
  regPin("saropaWorkspace.tagPin", (pin) => tagPin(store, pin));

  // Link a pin to the current git branch (or clear the link) — WOW #3. A linked pin
  // shows in the tree only while the owning folder is on that branch; switching
  // branches re-filters the view live. A single toggle since the row chip shows the
  // current state.
  regPin("saropaWorkspace.toggleBranchLink", (pin) => toggleBranchLink(store, pin));

  // Live metric badge (#24): give a file pin a size / line-count / last-modified
  // badge that updates as the file changes, with an optional size threshold that
  // warns + toasts when the file grows past it.
  regPin("saropaWorkspace.setMetric", (pin) => setMetric(store, pin));

  regPin("saropaWorkspace.unpin", async (pin) => {
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
  // roots, group folders) are no-ops — the menu is gated to file-backed items. Uses
  // pathToCopy on the raw argument (not a Pin), so it stays a plain reg.
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
}
