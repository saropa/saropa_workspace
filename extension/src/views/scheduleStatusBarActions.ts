import * as vscode from "vscode";
import { Shortcut } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { peekLastReport } from "../exec/lastReport";
import { openReport } from "../exec/reportOpen";
import { l10n } from "../i18n/l10n";
import { formatWhen, SCHEDULE_STATUS_BAR_SETTING } from "./scheduleStatusBar";

// The action menu behind the next-scheduled-run status-bar item. Clicking the item
// used to only reveal the shortcut in the tree, which answered none of the questions
// the indicator raises: where is the report it just wrote, how do I change the time,
// how do I turn it off, how do I get rid of the indicator. Each of those is now one
// click away, and the report entry is first because it is the reason the run exists.

// One QuickPick row. `run` performs the action; the picker closes first so a chosen
// action never fights the picker for focus (opening an editor under an open
// QuickPick leaves the editor unfocused).
interface ScheduleAction {
  label: string;
  detail?: string;
  run(): Promise<void>;
}

export async function showScheduleStatusBarActions(
  store: ShortcutStore,
  shortcut: Shortcut,
  nextRunAt: number
): Promise<void> {
  const name = shortcut.label ?? shortcut.id;
  const actions = buildActions(store, shortcut, name);
  const picked = await vscode.window.showQuickPick(
    actions.map((a) => ({ label: a.label, detail: a.detail, action: a })),
    {
      title: l10n("statusBar.actions.title", { name, time: formatWhen(nextRunAt) }),
      placeHolder: l10n("statusBar.actions.placeholder"),
    }
  );
  if (picked) {
    await picked.action.run();
  }
}

function buildActions(
  store: ShortcutStore,
  shortcut: Shortcut,
  name: string
): ScheduleAction[] {
  const actions: ScheduleAction[] = [];

  // The report this shortcut's last run wrote, when this session has seen one. Peek,
  // not take: the Schedule screen links the same path and must still find it.
  const report = peekLastReport(shortcut.id);
  if (report) {
    actions.push({
      label: l10n("statusBar.actions.openReport"),
      detail: report,
      run: () => openReport(report),
    });
  }

  // Reachable whether or not a report exists this session: the Schedule screen lists
  // every scheduled item with its last outcome and a link to its latest report, so it
  // is the durable answer to "where are my reports".
  actions.push({
    label: l10n("statusBar.actions.openSchedule"),
    detail: l10n("statusBar.actions.openScheduleDetail"),
    run: async () => {
      await vscode.commands.executeCommand("saropaWorkspace.openSchedule");
    },
  });

  actions.push({
    label: l10n("statusBar.actions.runNow", { name }),
    run: async () => {
      await vscode.commands.executeCommand("saropaWorkspace.runPinById", shortcut.id);
    },
  });

  actions.push({
    label: l10n("statusBar.actions.reveal", { name }),
    run: async () => {
      await vscode.commands.executeCommand("saropaWorkspace.revealNextScheduled");
    },
  });

  actions.push({
    label: l10n("statusBar.actions.editSchedule", { name }),
    run: async () => {
      await vscode.commands.executeCommand("saropaWorkspace.configureSchedule", shortcut);
    },
  });

  // Turning the schedule off is distinct from hiding the indicator: one stops the
  // run, the other stops the reminder. Both are offered, and each says which it is.
  const schedule = shortcut.schedule;
  if (schedule) {
    actions.push({
      label: l10n("statusBar.actions.disable", { name }),
      detail: l10n("statusBar.actions.disableDetail"),
      run: async () => {
        await store.updateShortcutSchedule(shortcut, { ...schedule, enabled: false });
        vscode.window.showInformationMessage(l10n("statusBar.actions.disabled", { name }));
      },
    });
  }

  actions.push({
    label: l10n("statusBar.actions.hide"),
    detail: l10n("statusBar.actions.hideDetail"),
    run: async () => {
      // Global (user) scope: the indicator is chrome, and a user who dismisses it in
      // one project means it everywhere. The setting is the durable record; VS Code's
      // own right-click hide is per-window and lost on profile changes.
      await vscode.workspace
        .getConfiguration("saropaWorkspace")
        .update(SCHEDULE_STATUS_BAR_SETTING, false, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(l10n("statusBar.actions.hidden"));
    },
  });

  return actions;
}
