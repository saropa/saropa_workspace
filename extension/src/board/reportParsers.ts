// Reads the captured output of the shell reports that feed the Release Board (dependency
// freshness, pull request queue, uncommitted files, tech-debt markers, merged branches).
// Pure. Every parser answers "unknown" when the output does not prove the command ran:
// an empty or failed run is never a pass.

export interface Parsed {
  result: "pass" | "fail" | "unknown";
  count?: number;
}

const UNKNOWN: Parsed = { result: "unknown" };

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

function linesOf(output: string): string[] {
  return stripAnsi(output)
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
}

// `git status --branch --porcelain=v1`. The "## " branch line proves git answered; every other
// line is one file not committed. Clean passes with 0; any file fails with the file count.
export function parseUncommitted(code: number | null, output: string): Parsed {
  if (code !== 0) {
    return UNKNOWN;
  }
  const lines = linesOf(output);
  if (!lines.some((l) => l.startsWith("## "))) {
    return UNKNOWN;
  }
  const files = lines.filter((l) => !l.startsWith("## ")).length;
  return files === 0 ? { result: "pass", count: 0 } : { result: "fail", count: files };
}

// `gh pr list`: one row per pull request, starting with its number. Passes with the count of
// rows. Output that is not rows and not a plain "no pull requests" message is unknown.
export function parsePrQueue(code: number | null, output: string): Parsed {
  if (code !== 0) {
    return UNKNOWN;
  }
  const lines = linesOf(output);
  const rows = lines.filter((l) => /^#?\d+(?:\s|$)/.test(l.trim()));
  if (rows.length === 0 && lines.length > 0 && !/^no (?:open )?pull requests?\b/i.test(lines[0].trim())) {
    return UNKNOWN;
  }
  return { result: "pass", count: rows.length };
}

// `npm outdated; npm audit`. The audit line proves the advisory check ran. Vulnerabilities fail
// with their count; none passes with the number of packages behind. Other ecosystems' output
// has no advisory check and is unknown.
export function parseDepsShell(code: number | null, output: string): Parsed {
  const text = stripAnsi(output);
  const found = /^found (\d+) vulnerabilit/m.exec(text) ?? /^(\d+) vulnerabilit(?:y|ies)\b/m.exec(text);
  if (!found) {
    return UNKNOWN;
  }
  const vulnerable = Number(found[1]);
  if (vulnerable > 0) {
    return { result: "fail", count: vulnerable };
  }
  // A clean audit that still exited with an error did not finish.
  if (code !== 0) {
    return UNKNOWN;
  }
  const all = text.split(/\r?\n/);
  const header = all.findIndex((l) => /^Package\s+Current\s+Wanted\s+Latest/.test(l));
  let behind = 0;
  if (header >= 0) {
    for (const l of all.slice(header + 1)) {
      if (l.trim() === "") {
        break;
      }
      behind += 1;
    }
  }
  return { result: "pass", count: behind };
}

// `git grep -n -E "TODO|FIXME|HACK|XXX"`: exit 0 with matching rows, or exit 1 with nothing
// (no marker). Anything else is unknown. The count is informational; the result is always pass.
export function parseDebtMarkers(code: number | null, output: string): Parsed {
  const lines = linesOf(output);
  if (code === 1 && lines.length === 0) {
    return { result: "pass", count: 0 };
  }
  if (code !== 0) {
    return UNKNOWN;
  }
  const rows = lines.filter((l) => /^[^\s:][^:]*:\d+:/.test(l));
  return rows.length === 0 ? UNKNOWN : { result: "pass", count: rows.length };
}

// Names never counted as a branch to delete.
const KEEP_BRANCHES = new Set(["main", "master", "develop", "dev", "trunk"]);

// `git branch --merged && git branch -vv`. The first list has bare names, the second has a
// commit id after each name; seeing the second proves both commands ran. The count is the
// merged branches other than the current one and the usual long-lived names.
export function parseMergedBranches(code: number | null, output: string): Parsed {
  if (code !== 0) {
    return UNKNOWN;
  }
  const lines = stripAnsi(output)
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
  const verbose = /^[*+ ] +\S+\s+[0-9a-f]{7,}\s/;
  if (!lines.some((l) => verbose.test(l))) {
    return UNKNOWN;
  }
  const merged = lines
    .filter((l) => !verbose.test(l) && !l.startsWith("*") && !l.startsWith("+"))
    .map((l) => l.trim())
    .filter((name) => name !== "" && !name.includes(" ") && !KEEP_BRANCHES.has(name));
  return { result: "pass", count: merged.length };
}
