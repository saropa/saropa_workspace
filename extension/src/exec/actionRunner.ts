import * as vscode from "vscode";
import * as path from "path";
import { MacroStep, Pin, RoutineMember } from "../model/pin";
import { telemetry, RunSource } from "./telemetry";
import { runStatusRegistry, formatDuration } from "./runStatus";
import { playCue } from "./soundCue";
import { pinEvents } from "./pinEvents";
import { PinBadge, pinBadges, parseRunBadge } from "./pinBadges";
import { processRegistry } from "./processRegistry";
import * as runLock from "./runLock";
import { hasInteractiveTokens } from "./promptTokens";
import { l10n } from "../i18n/l10n";
import { getOutputChannel, runInTerminal } from "./terminalRunner";
import { runInBackground } from "./backgroundRunner";

// The non-file pin kinds (recipes): url / command / shell, plus the multi-step
// orchestrators (macro and routine). The file kind is handled by runPin in
// runner.ts; callers branch on pinKind and route non-file pins here. Split out of
// runner.ts so the file-run dispatcher stays small and these action handlers live
// with the report-capture + summary writing they share.

// Run a non-file pin (url / shell / command / macro). Returns without error for an
// unknown/empty action so a malformed recipe cannot throw.
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
      // single-pin-run logic lives in the store/command layer (which this module must
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
