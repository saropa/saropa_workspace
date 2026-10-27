import * as vscode from "vscode";
import { OvernightConfig, asOvernight, dueDay, openWindowDay, planSteps, showOffer } from "../board/overnight";
import { withTimeout } from "../board/timeout";
import { BoardConfig, ProjectDef } from "../board/types";
import { toBackground } from "../exec/chainRunner";
import { processRegistry } from "../exec/processRegistry";
import { runStatusRegistry } from "../exec/runStatus";
import { ShortcutStore } from "../model/shortcutStore";
import { l10n } from "../i18n/l10n";
import { findHealthShortcut } from "./boardHealth";

// Overnight proof run, VS Code layer. Once per night, inside the configured window, it
// starts each project's own lint and test shortcuts in the background (the same start the
// Path to GO buttons use), one at a time, and waits for each to end. It records nothing
// itself: boardHealth.ts records every finished background run, so a step that fails, times
// out or never starts leaves the evidence missing or failing, never passing. It edits no
// file. Off by default; the sidebar offers to turn it on until the offer is dismissed.

const SETTINGS = "saropaWorkspace.releaseBoard";
const LAST_DAY_KEY = "saropaWorkspace.releaseBoard.overnight.lastDay";
const DISMISSED_KEY = "saropaWorkspace.releaseBoard.overnight.offerDismissed";
// How often the window is checked. A run starts at the first check inside the window.
const CHECK_EVERY_MS = 5 * 60000;
const FIRST_CHECK_MS = 60000;

const changed = new vscode.EventEmitter<void>();
// Fires when the offer may have appeared or gone, so the sidebar repaints.
export const onDidChangeOvernightOffer = changed.event;

function readConfig(): OvernightConfig {
  const c = vscode.workspace.getConfiguration(`${SETTINGS}.overnight`);
  return asOvernight({
    enabled: c.get("enabled", false),
    startTime: c.get("startTime"),
    windowHours: c.get("windowHours"),
    stepTimeoutMinutes: c.get("stepTimeoutMinutes"),
  });
}

// True when the sidebar should show the offer line.
export function overnightOfferVisible(context: vscode.ExtensionContext): boolean {
  const boardOn = vscode.workspace.getConfiguration(SETTINGS).get<boolean>("enabled", true);
  return boardOn && showOffer(readConfig(), context.globalState.get<boolean>(DISMISSED_KEY, false));
}

// Waits until the shortcut's background run ends, or gives up after `ms` and stops it.
// Subscribes before the caller starts the run, so a fast run is never missed.
function waitForEnd(pinId: string, since: number, ms: number): { done: Promise<void>; cancel: () => void } {
  let sub: vscode.Disposable | undefined;
  const ended = (): boolean => (runStatusRegistry.get(pinId)?.endedAt ?? 0) >= since;
  const job = new Promise<void>((resolve) => {
    sub = runStatusRegistry.onDidChange(() => ended() && resolve());
  });
  const done = withTimeout(job, ms, () => processRegistry.stop(pinId)).then(
    () => undefined,
    () => undefined
  );
  return { done: done.finally(() => sub?.dispose()), cancel: () => sub?.dispose() };
}

// Runs one step. Skips when the shortcut is already running (it is the owner's run) or
// is gone.
async function runStep(store: ShortcutStore, project: ProjectDef, kind: "lint" | "tests", ms: number): Promise<void> {
  const shortcut = findHealthShortcut(store, project, kind);
  if (!shortcut || processRegistry.isRunning(shortcut.id)) {
    return;
  }
  const wait = waitForEnd(shortcut.id, Date.now(), ms);
  try {
    await vscode.commands.executeCommand("saropaWorkspace.runPin", toBackground(shortcut));
  } catch {
    wait.cancel();
    return;
  }
  await wait.done;
}

let busy = false;

async function tonight(context: vscode.ExtensionContext, store: ShortcutStore, loadConfig: () => Promise<BoardConfig>): Promise<void> {
  const cfg = readConfig();
  const day = dueDay(new Date(), cfg, context.globalState.get<string>(LAST_DAY_KEY));
  if (!day || busy) {
    return;
  }
  busy = true;
  try {
    // Marked first: a crash or a reload mid-run does not start a second run the same night.
    await context.globalState.update(LAST_DAY_KEY, day);
    const board = await loadConfig();
    const steps = planSteps(
      board.projects.map((p) => ({ id: p.id, canLint: findHealthShortcut(store, p, "lint") !== undefined, canTests: findHealthShortcut(store, p, "tests") !== undefined }))
    );
    for (const step of steps) {
      const now = readConfig();
      // Stop when the owner turns it off or the window closes; no new step starts after.
      if (!now.enabled || openWindowDay(new Date(), now) !== day) {
        return;
      }
      const project = board.projects.find((p) => p.id === step.projectId);
      if (project) {
        await runStep(store, project, step.kind, now.stepTimeoutMs);
      }
    }
  } catch {
    // A failed night leaves the evidence as it was; the next night tries again.
  } finally {
    busy = false;
  }
}

async function turnOn(context: vscode.ExtensionContext, store: ShortcutStore, loadConfig: () => Promise<BoardConfig>): Promise<void> {
  await vscode.workspace.getConfiguration(`${SETTINGS}.overnight`).update("enabled", true, vscode.ConfigurationTarget.Global);
  const c = readConfig();
  const hh = String(Math.floor(c.startMinutes / 60)).padStart(2, "0");
  const mm = String(c.startMinutes % 60).padStart(2, "0");
  void vscode.window.showInformationMessage(l10n("releaseBoard.overnight.enabledMsg", { start: `${hh}:${mm}`, hours: c.windowMinutes / 60 }));
  const board = await loadConfig().catch(() => undefined);
  if (board && !board.projects.some((p) => findHealthShortcut(store, p, "lint") || findHealthShortcut(store, p, "tests"))) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.overnight.noShortcuts"));
  }
  changed.fire();
}

export function registerBoardOvernight(context: vscode.ExtensionContext, store: ShortcutStore, loadConfig: () => Promise<BoardConfig>): void {
  const check = (): void => void tonight(context, store, loadConfig);
  const first = setTimeout(check, FIRST_CHECK_MS);
  const timer = setInterval(check, CHECK_EVERY_MS);
  context.subscriptions.push(
    { dispose: () => (clearTimeout(first), clearInterval(timer)) },
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration(`${SETTINGS}.overnight`) && changed.fire()),
    vscode.commands.registerCommand("saropaWorkspace.releaseBoard.overnight.enable", () => turnOn(context, store, loadConfig)),
    vscode.commands.registerCommand("saropaWorkspace.releaseBoard.overnight.dismissOffer", async () => {
      await context.globalState.update(DISMISSED_KEY, true);
      changed.fire();
    })
  );
}
