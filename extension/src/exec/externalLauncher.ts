import type { ChildProcess } from "child_process";
import * as vscode from "vscode";
import { quoteArg, buildWindowsStartup, encodeForPowerShell } from "./commandPlan";
import { getOutputChannel } from "./terminalRunner";
import { findOnPath } from "./interpreterDetect";
import { l10n } from "../i18n/l10n";

// The external-window run path: launch the command in a NEW OS terminal window
// outside VS Code (per-platform), optionally with administrator/elevated privileges.
// Fire-and-forget — VS Code does not own the process, so there is no Stop action or
// completion toast; the new window itself is the feedback. Split out of runner.ts
// because the platform branching is self-contained.

// Session-cached PowerShell binary: pwsh.exe (7+) when installed, else
// powershell.exe (5.1). Cached because interpreters do not appear or disappear
// within a window, and findOnPath touches the filesystem on every call.
// Resolved shell: { name } for Start-Process -FilePath, { path } for cp.spawn.
// Using the absolute path for spawn avoids a second PATH lookup by Node.
let windowsShellCache: { name: string; path: string } | undefined;
function windowsShell(): { name: string; path: string } {
  if (windowsShellCache === undefined) {
    // findOnPath iterates PATHEXT and may resolve to a .cmd shim (scoop,
    // chocolatey) rather than a real .exe. cp.spawn without shell:true cannot
    // launch a .cmd, so only accept .exe results.
    const pwsh = findExe("pwsh");
    const fallback = findExe("powershell") ?? "powershell.exe";
    windowsShellCache = pwsh
      ? { name: "pwsh.exe", path: pwsh }
      : { name: "powershell.exe", path: fallback };
  }
  return windowsShellCache;
}

function findExe(binary: string): string | undefined {
  const found = findOnPath(binary);
  return found?.toLowerCase().endsWith(".exe") ? found : undefined;
}

// Launch the command in a NEW OS terminal window, outside VS Code. The window
// stays open after the command exits so the user can read the output (the run is
// fire-and-forget: VS Code does not own the process, so there is no Stop action
// or completion toast — the window itself is the feedback). When `elevated`, the
// window is requested with administrator privileges (Windows UAC prompt). On
// Windows, elevation spawns a fresh elevated environment, so per-shortcut env vars do
// not propagate into an elevated window — surfaced to the user once below.
export async function runInExternal(
  commandLine: string,
  cwd: string,
  env: Record<string, string> | undefined,
  elevated: boolean,
  name: string
): Promise<void> {
  const cp = await import("child_process");
  const channel = getOutputChannel();
  const shellLabel = process.platform === "win32" ? `, ${windowsShell().name}` : "";
  channel.appendLine(
    `$ (${name}) [external${elevated ? ", elevated" : ""}${shellLabel}] ${commandLine}`
  );

  let child: ChildProcess;
  try {
    if (process.platform === "win32") {
      child = launchExternalWindows(cp, commandLine, cwd, env, elevated);
    } else if (process.platform === "darwin") {
      child = launchExternalMac(cp, commandLine, cwd, elevated);
    } else {
      child = launchExternalLinux(cp, commandLine, cwd, elevated);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    channel.appendLine(`\n[${name}] failed to launch external window: ${message}`);
    vscode.window.showErrorMessage(l10n("run.externalFailed", { name, error: message }));
    return;
  }

  // Async spawn failures (ENOENT, EACCES) fire here, not as a thrown exception.
  child.on("error", (err) => {
    channel.appendLine(`[${name}] external launcher spawn error: ${err.message}`);
    vscode.window.showErrorMessage(l10n("run.externalFailed", { name, error: err.message }));
    child.stderr?.destroy();
  });

  // On Windows the outer launcher's stderr is piped so a Start-Process failure
  // reports what went wrong rather than vanishing silently.
  if (child.stderr) {
    let stderr = "";
    const STDERR_CAP = 4096;
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < STDERR_CAP) {
        stderr = (stderr + chunk.toString()).slice(0, STDERR_CAP);
      }
    });
    child.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        const detail = stderr.trim().slice(0, STDERR_CAP) || `exit code ${code}`;
        channel.appendLine(`[${name}] external launcher failed: ${detail}`);
        vscode.window.showErrorMessage(l10n("run.externalFailed", { name, error: detail }));
      } else {
        // A clean wrapper exit only means Start-Process was asked to launch the
        // window, not that the window actually opened (Start-Process is
        // fire-and-forget and returns before the target finishes initializing) —
        // exactly the gap that let the Job Object failure go unnoticed. Worded to
        // reflect that: confirms the request succeeded, not the window's presence.
        channel.appendLine(`[${name}] external launcher: window requested successfully`);
      }
      child.stderr?.destroy();
    });
  }

  // Elevation drops per-shortcut env vars (the elevated process gets a fresh
  // environment); say so once so a missing var is not a silent surprise.
  if (elevated && env && Object.keys(env).length > 0) {
    vscode.window.showWarningMessage(l10n("run.elevatedEnvDropped", { name }));
  }
  const showToasts = vscode.workspace
    .getConfiguration("saropaWorkspace")
    .get<boolean>("showRunToasts", true);
  if (showToasts) {
    vscode.window.showInformationMessage(
      l10n(elevated ? "run.externalElevatedStarted" : "run.externalStarted", { name })
    );
  }
}

