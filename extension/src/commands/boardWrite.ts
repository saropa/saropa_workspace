import { promises as fsp, constants as fsc } from "node:fs";
import * as nodePath from "node:path";
import * as vscode from "vscode";

// Release Board, the one way files are written: writes to the same path wait for each other (each
// writer re-reads after it gets its turn), and a file is replaced whole or not at all.

const queues = new Map<string, Promise<unknown>>();

// The queue a path belongs to: the real path of its folder, letter case ignored, so a link or a
// case-insensitive disk shares one queue.
async function keyOf(uri: vscode.Uri): Promise<string> {
  const dir = nodePath.dirname(uri.fsPath);
  const real = await fsp.realpath(dir).catch(() => dir);
  return nodePath.join(real, nodePath.basename(uri.fsPath)).toLowerCase();
}

// Runs `job` once every earlier job on the same path finished. A failing job never blocks the next.
export async function withWriteLock<T>(uri: vscode.Uri, job: () => Promise<T>): Promise<T> {
  const key = await keyOf(uri);
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
// The temporary name ends with the target's name.
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
  const name = uri.path.slice(uri.path.lastIndexOf("/") + 1);
  const tmp = vscode.Uri.joinPath(uri, "..", `.tmp-${process.pid}-${Date.now()}-${counter++}-${name}`);
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
