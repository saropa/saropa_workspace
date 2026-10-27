// Live evidence: error and warning signals in the source files an open document names,
// shown as a small mark on the document's row. Pure; the VS Code layer gathers the counts.
//
// A mark is information only. Nothing here reaches a light: buildBoard reads these marks
// after the light is decided, and a signal from one device is not the evidence a failing
// test is.

export interface Counts {
  errors: number;
  warnings: number;
}

// Counts from debug logs, with crashes and the newest signal.
export interface LogCounts extends Counts {
  // Crashes seen in debug runs.
  crashes: number;
  // Newest signal, in ms since 1970, when the source says.
  last?: number;
  // A short plain-text title of the worst signal, when the source gives one.
  title?: string;
}

// What is known about one source file, per source. A source that knows nothing is absent.
export interface FileSignal {
  problems?: Counts;
  lints?: Counts;
  logs?: LogCounts;
}

// Project id -> project-relative file ("/" separated) -> signal.
export type LiveSignals = Record<string, Record<string, FileSignal>>;

// The signals known for one source file.
export interface LiveFile {
  file: string;
  problems?: Counts;
  lints?: Counts;
  logs?: LogCounts;
}

// The flame on a row: totals and the worst files behind it.
export interface LiveMark {
  // True when any error or crash is present; false when only warnings are.
  hot: boolean;
  errors: number;
  warnings: number;
  crashes: number;
  // Worst files first, at most MAX_MARK_FILES.
  files: LiveFile[];
  // Files beyond the listed ones that also have signals.
  more: number;
}

// A crash signal in a file that no open document names.
export interface LiveUnnamed {
  project: string;
  projectName: string;
  file: string;
  logs: LogCounts;
  // Project-relative folder a new document is written to; undefined when the project has no bugs folder.
  folder?: string;
}

// Most files listed in one mark's tooltip.
export const MAX_MARK_FILES = 5;
// Most crash signals listed in the box of files no document names.
export const MAX_UNNAMED = 5;
const MAX_COUNT = 1_000_000;
const MAX_LINT_ROWS = 50_000;
const MAX_TITLE = 120;

const posInt = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), MAX_COUNT) : 0);

// A project-relative path with "/" separators; lower-cased where the file system ignores case.
export function normRel(p: string, fold: boolean): string {
  const s = p.replace(/\\/g, "/").replace(/^\.\//, "");
  return fold ? s.toLowerCase() : s;
}

// A key for an absolute path that both sides of the Log Capture lookup build the same way:
// "/" separators, a lower-case drive letter, and no case where the file system ignores it.
export function pathKey(p: string, fold: boolean): string {
  const s = p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_m, d: string) => d.toLowerCase() + ":").replace(/\/{2,}/g, "/");
  return fold ? s.toLowerCase() : s;
}

// Looks back 1 to 30 days; anything else means 1.
export function clampLookbackDays(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(30, Math.max(1, Math.round(v))) : 1;
}

// Per-file violation counts from a Saropa Lints violations file. Paths are made relative to
// `base` when absolute. Rows that are not understood are skipped; the file is untrusted.
export function parseLintViolations(text: string, base: string | undefined, fold: boolean): Map<string, Counts> {
  const out = new Map<string, Counts>();
  let data: { violations?: unknown };
  try {
    data = JSON.parse(text);
  } catch {
    return out;
  }
  const rows = Array.isArray(data?.violations) ? data.violations.slice(0, MAX_LINT_ROWS) : [];
  const root = base ? normRel(base, fold).replace(/\/+$/, "") + "/" : undefined;
  for (const r of rows) {
    const o = (typeof r === "object" && r !== null ? r : {}) as Record<string, unknown>;
    const raw = typeof o.file === "string" ? o.file : typeof o.path === "string" ? o.path : undefined;
    const sev = String(o.severity ?? o.impact ?? "").toLowerCase();
    if (!raw || (sev !== "error" && sev !== "warning")) {
      continue;
    }
    // The key keeps the file's own case for display; matching folds it where needed.
    let rel = normRel(raw, false);
    if (root && normRel(rel, fold).startsWith(root)) {
      rel = rel.slice(root.length);
    }
    if (rel.startsWith("/") || /^[a-z]:\//i.test(rel) || rel.split("/").includes("..")) {
      continue;
    }
    const c = out.get(rel) ?? { errors: 0, warnings: 0 };
    if (sev === "error") {
      c.errors += 1;
    } else {
      c.warnings += 1;
    }
    out.set(rel, c);
  }
  return out;
}

