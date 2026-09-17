import * as vscode from "vscode";
import {
  ADB_COMMAND_CATALOG,
  AdbCommandEntry,
} from "../../model/adbCommandCatalog";
import { substituteAdbCommand } from "../../model/adbCommandSubstitution";
import { AndroidProjectProfile } from "../../model/androidProjectProfile";
import { ShortcutStore } from "../../model/shortcutStore";
import { Shortcut, ShortcutScope } from "../../model/shortcut";
import { adbRunHistory } from "../../exec/adbRunHistory";
import {
  cloneWithResolvedTokens,
  hasInteractiveTokens,
  resolveInteractiveTokens,
} from "../../exec/promptTokens";
import { getOutputChannel, runShellAction } from "../../exec/runner";
import { l10n } from "../../i18n/l10n";

// What the Mobile Remote Control panel's two row actions actually DO
// (MOBILE_REMOTE_CONTROL_PLAN section 4, build-order steps 5-6). Split out of
// remoteControlPanel.ts so that file stays what it is elsewhere in this extension — a
// webview host and a message protocol — and so this, the part with the confirm dialog
// and the run, can be read in one piece.
//
// THE RUN PATH, end to end:
//   1. substitute the entry's `{token}` template against the project profile
//      (model/adbCommandSubstitution.ts — pure, tested);
//   2. resolve whatever it left as `${prompt:...}` / `${pick:...}` through
//      exec/promptTokens.ts, the same run-parameter machinery a library.json shortcut
//      uses, so a file path or a port is ASKED rather than guessed;
//   3. show the DRY-RUN PREVIEW: a modal carrying the exact, fully substituted command
//      line, which the user confirms or cancels. Always — not only for a destructive
//      command — because the substitution is the whole point of the panel and a user is
//      entitled to see what a one-click row resolved to. A destructive entry gets the
//      warning-severity dialog and its own "this destroys state" wording;
//   4. run it through exec/runner.ts's shell-action path — the same one every recipe
//      shell shortcut takes, ending in a fresh integrated terminal — and record the run
//      for ranking.
// Every exit from that sequence surfaces something (a toast, an output-channel line, or
// both), per the "no silent async" rule: a cancel says it canceled.
//
// NOT a second execution mechanism: nothing here spawns a process, creates a terminal or
// builds a command line beyond the substitution above. runShellAction owns the run.

// The pseudo-shortcut id an adb catalog run is executed under. It is NOT a real shortcut
// id — no Shortcut carries it — so nothing resolves it in the Shortcuts tree; it exists
// to key two per-run side stores that are keyed by shortcut id: the interactive-token
// prompt memory (so "which apk did I install last time" is remembered per catalog entry)
// and the terminal label. Ranking is kept in exec/adbRunHistory.ts instead, for the
// reasons that file's header gives.
export function adbRunId(entryId: string): string {
  return `adb:${entryId}`;
}

/** Look one catalog entry up by id. `undefined` for an id the webview made up. */
export function findAdbEntry(id: string): AdbCommandEntry | undefined {
  return ADB_COMMAND_CATALOG.find((e) => e.id === id);
}

// Build the throwaway Shortcut that carries a command line through the interactive-token
// resolver. promptTokens.ts reads a shortcut's exec.command/args/cwd, so the command goes
// in `exec.command`; it is never stored, never added to the tree, and never persisted.
function tokenCarrier(entryId: string, label: string, command: string): Shortcut {
  return {
    id: adbRunId(entryId),
    path: "",
    scope: "global",
    order: 0,
    label,
    exec: { command },
  };
}

// Resolve any `${prompt:...}` / `${pick:...}` left by substitution. Returns the final
// command line, or undefined when the user escaped a prompt — a cancel of the whole run,
// matching runShortcut's behavior for a parameterized shortcut.
async function resolvePrompts(
  entry: AdbCommandEntry,
  label: string,
  command: string
): Promise<string | undefined> {
  const carrier = tokenCarrier(entry.id, label, command);
  if (!hasInteractiveTokens(carrier)) {
    return command;
  }
  const values = await resolveInteractiveTokens(carrier);
  if (values === undefined) {
    return undefined;
  }
  return cloneWithResolvedTokens(carrier, values).exec?.command ?? command;
}

