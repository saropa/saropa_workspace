import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// Release Board: which of a project's documents git ignores. One `git check-ignore` process
// per project folder, fed every path on stdin. A folder outside any repository, a machine
// without git, a timeout or any other failure answers "none ignored", so nothing is hidden.

const CHECK_TIMEOUT_MS = 10000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

// Paths are relative to `dir`, "/" separated. Returns the subset git reports as ignored.
export async function gitIgnoredPaths(dir: string, paths: readonly string[]): Promise<Set<string>> {
  // git refuses the whole batch when one path lies beyond a symbolic link, so those paths stay out of it.
  const checkable = await withoutLinkedParents(dir, paths);
  if (checkable.length === 0) {
    return new Set();
  }
  return runCheck(dir, checkable);
}

// Keeps the paths none of whose parent folders (below `dir`) is a symbolic link. Each folder is looked at once.
async function withoutLinkedParents(dir: string, paths: readonly string[]): Promise<string[]> {
  const linked = new Map<string, Promise<boolean>>();
  const isLink = (rel: string): Promise<boolean> => {
    let known = linked.get(rel);
    if (!known) {
      known = fs.promises.lstat(path.join(dir, rel)).then((st) => st.isSymbolicLink(), () => false);
      linked.set(rel, known);
    }
    return known;
  };
  const keep: string[] = [];
  for (const p of paths) {
    const parts = p.split("/").slice(0, -1);
    let ok = true;
    for (let i = 1; i <= parts.length && ok; i++) {
      ok = !(await isLink(parts.slice(0, i).join("/")));
    }
    if (ok) {
      keep.push(p);
    }
  }
  return keep;
}

function runCheck(dir: string, paths: readonly string[]): Promise<Set<string>> {
  return new Promise((resolve) => {
    try {
      const child = execFile(
        "git",
        ["check-ignore", "--stdin", "-z"],
        { cwd: dir, timeout: CHECK_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
        (err, stdout) => {
          // Any error (exit 1 is none ignored, 128 is not a repository, git missing, timeout) hides nothing.
          resolve(err ? new Set() : new Set(String(stdout).split("\0").filter((p) => p !== "")));
        }
      );
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(paths.join("\0") + "\0");
    } catch {
      resolve(new Set());
    }
  });
}
