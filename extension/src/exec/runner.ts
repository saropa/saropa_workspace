import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
  MacroStep,
  Pin,
  PinExecConfig,
  RoutineMember,
  RunLocation,
  SoundOverride,
} from "../model/pin";
import { processRegistry } from "./processRegistry";
import { isConcurrencyBlocked } from "./concurrency";
import * as runLock from "./runLock";
import { runStatusRegistry, formatDuration } from "./runStatus";
import { runOutputs } from "./runOutputs";
import { telemetry, RunSource } from "./telemetry";
import { buildTokenMap, expandTokens } from "./tokens";
import {
  resolveInterpreter,
  isRunnablePlan,
  quoteArg,
  assembleCommandLine,
} from "./commandPlan";
import {
  hasInteractiveTokens,
  resolveInteractiveTokens,
  cloneWithResolvedTokens,
} from "./promptTokens";
import { playCue } from "./soundCue";
import { pinEvents } from "./pinEvents";
import { PinBadge, pinBadges, parseRunBadge } from "./pinBadges";
import {
  detectBlockedPort,
  findPortHolder,
  killProcess,
  PortHolder,
} from "./portUnwedge";
import { l10n } from "../i18n/l10n";

// Builds and launches the command for a pin. Phase 1 supports the integrated
// terminal (visible, interactive) and a background output channel.

let sharedTerminal: vscode.Terminal | undefined;
let outputChannel: vscode.OutputChannel | undefined;

// Reset the cached terminal handle when the user closes it, so the next run
// recreates one instead of writing to a disposed terminal.
export function registerTerminalCleanup(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((t) => {
      if (t === sharedTerminal) {
        sharedTerminal = undefined;
      }
    })
  );
}

// Read a script's `#!` shebang and return the interpreter to run it through, or
// undefined when the file has none / cannot be read. Honors the Unix convention so
// an extensionless script (e.g. a `#!/usr/bin/env python3` file with no recognized
// extension) runs through its declared interpreter instead of depending on the
// file's executable bit — matching Code Runner. `#!/usr/bin/env X [args]` yields
// `X [args]` (the env wrapper is stripped); any other shebang yields its literal
// interpreter path + args. Reads only the first chunk (the shebang is the first
// line) so a large file is never slurped whole.
function shebangInterpreter(fsPath: string): string | undefined {
  let firstLine: string;
  try {
    const fd = fs.openSync(fsPath, "r");
    try {
      const buffer = Buffer.alloc(256);
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
      firstLine = buffer.toString("utf8", 0, bytesRead).split(/\r?\n/, 1)[0];
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Missing/unreadable file: no shebang to honor (the caller falls back to "").
    return undefined;
  }
  if (!firstLine.startsWith("#!")) {
    return undefined;
  }
  const rest = firstLine.slice(2).trim();
  if (!rest) {
    return undefined;
  }
  const parts = rest.split(/\s+/);
  // `#!/usr/bin/env python3` -> run `python3`: env's job is to locate the real
  // interpreter on PATH, which the shell already does for us, so drop it.
  if (path.basename(parts[0]) === "env" && parts.length > 1) {
    return parts.slice(1).join(" ");
  }
  return rest;
}

// Read the configured interpreter-defaults map (file extension -> command prefix).
// One reader so the prefix resolution and the runnable check share a source.
function interpreterDefaults(): Record<string, string> {
  return vscode.workspace
    .getConfiguration("saropaWorkspace")
    .get<Record<string, string>>("interpreterDefaults", {});
}

// Resolve the command prefix for a file. Reads the config + shebang here (the IO),
// then defers the precedence decision to the pure resolveInterpreter so the
// fallback order is unit-testable without the host. Empty result means "run
// directly".
function resolveCommandPrefix(pin: Pin, fsPath: string): string {
  return resolveInterpreter({
    explicitCommand: pin.exec?.command,
    ext: path.extname(fsPath).toLowerCase(),
    defaults: interpreterDefaults(),
    shebang: shebangInterpreter(fsPath),
  });
}

// Whether running this pin makes sense, i.e. there is a way to execute it. True
// when the user set an explicit command (including an explicit empty string,
// which means "run the file directly" — e.g. a shebang script), or the file's
// extension has a configured default interpreter, or the file carries a `#!`
// shebang. False for an ordinary document (.txt, .md, image, etc.) with no
// interpreter, where "run" has no meaning and the caller should open the file.
export function isRunnable(pin: Pin, fsPath: string): boolean {
  return isRunnablePlan({
    explicitCommand: pin.exec?.command,
    ext: path.extname(fsPath).toLowerCase(),
    defaults: interpreterDefaults(),
    hasShebang: shebangInterpreter(fsPath) !== undefined,
  });
}

// Resolve where a run happens. runLocation is the source of truth; for pins
// written before it existed, fall back to the deprecated useIntegratedTerminal
// boolean (true -> terminal, false -> background); if neither is set, follow the
// workspace default. One resolver so the legacy field is read in exactly one place.
function resolveRunLocation(exec: PinExecConfig | undefined): RunLocation {
  if (exec?.runLocation) {
    return exec.runLocation;
  }
  if (exec?.useIntegratedTerminal === true) {
    return "terminal";
  }
  if (exec?.useIntegratedTerminal === false) {
    return "background";
  }
  const defaultIntegrated = vscode.workspace
    .getConfiguration("saropaWorkspace")
    .get<boolean>("defaultUseIntegratedTerminal", true);
  return defaultIntegrated ? "terminal" : "background";
}

// Everything needed to launch a pin, resolved from its config and target. Kept
// as a single value so the scheduler can log the exact command it is about to
// run from one source of truth (planRun), rather than reassembling it.
export interface RunPlan {
  commandLine: string;
  cwd: string;
  env: Record<string, string> | undefined;
  name: string;
  // Where this run executes (integrated terminal / background channel / external
  // OS window), resolved from the pin's config and the workspace default.
  location: RunLocation;
  // Request administrator/elevated privileges; only meaningful when location is
  // "external".
  elevated: boolean;
  // $names that appeared in the command/args/cwd but are not recognized tokens.
  // Left literal in the command; surfaced once by runPin so they are not blanked
  // silently (a literal $name may also be an intentional shell variable).
  unknownTokens: string[];
  // Optional regex matched against a background run's output to extract one value to
  // the clipboard (WOW #16). Only honored for the background location.
  extractResult?: string;
}

// Resolve a pin + target into a concrete RunPlan. Pure of side effects so both
// runPin and the scheduler's log line share one assembly path. `extraTokens` adds
// run-specific token values (e.g. $droppedFile from a drag-and-drop run, WOW #8)
// merged over the standard file tokens.
export function planRun(
  pin: Pin,
  uri: vscode.Uri,
  extraTokens?: Record<string, string>
): RunPlan {
  const fsPath = uri.fsPath;
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;

  // Expand placeholder tokens in the command, each arg, and a custom cwd before
  // assembly/quoting, so a substituted path with spaces is quoted as one arg.
  const tokens = { ...buildTokenMap(fsPath, workspaceRoot), ...(extraTokens ?? {}) };
  const unknown = new Set<string>();

  const prefix = expandTokens(resolveCommandPrefix(pin, fsPath), tokens, unknown);
  const args = (pin.exec?.args ?? []).map((a) => expandTokens(a, tokens, unknown));
  const cwd = pin.exec?.cwd
    ? expandTokens(pin.exec.cwd, tokens, unknown)
    : workspaceRoot ?? path.dirname(fsPath);

  const name = pin.label ?? path.basename(fsPath);

  // Assemble <prefix> "<file>" <args...> via the pure core. includeFilePath ===
  // false omits the file entirely (npm-script / Make-target run configs name their
  // work in args and run against cwd, not the file path).
  const includeFile = pin.exec?.includeFilePath !== false;
  const commandLine = assembleCommandLine({ prefix, fsPath, args, includeFile });

  const location = resolveRunLocation(pin.exec);

  return {
    commandLine,
    cwd,
    env: pin.exec?.env,
    name,
    location,
    // Elevation only applies to an external window; ignored otherwise.
    elevated: location === "external" && pin.exec?.elevated === true,
    unknownTokens: [...unknown],
    extractResult: pin.exec?.extractResult,
  };
}

// Why a fresh run of this pin must not start, or undefined when it may. The single
// source of truth both the unattended runners (scheduler, chain, run-on-save) and
// the manual Run command consult, so the single-instance rule lives in one place:
//   - "running": one of THIS pin's runs is already tracked in this window (a
//     background / report-capture run); the in-process guard.
//   - "locked":  the pin's cross-process lock (lockName) is held by a LIVE holder
//     in another window / terminal / process.
// allowConcurrent:true opts a pin out of both. Integrated-terminal and external
// runs are untracked, so "running" never applies to them — only a lockName can
// guard those, and only against runs that also honor the lock.
export type RunBlockReason = "running" | "locked";

export function runBlockReason(pin: Pin): RunBlockReason | undefined {
  // The in-process guard: a tracked run of this exact pin is still in flight.
  if (isConcurrencyBlocked(pin.allowConcurrent, processRegistry.isRunning(pin.id))) {
    return "running";
  }
  // The cross-process guard: a live holder owns this pin's shared lock elsewhere.
  if (!pin.allowConcurrent && pin.lockName && runLock.isHeld(pin.lockName)) {
    return "locked";
  }
  return undefined;
}

// Localized one-phrase reason for a block, shared by every skip/blocked message so
// the wording is defined once.
export function blockReasonLabel(reason: RunBlockReason): string {
  return l10n(
    reason === "locked" ? "concurrency.reasonLocked" : "concurrency.reasonRunning"
  );
}

// Lazily create (and reuse) the shared output channel. Shared so scheduled-run
// log lines and background-run output land in the same "Saropa Workspace" panel.
export function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("Saropa Workspace");
  }
  return outputChannel;
}

