import { execFile } from "child_process";
import { promisify } from "util";

// Auto-unwedge a "port already in use" failure (WOW #1). When a background run
// fails because a zombie process from a crashed run still holds the port, this
// reads the port from the captured output, resolves the owning process
// cross-platform, and (after an explicit confirm in the runner) frees it so the
// shortcut can retry. Everything here is host-free (no `vscode` import) so the pure
// detection/parsing is unit-testable; the runner owns the toast + confirm UX.

const execFileAsync = promisify(execFile);

// External-command timeout. netstat/lsof/tasklist must answer fast or be ignored —
// a hung lookup must never block the completion toast.
const LOOKUP_TIMEOUT_MS = 4000;

// Grace between the graceful SIGTERM and the forced escalation, mirroring the
// processRegistry stop policy: give the process a chance to release the port
// cleanly before forcing it.
const KILL_GRACE_MS = 1500;

// The process found listening on a blocked port: its PID (always known once a
// holder is resolved) and, best-effort, the image/command name shown in the
// confirm prompt.
export interface PortHolder {
  pid: number;
  // The process image/command name (e.g. "node.exe", "node"). Undefined when the
  // PID was found but the name lookup failed; the caller supplies a generic label.
  name?: string;
}

// Lines that actually signal a port-in-use error. Detection is gated on one of
// these so an unrelated ":3000" elsewhere in the output cannot trigger a kill
// offer for the wrong port.
const IN_USE_MARKER = /EADDRINUSE|address already in use/i;

// Read the blocked port from a background run's captured output, or undefined when
// the output carries no port-in-use error naming a port. Only lines that match the
// in-use marker are considered, and the port must be a valid 1-65535 value — a
// Python "Address already in use" with no port simply yields undefined (no toast).
export function detectBlockedPort(output: string): number | undefined {
  if (!output) {
    return undefined;
  }
  for (const line of output.split(/\r?\n/)) {
    if (!IN_USE_MARKER.test(line)) {
      continue;
    }
    const port = extractPort(line);
    if (port !== undefined) {
      return port;
    }
  }
  return undefined;
}

// Pull the first valid port from a single error line. Handles the common host:port
// renderings — `:::3000`, `0.0.0.0:3000`, `127.0.0.1:3000`, `http://host:5000:`
// (dotnet), and a bare `port 3000`. The `\b` after the digits rejects an
// over-length run (`:123456` never yields 12345), and the range check rejects any
// match outside 1-65535.
function extractPort(line: string): number | undefined {
  for (const match of line.matchAll(/(?::|port\s+)(\d{1,5})\b/gi)) {
    const port = Number(match[1]);
    if (port >= 1 && port <= 65535) {
      return port;
    }
  }
  return undefined;
}

// Resolve the process listening on `port`, or undefined when it cannot be
// identified (lookup tool absent, no match, parse miss, or timeout). The port is
// validated as an integer before it reaches any command argument; combined with
// execFile (no shell), there is no interpolation surface to inject through.
export async function findPortHolder(port: number): Promise<PortHolder | undefined> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return undefined;
  }
  try {
    if (process.platform === "win32") {
      return await findHolderWindows(port);
    }
    return await findHolderUnix(port);
  } catch {
    // Any failure (tool missing, non-zero exit, timeout) degrades to "unknown
    // holder" rather than guessing a PID — the runner then offers a manual path.
    return undefined;
  }
}

async function findHolderWindows(port: number): Promise<PortHolder | undefined> {
  const { stdout } = await execFileAsync("netstat", ["-ano"], {
    timeout: LOOKUP_TIMEOUT_MS,
    windowsHide: true,
  });
  const pid = parseNetstatPid(stdout, port);
  if (pid === undefined) {
    return undefined;
  }
  return { pid, name: await windowsImageName(pid) };
}

async function findHolderUnix(port: number): Promise<PortHolder | undefined> {
  // -t prints PIDs only; -sTCP:LISTEN restricts to the listener (the holder), not a
  // transient client connection to the same port.
  const { stdout } = await execFileAsync(
    "lsof",
    ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
    { timeout: LOOKUP_TIMEOUT_MS }
  );
  const pid = parseLsofPid(stdout);
  if (pid === undefined) {
    return undefined;
  }
  return { pid, name: await unixProcessName(pid) };
}

// Parse `netstat -ano` for the PID of the TCP LISTENING socket on `port`. Columns:
// Proto  Local-Address  Foreign-Address  State  PID. Only TCP LISTENING rows are
// the holder; a matching foreign-address column on another row must not be read as
// the local port, so the local address (column 2) is the one tested.
export function parseNetstatPid(output: string, port: number): number | undefined {
  const suffix = `:${port}`;
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5 || parts[0] !== "TCP" || parts[3] !== "LISTENING") {
      continue;
    }
    if (!parts[1].endsWith(suffix)) {
      continue;
    }
    const pid = Number(parts[parts.length - 1]);
    if (Number.isInteger(pid) && pid > 0) {
      return pid;
    }
  }
  return undefined;
}

// Parse the image name out of `tasklist /FO CSV /NH` output: the first
// double-quoted CSV field of the first data row (e.g. `"node.exe",...`).
export function parseTasklistImage(csv: string): string | undefined {
  for (const line of csv.split(/\r?\n/)) {
    const match = line.match(/^"([^"]+)"/);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

// Parse the first PID from `lsof -t` output (one PID per line).
export function parseLsofPid(output: string): number | undefined {
  for (const line of output.split(/\r?\n/)) {
    const pid = Number(line.trim());
    if (Number.isInteger(pid) && pid > 0) {
      return pid;
    }
  }
  return undefined;
}

async function windowsImageName(pid: number): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "tasklist",
      ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
      { timeout: LOOKUP_TIMEOUT_MS, windowsHide: true }
    );
    return parseTasklistImage(stdout);
  } catch {
    return undefined;
  }
}

async function unixProcessName(pid: number): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "comm="], {
      timeout: LOOKUP_TIMEOUT_MS,
    });
    const name = stdout.trim();
    return name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

// True only for a PID safe to terminate. Refuses 0 and 1 (the OS/init), any
// non-positive or non-integer value, and the extension host's own PID — killing
// ourselves would take down VS Code's extension host with the user's other work.
export function isKillablePid(pid: number): boolean {
  return Number.isInteger(pid) && pid > 1 && pid !== process.pid;
}

// Terminate the process holding the port: graceful SIGTERM first, then escalate to
// a forced kill (taskkill /F on Windows, SIGKILL on posix) if it survives the
// grace window. Returns true only when the process is confirmed gone, so the runner
// never reports a freed port that is still held. Refuses an unsafe PID outright.
export async function killProcess(pid: number): Promise<boolean> {
  if (!isKillablePid(pid)) {
    return false;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Already gone, or no permission to signal it — let the verify-and-escalate
    // path below decide the outcome rather than failing here.
  }

  await delay(KILL_GRACE_MS);
  if (!isAlive(pid)) {
    return true;
  }

  try {
    if (process.platform === "win32") {
      await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        timeout: LOOKUP_TIMEOUT_MS,
        windowsHide: true,
      });
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {
    return false;
  }

  await delay(500);
  return !isAlive(pid);
}

// Whether a PID still exists. `kill(pid, 0)` sends no signal but throws when the
// process is gone (ESRCH); EPERM means it exists but is not ours, which still
// counts as alive.
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
