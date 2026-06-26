// Dependency-free glob matching for the cross-file watch links (#25). VS Code
// exposes no public API to test a single path against a glob synchronously —
// RelativePattern only feeds a FileSystemWatcher — and pulling in a glob library
// (minimatch) for the handful of patterns a watch link carries is not warranted.
// This supports the POSIX-glob subset the feature needs:
//   *   any run of characters within a single path segment (does not cross "/")
//   **  any run of characters across segments ("**" / "**/" matches zero or more
//       leading segments, so "**/x" also matches "x" at the root)
//   ?   exactly one non-separator character
//   …   every other character is matched literally
// Paths are compared with forward slashes (the form vscode.workspace.asRelativePath
// returns) and case-sensitively, matching how VS Code's own glob watchers behave on
// the case-sensitive filesystems these patterns are authored against.

// Translate one glob into an anchored RegExp. Kept separate so the (small) cost of
// compiling is paid once per match call, not per candidate path; callers that match
// many paths against the same globs can compile ahead with this directly.
export function globToRegExp(glob: string): RegExp {
  // Regex metacharacters that must be escaped to be treated literally. "*" and "?"
  // are handled explicitly below (they are the glob wildcards); "/" needs no escape.
  const escapeNeeded = new Set([".", "+", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\"]);
  let pattern = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*") {
      // "**" crosses path separators; a single "*" stays within one segment.
      if (glob[i + 1] === "*") {
        i++;
        // Consume a trailing slash so "**/" collapses to "zero or more segments",
        // letting "**/x" match "x" at the root as well as "a/b/x".
        if (glob[i + 1] === "/") {
          i++;
          pattern += "(?:.*/)?";
        } else {
          pattern += ".*";
        }
      } else {
        pattern += "[^/]*";
      }
    } else if (char === "?") {
      pattern += "[^/]";
    } else if (escapeNeeded.has(char)) {
      pattern += "\\" + char;
    } else {
      pattern += char;
    }
  }
  return new RegExp("^" + pattern + "$");
}

// True when the forward-slashed path matches any one of the globs. An empty/absent
// glob list never matches (an un-linked shortcut reacts to no save). A glob that fails to
// compile is skipped rather than thrown, so one malformed pattern cannot disable the
// whole save listener.
export function matchesAnyGlob(relPath: string, globs: readonly string[]): boolean {
  for (const glob of globs) {
    const trimmed = glob.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      if (globToRegExp(trimmed).test(relPath)) {
        return true;
      }
    } catch {
      // A pattern that does not form a valid RegExp matches nothing; ignore it.
    }
  }
  return false;
}
