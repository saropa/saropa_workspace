import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { getOutputChannel } from "../exec/runner";
import { processRegistry } from "../exec/processRegistry";
import { runStatusRegistry } from "../exec/runStatus";
import { runOutputs } from "../exec/runOutputs";
import { promptMemory } from "../exec/promptMemory";
import { encodeShortcutLink } from "../import/shareLink";
import { configureRun } from "./configureRun";
import { configureSchedule } from "./configureSchedule";
import { ScheduleEditorPanel } from "../views/scheduleEditorPanel";
import { configureTriggers } from "./configureTriggers";
import { configureWatchLink } from "./configureWatchLink";
import { shortcutUntil, shortcutUntilBranchChange, clearShortcutExpiry } from "./configureExpiry";
import { configureAppearance } from "./configureAppearance";
import { tagShortcut } from "./tagShortcut";
import { setMetric } from "./setMetric";
import { simulateRun } from "./simulateRun";
import { diffLastRuns } from "./diffRuns";
import { useAsTemplate } from "./templateShortcut";
import {
  newFileHere,
  duplicateFile,
  renameFileOnDisk,
  copyFileTo,
  deleteFile,
  toggleFileLock,
} from "./fileOps";
import { l10n } from "../i18n/l10n";
import { toggleBranchLink } from "./shortcutInteraction";
import { runShortcutOnDroppedFile } from "./shortcutExecution";
import { asShortcut, pathToCopy, shortcutUri } from "./shortcutSelection";
import { shortcutCommandRegistrar } from "./registerHelpers";