// `source` distinguishes a user-triggered run ("manual", the default) from an
// unattended scheduled fire ("scheduled", passed by the Scheduler) for the local
// run telemetry that feeds the Recent group and the palette's recents.
export async function runPin(
  pin: Pin,
  uri: vscode.Uri,
  source: RunSource = "manual",
  extraTokens?: Record<string, string>
): Promise<void> {
  const name = pin.label ?? path.basename(uri.fsPath);

  // Resolve interactive run-parameter tokens (${prompt:...} / ${pick:...}) before
  // assembly, so the run uses the values the user just entered. Canceling any
  // prompt aborts the run with nothing executed; the stored pin is untouched, as
  // the substitution applies only to this run.
  let effectivePin = pin;
  if (hasInteractiveTokens(pin)) {
    const resolved = await resolveInteractiveTokens(pin);
    if (resolved === undefined) {
      getOutputChannel().appendLine(
        l10n("run.canceledPrompt", { time: new Date().toLocaleString(), name })
      );
      vscode.window.showInformationMessage(l10n("run.canceledPromptToast", { name }));
      return;
    }
    effectivePin = cloneWithResolvedTokens(pin, resolved);
  }

  const plan = planRun(effectivePin, uri, extraTokens);

  // Note unrecognized $tokens once so they are visibly left literal rather than
  // silently dropped (acceptance 2.4).
  if (plan.unknownTokens.length > 0) {
    getOutputChannel().appendLine(
      l10n("run.unknownTokens", {
        tokens: plan.unknownTokens.map((t) => `$${t}`).join(", "),
      })
    );
  }

  // Record the run for the Recent group and the palette's recents (after the
  // cancel checks above, so an aborted interactive prompt does not count as a run).
  void telemetry.record(pin.id, source);

  vscode.window.showInformationMessage(l10n("run.starting", { name: plan.name }));

  // Audio start cue (#64), honoring the pin's per-pin override. Fires for every
  // location; terminal/external runs get no finish cue because VS Code cannot track
  // their exit, so the start cue is their only audio acknowledgment.
  playCue("start", effectivePin.exec?.sound);

  // Route to the resolved location. An external run launches a separate OS
  // terminal window and returns immediately — VS Code cannot track its exit, so
  // it is not registered for Stop and gets no completion toast (the new window is
  // itself the visible feedback).
  switch (plan.location) {
    case "terminal":
      runInTerminal(plan.commandLine, plan.cwd, plan.env);
      // Terminal runs have no tracked exit, so chaining keys off dispatch: the
      // dependent fires as soon as the command is sent. Background fires its real
      // outcome from settle() instead (so it is excluded here).
      pinEvents.fireComplete(pin.id, "dispatched");
      break;
    case "external":
      await runInExternal(plan.commandLine, plan.cwd, plan.env, plan.elevated, plan.name);
      // External windows are fire-and-forget too: chain off the dispatch.
      pinEvents.fireComplete(pin.id, "dispatched");
      break;
    case "background":
      await runInBackground(
        plan.commandLine,
        plan.cwd,
        plan.env,
        plan.name,
        pin.id,
        plan.extractResult,
        effectivePin.exec?.sound,
        // Re-run from the original pin (not effectivePin) so a kill+retry re-resolves
        // any interactive ${prompt:}/${pick:} tokens, matching a fresh manual run.
        () => void runPin(pin, uri, source, extraTokens),
        // Cross-process lock held for this run's lifetime when the pin opts in.
        pin.lockName
      );
      break;
  }
}

