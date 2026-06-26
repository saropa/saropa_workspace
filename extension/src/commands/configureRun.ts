import * as vscode from "vscode";
import { Shortcut, ShortcutExecConfig, RunLocation } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { l10n } from "../i18n/l10n";
import { editCommand, editArgs, formatArgs } from "./configureRunCommand";
import { editCwd, editEnv, editDependsOn, resolveDepName } from "./configureRunEnv";
import {
  editLocation,
  editElevated,
  editFileArg,
  editSound,
  editRunOnSave,
  editConcurrency,
  editLock,
  editExtract,
} from "./configureRunMode";

// Roadmap 2.1 — Run-parameters editor.
//
// A hub-and-spoke QuickPick flow to edit a shortcut's ShortcutExecConfig (command prefix,
// arguments, working directory, environment variables, terminal-vs-background
// toggle) without hand-editing JSON. The individual field editors live in sibling
// modules (configureRunCommand / configureRunEnv / configureRunMode); this file
// owns the working copy, the hub loop, and persistence.
//
// Edits accumulate in a working copy; nothing is persisted until the user
// explicitly chooses Save at the hub. Dismissing (Esc) the hub discards the
// working copy, so a canceled edit never reaches disk (acceptance: canceling
// any step aborts with no partial write). Dismissing a sub-step returns to the
// hub with that field unchanged.

// Re-exported so the run-with-overrides palette keeps importing the command-line
// parse/format pair from this module.
export { parseArgs, formatArgs } from "./configureRunCommand";

// A QuickPickItem tagged with the hub action it represents.
interface HubItem extends vscode.QuickPickItem {
  id:
    | "command"
    | "args"
    | "cwd"
    | "env"
    | "location"
    | "elevated"
    | "fileArg"
    | "extract"
    | "dependsOn"
    | "sound"
    | "runOnSave"
    | "concurrency"
    | "lock"
    | "save";
}

// Mutable holder for the shortcut's top-level single-instance settings, threaded through
// the hub the way `work` threads the exec config. Exported so the concurrency/lock
// editors in configureRunMode share the type.
export interface ConcurrencyEdit {
  allowConcurrent: boolean;
  lockName: string | undefined;
}

// Seed the working copy's location from a stored shortcut WITHOUT consulting the
// workspace default (the hub shows the shortcut's own choice, where undefined means
// "follow the default setting"). Maps the deprecated useIntegratedTerminal flag
// for shortcuts written before runLocation existed.
function seedLocation(exec: ShortcutExecConfig | undefined): RunLocation | undefined {
  if (exec?.runLocation) {
    return exec.runLocation;
  }
  if (exec?.useIntegratedTerminal === true) {
    return "terminal";
  }
  if (exec?.useIntegratedTerminal === false) {
    return "background";
  }
  return undefined;
}

export async function configureRun(store: ShortcutStore, shortcut: Shortcut): Promise<void> {
  // Auto-shortcuts are recomputed each refresh and never stored in pins[], so there
  // is nowhere to persist run config; surface that rather than silently failing.
  if (shortcut.isAuto) {
    vscode.window.showWarningMessage(l10n("configure.autoUnsupported"));
    return;
  }

  const name = shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);

  // Working copy: a deep-enough clone so canceling discards every edit. args and
  // env are copied by value; the rest are primitives.
  const work: ShortcutExecConfig = {
    command: shortcut.exec?.command,
    args: shortcut.exec?.args ? [...shortcut.exec.args] : undefined,
    cwd: shortcut.exec?.cwd,
    env: shortcut.exec?.env ? { ...shortcut.exec.env } : undefined,
    runLocation: seedLocation(shortcut.exec),
    elevated: shortcut.exec?.elevated,
    includeFilePath: shortcut.exec?.includeFilePath,
    extractResult: shortcut.exec?.extractResult,
    dependsOn: shortcut.exec?.dependsOn,
    sound: shortcut.exec?.sound,
    runOnSave: shortcut.exec?.runOnSave,
  };

  // Single-instance settings live top-level on the Shortcut (so a recipe with no exec can
  // carry them too), not on ShortcutExecConfig — kept in a small side holder and persisted
  // separately from the exec config below.
  const conc: ConcurrencyEdit = {
    allowConcurrent: shortcut.allowConcurrent === true,
    lockName: shortcut.lockName,
  };

  const title = l10n("configure.title", { name });

  // Hub loop: show the field summary, dispatch to the chosen sub-editor, repeat.
  // Returns out of the function on Save (persist) or Esc (discard).
  for (;;) {
    const depName = work.dependsOn
      ? resolveDepName(store, work.dependsOn)
      : undefined;
    const choice = await showHub(work, conc, title, depName);
    if (!choice) {
      // Esc at the hub: discard the working copy and write nothing (canceling
      // leaves the persisted config untouched).
      return;
    }
    if (choice === "save") {
      break;
    }
    switch (choice) {
      case "command":
        await editCommand(work, title);
        break;
      case "args":
        await editArgs(work, title);
        break;
      case "cwd":
        await editCwd(work, title, store, shortcut);
        break;
      case "env":
        await editEnv(work, title);
        break;
      case "location":
        await editLocation(work, title);
        break;
      case "elevated":
        await editElevated(work, title);
        break;
      case "fileArg":
        await editFileArg(work, title);
        break;
      case "extract":
        await editExtract(work, title);
        break;
      case "dependsOn":
        await editDependsOn(work, title, store, shortcut);
        break;
      case "sound":
        await editSound(work, title);
        break;
      case "runOnSave":
        await editRunOnSave(work, title);
        break;
      case "concurrency":
        await editConcurrency(conc, title);
        break;
      case "lock":
        await editLock(conc, title);
        break;
    }
  }

  await store.updateShortcutExec(shortcut, normalize(work));
  // Persist the top-level single-instance settings alongside the exec config (a
  // second mutate, since they do not live on ShortcutExecConfig).
  await store.setShortcutConcurrency(shortcut, conc.allowConcurrent, conc.lockName);
  vscode.window.showInformationMessage(l10n("configure.saved", { name }));
}