// Per-shortcut configuration and lifecycle command registrations (rename, run config,
// schedule/triggers/watch links, pause, expiry, appearance, tags, branch link,
// metric, file operations, stop/kill, remove, copy). Split out of pinCommands so the
// main registrar stays under the size cap; registerShortcutCommands calls this. The
// guard-only handlers use regShortcut (resolve the argument to a shortcut, run only when
// present); handlers needing extra args or a no-shortcut branch use reg directly.
export function registerPinConfigCommands(
  context: vscode.ExtensionContext,
  store: ShortcutStore
): void {
  const { reg, regShortcut } = shortcutCommandRegistrar(context);

  regShortcut("saropaWorkspace.renamePin", async (shortcut) => {
    const current = shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
    const label = await vscode.window.showInputBox({
      prompt: l10n("pin.renamePrompt", { name: current }),
      value: shortcut.label ?? "",
    });
    if (label !== undefined) {
      await store.renameShortcut(shortcut, label);
    }
  });

  regShortcut("saropaWorkspace.configureRun", (shortcut) => configureRun(store, shortcut));

  // Dry-run audit: show the exact command/cwd/env/location a run would use, in a
  // read-only Markdown preview, without executing anything. Available on every shortcut
  // kind (file, recipe, auto) since auditing a shared macro before running it is
  // the point.
  regShortcut("saropaWorkspace.simulateRun", (shortcut) => simulateRun(store, shortcut));

  // Drag-and-drop execution: run a script shortcut against a file dropped onto it from
  // the Explorer (WOW #8). Invoked by the tree's drop controller with the shortcut and
  // the dropped file's path — two arguments, so it stays a plain reg.
  reg("saropaWorkspace.runPinOnFile", async (shortcutArg: unknown, fsPath: unknown) => {
    const shortcut = asShortcut(shortcutArg);
    if (shortcut && typeof fsPath === "string") {
      await runShortcutOnDroppedFile(store, shortcut, fsPath);
    }
  });

  // Filesystem operations on a shortcut's file, so the Shortcuts view doubles as a light
  // file manager: create a sibling, duplicate, rename (re-pointing the shortcut), copy
  // elsewhere, and delete-to-trash. Each acts on the shortcut's resolved file; a
  // non-file shortcut is rejected with a naming message inside the handler.
  regShortcut("saropaWorkspace.newFileHere", (shortcut) => newFileHere(store, shortcut));
  regShortcut("saropaWorkspace.duplicateFile", (shortcut) => duplicateFile(store, shortcut));
  regShortcut("saropaWorkspace.renameFileOnDisk", (shortcut) => renameFileOnDisk(store, shortcut));
  regShortcut("saropaWorkspace.copyFileTo", (shortcut) => copyFileTo(store, shortcut));
  regShortcut("saropaWorkspace.deleteFile", (shortcut) => deleteFile(store, shortcut));
  // Lock / unlock the shortcut's file read-only attribute at the filesystem level (a
  // single toggle — the lock state is an OS attribute read live, not stored on the shortcut).
  regShortcut("saropaWorkspace.toggleFileLock", (shortcut) => toggleFileLock(store, shortcut));

  // Diff a shortcut's last two background-run outputs to see what changed (WOW #20).
  regShortcut("saropaWorkspace.diffLastRuns", (shortcut) => diffLastRuns(shortcut));

  // Duplicate a file shortcut's target into a new file with a casing-aware rename, then
  // open it — the "template" boilerplate-buster (WOW #27).
  regShortcut("saropaWorkspace.useAsTemplate", (shortcut) => useAsTemplate(store, shortcut));

  // Copy a clickable Saropa import link for a shortcut to the clipboard, so its exact
  // configuration can be shared and re-imported in one click (WOW #4). The link
  // carries only the shortcut's configuration, never its id/scope — see shareLink.
  regShortcut("saropaWorkspace.copyPinLink", async (shortcut) => {
    const name = shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
    await vscode.env.clipboard.writeText(encodeShortcutLink(shortcut));
    vscode.window.showInformationMessage(l10n("share.copied", { name }));
  });

  // Add any file on disk — including one outside this workspace, in another repo —
  // as a global shortcut, without opening a second VS Code window (the "wormhole",
  // WOW #21). shortcutUri reports the result and offers run targets, the same as adding
  // a file from the editor. No shortcut argument, so it stays a plain reg.
  reg("saropaWorkspace.pinExternalFile", async () => {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: l10n("external.openLabel"),
      title: l10n("external.title"),
    });
    if (picked && picked.length > 0) {
      await shortcutUri(store, picked[0], "global");
    }
  });

  regShortcut("saropaWorkspace.stopPin", (shortcut) => {
    const name = shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
    // Graceful stop: the shortcut shows a "stopping…" badge until the process exits,
    // and the registry auto-escalates to a forced kill if it does not.
    const stopping = processRegistry.stop(shortcut.id);
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
  regShortcut("saropaWorkspace.forceKillPin", (shortcut) => {
    const name = shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
    const killed = processRegistry.forceKill(shortcut.id);
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
  regShortcut("saropaWorkspace.configureSchedule", (shortcut) =>
    ScheduleEditorPanel.show(context, store, shortcut)
  );
  regShortcut("saropaWorkspace.configureScheduleQuick", (shortcut) =>
    configureSchedule(store, shortcut)
  );
  regShortcut("saropaWorkspace.configureTriggers", (shortcut) => configureTriggers(store, shortcut));

  // Cross-file watch links (#25): link this shortcut to one or more file globs so saving
  // a matching file runs the shortcut in the background (e.g. save schema.graphql, run the
  // generate-types shortcut). Distinct from the own-file run-on-save toggle in Configure Run.
  regShortcut("saropaWorkspace.configureWatchLink", (shortcut) => configureWatchLink(store, shortcut));

  // Pause / unpause a stored shortcut's automatic execution. Pausing suspends the
  // scheduler, chain triggers/emits, idle, and run-on-save for it while keeping the
  // schedule/triggers intact; a manual run still works. Two commands so the menu can
  // show "Pause" on an active shortcut and "Unpause" on a paused one (gated by the
  // pin*Paused contextValue). Each names the shortcut in its toast. setPinPaused no-ops on
  // an auto/recipe shortcut (recomputed, not stored), and the menu gates those out anyway.
  regShortcut("saropaWorkspace.pausePin", async (shortcut) => {
    const name = shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
    await store.setShortcutPaused(shortcut, true);
    vscode.window.showInformationMessage(l10n("pause.paused", { name }));
  });
  regShortcut("saropaWorkspace.unpausePin", async (shortcut) => {
    const name = shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
    await store.setShortcutPaused(shortcut, false);
    vscode.window.showInformationMessage(l10n("pause.unpaused", { name }));
  });

  // Time-bomb / ephemeral shortcuts (WOW #9): set a self-removal condition on a stored
  // shortcut (a wall-clock instant or leaving the current git branch) and clear it. Only
  // shortcuts the user explicitly bombs ever auto-remove; the expiry engine (wired in
  // activate) sweeps them and offers Undo.
  regShortcut("saropaWorkspace.pinUntil", (shortcut) => shortcutUntil(store, shortcut));
  regShortcut("saropaWorkspace.pinUntilBranchChange", (shortcut) => shortcutUntilBranchChange(store, shortcut));
  regShortcut("saropaWorkspace.clearPinExpiry", (shortcut) => clearShortcutExpiry(store, shortcut));

  regShortcut("saropaWorkspace.configureAppearance", (shortcut) => configureAppearance(store, shortcut));

  // Assign mode tags to a shortcut (WOW #17); the tag picker drives the Shortcuts-view mode
  // filter (saropaWorkspace.pickMode).
  regShortcut("saropaWorkspace.tagPin", (shortcut) => tagShortcut(store, shortcut));

  // Link a shortcut to the current git branch (or clear the link) — WOW #3. A linked shortcut
  // shows in the tree only while the owning folder is on that branch; switching
  // branches re-filters the view live. A single toggle since the row chip shows the
  // current state.
  regShortcut("saropaWorkspace.toggleBranchLink", (shortcut) => toggleBranchLink(store, shortcut));

  // Live metric badge (#24): give a file shortcut a size / line-count / last-modified
  // badge that updates as the file changes, with an optional size threshold that
  // warns + toasts when the file grows past it.
  regShortcut("saropaWorkspace.setMetric", (shortcut) => setMetric(store, shortcut));

  regShortcut("saropaWorkspace.unpin", async (shortcut) => {
    const name = shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
    await store.removeShortcut(shortcut);
    // Drop any last-run badge so it does not outlive the shortcut (the id is reused
    // for an identical re-add only after a fresh run records a new result).
    runStatusRegistry.clear(shortcut.id);
    // Drop any remembered run-parameter values for the gone shortcut so they do not
    // accumulate in workspace state.
    void promptMemory.forget(shortcut.id);
    // Drop any captured run outputs so they do not linger for a reused id.
    runOutputs.clear(shortcut.id);
    vscode.window.showInformationMessage(l10n("pin.removed", { name }));
  });

  // Copy a tree node's full path to the clipboard. Available on every file-backed
  // row across both views (file shortcuts, recipes, and the Project Files list); a
  // non-file recipe copies its action target. Nodes with nothing to copy (scope
  // roots, group folders) are no-ops — the menu is gated to file-backed items. Uses
  // pathToCopy on the raw argument (not a Shortcut), so it stays a plain reg.
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