// The optional extension API that answers for a list of files. Used only when it says it
// is version 1 or newer and has the member; anything else is treated as not installed.
export interface SignalsApi {
  apiVersion?: unknown;
  signalsForFiles?: unknown;
}

// Oldest version of the other extension's API the board will use.
export const MIN_API_VERSION = 1;

// True when the other extension's API is new enough and has the call the board needs.
export function apiUsable(api: SignalsApi | undefined): boolean {
  return !!api && typeof api.apiVersion === "number" && api.apiVersion >= MIN_API_VERSION && typeof api.signalsForFiles === "function";
}

// The reply of `signalsForFiles(paths, sinceDate)`: an array, or an object with a `files`
// array, of { path, errors, warnings, crashes, last, title }. `lookup` maps each path that was
// asked for to its project and relative file; an answer for any other path is dropped.
export type PathLookup = Map<string, Array<{ project: string; rel: string }>>;

// Cleans the reply of the other extension into counts per known file; unknown paths are dropped.
export function readApiSignals(reply: unknown, lookup: PathLookup, fold: boolean): Array<{ project: string; rel: string; logs: LogCounts }> {
  const list = Array.isArray(reply) ? reply : Array.isArray((reply as { files?: unknown } | null)?.files) ? (reply as { files: unknown[] }).files : [];
  const out: Array<{ project: string; rel: string; logs: LogCounts }> = [];
  for (const r of list.slice(0, 1000)) {
    const o = (typeof r === "object" && r !== null ? r : {}) as Record<string, unknown>;
    const hit = typeof o.path === "string" ? lookup.get(pathKey(o.path, fold)) : undefined;
    if (!hit || hit.length === 0) {
      continue;
    }
    const logs: LogCounts = { errors: posInt(o.errors), warnings: posInt(o.warnings), crashes: posInt(o.crashes) };
    if (logs.errors + logs.warnings + logs.crashes === 0) {
      continue;
    }
    if (typeof o.last === "number" && Number.isFinite(o.last) && o.last > 0) {
      logs.last = o.last;
    }
    if (typeof o.title === "string" && o.title.trim() !== "") {
      logs.title = o.title.replace(/[\r\n\t]+/g, " ").trim().slice(0, MAX_TITLE);
    }
    for (const h of hit) {
      out.push({ ...h, logs });
    }
  }
  return out;
}

// Settings that change which signals count.
export interface LiveOptions {
  // Warnings are counted and shown. When false only errors and crashes are.
  includeWarnings: boolean;
  fold: boolean;
}

function weigh(f: FileSignal, warn: boolean): { errors: number; warnings: number; crashes: number } {
  const parts = [f.problems, f.lints, f.logs];
  return {
    errors: parts.reduce((a, c) => a + (c?.errors ?? 0), 0),
    warnings: warn ? parts.reduce((a, c) => a + (c?.warnings ?? 0), 0) : 0,
    crashes: f.logs?.crashes ?? 0,
  };
}

// The mark for one document: its named files, matched against the signals of its project.
// A document whose files are clean and quiet gets none.
export function markFor(project: string, sourceFiles: string[], signals: LiveSignals, opt: LiveOptions): LiveMark | undefined {
  const mine = signals[project];
  if (!mine || sourceFiles.length === 0) {
    return undefined;
  }
  const byKey = new Map(Object.entries(mine).map(([k, v]) => [normRel(k, opt.fold), { name: k, sig: v }]));
  const found: Array<LiveFile & { w: number }> = [];
  const seen = new Set<string>();
  for (const f of sourceFiles) {
    const k = normRel(f, opt.fold);
    const hit = byKey.get(k);
    if (!hit || seen.has(k)) {
      continue;
    }
    seen.add(k);
    const w = weigh(hit.sig, opt.includeWarnings);
    if (w.errors + w.warnings + w.crashes === 0) {
      continue;
    }
    const keep = (c: Counts | undefined): Counts | undefined => (c && c.errors + (opt.includeWarnings ? c.warnings : 0) > 0 ? { errors: c.errors, warnings: opt.includeWarnings ? c.warnings : 0 } : undefined);
    const logs = hit.sig.logs && hit.sig.logs.errors + hit.sig.logs.crashes + (opt.includeWarnings ? hit.sig.logs.warnings : 0) > 0 ? { ...hit.sig.logs, warnings: opt.includeWarnings ? hit.sig.logs.warnings : 0 } : undefined;
    found.push({ file: f, problems: keep(hit.sig.problems), lints: keep(hit.sig.lints), logs, w: w.crashes * 1000 + w.errors * 10 + w.warnings });
  }
  if (found.length === 0) {
    return undefined;
  }
  found.sort((a, b) => b.w - a.w || a.file.localeCompare(b.file));
  const total = found.reduce(
    (a, f) => ({
      errors: a.errors + (f.problems?.errors ?? 0) + (f.lints?.errors ?? 0) + (f.logs?.errors ?? 0),
      warnings: a.warnings + (f.problems?.warnings ?? 0) + (f.lints?.warnings ?? 0) + (f.logs?.warnings ?? 0),
      crashes: a.crashes + (f.logs?.crashes ?? 0),
    }),
    { errors: 0, warnings: 0, crashes: 0 }
  );
  return {
    hot: total.errors + total.crashes > 0,
    ...total,
    files: found.slice(0, MAX_MARK_FILES).map(({ w: _w, ...f }) => f),
    more: Math.max(0, found.length - MAX_MARK_FILES),
  };
}

