// A temporary workspace folder on disk for tests that read real files through the stub: it is
// created and removed per test, and files are written by relative path.

import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { Uri, __setWorkspaceFolders } from "./_stub/vscode";
import type { WorkspaceFolder } from "vscode";

/** A temporary single-folder workspace. */
export interface FsFixture {
  /** The folder path, with forward slashes. */
  readonly dir: string;
  /** The workspace folder, typed as the real vscode type. */
  readonly folder: WorkspaceFolder;
  /** Writes `body` to `rel` under the folder, creating parent folders. */
  write(rel: string, body?: string): void;
  /** Deletes the folder and clears the workspace folders. */
  remove(): void;
}

/** Creates the folder (named with `prefix`) and makes it the only open workspace folder. */
export function createFsFixture(prefix: string): FsFixture {
  const dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), prefix)).replace(/\\/g, "/");
  const folder = { uri: Uri.file(dir), name: "proj", index: 0 } as unknown as WorkspaceFolder;
  __setWorkspaceFolders([folder as never]);
  return {
    dir,
    folder,
    write(rel: string, body = ""): void {
      const full = nodePath.join(dir, rel);
      nodeFs.mkdirSync(nodePath.dirname(full), { recursive: true });
      nodeFs.writeFileSync(full, body);
    },
    remove(): void {
      __setWorkspaceFolders(undefined);
      nodeFs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