// Collapse empty collections to undefined so a saved config is identical to the
// equivalent hand-written JSON (round-trip parity). command is left as-is: ""
// (run directly, overriding the interpreter default) is a distinct, meaningful
// value from undefined (use the default).
function normalize(work: ShortcutExecConfig): ShortcutExecConfig {
  return {
    command: work.command,
    args: work.args && work.args.length > 0 ? work.args : undefined,
    cwd: work.cwd,
    env: work.env && Object.keys(work.env).length > 0 ? work.env : undefined,
    runLocation: work.runLocation,
    // Elevation only applies to an external window; drop it otherwise so a
    // stored config has no stray flag.
    elevated: work.runLocation === "external" && work.elevated === true ? true : undefined,
    // Writing runLocation supersedes the deprecated flag; clear it so a re-saved
    // shortcut carries the location in exactly one field (no two-source drift).
    useIntegratedTerminal: undefined,
    // true is the default assembly, so collapse it to undefined for parity; only
    // an explicit false (omit the file path) is meaningful to persist.
    includeFilePath: work.includeFilePath === false ? false : undefined,
    // Collapse an empty pattern to undefined (round-trip parity with hand-written
    // JSON that simply omits the field).
    extractResult:
      work.extractResult && work.extractResult.trim() !== ""
        ? work.extractResult
        : undefined,
    dependsOn: work.dependsOn || undefined,
    // Only a real "on"/"off" override is persisted; the default (follow the global
    // sound settings) collapses to undefined for round-trip parity.
    sound: work.sound === "on" || work.sound === "off" ? work.sound : undefined,
    // Off is the default; collapse it to undefined so only an opted-in shortcut carries
    // the flag (round-trip parity with hand-written JSON that omits it).
    runOnSave: work.runOnSave === true ? true : undefined,
  };
}

async function showHub(
  work: ShortcutExecConfig,
  conc: ConcurrencyEdit,
  title: string,
  depName: string | undefined
): Promise<HubItem["id"] | undefined> {
  const items: HubItem[] = [
    {
      id: "command",
      label: l10n("configure.field.command"),
      description: work.command ?? l10n("configure.value.commandDefault"),
    },
    {
      id: "args",
      label: l10n("configure.field.args"),
      description:
        work.args && work.args.length > 0
          ? formatArgs(work.args)
          : l10n("configure.value.none"),
    },
    {
      id: "cwd",
      label: l10n("configure.field.cwd"),
      description: work.cwd ?? l10n("configure.value.cwdDefault"),
    },
    {
      id: "env",
      label: l10n("configure.field.env"),
      description: l10n("configure.value.envCount", {
        count: work.env ? Object.keys(work.env).length : 0,
      }),
    },
    {
      id: "location",
      label: l10n("configure.field.terminal"),
      description: locationLabel(work.runLocation),
    },
    // Elevation is only meaningful for an external window; show the toggle only
    // when that location is chosen so the hub does not offer a no-op field.
    ...(work.runLocation === "external"
      ? [
          {
            id: "elevated" as const,
            label: l10n("configure.field.elevated"),
            description: work.elevated
              ? l10n("configure.elevated.on")
              : l10n("configure.elevated.off"),
          },
        ]
      : []),
    {
      id: "fileArg",
      label: l10n("configure.field.fileArg"),
      description:
        work.includeFilePath === false
          ? l10n("configure.fileArg.off")
          : l10n("configure.fileArg.on"),
    },
    {
      id: "extract",
      label: l10n("configure.field.extract"),
      description: work.extractResult ?? l10n("configure.value.none"),
    },
    {
      id: "dependsOn",
      label: l10n("configure.field.dependsOn"),
      description: depName ?? l10n("configure.value.none"),
    },
    {
      id: "sound",
      label: l10n("configure.field.sound"),
      description:
        work.sound === "on"
          ? l10n("configure.sound.on")
          : work.sound === "off"
            ? l10n("configure.sound.off")
            : l10n("configure.sound.followDefault"),
    },
    {
      id: "runOnSave",
      label: l10n("configure.field.runOnSave"),
      description: work.runOnSave
        ? l10n("configure.runOnSave.on")
        : l10n("configure.runOnSave.off"),
    },
    {
      id: "concurrency",
      label: l10n("configure.field.concurrency"),
      description: conc.allowConcurrent
        ? l10n("configure.concurrency.allow")
        : l10n("configure.concurrency.block"),
    },
    {
      id: "lock",
      label: l10n("configure.field.lock"),
      description: conc.lockName ?? l10n("configure.value.none"),
    },
    {
      id: "save",
      label: l10n("configure.save"),
      description: l10n("configure.saveHint"),
    },
  ];

  // ignoreFocusOut: dismissing the hub discards the whole working copy, so a
  // stray click outside the picker must NOT close it — only a deliberate Esc
  // does. Without this, one misclick loses every edit and the user starts over.
  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: l10n("configure.hubPlaceholder"),
    ignoreFocusOut: true,
  });
  return pick?.id;
}

function locationLabel(value: RunLocation | undefined): string {
  switch (value) {
    case "terminal":
      return l10n("configure.terminal.integrated");
    case "background":
      return l10n("configure.terminal.background");
    case "external":
      return l10n("configure.terminal.external");
    default:
      return l10n("configure.terminal.default");
  }
}
