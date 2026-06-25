import * as path from "path";

// Run-command placeholder tokens (roadmap 2.4). Token names follow Code Runner's
// for familiarity, so users coming from it can reuse the names they know. Pure of
// VS Code so the substitution is unit-testable in isolation (roadmap 6.1).

// The supported token names (without the leading "$"). Exported so help text and
// tests share one list rather than restating it.
export const SUPPORTED_TOKENS = [
  "workspaceRoot",
  "dir",
  "file",
  "fileName",
  "fileNameWithoutExt",
] as const;

// Resolve the concrete value of each token for a given target file.
export function buildTokenMap(
  fsPath: string,
  workspaceRoot: string | undefined
): Record<string, string> {
  return {
    file: fsPath,
    dir: path.dirname(fsPath),
    fileName: path.basename(fsPath),
    fileNameWithoutExt: path.basename(fsPath, path.extname(fsPath)),
    // Outside any workspace folder, fall back to the file's own directory so
    // $workspaceRoot yields a usable path rather than an empty string.
    workspaceRoot: workspaceRoot ?? path.dirname(fsPath),
  };
}

// Substitute $token occurrences in `value`. An unknown $name is left exactly as
// written and added to `unknown` so the caller can report it once: a literal
// $name may be an intentional shell variable (e.g. $HOME) that the shell should
// expand, so blanking it would be wrong. The regex matches the longest
// identifier, so $fileNameWithoutExt resolves as a whole rather than as
// $fileName followed by the literal "WithoutExt".
export function expandTokens(
  value: string,
  tokens: Record<string, string>,
  unknown: Set<string>
): string {
  return value.replace(/\$([A-Za-z][A-Za-z0-9]*)/g, (whole, name: string) => {
    if (Object.prototype.hasOwnProperty.call(tokens, name)) {
      return tokens[name];
    }
    unknown.add(name);
    return whole;
  });
}
