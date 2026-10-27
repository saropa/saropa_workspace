import * as vscode from "vscode";
import { OvernightConfig, START_WITHIN_MS, SkipReason, asOvernight, dueDay, openWindowDay, planSteps, showOffer, stepSkipReason } from "../board/overnight";
import { withTimeout } from "../board/timeout";
import { BoardConfig, ProjectDef } from "../board/types";
import { hasInteractiveTokens } from "../exec/promptTokens";
import { dependencyState } from "../exec/dependencies";
import { isRunnable, runBlockReason } from "../exec/runPlanning";
import { Shortcut, shortcutKind } from "../model/shortcut";
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

// Whether the shortcut may start unattended; anything that would show a prompt or a
// message is a skip.
async function skipReason(store: ShortcutStore, shortcut: Shortcut): Promise<SkipReason | undefined> {
  const isFile = shortcutKind(shortcut) === "file";
  const uri = isFile ? store.resolveUri(shortcut) : undefined;
  let fileMissing = isFile && !uri;
  if (uri) {
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      fileMissing = true;
    }
  }
  return stepSkipReason({
    blocked: runBlockReason(shortcut) !== undefined,
    pendingDependency: dependencyState(shortcut, (id) => store.findShortcut(id)).pendingDependencyId !== undefined,
    interactive: hasInteractiveTokens(shortcut),
    fileMissing,
    notRunnable: isFile && uri !== undefined && !fileMissing && !isRunnable(shortcut, uri.fsPath),
  });
}

// Waits until the shortcut's background run ends. Gives up (and stops the run) after `ms`,
// or when the setting is turned off; gives up without waiting when no run shows itself
// within a minute. Subscribes before the caller starts the run, so a fast run is never missed.
function waitForEnd(pinId: string, since: number, ms: number): { done: Promise<void>; cancel: () => void } {
  const subs: vscode.Disposable[] = [];
  const ended = (): boolean => (runStatusRegistry.get(pinId)?.endedAt ?? 0) >= since;
  let started = false;
  let startTimer: NodeJS.Timeout | undefined;
  const job = new Promise<void>((resolve, reject) => {
    subs.push(
      runStatusRegistry.onDidChange(() => ended() && resolve()),
      processRegistry.onDidChange(() => {
        started = started || processRegistry.isRunning(pinId);
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(`${SETTINGS}.overnight`) && !readConfig().enabled) {
          reject(new Error("turned off"));
        }
      })
    );
    startTimer = setTimeout(() => !started && !ended() && resolve(), START_WITHIN_MS);
  });
  const done = withTimeout(job, ms, () => processRegistry.stop(pinId)).then(
    () => undefined,
    () => {
      // Turned off mid-step: stop the run this feature started.
      processRegistry.stop(pinId);
    }
  );
  const cleanup = (): void => {
    clearTimeout(startTimer);
    subs.forEach((d) => d.dispose());
  };
  return { done: done.finally(cleanup), cancel: cleanup };
}

// Runs one step. Skips (never prompts) when the shortcut is the owner's own running job, is
// gone, or would ask for anything.
async function runStep(store: ShortcutStore, project: ProjectDef, kind: "lint" | "tests", ms: number): Promise<void> {
  const shortcut = findHealthShortcut(store, project, kind);
  if (!shortcut || (await skipReason(store, shortcut)) !== undefined) {
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
  // The same check as the offer: with the board off, nothing runs.
  if (!vscode.workspace.getConfiguration(SETTINGS).get<boolean>("enabled", true)) {
    return;
  }
  const cfg = readConfig();
  const day = dueDay(new Date(), cfg, context.workspaceState.get<string>(LAST_DAY_KEY));
  if (!day || busy) {
    return;
  }
  busy = true;
  try {
    // Marked first: a crash or a reload mid-run does not start a second run the same night.
    await context.workspaceState.update(LAST_DAY_KEY, day);
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
    changed,
    { dispose: () => (clearTimeout(first), clearInterval(timer)) },
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration(`${SETTINGS}.overnight`) && changed.fire()),
    vscode.commands.registerCommand("saropaWorkspace.releaseBoard.overnight.enable", () => turnOn(context, store, loadConfig)),
    vscode.commands.registerCommand("saropaWorkspace.releaseBoard.overnight.dismissOffer", async () => {
      await context.globalState.update(DISMISSED_KEY, true);
      changed.fire();
    })
  );
}