// --- non-file pin kinds (recipes) --------------------------------------

// Run a non-file pin (url / shell / command / macro). The file kind is handled by
// runPin above; callers branch on pinKind and route non-file pins here. Returns
// without error for an unknown/empty action so a malformed recipe cannot throw.
export async function runAction(
  pin: Pin,
  source: RunSource = "manual"
): Promise<void> {
  const action = pin.action;
  if (!action) {
    return;
  }
  const name = pin.label ?? pin.id;
  // Recipe/non-file runs feed the same local telemetry as file runs.
  void telemetry.record(pin.id, source);
  // The pin's cross-process lock, passed down to the shell paths that own a child
  // process and can hold it (background / report capture). Other action kinds are
  // fire-and-forget and only the upstream runBlockReason check applies to them.
  const lockName = pin.lockName;

  switch (action.kind) {
    case "url":
      await openUrl(action.url, name);
      // url / command / macro pins have no tracked exit; chain off their dispatch so
      // a pin can still be triggered "after" an open-the-dashboard or run-a-macro pin.
      pinEvents.fireComplete(pin.id, "dispatched");
      return;
    case "command":
      await runVsCommand(action.commandId, action.commandArgs, name);
      pinEvents.fireComplete(pin.id, "dispatched");
      return;
    case "shell":
      // runShellAction fires its own completion: a real outcome from the background /
      // report path, or a dispatch from the terminal path. Not fired here, to avoid
      // a duplicate.
      await runShellAction(action, name, pin.id, lockName);
      return;
    case "macro":
      await runMacro(action.steps ?? [], name);
      pinEvents.fireComplete(pin.id, "dispatched");
      return;
    case "routine":
      // A routine resolves and runs OTHER recipe pins in sequence. The resolve +
      // single-pin-run logic lives in the store/command layer (which runner.ts must
      // not import — it would cycle), so it is injected once at activation via
      // setRoutineHooks. runRoutine fires its own aggregated completion.
      await runRoutine(pin, action.members ?? [], source);
      return;
    default:
      return;
  }
}

async function openUrl(url: string | undefined, name: string): Promise<void> {
  if (!url) {
    return;
  }
  await vscode.env.openExternal(vscode.Uri.parse(url));
  vscode.window.showInformationMessage(l10n("action.opened", { name, url }));
}

async function runVsCommand(
  commandId: string | undefined,
  args: unknown[] | undefined,
  name: string
): Promise<void> {
  if (!commandId) {
    return;
  }
  // A command pin may target another extension's command (e.g. a Saropa Suite
  // recipe driving Saropa Lints / Drift Advisor / Log Capture). If that extension
  // is not installed or not yet activated, executeCommand rejects with "command
  // not found". Degrade gracefully with a visible toast instead of an unhandled
  // rejection, satisfying the suite-integration "absent tool degrades" principle.
  try {
    await vscode.commands.executeCommand(commandId, ...(args ?? []));
  } catch (err) {
    getOutputChannel().appendLine(
      `[command] ${name} (${commandId}) failed: ${err instanceof Error ? err.message : String(err)}`
    );
    vscode.window.showWarningMessage(l10n("action.commandFailed", { name }));
  }
}

// Run a shell action's command line. With a reportFile, stdout+stderr are captured
// to that dated file (under cwd) and the file is opened when autoOpen is set —
// this is the scheduled-report path. Without one, output streams to the channel
// like an ordinary background run.
async function runShellAction(
  action: { shellCommand?: string; cwd?: string; useIntegratedTerminal?: boolean; reportFile?: string; autoOpen?: boolean },
  name: string,
  pinId: string,
  lockName?: string
): Promise<void> {
  const raw = action.shellCommand;
  if (!raw) {
    return;
  }
  const cwd = expandRecipeTokens(action.cwd ?? firstWorkspacePath() ?? process.cwd());
  const commandLine = expandRecipeTokens(raw);

  if (action.reportFile) {
    await runShellToReport(
      commandLine,
      cwd,
      expandRecipeTokens(action.reportFile),
      action.autoOpen === true,
      name,
      pinId,
      lockName
    );
    return;
  }

  const useTerminal =
    action.useIntegratedTerminal ??
    vscode.workspace
      .getConfiguration("saropaWorkspace")
      .get<boolean>("defaultUseIntegratedTerminal", true);
  vscode.window.showInformationMessage(l10n("run.starting", { name }));
  // Start cue for a recipe shell run (#64). A recipe pin has no exec override, so it
  // follows the global cue settings; the background path below plays the finish cue.
  playCue("start");
  if (useTerminal) {
    runInTerminal(commandLine, cwd, undefined);
    // Terminal shell run: no tracked exit, so chain off the dispatch (background
    // fires its real outcome from settle()).
    pinEvents.fireComplete(pinId, "dispatched");
  } else {
    await runInBackground(
      commandLine,
      cwd,
      undefined,
      name,
      pinId,
      undefined,
      undefined,
      // A shell recipe retries by re-dispatching itself; the action carries its own
      // command/cwd, so the kill+retry path can re-run it without a file/uri.
      () => void runShellAction(action, name, pinId, lockName),
      lockName
    );
  }
}

