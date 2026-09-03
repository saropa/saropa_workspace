// Case-sensitivity-aware path comparison helpers.
//
// Case-sensitivity-aware path comparison helpers for case-insensitive
// filesystems (Windows NTFS/ReFS, macOS HFS+/APFS-default).
//
// Two `vscode.Uri.fsPath` strings that differ only in casing can refer to the
// same file or folder — e.g. a workspace folder opened as "D:\Src\Proj" but a
// file resolved elsewhere as "d:\src\Proj\file.ts". A naive `startsWith` (or
// `===`) comparison treats those as unrelated, which silently breaks
// folder-relative path derivation and "is this under that folder" checks.
// These helpers normalize casing for the COMPARISON ONLY on win32 and darwin;
// the text returned to callers is always sliced from the original input, so
// on-disk / display casing is never altered.

// Both Windows (NTFS/ReFS) and macOS (HFS+/APFS-default) use case-insensitive
// but case-preserving filesystems. Only Linux (ext4/btrfs) is case-sensitive.
const isCaseInsensitiveFS =
  process.platform === "win32" || process.platform === "darwin";

/**
 * Case-normalize a value for comparison purposes only. Never surface this
 * return value to the user or use it as a path — only `base`/`fullPath`
 * themselves (or slices of them) preserve real casing.
 */
function normalizeForCompare(value: string): string {
  return isCaseInsensitiveFS ? value.toLowerCase() : value;
}

/**
 * Case-insensitive path equality on win32, exact equality elsewhere. Use for
 * stop-directory checks (walkUp) and anywhere two paths that should name the
 * same location need an equality test across casing differences.
 */
export function pathEquals(a: string, b: string): boolean {
  return normalizeForCompare(a) === normalizeForCompare(b);
}

/**
 * True when `fullPath` is exactly `base`, or a descendant of it separated by
 * `separator`. The `separator` boundary check prevents a false match against
 * a sibling whose name merely starts with `base` (e.g. base "/proj" must not
 * match "/project"). Comparison is case-insensitive on win32/macOS to match that
 * platform's case-insensitive filesystem; everywhere else it is exact.
 */
export function isPathWithinBase(
  fullPath: string,
  base: string,
  separator: string
): boolean {
  const normalizedFull = normalizeForCompare(fullPath);
  const normalizedBase = normalizeForCompare(base);
  return (
    normalizedFull === normalizedBase ||
    normalizedFull.startsWith(normalizedBase + separator)
  );
}

/**
 * Strip `base` off the front of `fullPath` using the same case-insensitive-
 * on-win32, separator-boundary-safe match as `isPathWithinBase`. Returns the
 * remainder with its ORIGINAL casing intact (sliced from `fullPath`, not the
 * normalized copy), or `fullPath` unchanged when it is not under `base`.
 */
export function relativeToBase(
  fullPath: string,
  base: string,
  separator: string
): string {
  return isPathWithinBase(fullPath, base, separator)
    ? fullPath.slice(base.length)
    : fullPath;
}

/**
 * Strip `base` off the front of `fullPath` on a plain (non-boundary-safe)
 * case-insensitive-on-win32 prefix match — for a caller whose `fullPath` is
 * always composed FROM `base` (e.g. `Uri.joinPath(folder.uri, "sub/file")`),
 * where a sibling-folder false match cannot occur and mixed path separators
 * (forward slash from a joined relative segment vs. the OS separator in
 * `base`) mean a separator-boundary check would wrongly reject a real match.
 * Returns `fullPath` unchanged when it is not under `base`.
 */
export function relativeToBaseLoose(fullPath: string, base: string): string {
  const matches = normalizeForCompare(fullPath).startsWith(
    normalizeForCompare(base)
  );
  return matches ? fullPath.slice(base.length) : fullPath;
}
