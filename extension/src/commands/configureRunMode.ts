import * as vscode from "vscode";
import { ShortcutExecConfig, RunLocation } from "../model/shortcut";
import { l10n } from "../i18n/l10n";
import type { ConcurrencyEdit } from "./configureRun";

// The execution-mode and output field editors for the run-parameters hub: run
// location (terminal / background / external), elevation, file-arg toggle, audio
// cue, run-on-save, single-instance concurrency, the cross-process lock name, and
// the output-extraction regex. Split out of configureRun.ts so the hub file holds
// the flow; each editor here is a small toggle/picker over a shortcut field.

export async function editLocation(work: ShortcutExecConfig, title: string): Promise<void> {
  interface LocationItem extends vscode.QuickPickItem {
    value: RunLocation | undefined;
  }
  const items: LocationItem[] = [
    { label: l10n("configure.terminal.default"), value: undefined },
    { label: l10n("configure.terminal.integrated"), value: "terminal" },
    { label: l10n("configure.terminal.background"), value: "background" },
    {
      label: l10n("configure.terminal.external"),
      detail: l10n("configure.terminal.externalDetail"),
      value: "external",
    },
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: l10n("configure.terminal.placeholder"),
    ignoreFocusOut: true,
  });
  if (!pick) {
    return;
  }
  work.runLocation = pick.value;
  // Choosing External immediately offers the admin toggle in the same sequence,
  // so enabling elevation is one flow rather than picking External, returning to
  // the hub, and hunting for a field that only appears once External is set. The
  // toggle stays on the hub too, so it remains adjustable later.
  if (pick.value === "external") {
    await editElevated(work, title);
  }
}

// Toggle administrator/elevated privileges for an external window. Reachable only
// when the location is "external" (the hub hides this field otherwise).
export async function editElevated(work: ShortcutExecConfig, title: string): Promise<void> {
  interface ElevatedItem extends vscode.QuickPickItem {
    value: boolean;
  }
  const items: ElevatedItem[] = [
    { label: l10n("configure.elevated.offChoice"), value: false },
    {
      label: l10n("configure.elevated.onChoice"),
      detail: l10n("configure.elevated.detail"),
      value: true,
    },
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: l10n("configure.elevated.placeholder"),
    ignoreFocusOut: true,
  });
  if (!pick) {
    return;
  }
  work.elevated = pick.value;
}

// Toggle whether the file path is inserted into the command. Off suits run
// targets that name their work in args (an npm script, a Make target) where the
// file is the package.json / Makefile in cwd, not an argument.
export async function editFileArg(work: ShortcutExecConfig, title: string): Promise<void> {
  interface FileArgItem extends vscode.QuickPickItem {
    value: boolean;
  }
  const items: FileArgItem[] = [
    { label: l10n("configure.fileArg.on"), value: true },
    { label: l10n("configure.fileArg.off"), value: false },
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: l10n("configure.fileArg.placeholder"),
    ignoreFocusOut: true,
  });
  if (!pick) {
    return;
  }
  work.includeFilePath = pick.value;
}

// Per-shortcut audio-cue override (#64): follow the global sound settings, force the
// cues on for this shortcut, or silence it. undefined = follow the settings; "on" /
// "off" are the explicit overrides. The picker offers all three; dismissing leaves
// the current choice unchanged (hub convention).
export async function editSound(work: ShortcutExecConfig, title: string): Promise<void> {
  interface SoundItem extends vscode.QuickPickItem {
    value: "default" | "on" | "off";
  }
  const items: SoundItem[] = [
    { label: l10n("configure.sound.followDefault"), value: "default" },
    { label: l10n("configure.sound.on"), value: "on" },
    { label: l10n("configure.sound.off"), value: "off" },
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: l10n("configure.sound.placeholder"),
    ignoreFocusOut: true,
  });
  if (!pick) {
    return;
  }
  work.sound = pick.value === "default" ? undefined : pick.value;
}

// Toggle whether the shortcut runs automatically when its own target file is saved.
// A two-option pick (On / Off) rather than a silent flip, so the current state is
// always shown and the choice is explicit.
export async function editRunOnSave(work: ShortcutExecConfig, title: string): Promise<void> {
  interface RunOnSaveItem extends vscode.QuickPickItem {
    value: boolean;
  }
  const items: RunOnSaveItem[] = [
    { label: l10n("configure.runOnSave.off"), value: false },
    { label: l10n("configure.runOnSave.on"), value: true },
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: l10n("configure.runOnSave.placeholder"),
    ignoreFocusOut: true,
  });
  if (!pick) {
    return;
  }
  work.runOnSave = pick.value;
}

// Choose whether the shortcut may run while one of its own runs is already in flight.
// Block (the default) is single-instance; Allow opts out for a shortcut that genuinely
// runs in parallel. A two-option pick so the current state is always shown.
export async function editConcurrency(
  conc: ConcurrencyEdit,
  title: string
): Promise<void> {
  interface ConcItem extends vscode.QuickPickItem {
    value: boolean; // true = allow overlapping runs
  }
  const items: ConcItem[] = [
    {
      label: l10n("configure.concurrency.blockChoice"),
      detail: l10n("configure.concurrency.blockDetail"),
      value: false,
    },
    {
      label: l10n("configure.concurrency.allowChoice"),
      detail: l10n("configure.concurrency.allowDetail"),
      value: true,
    },
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: l10n("configure.concurrency.placeholder"),
    ignoreFocusOut: true,
  });
  if (!pick) {
    return;
  }
  conc.allowConcurrent = pick.value;
}

// Set (or clear) the cross-process lock name. When set, a run refuses to start
// while a live holder owns the same-named lock in another window / terminal / a
// script that honors the convention — extending the barrier beyond this window. An
// empty entry clears it (the in-process guard still applies).
export async function editLock(conc: ConcurrencyEdit, title: string): Promise<void> {
  const value = await vscode.window.showInputBox({
    title,
    prompt: l10n("configure.lock.prompt"),
    placeHolder: l10n("configure.lock.placeholder"),
    value: conc.lockName ?? "",
    ignoreFocusOut: true,
  });
  if (value === undefined) {
    return;
  }
  conc.lockName = value.trim() === "" ? undefined : value.trim();
}

// Set the output-extraction regex (WOW #16). The pattern is matched against a
// BACKGROUND run's output when it finishes; the first capture group (or the whole
// match) is copied to the clipboard. An empty entry clears it. Validated as a real
// regex inline so a typo never persists and silently never matches.
export async function editExtract(work: ShortcutExecConfig, title: string): Promise<void> {
  const value = await vscode.window.showInputBox({
    title,
    prompt: l10n("configure.extract.prompt"),
    placeHolder: l10n("configure.extract.placeholder"),
    value: work.extractResult ?? "",
    ignoreFocusOut: true,
    validateInput: (input) => {
      const trimmed = input.trim();
      if (trimmed === "") {
        return undefined; // empty clears the pattern
      }
      try {
        new RegExp(trimmed, "m");
        return undefined;
      } catch {
        return l10n("configure.extract.invalid");
      }
    },
  });
  if (value === undefined) {
    return;
  }
  work.extractResult = value.trim() === "" ? undefined : value.trim();
}