// The dry-run preview. A modal so the substituted command line is unmissable and the
// choice is explicit — the codebase's existing convention for a consequential action
// (fileOps delete, the shortcut-peek run, the shared-shortcut import all confirm this
// way). A destructive entry uses showWarningMessage and says what it destroys; everything
// else uses the informational variant and simply shows what will run.
async function confirmRun(entry: AdbCommandEntry, command: string): Promise<boolean> {
  const name = l10n(entry.labelKey);
  const confirm = l10n("remoteControl.confirm.run");
  const options: vscode.MessageOptions = { modal: true, detail: command };
  const picked = entry.destructive
    ? await vscode.window.showWarningMessage(
        l10n("remoteControl.confirm.destructiveTitle", { name }),
        options,
        confirm
      )
    : await vscode.window.showInformationMessage(
        l10n("remoteControl.confirm.title", { name }),
        options,
        confirm
      );
  return picked === confirm;
}

/**
 * Run one catalog entry: substitute, ask, preview, confirm, run, record.
 * Returns the command line that was run, or undefined when nothing ran (unknown id,
 * canceled prompt, declined confirm) — the panel does not use the value, but a test and
 * a future caller (the `runAdbCommand` palette command) can assert on it.
 */
export async function runAdbCommand(
  id: string,
  profile?: AndroidProjectProfile
): Promise<string | undefined> {
  const entry = findAdbEntry(id);
  if (!entry) {
    return undefined;
  }
  const name = l10n(entry.labelKey);
  const substitution = substituteAdbCommand(entry, profile);

  // No Android project (or a project whose gradle file yielded no application id) and a
  // command that needs one: say so once, here, rather than letting the prompt below ask
  // for a package id with no explanation of why it does not already know it. The run is
  // not blocked — typing the id by hand is a legitimate answer — so this is a warning,
  // not a refusal.
  if (substitution.missingFromProfile.length > 0) {
    vscode.window.showWarningMessage(
      l10n("remoteControl.run.noProject", {
        name,
        tokens: substitution.missingFromProfile.join(", "),
      })
    );
  }

  const command = await resolvePrompts(entry, name, substitution.command);
  if (command === undefined) {
    getOutputChannel().appendLine(l10n("remoteControl.run.canceledLog", { name }));
    vscode.window.showInformationMessage(l10n("remoteControl.run.canceled", { name }));
    return undefined;
  }

  if (!(await confirmRun(entry, command))) {
    getOutputChannel().appendLine(l10n("remoteControl.run.canceledLog", { name }));
    vscode.window.showInformationMessage(l10n("remoteControl.run.canceled", { name }));
    return undefined;
  }

  // The exact string that is about to run, in the shared output channel, before it runs:
  // the panel's own persistent record of what happened, independent of whichever terminal
  // tab the command landed in.
  getOutputChannel().appendLine(l10n("remoteControl.run.log", { name, command }));
  await adbRunHistory.record(entry.id);
  await runShellAction(
    { shellCommand: command, useIntegratedTerminal: true },
    name,
    adbRunId(entry.id)
  );
  return command;
}

/**
 * Pin one catalog entry into the real Shortcuts tree as a shell shortcut.
 *
 * The pinned command is the SUBSTITUTED one, with anything the profile could not answer
 * left as a `${prompt:...}` / `${pick:...}` token — so the shortcut asks the same
 * questions the panel would, every time it is run, instead of freezing today's answers
 * into a command line that silently goes stale. It is added through the store's existing
 * addShellShortcut API (the same one the shell-history suggester uses), so it is an
 * ordinary shortcut afterwards: renameable, groupable, schedulable, removable.
 *
 * Project scope when a workspace folder is open (the command is usually project-specific,
 * carrying this project's package id), global otherwise.
 */
export async function pinAdbCommand(
  store: ShortcutStore,
  id: string,
  profile?: AndroidProjectProfile
): Promise<boolean> {
  const entry = findAdbEntry(id);
  if (!entry) {
    return false;
  }
  const name = l10n(entry.labelKey);
  const command = substituteAdbCommand(entry, profile).command;
  const scope: ShortcutScope = vscode.workspace.workspaceFolders?.[0]
    ? "project"
    : "global";
  const added = await store.addShellShortcut(name, command, scope, true);
  if (!added) {
    vscode.window.showWarningMessage(l10n("remoteControl.pin.failed", { name }));
    return false;
  }
  vscode.window.showInformationMessage(
    l10n(scope === "project" ? "remoteControl.pin.addedProject" : "remoteControl.pin.addedGlobal", {
      name,
    })
  );
  return true;
}
