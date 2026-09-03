// Case-sensitivity-aware path comparison helpers.
//
// Filesystems can be case-insensitive (Windows NTFS/ReFS, macOS HFS+/APFS-
// default) or case-sensitive (Linux ext4/btrfs, macOS APFS case-sensitive
// volumes). Two `vscode.Uri.fsPath` strings that differ only in casing can
// refer to the same file on a case-insensitive volume, so a naive `startsWith`
// or `===` comparison silently breaks folder-relative path derivation.
//
// Rather than assuming based on `process.platform` alone (which misses case-
// sensitive APFS on macOS and case-insensitive ext4 on Linux), these helpers
// probe the filesystem once on first use and cache the result. The probe checks
// whether the Node executable's own path resolves under a different-case alias;
// if the probe fails (read-only FS, permissions), the platform default wins.
//
// Normalization happens for the COMPARISON ONLY; returned text is always sliced
// from the original input so on-disk/display casing is never altered.

import * as fs from "fs";

// Cached after the first call to isCaseInsensitiveFS(). `undefined` means the
// probe has not run yet; `true`/`false` is the sticky answer.
let cachedCaseSensitivity: boolean | undefined;

// Probe whether the local filesystem is case-insensitive by checking if the
// Node executable exists under an inverted-case alias. Falls back to the
// platform default (Windows/macOS → insensitive, Linux → sensitive) when the
// probe cannot run.
function probeIsCaseInsensitive(): boolean {
  try {
    const exe = process.execPath;
    // Build an alias with every letter's case flipped.
    const flipped = Array.from(exe)
      .map((c) => {
        const lower = c.toLowerCase();
        const upper = c.toUpperCase();
        return c === lower ? upper : lower;
      })
      .join("");
    // If flipped differs from exe and the flipped path exists, the FS treats
    // them as the same file → case-insensitive. If they're identical (all non-
    // alpha path), the probe is inconclusive → fall back to platform default.
    if (flipped === exe) {
      return process.platform === "win32" || process.platform === "darwin";
    }
    return fs.existsSync(flipped);
  } catch {
    // Probe failed (permissions, sandbox) — use the platform default.
    return process.platform === "win32" || process.platform === "darwin";
  }
}

// Lazy-initialized: runs the probe on first call, then returns the cached
// result on every subsequent call. Exported for tests that need to verify the
// probe ran.
export function isCaseInsensitiveFS(): boolean {
  if (cachedCaseSensitivity === undefined) {
    cachedCaseSensitivity = probeIsCaseInsensitive();
  }
  return cachedCaseSensitivity;
}

/**
 * Case-normalize a value for comparison purposes only. Never surface this
 * return value to the user or use it as a path — only `base`/`fullPath`
 * themselves (or slices of them) preserve real casing.
 */
function normalizeForCompare(value: string): string {
  return isCaseInsensitiveFS() ? value.toLowerCase() : value;
}

/**
 * Case-insensitive path equality on case-insensitive filesystems, exact
 * equality elsewhere. Use for stop-directory checks (walkUp) and anywhere
 * two paths that should name the same location need an equality test across
 * casing differences.
 */
export function pathEquals(a: string, b: string): boolean {
  return normalizeForCompare(a) === normalizeForCompare(b);
}

/**
 * True when `fullPath` is exactly `base`, or a descendant of it separated by
 * `separator`. The `separator` boundary check prevents a false match against
 * a sibling whose name merely starts with `base` (e.g. base "/proj" must not
 * match "/project"). Comparison is case-insensitive on case-insensitive
 * filesystems; everywhere else it is exact.
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
 * Strip `base` off the front of `fullPath` using the same case-aware,
 * separator-boundary-safe match as `isPathWithinBase`. Returns the remainder
 * with its ORIGINAL casing intact (sliced from `fullPath`, not the normalized
 * copy), or `fullPath` unchanged when it is not under `base`.
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
 * case-aware prefix match — for a caller whose `fullPath` is always composed
 * FROM `base` (e.g. `Uri.joinPath(folder.uri, "sub/file")`), where a sibling-
 * folder false match cannot occur and mixed path separators (forward slash from
 * a joined relative segment vs. the OS separator in `base`) mean a separator-
 * boundary check would wrongly reject a real match. Returns `fullPath`
 * unchanged when it is not under `base`.
 */
export function relativeToBaseLoose(fullPath: string, base: string): string {
  const matches = normalizeForCompare(fullPath).startsWith(
    normalizeForCompare(base)
  );
  return matches ? fullPath.slice(base.length) : fullPath;
}
