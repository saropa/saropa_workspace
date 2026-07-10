import * as vscode from "vscode";
import { Shortcut, ShortcutExecConfig, RunLocation } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { l10n } from "../i18n/l10n";
import { editCommand, editArgs, formatArgs } from "./configureRunCommand";
import { editCwd, editEnv, editDependsOn } from "./configureRunEnv";
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
import type { ConcurrencyEdit } from "./configureRun";

// The run-parameters hub's QuickPick rows and per-cluster dispatch, split out of
// configureRun.ts (which owns the working copy, the loop skeleton, and persistence)
// purely to keep that file under the project's line-count cap. Nothing here is
// consumed outside configureRun.ts's hub loop.

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

// What the loop does after one hub pick: "cancel" on Esc (discard, return to caller),
// "save" once the user picks Save (persist, return to caller), "continue" after any
// field edit (redraw the hub with the freshly edited value).
type HubChoiceSignal = "cancel" | "save" | "continue";

// Render the run-parameters hub as a QuickPick built from the three field clusters
// (core exec config, location/mode, behavior/scheduling) plus the trailing Save row.
// ignoreFocusOut keeps the picker open on a stray focus loss, since dismissing it
// discards the whole working copy — only a deliberate Esc may do that.
export async function showHub(
  work: ShortcutExecConfig,
  conc: ConcurrencyEdit,
  title: string,
  depName: string | undefined
): Promise<HubItem["id"] | undefined> {
  const items = buildHubItems(work, conc, depName);

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

// Apply a single hub pick. Esc and Save short-circuit before the switch since neither
// mutates work/conc; every other id belongs to one of the three field clusters below
// (mirroring buildRunConfigHubItems / buildLocationHubItems / buildAdvancedHubItems), so
// this switch only routes to the matching cluster helper, then falls through to
// "continue" so the loop redraws the hub with the freshly edited value.
export async function applyHubChoice(
  choice: HubItem["id"] | undefined,
  work: ShortcutExecConfig,
  conc: ConcurrencyEdit,
  store: ShortcutStore,
  shortcut: Shortcut,
  title: string
): Promise<HubChoiceSignal> {
  if (!choice) {
    return "cancel";
  }
  if (choice === "save") {
    return "save";
  }
  switch (choice) {
    case "command":
    case "args":
    case "cwd":
    case "env":
      await applyRunConfigChoice(choice, work, store, shortcut, title);
      break;
    case "location":
    case "elevated":
    case "fileArg":
    case "extract":
      await applyLocationChoice(choice, work, title);
      break;
    case "dependsOn":
    case "sound":
    case "runOnSave":
    case "concurrency":
    case "lock":
      await applyAdvancedChoice(choice, work, conc, store, shortcut, title);
      break;
  }
  return "continue";
}

// Core exec-config cluster (mirrors buildRunConfigHubItems): open the sub-editor for the
// interpreter prefix, its arguments, the working directory, or the environment variables.
async function applyRunConfigChoice(
  choice: "command" | "args" | "cwd" | "env",
  work: ShortcutExecConfig,
  store: ShortcutStore,
  shortcut: Shortcut,
  title: string
): Promise<void> {
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
  }
}

// Where-and-how-it-runs cluster (mirrors buildLocationHubItems): open the sub-editor for
// the terminal location, the external-only elevation toggle, the file-arg toggle, or the
// output-extraction pattern.
async function applyLocationChoice(
  choice: "location" | "elevated" | "fileArg" | "extract",
  work: ShortcutExecConfig,
  title: string
): Promise<void> {
  switch (choice) {
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
  }
}

// Behavior/scheduling cluster (mirrors buildAdvancedHubItems): open the sub-editor for the
// run-before dependency, the sound override, run-on-save, or the single-instance settings
// (concurrency + lock name).
async function applyAdvancedChoice(
  choice: "dependsOn" | "sound" | "runOnSave" | "concurrency" | "lock",
  work: ShortcutExecConfig,
  conc: ConcurrencyEdit,
  store: ShortcutStore,
  shortcut: Shortcut,
  title: string
): Promise<void> {
  switch (choice) {
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

// Assemble the hub's field-summary rows by concatenating the logical clusters below,
// then appending the trailing Save action (the one row with no editable field behind
// it, so it does not belong in any cluster).
function buildHubItems(
  work: ShortcutExecConfig,
  conc: ConcurrencyEdit,
  depName: string | undefined
): HubItem[] {
  return [
    ...buildRunConfigHubItems(work),
    ...buildLocationHubItems(work),
    ...buildAdvancedHubItems(work, conc, depName),
    {
      id: "save",
      label: l10n("configure.save"),
      description: l10n("configure.saveHint"),
    },
  ];
}

// Core exec-config rows: the interpreter prefix, its arguments, the working directory,
// and the environment-variable count — the fields every run has regardless of where or
// how it executes.
function buildRunConfigHubItems(work: ShortcutExecConfig): HubItem[] {
  return [
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
  ];
}

// Where-and-how-it-runs rows: terminal location, the elevation toggle that only applies
// to an external window, whether the file path is appended, and the output-extraction
// pattern.
function buildLocationHubItems(work: ShortcutExecConfig): HubItem[] {
  return [
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
  ];
}

// Behavior/scheduling rows: the run-before-this dependency, the sound override, the
// run-on-save toggle, and the single-instance settings (concurrency + lock name).
function buildAdvancedHubItems(
  work: ShortcutExecConfig,
  conc: ConcurrencyEdit,
  depName: string | undefined
): HubItem[] {
  return [
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
  ];
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
