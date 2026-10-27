// Real-filesystem glob matching behind the stub workspace.findFiles. Split out of vscode.ts.

import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { Uri, RelativePattern } from "./vscodeTypes";

// Convert a VS Code glob to a RegExp anchored to a folder-relative POSIX path.
// Handles the constructs the auto-shortcut patterns use: `**` (any depth), `*` (one
// segment), `?` (one char). Enough to expand a real glob against the temp tree;
// literal patterns never reach here (the store stats those directly).
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**/` matches any number of leading segments (including none); a bare
        // `**` matches anything.
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

// workspace.findFiles for the glob auto-shortcut branch: walk the base folder, match
// each file's folder-relative POSIX path against the pattern, skip the excluded
// subtree (the store passes node_modules), and cap at maxResults. The non-glob
// branch never calls this — the store stats a literal path directly.
export async function findFiles(
  include: RelativePattern,
  exclude?: string,
  maxResults?: number
): Promise<Uri[]> {
  const root = include.base.uri.fsPath;
  const matcher = globToRegExp(include.pattern);
  const excludeName = exclude ? exclude.replace(/[*/]/g, "") : undefined;
  const out: Uri[] = [];
  const walk = (dir: string): void => {
    if (maxResults !== undefined && out.length >= maxResults) {
      return;
    }
    for (const entry of nodeFs.readdirSync(dir, { withFileTypes: true })) {
      if (excludeName && entry.name === excludeName) {
        continue;
      }
      const full = nodePath.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        const rel = nodePath.relative(root, full).replace(/\\/g, "/");
        if (matcher.test(rel)) {
          out.push(Uri.joinPath(include.base.uri, rel));
        }
      }
    }
  };
  walk(root);
  return out;
}
