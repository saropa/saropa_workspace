import { promises as fsp, constants as fsc } from "node:fs";
import * as nodePath from "node:path";
import * as vscode from "vscode";
import { HANDOFF_DIR } from "../board/handoff";

// Release Board, the one way files are written: writes to the same path wait for each other (each
// writer re-reads after it gets its turn), and a file is replaced whole or not at all.

const queues = new Map<string, Promise<unknown>>();

// The real path of a folder; when it does not exist yet, the real path of its nearest existing
// parent with the missing part appended, so the first save that creates a folder gets the same key
// as the saves after it.
async function realFolder(dir: string): Promise<string> {
  try {
    return await fsp.realpath(dir);
  } catch {
    const parent = nodePath.dirname(dir);
    if (parent === dir) {
      return dir;
    }
    return nodePath.join(await realFolder(parent), nodePath.basename(dir));
  }
}

// The queue a path belongs to: the real path of its folder, letter case and Unicode form ignored, so a
// link or a case-insensitive disk shares one queue.
async function keyOf(uri: vscode.Uri): Promise<string> {
  const real = await realFolder(nodePath.dirname(uri.fsPath));
  return nodePath.join(real, nodePath.basename(uri.fsPath)).normalize("NFC").toLowerCase();
}

// Keys are worked out one call at a time, in the order the calls came in, so the queue order is first-come.
let keyGate: Promise<unknown> = Promise.resolve();

// Runs `job` once every earlier job on the same path finished. A failing job never blocks the next.
export async function withWriteLock<T>(uri: vscode.Uri, job: () => Promise<T>): Promise<T> {
  const slot = keyGate.then(() => keyOf(uri));
  keyGate = slot.catch(() => undefined);
  const key = await slot;
  const prev = queues.get(key) ?? Promise.resolve();
  const run = prev.then(job, job);
  const tail = run.catch(() => undefined);
  queues.set(key, tail);
  try {
    return await run;
  } finally {
    if (queues.get(key) === tail) {
      queues.delete(key);
    }
  }
}

let counter = 0;

// Writes the bytes to a temporary file in the same folder, then renames it over the target, keeping the
// target's file mode. The temporary file is removed when anything fails, so the original is never half written.
// The temporary name is "<name>.<pid>-<n>.tmp": it ends in neither .md nor .sql, so the scan never reads it,
// and a temporary file left by a crash is swept once it is ten minutes old.
export async function writeFileSafe(uri: vscode.Uri, bytes: Uint8Array): Promise<void> {
  const local = uri.scheme === "file";
  if (local) {
    try {
      await fsp.access(nodePath.dirname(uri.fsPath), fsc.W_OK);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== "ENOENT") {
        throw new Error("EACCES: the folder is not writable");
      }
    }
  }
  if (local) {
    // Renaming over a file would replace a read-only one that an in-place write refuses.
    let exists = true;
    try {
      await fsp.stat(uri.fsPath);
    } catch {
      exists = false;
    }
    if (exists) {
      try {
        await fsp.access(uri.fsPath, fsc.W_OK);
      } catch {
        throw new Error("EACCES: the file is read-only");
      }
    }
    await sweepStaleTemps(vscode.Uri.joinPath(uri, ".."));
  }
  const name = uri.path.slice(uri.path.lastIndexOf("/") + 1);
  const tmp = vscode.Uri.joinPath(uri, "..", `${name}.${process.pid}-${counter++}.tmp`);
  try {
    await vscode.workspace.fs.writeFile(tmp, bytes);
    if (local) {
      try {
        await fsp.chmod(tmp.fsPath, (await fsp.stat(uri.fsPath)).mode & 0o7777);
      } catch {
        // No target yet (or no way to read its mode): the default mode stays.
      }
    }
    await vscode.workspace.fs.rename(tmp, uri, { overwrite: true });
  } catch (e) {
    await Promise.resolve(vscode.workspace.fs.delete(tmp)).catch(() => undefined);
    throw e;
  }
}

const TEMP_NAME = /\.\d+-\d+\.tmp$/;
const STALE_MS = 10 * 60 * 1000;

// Removes temporary files left in a folder by a write that never finished (older than ten minutes).
// Never throws: a folder that cannot be read has nothing to sweep.
export async function sweepStaleTemps(dir: vscode.Uri): Promise<void> {
  if (dir.scheme !== "file") {
    return;
  }
  try {
    for (const name of await fsp.readdir(dir.fsPath)) {
      if (!TEMP_NAME.test(name)) {
        continue;
      }
      const file = nodePath.join(dir.fsPath, name);
      try {
        const st = await fsp.lstat(file);
        if (st.isFile() && Date.now() - st.mtimeMs > STALE_MS) {
          await fsp.unlink(file);
        }
      } catch {
        // Gone already, or not ours to remove.
      }
    }
  } catch {
    // No such folder.
  }
}

// At start: sweeps the rules folder and the hand-off folder of every workspace folder.
export async function sweepBoardTemps(): Promise<void> {
  for (const f of vscode.workspace.workspaceFolders ?? []) {
    await sweepStaleTemps(vscode.Uri.joinPath(f.uri, ".saropa"));
    await sweepStaleTemps(vscode.Uri.joinPath(f.uri, HANDOFF_DIR));
  }
}
