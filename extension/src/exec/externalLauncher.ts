import * as vscode from "vscode";
import { quoteArg } from "./commandPlan";
import { getOutputChannel } from "./terminalRunner";
import { l10n } from "../i18n/l10n";

// The external-window run path: launch the command in a NEW OS terminal window
// outside VS Code (per-platform), optionally with administrator/elevated privileges.
// Fire-and-forget — VS Code does not own the process, so there is no Stop action or
// completion toast; the new window itself is the feedback. Split out of runner.ts
// because the platform branching is self-contained.

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

  // Elevation drops per-shortcut env vars (the elevated process gets a fresh
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
    {
      // detached:true (DETACHED_PROCESS on Windows) strips the inherited window
      // station from the launching PowerShell. ShellExecute's "runas" verb
      // (-Verb RunAs) then has no desktop on which the AppInfo service can raise
      // the UAC consent, so elevation is dropped SILENTLY — no prompt, no window,
      // PowerShell still exits 0. Verified: detached + RunAs shows nothing;
      // non-detached + RunAs shows the UAC prompt and the window. So only the
      // non-elevated launch detaches (to outlive this launcher). The elevated
      // PowerShell needs no detach: it exits on its own once Start-Process hands
      // off to the independent elevated window, which survives regardless.
      detached: !elevated,
      stdio: "ignore",
      // Non-elevated windows inherit env from this launcher; elevated windows get
      // a fresh environment from ShellExecute, so this env is unused there.
      env: { ...process.env, ...(env ?? {}) },
    }
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
