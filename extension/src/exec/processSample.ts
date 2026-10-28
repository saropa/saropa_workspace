// OS process sampling for the process poll: the raw process row, the Windows and
// POSIX samplers and their output parsers. Split out of processPoll.ts.

import * as cp from "child_process";

// One process as the OS reports it in a single sample.
export interface RawProc {
  pid: number;
  ppid: number;
  // The executable base name as the OS reports it (e.g. "Code.exe", "dart").
  name: string;
  // Working-set / resident memory in bytes.
  rssBytes: number;
  // Cumulative CPU time consumed since the process started, in milliseconds. The
  // delta between two samples (divided by elapsed wall-time and core count) is the
  // live CPU percentage.
  cpuMs: number;
}

// Normalize an OS-reported executable name to the lowercased base used for
// matching: drop a trailing .exe and any directory part.
export function normalizeName(raw: string): string {
  const base = raw.replace(/\\/g, "/").split("/").pop() ?? raw;
  return base.replace(/\.exe$/i, "").toLowerCase();
}

// --- platform sampling --------------------------------------------------

export async function sampleOnce(): Promise<Map<number, RawProc>> {
  return process.platform === "win32" ? sampleWindows() : samplePosix();
}

// Windows: Win32_Process carries ProcessId, ParentProcessId, Name, WorkingSetSize
// (bytes), and Kernel/UserModeTime (cumulative CPU in 100-nanosecond ticks). Run
// via execFile with an argument array (no shell) so there is no quoting to get
// wrong. @(...) forces an array even when one row would otherwise serialize as a
// bare object.
function sampleWindows(): Promise<Map<number, RawProc>> {
  const script =
    "@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,KernelModeTime,UserModeTime) | ConvertTo-Json -Compress";
  return new Promise((resolve) => {
    cp.execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) {
          resolve(new Map());
          return;
        }
        resolve(parseWindows(stdout));
      }
    );
  });
}

interface WinRow {
  ProcessId?: number;
  ParentProcessId?: number;
  Name?: string;
  WorkingSetSize?: number;
  KernelModeTime?: number;
  UserModeTime?: number;
}

function parseWindows(stdout: string): Map<number, RawProc> {
  const out = new Map<number, RawProc>();
  let rows: WinRow[];
  try {
    const parsed = JSON.parse(stdout) as WinRow[] | WinRow;
    rows = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return out;
  }
  for (const row of rows) {
    const pid = row.ProcessId;
    if (typeof pid !== "number") {
      continue;
    }
    // 100-ns ticks -> ms. Kernel/UserModeTime are null for some system processes.
    const ticks = (row.KernelModeTime ?? 0) + (row.UserModeTime ?? 0);
    out.set(pid, {
      pid,
      ppid: row.ParentProcessId ?? 0,
      name: row.Name ?? "",
      rssBytes: row.WorkingSetSize ?? 0,
      cpuMs: ticks / 10_000,
    });
  }
  return out;
}

// macOS/Linux: ps with empty headers (the trailing = on each column) so the output
// is pure data. comm is last and may itself contain spaces, so it is captured as
// the remainder. rss is in KB; time is cumulative CPU as [[dd-]hh:]mm:ss.
function samplePosix(): Promise<Map<number, RawProc>> {
  return new Promise((resolve) => {
    cp.execFile(
      "ps",
      ["-axo", "pid=,ppid=,rss=,time=,comm="],
      { maxBuffer: 32 * 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout) {
          resolve(new Map());
          return;
        }
        resolve(parsePosix(stdout));
      }
    );
  });
}

function parsePosix(stdout: string): Map<number, RawProc> {
  const out = new Map<number, RawProc>();
  // The time column may carry fractional seconds on macOS ("59:01.91"), hence the dot.
  const line = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d:.-]+)\s+(.*\S)\s*$/;
  for (const raw of stdout.split("\n")) {
    const m = line.exec(raw);
    if (!m) {
      continue;
    }
    const pid = Number(m[1]);
    out.set(pid, {
      pid,
      ppid: Number(m[2]),
      name: m[5],
      rssBytes: Number(m[3]) * 1024,
      cpuMs: parsePosixCpuTime(m[4]),
    });
  }
  return out;
}

// Parse ps's cumulative CPU time "[[dd-]hh:]mm:ss" into milliseconds.
function parsePosixCpuTime(value: string): number {
  let days = 0;
  let rest = value;
  const dashIndex = rest.indexOf("-");
  if (dashIndex >= 0) {
    days = Number(rest.slice(0, dashIndex)) || 0;
    rest = rest.slice(dashIndex + 1);
  }
  const parts = rest.split(":").map((p) => Number(p) || 0);
  let seconds = days * 86_400;
  // The last part is always seconds; preceding parts are minutes then hours.
  for (let i = 0; i < parts.length; i++) {
    const factor = [1, 60, 3600][parts.length - 1 - i] ?? 0;
    seconds += parts[i] * factor;
  }
  return seconds * 1000;
}
