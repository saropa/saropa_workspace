import { execFile } from "child_process";
import { promisify } from "util";
import { findOnPath } from "./interpreterDetect";

// Is adb installed, and is anything attached to it? The discovery half of
// MOBILE_REMOTE_CONTROL_PLAN section 5 ("adb not found" state + a lightweight connection
// health check), kept host-free (no `vscode` import) so the parsing and the decisions it
// feeds are unit-testable and the panel layer stays glue.
//
// The availability probe is deliberately the SAME mechanism the script library's
// `requires: [{type:"command", name:"adb"}]` pre-flight already uses — findOnPath() from
// interpreterDetect.ts, honoring PATH + PATHEXT — rather than a second PATH-probing
// scheme that could disagree with it. A user who installs platform-tools between two
// panel opens is unblocked by the next probe, since nothing here is cached.
//
// The connection check is one `adb devices` call, parsed. Not a diagnostic suite: the
// plan's fuller health check (wireless-debugging state, pairing status, actionable fixes)
// is later scope. The point of this much is that the panel reflects reality — "no device
// connected" rather than a row that looks ready and then fails in a terminal.

const execFileAsync = promisify(execFile);

// adb must answer fast or be treated as absent. A wedged adb server (the classic
// "daemon not running; starting it now" that never finishes) must never hold the panel's
// first paint, so the probe times out and reports the failure as a state.
const PROBE_TIMEOUT_MS = 4000;

/**
 * One line of `adb devices`. `ready` is the only state a command can actually run
 * against; the other two are the states a user needs told about, because both look like
 * "plugged in" from the outside.
 */
export type AdbDeviceState = "ready" | "unauthorized" | "offline";

export interface AdbDevice {
  serial: string;
  state: AdbDeviceState;
}

/** What the panel header says, counted rather than listed. */
export interface AdbDeviceSummary {
  total: number;
  ready: number;
  unauthorized: number;
  offline: number;
  // The single attached device's serial, when there is exactly one. Used as the header
  // chip's detail; absent for zero or many, where a serial would mislead.
  serial?: string;
}

/** The whole probe result: is the tool there, and what is attached to it. */
export interface AdbEnvironment {
  // adb resolved on PATH.
  available: boolean;
  // The resolved absolute path, when found — shown as the chip's hover so "which adb?"
  // is answerable without leaving the panel.
  path?: string;
  // The device summary, when `adb devices` ran and was parsed. Absent when adb is
  // missing, or when the call failed/timed out (see `failed`).
  devices?: AdbDeviceSummary;
  // True when adb exists but the device query did not produce output we could read.
  failed: boolean;
}

/** The environment reported before any probe has run, and when adb is not installed. */
export function adbMissing(): AdbEnvironment {
  return { available: false, failed: false };
}

/**
 * Parse `adb devices` output into one entry per attached device.
 *
 * The output is a header line ("List of devices attached") followed by
 * `<serial>\t<state>` rows, with daemon chatter ("* daemon not running; starting now *")
 * possible above it. Anything that is not a two-column row is skipped, so a noisy start
 * never invents a device. Unknown states (`bootloader`, `recovery`, `sideload`,
 * `authorizing`) are folded into `offline`: they are all "attached but not runnable",
 * which is the only distinction the panel draws.
 */
export function parseAdbDevices(stdout: string): AdbDevice[] {
  const devices: AdbDevice[] = [];
  for (const raw of (stdout ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("*") || /^List of devices/i.test(line)) {
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts.length < 2) {
      continue;
    }
    const [serial, state] = parts as [string, string];
    devices.push({ serial, state: normalizeState(state) });
  }
  return devices;
}

function normalizeState(state: string): AdbDeviceState {
  const value = state.toLowerCase();
  if (value === "device") {
    return "ready";
  }
  if (value === "unauthorized") {
    return "unauthorized";
  }
  return "offline";
}

/** Count the parsed devices by state, naming the serial only when there is exactly one. */
export function summarizeAdbDevices(devices: AdbDevice[]): AdbDeviceSummary {
  const ready = devices.filter((d) => d.state === "ready");
  const summary: AdbDeviceSummary = {
    total: devices.length,
    ready: ready.length,
    unauthorized: devices.filter((d) => d.state === "unauthorized").length,
    offline: devices.filter((d) => d.state === "offline").length,
  };
  if (devices.length === 1) {
    return { ...summary, serial: (devices[0] as AdbDevice).serial };
  }
  return summary;
}

/** True when at least one attached device is in the only state a command can run against. */
export function hasReadyDevice(env: AdbEnvironment): boolean {
  return (env.devices?.ready ?? 0) > 0;
}

// Every probe result is broadcast to these listeners. The point is that there is
// exactly ONE place the host learns "what is attached right now" — the panel already
// re-probes on its ready handshake, after every run and on its Refresh button, so a
// consumer that needs the same answer (the saropaWorkspace.hasDevice context key)
// subscribes here instead of starting a second poll loop of its own. Plain callbacks,
// not a vscode.EventEmitter, because this module stays host-free.
type AdbProbeListener = (env: AdbEnvironment) => void;
const probeListeners = new Set<AdbProbeListener>();

/**
 * Be told the result of every probeAdbEnvironment() call, whoever made it. Returns a
 * disposable-shaped handle so a VS Code caller can push it straight onto
 * context.subscriptions.
 */
export function onAdbEnvironmentProbe(listener: AdbProbeListener): {
  dispose: () => void;
} {
  probeListeners.add(listener);
  return { dispose: () => void probeListeners.delete(listener) };
}

// A listener is UI bookkeeping; one throwing must never turn a successful probe into
// a failed one for the caller that asked for it.
function notifyProbe(env: AdbEnvironment): AdbEnvironment {
  for (const listener of probeListeners) {
    try {
      listener(env);
    } catch (err) {
      console.error("[saropa] adb probe listener failed:", err);
    }
  }
  return env;
}

/** The resolved adb executable, or undefined when it is not on PATH. */
export function findAdb(): string | undefined {
  return findOnPath("adb");
}

/**
 * Probe the host: is adb installed, and what is attached. Never throws — every failure
 * mode (missing binary, non-zero exit, timeout) becomes a reported state, because the
 * panel's whole job here is to say what is wrong instead of failing at run time.
 */
export async function probeAdbEnvironment(): Promise<AdbEnvironment> {
  const path = findAdb();
  if (!path) {
    return notifyProbe(adbMissing());
  }
  try {
    const { stdout } = await execFileAsync(path, ["devices"], {
      timeout: PROBE_TIMEOUT_MS,
    });
    return notifyProbe({
      available: true,
      path,
      devices: summarizeAdbDevices(parseAdbDevices(stdout)),
      failed: false,
    });
  } catch {
    return notifyProbe({ available: true, path, failed: true });
  }
}
