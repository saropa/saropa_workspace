import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { MacroStep, Pin, PinExecConfig, RunLocation, SoundOverride } from "../model/pin";
import { processRegistry } from "./processRegistry";
import { runStatusRegistry, formatDuration } from "./runStatus";
import { runOutputs } from "./runOutputs";
import { telemetry, RunSource } from "./telemetry";
import { buildTokenMap, expandTokens } from "./tokens";
import {
  hasInteractiveTokens,
  resolveInteractiveTokens,
  cloneWithResolvedTokens,
} from "./promptTokens";
import { playCue } from "./soundCue";
import { pinEvents } from "./pinEvents";
import { pinBadges, parseRunBadge } from "./pinBadges";
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

// Resolve the command prefix for a file: explicit per-pin command wins, else the
// configured default for the file extension, else a `#!` shebang when present.
// Empty result means "run directly".
function resolveCommandPrefix(pin: Pin, fsPath: string): string {
  if (pin.exec?.command !== undefined) {
    return pin.exec.command;
  }
  const ext = path.extname(fsPath).toLowerCase();
  const defaults = vscode.workspace
    .getConfiguration("saropaWorkspace")
    .get<Record<string, string>>("interpreterDefaults", {});
  const byExtension = defaults[ext];
  if (byExtension !== undefined) {
    return byExtension;
  }
  // No explicit prefix and no extension default: honor a shebang so a *nix script
  // runs through its declared interpreter rather than only being flung directly at
  // the shell (which needs the executable bit). Absent shebang keeps "run directly".
  return shebangInterpreter(fsPath) ?? "";
}

// Whether running this pin makes sense, i.e. there is a way to execute it. True
// when the user set an explicit command (including an explicit empty string,
// which means "run the file directly" — e.g. a shebang script), or the file's
// extension has a configured default interpreter. False for an ordinary document
// (a .txt, .md, image, etc.) with no interpreter, where "run" has no meaning and
// the caller should open the file instead of throwing it at the shell.
export function isRunnable(pin: Pin, fsPath: string): boolean {
  if (pin.exec?.command !== undefined) {
    return true;
  }
  const ext = path.extname(fsPath).toLowerCase();
  const defaults = vscode.workspace
    .getConfiguration("saropaWorkspace")
    .get<Record<string, string>>("interpreterDefaults", {});
  if (defaults[ext] !== undefined) {
    return true;
  }
  // An extensionless script carrying a `#!` shebang is runnable through the
  // interpreter it names, even with no extension-default mapping.
  return shebangInterpreter(fsPath) !== undefined;
}

// Quote a path/arg for the shell. Simple double-quote wrapping covers the common
// case (paths with spaces) without a full shell-escaping dependency.
function quote(value: string): string {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
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

  // Assemble: <prefix> "<file>" <args...>. A blank prefix runs the file directly.
  // includeFilePath === false omits the file entirely (npm-script / Make-target
  // run configs name their work in args and run against cwd, not the file path).
  const includeFile = pin.exec?.includeFilePath !== false;
  const parts = [
    prefix,
    ...(includeFile ? [quote(fsPath)] : []),
    ...args.map(quote),
  ].filter((p) => p.length > 0);
  const commandLine = parts.join(" ");

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
        effectivePin.exec?.sound
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
      await runShellAction(action, name, pin.id);
      return;
    case "macro":
      await runMacro(action.steps ?? [], name);
      pinEvents.fireComplete(pin.id, "dispatched");
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
  pinId: string
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
      pinId
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
    await runInBackground(commandLine, cwd, undefined, name, pinId);
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
  pinId: string
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
  child.stdout?.on("data", (d) => (body += d.toString()));
  child.stderr?.on("data", (d) => (body += d.toString()));

  await new Promise<void>((resolve) => {
    const finish = async (code: number | null): Promise<void> => {
      const durationMs = Date.now() - startedAt;
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
  sharedTerminal.sendText(`cd ${quote(cwd)}`);
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
  const inner = `/k cd /d ${quote(cwd)} & ${commandLine}`;
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
  const inner = `cd ${quote(cwd)}; ${shellCmd}`;
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
  const inner = `cd ${quote(cwd)}; ${shellCmd}; exec ${process.env.SHELL ?? "bash"}`;
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
  soundOverride?: SoundOverride
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
    // On failure, scan the output for a fix command the tool itself suggested
    // (e.g. "Run `npm install lodash` to fix") and offer to run it in one click,
    // so the user does not have to select/copy/paste it (WOW #12).
    const fix =
      outcome === "failure" ? detectFixCommand(captured) : undefined;
    notifyCompletion(
      name,
      outcome,
      code,
      durationMs,
      fix ? { command: fix, cwd } : undefined
    );
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