// Run a command, capture its combined output to a dated report file (created with
// its parent directory), and optionally open it. Used by scheduled report recipes.
async function runShellToReport(
  commandLine: string,
  cwd: string,
  reportRelOrAbs: string,
  autoOpen: boolean,
  name: string,
  pinId: string,
  lockName?: string
): Promise<void> {
  const cp = await import("child_process");
  const nodePath = await import("path");
  const channel = getOutputChannel();
  const reportPath = nodePath.isAbsolute(reportRelOrAbs)
    ? reportRelOrAbs
    : nodePath.join(cwd, reportRelOrAbs);

  channel.appendLine(`$ (${name}) ${commandLine}`);
  const startedAt = Date.now();
  const header = `# ${name}\n\nGenerated ${new Date().toLocaleString()}\nCommand: ${commandLine}\n\n`;
  let body = "";

  const child = cp.spawn(commandLine, {
    cwd,
    shell: true,
    env: { ...process.env },
  });
  processRegistry.register(pinId, child);
  // Hold the cross-process lock for this run's lifetime (opt-in). Keyed to the
  // child PID so release() only clears OUR record, and so a crash leaves a stale
  // (dead-PID) record the next run steals rather than a permanent block.
  if (lockName && child.pid !== undefined) {
    runLock.acquire(lockName, child.pid, name);
  }
  child.stdout?.on("data", (d) => (body += d.toString()));
  child.stderr?.on("data", (d) => (body += d.toString()));

  await new Promise<void>((resolve) => {
    const finish = async (code: number | null): Promise<void> => {
      const durationMs = Date.now() - startedAt;
      // Free the cross-process lock now this run has ended (release only clears our
      // own record, so a run that already stole the lock is unaffected).
      if (lockName && child.pid !== undefined) {
        runLock.release(lockName, child.pid);
      }
      try {
        const fs = await import("fs/promises");
        await fs.mkdir(nodePath.dirname(reportPath), { recursive: true });
        await fs.writeFile(reportPath, header + body, "utf8");
        channel.appendLine(l10n("report.wrote", { name, path: reportPath }));
        runStatusRegistry.record(pinId, {
          outcome: code === 0 ? "success" : "failure",
          exitCode: code,
          durationMs,
          endedAt: Date.now(),
        });
        // Finish cue (#64) for a captured-to-report run (scheduled rituals, the
        // process snapshot). Report recipes carry no per-pin override, so they
        // follow the global cue settings.
        playCue(code === 0 ? "success" : "failure");
        // Tracked outcome for the chain engine, same as the background path.
        pinEvents.fireComplete(pinId, code === 0 ? "success" : "failure");
        // Badge the pin from the captured report body (#26, #32): the lint sweep /
        // test-trend rituals run through this report path, so this is where their
        // severity counts / test tally reach the pin.
        const badge = parseRunBadge(body);
        if (badge) {
          pinBadges.record(pinId, badge);
        }
        if (autoOpen) {
          const doc = await vscode.workspace.openTextDocument(
            vscode.Uri.file(reportPath)
          );
          await vscode.window.showTextDocument(doc, { preview: false });
        }
      } catch (err) {
        channel.appendLine(
          l10n("report.failed", { name, error: err instanceof Error ? err.message : String(err) })
        );
      }
      resolve();
    };
    child.on("close", (code) => void finish(code));
    child.on("error", () => void finish(null));
  });
}