// Windows: open a new PowerShell console window via Start-Process, running a
// startup script that cd's to the target, seeds the run command into an isolated
// per-window history file, then runs it. `-NoExit` keeps the window open after the
// command finishes so the user can read the output AND press up-arrow to re-run it.
// Prefers pwsh.exe (PowerShell 7+) when installed; falls back to powershell.exe
// (Windows PowerShell 5.1) otherwise.
//
// Why PowerShell and not cmd.exe: cmd cannot give the launched window any history.
// A command handed to `cmd /k "cd … & script"` executes but never enters doskey
// history (verified: `doskey /history` is empty right after), and cmd has no
// command to inject history — so up-arrow in a fresh cmd window recalls nothing.
// PSReadLine loads its history from HistorySavePath at the first interactive
// prompt, so setting that path (below) to a file we pre-populate makes the run
// command recallable with up-arrow. This is the rerun-in-the-same-window behavior
// the user asked for; cmd structurally cannot provide it.
//
// The startup script is passed as a UTF-16LE base64 blob via -EncodedCommand to
// avoid a stack of nested quoting (Node argv -> outer PowerShell -Command ->
// Start-Process -ArgumentList -> inner PowerShell), which a raw string could not
// survive intact. `-Verb RunAs` triggers the UAC elevation prompt.
function launchExternalWindows(
  cp: typeof import("child_process"),
  commandLine: string,
  cwd: string,
  env: Record<string, string> | undefined,
  elevated: boolean
): ChildProcess {
  const shell = windowsShell();
  const encoded = encodeForPowerShell(buildWindowsStartup(commandLine, cwd));
  const startArgs = [
    "-FilePath",
    `'${shell.name}'`,
    "-ArgumentList",
    // Each element is a literal token; the base64 payload is [A-Za-z0-9+/=] only,
    // so single-quoting the array needs no escaping.
    `'-NoExit','-NoProfile','-EncodedCommand','${encoded}'`,
  ];
  if (elevated) {
    startArgs.push("-Verb", "RunAs");
  }
  const psCommand = `Start-Process ${startArgs.join(" ")}`;
  const child = cp.spawn(
    shell.path,
    // No -NonInteractive: it silently suppresses the UAC consent that
    // `Start-Process -Verb RunAs` triggers, so the elevated window never launches
    // (no prompt, no window, launcher still exits 0). The launcher only invokes a
    // fire-and-forget Start-Process and never reads input, so it has no use for
    // -NonInteractive anyway. Verified: with the flag the elevated process never
    // runs; without it, UAC fires and the window opens.
    ["-NoProfile", "-Command", psCommand],
    {
      // NEVER detach this wrapper. VS Code's Electron host runs its child processes
      // inside a Windows Job Object (for orphan cleanup on exit); DETACHED_PROCESS /
      // CREATE_BREAKAWAY_FROM_JOB is denied by a job that doesn't grant
      // JOB_OBJECT_LIMIT_BREAKAWAY_OK. The wrapper's own CreateProcess still
      // succeeds (real PID, exit code 0, empty stderr) but the Start-Process it
      // runs internally fails to allocate a console for the target window, so the
      // window silently never appears — the exact "only the toast shows" report.
      // Verified: detached:true creates zero visible process; detached:false (or
      // omitted) reliably opens the window, in the same job-constrained host.
      // This also fixed the earlier elevated-UAC case (see below) for the same
      // underlying reason, not a UAC-specific one.
      detached: false,
      // The wrapper is not the user-visible window (Start-Process's target is) —
      // hide the wrapper's own console so only the real window is seen. This only
      // hides THIS process's own console; it should have no effect on the UAC
      // consent dialog or the elevated target window for -Verb RunAs, both raised
      // by the AppInfo service on the Secure Desktop independent of the calling
      // process's window state — but that reasoning is unverified against a real
      // UAC prompt. The elevated case's window/UAC behavior was already verified
      // working (see the -NonInteractive comment above) before windowsHide existed,
      // so scope this to the non-elevated wrapper only: no reason to add an
      // untested variable to a path that already worked.
      windowsHide: !elevated,
      // Pipe stderr so Start-Process failures surface to the caller instead of
      // vanishing in the wrapper's hidden console.
      stdio: ["ignore", "ignore", "pipe"],
      // Non-elevated windows inherit env from this launcher; elevated windows get
      // a fresh environment from ShellExecute, so this env is unused there.
      env: { ...process.env, ...(env ?? {}) },
    }
  );
  child.unref();
  return child;
}

// macOS: drive Terminal.app via AppleScript. Elevation wraps the command in a
// `sudo` invocation (Terminal prompts for the password in the new window); there
// is no UAC equivalent, so this is the closest "administrator" behavior.
//
// Unlike Windows, `detached: true` here spawns the process the user actually sees
// (osascript driving Terminal.app), not an intermediate wrapper that hands off to
// a separate target — so the exact "wrapper succeeds, inner launch silently fails"
// failure mode diagnosed on Windows does not structurally apply. Left unverified
// and unchanged: no macOS host was available to confirm whether Electron's Job
// Object equivalent on this platform (if any) causes a different, narrower issue.
function launchExternalMac(
  cp: typeof import("child_process"),
  commandLine: string,
  cwd: string,
  elevated: boolean
): ChildProcess {
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
  return child;
}

// Linux: open a terminal emulator and hold it open with an interactive shell.
// Elevation prefixes pkexec (graphical auth) when present, else sudo. Tries a few
// common emulators; the first that launches wins.
function launchExternalLinux(
  cp: typeof import("child_process"),
  commandLine: string,
  cwd: string,
  elevated: boolean
): ChildProcess {
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
      return child;
    }
  }
  throw new Error("No supported terminal emulator found");
}