// Crash signals from debug runs in files that no open document names, worst first. Only the
// log source feeds this box: a lint or Problems entry in an unnamed file is everyday work.
export function unnamedFiles(
  signals: LiveSignals,
  named: Map<string, Set<string>>,
  projects: Array<{ id: string; name: string; bugsFolder?: string }>,
  fold: boolean,
  // Only a file a document can name is listed, so a written document makes it "named".
  nameable: (rel: string) => boolean = () => true
): LiveUnnamed[] {
  const out: LiveUnnamed[] = [];
  for (const p of projects) {
    const have = new Set([...(named.get(p.id) ?? [])].map((f) => normRel(f, fold)));
    for (const [file, sig] of Object.entries(signals[p.id] ?? {})) {
      if (sig.logs && sig.logs.crashes + sig.logs.errors > 0 && nameable(file) && !have.has(normRel(file, fold))) {
        out.push({ project: p.id, projectName: p.name, file, logs: sig.logs, folder: p.bugsFolder });
      }
    }
  }
  return out
    .sort((a, b) => b.logs.crashes - a.logs.crashes || b.logs.errors - a.logs.errors || a.file.localeCompare(b.file))
    .slice(0, MAX_UNNAMED);
}

// The project's bugs folder: the first document root whose last segment is "bugs".
// A root that is absolute or climbs out of the project is never used.
export function bugsFolderOf(roots: string[]): string | undefined {
  return roots
    .map((r) => r.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, ""))
    .find((r) => r !== "" && !r.startsWith("/") && !/^[A-Za-z]:/.test(r) && !r.split("/").some((seg) => seg === ".." || seg === ".") && r.split("/").pop()?.toLowerCase() === "bugs");
}

const pad = (n: number): string => String(n).padStart(2, "0");
// A local date as YYYY-MM-DD from a time in milliseconds.
export const dateOf = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// A new bug document for a signal: the name (without a folder) and the text. The owner
// finishes it; the board writes it once and never touches it again.
export function bugDocument(u: LiveUnnamed, now: number, sinceDays: number): { name: string; text: string } {
  const base = u.file.split("/").pop() ?? u.file;
  const slug = base.replace(/\.[A-Za-z0-9]+$/, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase() || "FILE";
  const parts = [u.logs.crashes > 0 ? `${u.logs.crashes} ${u.logs.crashes === 1 ? "crash" : "crashes"}` : "", u.logs.errors > 0 ? `${u.logs.errors} ${u.logs.errors === 1 ? "error" : "errors"}` : ""].filter(Boolean);
  const signal = `${parts.join(", ")} in debug runs since ${dateOf(now - sinceDays * 86400000)}`;
  const title = u.logs.title ?? (u.logs.crashes > 0 ? `Crashes in ${base}` : `Errors in ${base}`);
  const file = u.file.replace(/`/g, "'");
  const text = [
    `# ${title}`,
    "",
    `Date: ${dateOf(now)}`,
    `File: \`${file}\``,
    `Signal: ${signal}.`,
    "",
    "## Steps",
    "",
    `- [ ] Find the cause in \`${file}\`.`,
    "- [ ] Fix it and add a test.",
    "",
  ].join("\n");
  return { name: `BUG_${slug}.md`, text };
}
