import * as fs from "node:fs";
import * as path from "node:path";
import { FileSource } from "./scanner";
import { ScanFile } from "./types";

// FileSource over the node file system. Used by the unit tests and the manual scan
// script. Not the VS Code layer's source (that one uses workspace.fs for remote).
export function nodeFileSource(base: string): FileSource {
  return {
    async list(projectDir: string, root: string, accept?: (path: string) => boolean): Promise<ScanFile[]> {
      const dir = path.join(base, projectDir);
      const out: ScanFile[] = [];
      const walk = (abs: string): void => {
        for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
          const full = path.join(abs, e.name);
          if (e.isDirectory()) {
            walk(full);
          } else if (e.isFile() && (!accept || accept(path.relative(dir, full).split(path.sep).join("/")))) {
            const st = fs.statSync(full);
            out.push({
              path: path.relative(dir, full).split(path.sep).join("/"),
              size: st.size,
              mtimeMs: st.mtimeMs,
            });
          }
        }
      };
      walk(path.join(dir, root));
      return out;
    },
    async readHead(projectDir: string, p: string, lines: number): Promise<string> {
      const text = fs.readFileSync(path.join(base, projectDir, p), "utf8");
      return text.split(/\r?\n/).slice(0, lines).join("\n");
    },
    async readText(projectDir: string, p: string): Promise<string> {
      return fs.readFileSync(path.join(base, projectDir, p), "utf8");
    },
  };
}
