import { execFile } from "node:child_process";

// Release Board: which of a project's documents git ignores. One `git check-ignore` process
// per project folder, fed every path on stdin. A folder outside any repository, a machine
// without git, a timeout or any other failure answers "none ignored", so nothing is hidden.

const CHECK_TIMEOUT_MS = 10000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

// Paths are relative to `dir`, "/" separated. Returns the subset git reports as ignored.
export function gitIgnoredPaths(dir: string, paths: readonly string[]): Promise<Set<string>> {
  if (paths.length === 0) {
    return Promise.resolve(new Set());
  }
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
