import * as vscode from "vscode";
import { FileSource } from "../board/scanner";
import { mapLimit } from "../board/pool";
import { ScanFile } from "../board/types";

// Release Board, file access for the scan. The board core has no VS Code imports, so this
// file hands it a FileSource over workspace.fs (which makes remote workspaces work) and a
// small existence check the host files share.

// How many files are stat-ed at once, and how many folders are walked at once.
const STAT_PARALLEL = 32;
const DIR_PARALLEL = 8;

// True when the path can be stat-ed.
export async function pathExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

// FileSource over workspace.fs. Walks a root recursively; a missing root throws and the
// scanner treats it as empty.
export function workspaceFileSource(): FileSource {
  return {
    async list(projectDir: string, root: string, accept?: (path: string) => boolean, noLinks = false): Promise<ScanFile[]> {
      const base = vscode.Uri.parse(projectDir);
      // Folders are walked in parallel and only wanted files are stat-ed, in parallel:
      // each call is a round trip, and on a remote workspace they dominate the scan.
      const walk = async (rel: string): Promise<ScanFile[]> => {
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(base, rel));
        const dirs: string[] = [];
        const files: string[] = [];
        for (const [name, type] of entries) {
          // In a chosen project a link is never followed: it could loop, or lead out of the folder.
          if (noLinks && type & vscode.FileType.SymbolicLink) {
            continue;
          }
          const childRel = rel + "/" + name;
          if (type & vscode.FileType.Directory) {
            dirs.push(childRel);
          } else if (type & vscode.FileType.File && !name.endsWith(".tmp") && (!accept || accept(childRel))) {
            files.push(childRel);
          }
        }
        const [stats, nested] = await Promise.all([
          mapLimit(files, STAT_PARALLEL, async (childRel): Promise<ScanFile | undefined> => {
            try {
              const st = await vscode.workspace.fs.stat(vscode.Uri.joinPath(base, childRel));
              return { path: childRel, size: st.size, mtimeMs: st.mtime };
            } catch {
              // The file vanished between the listing and the stat (a save replaced it): leave it out.
              return undefined;
            }
          }).then((list) => list.filter((f): f is ScanFile => f !== undefined)),
          mapLimit(dirs, DIR_PARALLEL, walk),
        ]);
        return [...stats, ...nested.flat()];
      };
      return walk(root);
    },
    async readHead(projectDir: string, p: string, lines: number): Promise<string> {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(vscode.Uri.parse(projectDir), p));
      return Buffer.from(bytes).toString("utf8").split(/\r?\n/).slice(0, lines).join("\n");
    },
    async readText(projectDir: string, p: string): Promise<string> {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(vscode.Uri.parse(projectDir), p));
      return Buffer.from(bytes).toString("utf8");
    },
  };
}