// Sequentially run macro steps (open / shell / url / command). A failing step is
// logged and the macro continues, so one bad step does not abort the rest.
async function runMacro(steps: MacroStep[], name: string): Promise<void> {
  const channel = getOutputChannel();
  for (const [index, step] of steps.entries()) {
    try {
      await runMacroStep(step);
    } catch (err) {
      channel.appendLine(
        l10n("macro.stepFailed", {
          name,
          step: String(index + 1),
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }
  vscode.window.showInformationMessage(
    l10n("macro.done", { name, count: String(steps.length) })
  );
}

async function runMacroStep(step: MacroStep): Promise<void> {
  switch (step.kind) {
    case "open": {
      if (!step.path) {
        return;
      }
      const uri = vscode.Uri.file(expandRecipeTokens(step.path));
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
      return;
    }
    case "url":
      if (step.url) {
        await vscode.env.openExternal(vscode.Uri.parse(step.url));
      }
      return;
    case "command":
      if (step.commandId) {
        await vscode.commands.executeCommand(
          step.commandId,
          ...(step.commandArgs ?? [])
        );
      }
      return;
    case "shell": {
      if (!step.shellCommand) {
        return;
      }
      const cwd = expandRecipeTokens(step.cwd ?? firstWorkspacePath() ?? process.cwd());
      runInTerminal(expandRecipeTokens(step.shellCommand), cwd, undefined);
      return;
    }
  }
}

// --- routine (a recipe of recipes) -------------------------------------

// Hooks injected once at activation (extension.ts) so the runner can resolve a
// routine member to its live pin and run it through the same single-pin path the
// tree / palette use, WITHOUT importing the store / command layer (that import
// would cycle: pinCommands already imports runAction). runRoutine no-ops with a
// logged note when the hooks are unset.
export interface RoutineHooks {
  // Resolve a member reference to the live pin, or undefined when the member recipe
  // / pin is absent (removed, not yet detected). recipeId is tried before pinId.
  resolveMember(member: RoutineMember): Pin | undefined;
  // Run one member pin to completion through the canonical single-pin path (handles
  // file vs action, dependency gating, missing files). Awaited so members run
  // strictly in sequence — overlapping report-writing members would interleave
  // output and spike CPU, the exact failure the hygiene member guards against.
  runMember(pin: Pin): Promise<void>;
}

let routineHooks: RoutineHooks | undefined;

export function setRoutineHooks(hooks: RoutineHooks): void {
  routineHooks = hooks;
}

// The outcome of one member within a routine run, for the summary report row.
interface MemberOutcome {
  label: string;
  status: "ok" | "failed" | "skipped" | "missing" | "dispatched";
  durationMs?: number;
  detail?: string;
}

// Run a routine's members strictly in sequence, continue-on-failure, then write a
// one-row-per-member summary report and badge the routine pin with the worst member
// outcome. Mirrors runMacro's failure policy (one broken member never blocks the
// rest) but over real recipe pins rather than inline steps.
async function runRoutine(
  pin: Pin,
  members: RoutineMember[],
  source: RunSource
): Promise<void> {
  const channel = getOutputChannel();
  const name = pin.label ?? pin.id;
  // A scheduled fire is unattended: interactive members cannot be answered, so they
  // are skipped (same rule the scheduler applies to scheduled pins).
  const unattended = source === "scheduled";

  if (!routineHooks) {
    channel.appendLine(l10n("routine.notReady", { name }));
    pinEvents.fireComplete(pin.id, "dispatched");
    return;
  }
  if (members.length === 0) {
    vscode.window.showInformationMessage(l10n("routine.empty", { name }));
    pinEvents.fireComplete(pin.id, "dispatched");
    return;
  }

  vscode.window.showInformationMessage(
    l10n("routine.starting", { name, count: String(members.length) })
  );

  const outcomes: MemberOutcome[] = [];
  const aggregate: PinBadge = { at: Date.now() };
  let anyFailed = false;

  for (const [index, member] of members.entries()) {
    const resolved = routineHooks.resolveMember(member);
    const memberLabel =
      member.label ??
      resolved?.label ??
      resolved?.id ??
      member.recipeId ??
      member.pinId ??
      `#${index + 1}`;

    // Per-member progress line into the shared channel ("Routine 'Morning' — 2/5: …").
    channel.appendLine(
      l10n("routine.step", {
        name,
        index: String(index + 1),
        count: String(members.length),
        member: memberLabel,
      })
    );

    if (!resolved) {
      outcomes.push({ label: memberLabel, status: "missing" });
      channel.appendLine(l10n("routine.memberMissing", { member: memberLabel }));
      continue;
    }
    // Routines do not nest: a routine member is skipped (bounds sequencing/failure
    // and prevents cycles), the one-level rule macros already enforce.
    if (resolved.action?.kind === "routine") {
      outcomes.push({
        label: memberLabel,
        status: "skipped",
        detail: l10n("routine.nestedSkippedDetail"),
      });
      channel.appendLine(l10n("routine.nestedSkipped", { member: memberLabel }));
      continue;
    }
    if (unattended && hasInteractiveTokens(resolved)) {
      outcomes.push({
        label: memberLabel,
        status: "skipped",
        detail: l10n("routine.interactiveSkippedDetail"),
      });
      channel.appendLine(l10n("routine.interactiveSkipped", { member: memberLabel }));
      continue;
    }

    const startedAt = Date.now();
    try {
      await routineHooks.runMember(resolved);
    } catch (err) {
      anyFailed = true;
      const error = err instanceof Error ? err.message : String(err);
      outcomes.push({
        label: memberLabel,
        status: "failed",
        durationMs: Date.now() - startedAt,
        detail: error,
      });
      channel.appendLine(l10n("routine.memberFailed", { member: memberLabel, error }));
      continue;
    }

    // Read the member's tracked outcome — background / report runs record one. A
    // terminal / url / command member has no tracked exit, so the absence of a fresh
    // result reads as "dispatched", never a failure. Guard on endedAt >= startedAt so
    // a stale prior-run result is not mistaken for this run's.
    const result = runStatusRegistry.get(resolved.id);
    const fresh = result && result.endedAt >= startedAt ? result : undefined;
    if (fresh) {
      if (fresh.outcome === "failure") {
        anyFailed = true;
      }
      outcomes.push({
        label: memberLabel,
        status: fresh.outcome === "success" ? "ok" : "failed",
        durationMs: fresh.durationMs,
      });
    } else {
      outcomes.push({
        label: memberLabel,
        status: "dispatched",
        durationMs: Date.now() - startedAt,
      });
    }
    // Fold the member's diagnostic / test badge into the routine's aggregate, so the
    // routine row shows the morning's total findings (#26 / #32 badge reuse).
    mergeBadge(aggregate, pinBadges.get(resolved.id));
  }

  // Badge the routine pin: a tracked worst-outcome result (red when any member
  // failed) plus the aggregated finding counts, both through the per-pin machinery
  // the tree already paints.
  runStatusRegistry.record(pin.id, {
    outcome: anyFailed ? "failure" : "success",
    exitCode: anyFailed ? 1 : 0,
    durationMs: 0,
    endedAt: Date.now(),
  });
  if (hasBadgeCounts(aggregate)) {
    pinBadges.record(pin.id, aggregate);
  }
  pinEvents.fireComplete(pin.id, anyFailed ? "failure" : "success");

  await writeRoutineSummary(name, outcomes, anyFailed);
}

// Sum a member's badge counts into the routine aggregate. Undefined member badge
// (a non-lint / non-test member) contributes nothing.
function mergeBadge(into: PinBadge, from: PinBadge | undefined): void {
  if (!from) {
    return;
  }
  const add = (a: number | undefined, b: number | undefined): number | undefined =>
    a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
  into.errors = add(into.errors, from.errors);
  into.warnings = add(into.warnings, from.warnings);
  into.infos = add(into.infos, from.infos);
  into.testsPassed = add(into.testsPassed, from.testsPassed);
  into.testsFailed = add(into.testsFailed, from.testsFailed);
}

function hasBadgeCounts(badge: PinBadge): boolean {
  return (
    badge.errors !== undefined ||
    badge.warnings !== undefined ||
    badge.infos !== undefined ||
    badge.testsPassed !== undefined ||
    badge.testsFailed !== undefined
  );
}

// Write the routine summary — one row per member (outcome + duration) — to a dated
// reports/ file, and open it when any member failed (otherwise stay quiet, badge
// only: the no-noise rule the scheduled rituals follow). Members write their own
// reports under reports/; this is the one-screen index over them.
async function writeRoutineSummary(
  name: string,
  outcomes: MemberOutcome[],
  anyFailed: boolean
): Promise<void> {
  const base = firstWorkspacePath();
  if (!base) {
    return;
  }
  const channel = getOutputChannel();
  // Filesystem-safe slug for the file name; the heading keeps the human name.
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "routine";
  const relative = expandRecipeTokens(`reports/$stamp_${slug}.md`);
  const reportPath = path.join(base, ...relative.split("/"));

  const rows = outcomes
    .map((o) => {
      const duration = o.durationMs !== undefined ? formatDuration(o.durationMs) : "—";
      const detail = o.detail ? escapeCell(o.detail) : "";
      return `| ${escapeCell(o.label)} | ${o.status} | ${duration} | ${detail} |`;
    })
    .join("\n");
  const body =
    `# ${name}\n\n` +
    `Generated ${new Date().toLocaleString()}\n\n` +
    `${outcomes.length} member(s); ${anyFailed ? "one or more need attention." : "all clear."}\n\n` +
    `| Member | Outcome | Duration | Notes |\n` +
    `|---|---|---|---|\n` +
    `${rows}\n`;

  try {
    const fsp = await import("fs/promises");
    await fsp.mkdir(path.dirname(reportPath), { recursive: true });
    await fsp.writeFile(reportPath, body, "utf8");
    channel.appendLine(l10n("report.wrote", { name, path: reportPath }));
    // Open the summary only when something needs the user — a clean run is silent.
    if (anyFailed) {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(reportPath));
      await vscode.window.showTextDocument(doc, { preview: false });
    }
  } catch (err) {
    channel.appendLine(
      l10n("report.failed", { name, error: err instanceof Error ? err.message : String(err) })
    );
  }
}

// Escape a Markdown table cell so a member label / error containing a pipe does not
// break the table layout.
function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function firstWorkspacePath(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

// Expand recipe-time tokens that are not file-scoped: $workspaceRoot, plus the
// date stamps used by report paths. $stamp is filesystem-safe (YYYY.MM.DD_HHmmss)
// for report file names; $date is YYYY-MM-DD for headings. Exported so the dry-run
// audit (simulateRun) resolves a recipe's shell/cwd the same way an actual run does,
// from this single source of truth rather than a second copy.
export function expandRecipeTokens(value: string): string {
  const root = firstWorkspacePath() ?? "";
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const stamp = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(
    now.getDate()
  )}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return value
    .split("$workspaceRoot").join(root)
    .split("$stamp").join(stamp)
    .split("$date").join(date);
}

function runInTerminal(
  commandLine: string,
  cwd: string,
  env: Record<string, string> | undefined
): void {
  const terminalName = vscode.workspace
    .getConfiguration("saropaWorkspace")
    .get<string>("terminalName", "Saropa Workspace");

  if (!sharedTerminal) {
    sharedTerminal = vscode.window.createTerminal({ name: terminalName, env });
  }
  sharedTerminal.show(true);
  // cd first so relative args/cwd behave; quoting handles spaces in the path.
  sharedTerminal.sendText(`cd ${quoteArg(cwd)}`);
  sharedTerminal.sendText(commandLine);
}

// Launch the command in a NEW OS terminal window, outside VS Code. The window
// stays open after the command exits so the user can read the output (the run is
// fire-and-forget: VS Code does not own the process, so there is no Stop action
// or completion toast — the window itself is the feedback). When `elevated`, the
// window is requested with administrator privileges (Windows UAC prompt). On
// Windows, elevation spawns a fresh elevated environment, so per-pin env vars do
// not propagate into an elevated window — surfaced to the user once below.
async function runInExternal(
  commandLine: string,
  cwd: string,
  env: Record<string, string> | undefined,
  elevated: boolean,
  name: string
): Promise<void> {
  const cp = await import("child_process");
  const channel = getOutputChannel();
  channel.appendLine(
    `$ (${name}) [external${elevated ? ", elevated" : ""}] ${commandLine}`
  );

  try {
    if (process.platform === "win32") {
      launchExternalWindows(cp, commandLine, cwd, env, elevated);
    } else if (process.platform === "darwin") {
      launchExternalMac(cp, commandLine, cwd, elevated);
    } else {
      launchExternalLinux(cp, commandLine, cwd, elevated);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    channel.appendLine(`\n[${name}] failed to launch external window: ${message}`);
    vscode.window.showErrorMessage(l10n("run.externalFailed", { name, error: message }));
    return;
  }

  // Elevation drops per-pin env vars (the elevated process gets a fresh
  // environment); say so once so a missing var is not a silent surprise.
  if (elevated && env && Object.keys(env).length > 0) {
    vscode.window.showWarningMessage(l10n("run.elevatedEnvDropped", { name }));
  }
  vscode.window.showInformationMessage(
    l10n(elevated ? "run.externalElevatedStarted" : "run.externalStarted", { name })
  );
}

// Single-quote a string for a PowerShell command (doubling embedded quotes), so a
// path or command line is passed to Start-Process as one literal argument.
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// Windows: open a new console window via PowerShell's Start-Process. cmd.exe /k
// keeps the window open after the command finishes; cd /d sets the directory
// (also honored when elevated, where Start-Process -WorkingDirectory is
// unreliable). `-Verb RunAs` triggers the UAC elevation prompt.
function launchExternalWindows(
  cp: typeof import("child_process"),
  commandLine: string,
  cwd: string,
  env: Record<string, string> | undefined,
  elevated: boolean
): void {
  const inner = `/k cd /d ${quoteArg(cwd)} & ${commandLine}`;
  const startArgs = [
    "-FilePath",
    "'cmd.exe'",
    "-ArgumentList",
    psQuote(inner),
  ];
  if (elevated) {
    startArgs.push("-Verb", "RunAs");
  }
  const psCommand = `Start-Process ${startArgs.join(" ")}`;
  const child = cp.spawn(
    "powershell.exe",
    // No -NonInteractive: it silently suppresses the UAC consent that
    // `Start-Process -Verb RunAs` triggers, so the elevated window never launches
    // (no prompt, no window, launcher still exits 0). The launcher only invokes a
    // fire-and-forget Start-Process and never reads input, so it has no use for
    // -NonInteractive anyway. Verified: with the flag the elevated process never
    // runs; without it, UAC fires and the window opens.
    ["-NoProfile", "-Command", psCommand],
    // Non-elevated windows inherit env from this launcher; detach so the window
    // outlives the launcher process. Elevated windows get a fresh environment.
    { detached: true, stdio: "ignore", env: { ...process.env, ...(env ?? {}) } }
  );
  child.unref();
}

// macOS: drive Terminal.app via AppleScript. Elevation wraps the command in a
// `sudo` invocation (Terminal prompts for the password in the new window); there
// is no UAC equivalent, so this is the closest "administrator" behavior.
function launchExternalMac(
  cp: typeof import("child_process"),
  commandLine: string,
  cwd: string,
  elevated: boolean
): void {
  const shellCmd = elevated ? `sudo ${commandLine}` : commandLine;
  const inner = `cd ${quoteArg(cwd)}; ${shellCmd}`;
  // Escape for embedding inside an AppleScript double-quoted string.
  const escaped = inner.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const script = `tell application "Terminal" to do script "${escaped}"`;
  const child = cp.spawn("osascript", ["-e", script], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

// Linux: open a terminal emulator and hold it open with an interactive shell.
// Elevation prefixes pkexec (graphical auth) when present, else sudo. Tries a few
// common emulators; the first that launches wins.
function launchExternalLinux(
  cp: typeof import("child_process"),
  commandLine: string,
  cwd: string,
  elevated: boolean
): void {
  const shellCmd = elevated ? `pkexec ${commandLine}` : commandLine;
  // Run the command, then drop into an interactive shell so the window stays open.
  const inner = `cd ${quoteArg(cwd)}; ${shellCmd}; exec ${process.env.SHELL ?? "bash"}`;
  const emulators: Array<[string, string[]]> = [
    ["x-terminal-emulator", ["-e", "bash", "-c", inner]],
    ["gnome-terminal", ["--", "bash", "-c", inner]],
    ["konsole", ["-e", "bash", "-c", inner]],
    ["xterm", ["-e", "bash", "-c", inner]],
  ];
  // spawn() reports a missing binary asynchronously (ENOENT on the 'error'
  // event), so a try/catch around it cannot pick the next emulator. Probe with
  // `which` (synchronous) and launch the first one that resolves.
  for (const [cmd, emuArgs] of emulators) {
    const probe = cp.spawnSync("which", [cmd]);
    if (probe.status === 0) {
      const child = cp.spawn(cmd, emuArgs, { cwd, detached: true, stdio: "ignore" });
      child.unref();
      return;
    }
  }
  throw new Error("No supported terminal emulator found");
}

async function runInBackground(
  commandLine: string,
  cwd: string,
  env: Record<string, string> | undefined,
  name: string,
  pinId: string,
  extractResult?: string,
  soundOverride?: SoundOverride,
  // Re-dispatch this same run. Used only by the port-unwedge kill+retry path so a
  // freed port can be retried in one click; absent for callers with no retry route.
  retry?: () => void,
  // Cross-process lock name held for this run's lifetime when the pin opts in.
  lockName?: string
): Promise<void> {
  const cp = await import("child_process");
  const channel = getOutputChannel();
  channel.appendLine(`$ (${name}) ${commandLine}`);
  channel.show(true);

  const startedAt = Date.now();
  const child = cp.spawn(commandLine, {
    cwd,
    shell: true,
    env: { ...process.env, ...(env ?? {}) },
  });
  // Track the child so the tree can show it running and a Stop action can kill
  // it; the registry clears itself on exit.
  processRegistry.register(pinId, child);
  // Hold the cross-process lock for this run's lifetime (opt-in). Keyed to the
  // child PID so release() only clears OUR record, and a crash leaves a stale
  // (dead-PID) record the next run steals rather than a permanent block.
  if (lockName && child.pid !== undefined) {
    runLock.acquire(lockName, child.pid, name);
  }
  // Accumulate the combined output so the last two runs can be diffed (WOW #20),
  // in addition to streaming it live to the channel.
  let captured = "";
  child.stdout?.on("data", (d) => {
    const text = d.toString();
    captured += text;
    channel.append(text);
  });
  child.stderr?.on("data", (d) => {
    const text = d.toString();
    captured += text;
    channel.append(text);
  });

  // Node may emit BOTH "error" (spawn failed) and "close" for the same failed
  // run; settle once so the result is recorded and the toast shown a single time.
  let settled = false;
  const settle = (outcome: "success" | "failure", code: number | null): void => {
    if (settled) {
      return;
    }
    settled = true;
    const durationMs = Date.now() - startedAt;
    const endedAt = Date.now();
    // Free the cross-process lock now this run has ended (release only clears our
    // own record, so a run that already stole the lock is unaffected).
    if (lockName && child.pid !== undefined) {
      runLock.release(lockName, child.pid);
    }
    runStatusRegistry.record(pinId, {
      outcome,
      exitCode: code,
      durationMs,
      endedAt,
    });
    // Audio finish cue (#64): distinct success/failure tone, honoring the pin's
    // override. Paired with the notifyCompletion toast below — the cue is the
    // additive channel, the toast stays the visible feedback.
    playCue(outcome, soundOverride);
    // Real tracked outcome for the chain engine — a pin chained "after" this one
    // (with onlyOnSuccess) runs only when this background run actually succeeded.
    pinEvents.fireComplete(pinId, outcome);
    // Keep this run's output for the "Diff Last Two Runs" command.
    runOutputs.record(pinId, { output: captured, endedAt, exitCode: code });
    // Badge the pin with any lint severity counts or test tally found in the output
    // (#26, #32) — so the lint sweep / test-trend ritual shows its result on the pin
    // itself, not only in the report. No-op when the output is neither.
    const badge = parseRunBadge(captured);
    if (badge) {
      pinBadges.record(pinId, badge);
    }
    // Pull a configured value (a deploy URL, a generated id) out of the output and
    // copy it to the clipboard. Runs on any completion — a URL printed before a
    // non-zero exit is still worth grabbing.
    if (extractResult) {
      extractAndCopy(extractResult, captured, name);
    }
    // A success is a quiet confirmation; a failure may carry an actionable cause —
    // a held port (WOW #1) or a tool-suggested fix command (WOW #12) — so the
    // failure path resolves those (async, for the port-holder lookup) before its
    // toast. Routed off settle so the run record above is written synchronously.
    if (outcome === "failure") {
      void notifyFailure(name, code, durationMs, captured, cwd, retry);
    } else {
      notifyCompletion(name, outcome, code, durationMs, undefined);
    }
  };

  // On exit, record the result so the tree shows a success/failure badge (7.2)
  // and surface the outcome: a failure is loud (error toast + one-click output),
  // a success is a quiet confirmation. Code 0 is success; any other code, or a
  // null code (killed by signal / stop), is a failure.
  child.on("close", (code) => {
    channel.appendLine(
      `\n[${name}] exited with code ${code} (${formatDuration(
        Date.now() - startedAt
      )})`
    );
    settle(code === 0 ? "success" : "failure", code);
  });

  // A spawn failure (command not found, cwd missing) may not emit "close"; record
  // it so the tree does not sit on a stale "running" forever.
  child.on("error", (err) => {
    channel.appendLine(`\n[${name}] failed to start: ${err.message}`);
    settle("failure", null);
  });
}

// Match a pin's extract pattern against its background output and copy the result
// to the clipboard with a toast (WOW #16). The first capture group is preferred (so
// `Live at: (https://\S+)` yields just the URL); with no group, the whole match is
// used. The pattern compiles with the "m" flag so `^`/`$` anchor to lines, the
// intuitive choice for pulling one line out of many. An invalid pattern or no match
// is logged to the channel and otherwise ignored — extraction is a convenience, never
// a reason to fail or nag.
function extractAndCopy(pattern: string, output: string, name: string): void {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "m");
  } catch {
    getOutputChannel().appendLine(
      l10n("extract.invalid", { name, pattern })
    );
    return;
  }
  const match = regex.exec(output);
  if (!match) {
    getOutputChannel().appendLine(l10n("extract.noMatch", { name, pattern }));
    return;
  }
  const value = match[1] ?? match[0];
  void vscode.env.clipboard.writeText(value);
  vscode.window.showInformationMessage(l10n("extract.copied", { name, value }));
}

// Resolve and surface a failed background run's actionable cause, then show the
// completion toast. A held port (WOW #1) takes precedence over a suggested fix
// command (WOW #12): freeing the port is the direct unblock, whereas a fix command
// is the fallback. The port-holder lookup is the only async step, which is why this
// path is async while the success path is not.
async function notifyFailure(
  name: string,
  code: number | null,
  durationMs: number,
  captured: string,
  cwd: string,
  retry?: () => void
): Promise<void> {
  const port = detectBlockedPort(captured);
  if (port !== undefined) {
    const holder = await findPortHolder(port);
    notifyPortBlocked(name, port, holder, cwd, retry);
    return;
  }
  const fix = detectFixCommand(captured);
  notifyCompletion(name, "failure", code, durationMs, fix ? { command: fix, cwd } : undefined);
}

// Toast for a run blocked by a held port. When the holder is known, offer the
// kill+retry action (gated behind a modal confirm in confirmKillAndRetry); when it
// could not be identified, name the port and offer to open a terminal pre-filled
// with the inspect command so the user can free it manually. Show Output is always
// available as the diagnostic fallback.
function notifyPortBlocked(
  name: string,
  port: number,
  holder: PortHolder | undefined,
  cwd: string,
  retry?: () => void
): void {
  const showOutput = l10n("run.showOutput");
  if (!holder) {
    const inspect = l10n("portUnwedge.inspectPort");
    void vscode.window
      .showErrorMessage(
        l10n("portUnwedge.blockedUnknown", { name, port }),
        inspect,
        showOutput
      )
      .then((choice) => {
        if (choice === inspect) {
          runInTerminal(inspectPortCommand(port), cwd, undefined);
        } else if (choice === showOutput) {
          getOutputChannel().show(true);
        }
      });
    return;
  }
  const processName = holder.name ?? l10n("portUnwedge.unknownProcess");
  const killAndRetry = l10n("portUnwedge.killAndRetry");
  void vscode.window
    .showErrorMessage(
      l10n("portUnwedge.blocked", { name, port, process: processName, pid: holder.pid }),
      killAndRetry,
      showOutput
    )
    .then((choice) => {
      if (choice === killAndRetry) {
        void confirmKillAndRetry(name, port, holder, processName, retry);
      } else if (choice === showOutput) {
        getOutputChannel().show(true);
      }
    });
}

// Modal confirm naming the exact PID + image before killing — never auto-kill. On
// a confirmed kill that frees the port, re-dispatch the run (when a retry route
// exists); a failed kill leaves everything as-is and says so.
async function confirmKillAndRetry(
  name: string,
  port: number,
  holder: PortHolder,
  processName: string,
  retry?: () => void
): Promise<void> {
  const confirm = l10n("portUnwedge.confirmKill");
  const choice = await vscode.window.showWarningMessage(
    l10n("portUnwedge.confirmBody", { process: processName, pid: holder.pid, port }),
    { modal: true },
    confirm
  );
  if (choice !== confirm) {
    return;
  }
  const killed = await killProcess(holder.pid);
  if (!killed) {
    vscode.window.showErrorMessage(
      l10n("portUnwedge.killFailed", { process: processName, pid: holder.pid, port })
    );
    return;
  }
  vscode.window.showInformationMessage(
    l10n("portUnwedge.killed", { process: processName, pid: holder.pid, port, name })
  );
  retry?.();
}

// The platform command that lists what holds a port, used to pre-fill the terminal
// when the holder could not be resolved automatically.
function inspectPortCommand(port: number): string {
  return process.platform === "win32"
    ? `netstat -ano | findstr :${port}`
    : `lsof -nP -iTCP:${port} -sTCP:LISTEN`;
}

// Visible outcome for a finished background run. Failures get an error toast with
// a one-click path to the output channel; successes get a quiet info toast. Never
// silent — completion is feedback the user is waiting on. When the failed output
// suggested a fix command, the toast also offers to run it (WOW #12).
function notifyCompletion(
  name: string,
  outcome: "success" | "failure",
  code: number | null,
  durationMs: number,
  fix?: { command: string; cwd: string }
): void {
  const duration = formatDuration(durationMs);
  if (outcome === "success") {
    vscode.window.showInformationMessage(l10n("run.succeeded", { name, duration }));
    return;
  }
  const showOutput = l10n("run.showOutput");
  // The fix action leads when present (it is the most useful next step), then the
  // always-available Show Output. The button text names the exact command so the
  // user runs it knowingly, not blindly.
  const runFix = fix ? l10n("run.runFix", { command: fix.command }) : undefined;
  const actions = runFix ? [runFix, showOutput] : [showOutput];
  void vscode.window
    .showErrorMessage(
      l10n("run.failed", { name, code: code === null ? "?" : code, duration }),
      ...actions
    )
    .then((choice) => {
      if (choice === showOutput) {
        getOutputChannel().show(true);
      } else if (fix && choice === runFix) {
        // Run the suggested fix in the shared integrated terminal so its output is
        // visible and interactive (a fix like `npm install` may prompt).
        runInTerminal(fix.command, fix.cwd, undefined);
      }
    });
}

// Known patterns: a fix command that a failed tool printed in its own output, so it
// can be offered as a one-click action instead of select/copy/paste (WOW #12). Order
// matters — the explicit "run X to fix" phrasing is the most reliable signal and is
// tried first; the package-manager install lines are the common concrete cases.
// Conservative on purpose: a missed suggestion just means no button (the user still
// has the output), whereas a wrong command offered for one click is worse.
const FIX_PATTERNS: readonly RegExp[] = [
  // "Run `npm install x` to fix", 'try running "yarn add y"', etc. — a quoted command
  // following a run/try/fix verb.
  /(?:run|try running|to fix,?\s*run)[:\s]+[`'"]([^`'"\n]+)[`'"]/i,
  // Bare package-manager install/add suggestions on their own.
  /\b((?:npm|pnpm) install(?:\s+--save(?:-dev)?)?\s+[@\w./-]+)/i,
  /\b(yarn add\s+[@\w./-]+)/i,
  /\b(pip3? install\s+[\w=<>.-]+)/i,
];

// Find the first fix command suggested in run output, trimmed, or undefined when
// none of the known patterns match.
function detectFixCommand(output: string): string | undefined {
  for (const pattern of FIX_PATTERNS) {
    const match = pattern.exec(output);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return undefined;
}
