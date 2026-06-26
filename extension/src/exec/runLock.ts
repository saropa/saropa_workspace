import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// A cross-process run lock backed by a small JSON file in the OS temp dir, so a
// single-instance shortcut is barred from overlapping even across VS Code windows, an
// external terminal, cron, or any script that honors the same convention. The
// in-process processRegistry guard only sees runs in THIS extension host; this is
// the shared-disk primitive that extends the barrier beyond it.
//
// A lock is identified by NAME (a shortcut's lockName, which several shortcuts or an
// external script may share to serialize one resource, e.g. a single GPU). The file
// records the holder PID, host, and start time. A lock counts as HELD only while its holder
// is still alive on this host; a holder whose PID is gone is stale and the next run
// steals it, so a crash never wedges the lock forever.

export interface LockRecord {
  pid: number;
  host: string;
  startedAt: number;
  // Human label of the run holding the lock (the shortcut name), for diagnostics.
  label?: string;
}

// Machine-global so a workspace shortcut and an unrelated launcher (a terminal, cron,
// a self-locking script in another project) agree on the same path by name alone.
const LOCK_DIR = path.join(os.tmpdir(), "saropa-workspace-locks");

// Filesystem-safe file for a lock name: the name is user-chosen, so collapse any
// run of characters outside [A-Za-z0-9._-] to a single '-' to keep it one valid
// filename, and never let it reduce to empty.
function lockFile(name: string): string {
  const safe =
    name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "lock";
  return path.join(LOCK_DIR, `${safe}.lock`);
}

// Whether a PID is alive on THIS host. process.kill(pid, 0) sends no signal but
// performs the existence/permission check: it returns for a live process, throws
// ESRCH when the process is gone, and throws EPERM when it is alive but owned by
// another user (still alive, so treat as alive). Meaningful only for a same-host
// holder.
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

// Pure staleness decision, separated from IO so it is unit-testable: a record is
// stale (free to steal) when it is from THIS host and its holder PID is no longer
// alive. A record from another host cannot be liveness-checked here, so it is
// treated as held (never stolen) — a shared-FS lock from another machine is left to
// that machine to release. `alive` is injected so the rule can be tested without
// spawning real processes.
export function isLockStale(
  record: LockRecord,
  ourHost: string,
  alive: (pid: number) => boolean
): boolean {
  if (record.host !== ourHost) {
    return false;
  }
  return !alive(record.pid);
}

function readRecord(name: string): LockRecord | undefined {
  try {
    const raw = fs.readFileSync(lockFile(name), "utf8");
    const parsed = JSON.parse(raw) as Partial<LockRecord>;
    if (typeof parsed.pid !== "number" || typeof parsed.host !== "string") {
      return undefined;
    }
    return {
      pid: parsed.pid,
      host: parsed.host,
      startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : 0,
      label: typeof parsed.label === "string" ? parsed.label : undefined,
    };
  } catch {
    // Absent or unparseable file: no live holder.
    return undefined;
  }
}

// The current LIVE holder of a lock, or undefined when the lock is free (no file,
// or a stale record whose holder has exited). A stale file is left in place; the
// next acquire() overwrites it.
export function holderOf(name: string): LockRecord | undefined {
  const record = readRecord(name);
  if (!record) {
    return undefined;
  }
  return isLockStale(record, os.hostname(), isPidAlive) ? undefined : record;
}

export function isHeld(name: string): boolean {
  return holderOf(name) !== undefined;
}

// Take the lock for `pid`, overwriting any stale record. Best-effort: a failure to
// write (e.g. an unwritable temp dir) is swallowed so locking can never break a run
// — the in-process guard still applies. Call only after isHeld() returned false.
export function acquire(name: string, pid: number, label?: string): void {
  const record: LockRecord = {
    pid,
    host: os.hostname(),
    startedAt: Date.now(),
    label,
  };
  try {
    fs.mkdirSync(LOCK_DIR, { recursive: true });
    fs.writeFileSync(lockFile(name), JSON.stringify(record), "utf8");
  } catch {
    // Ignore — see above.
  }
}

// Release the lock IFF we still hold it (the file's pid matches `pid`), so a run
// never deletes a lock another run has since stolen. Best-effort; a missing file is
// fine.
export function release(name: string, pid: number): void {
  const record = readRecord(name);
  if (record && record.pid !== pid) {
    return;
  }
  try {
    fs.rmSync(lockFile(name), { force: true });
  } catch {
    // Ignore.
  }
}
