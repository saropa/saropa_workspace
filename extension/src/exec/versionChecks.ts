import { escapeCell, escapeRegExp } from "../board/textEscape";
import { formatSummaryLine, ReportSummary, feedInfo } from "../board/reportSummary";

// Pure parts of the Changelog check and Version consistency recipes: reading a version out of
// a manifest, a lockfile, a changelog and a README badge, comparing them, and rendering the
// report. Nothing here touches the disk; the commands in releaseChecksCommands.ts read the
// files. A check that has nothing to compare says "unknown", never "pass".

// A file name relative to the project folder, in "/" form. Anything absolute, climbing out of
// the folder or empty gives the fallback, so a typo can never point a read outside the project.
export function cleanRelativeFile(v: unknown, fallback: string): string {
  if (typeof v !== "string") {
    return fallback;
  }
  const t = v.trim().replace(/\\/g, "/");
  const parts = t.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.length === 0 || t.startsWith("/") || /^[A-Za-z]:/.test(t) || parts.includes("..") || /[<>"|?*\0]/.test(t)) {
    return fallback;
  }
  return parts.join("/");
}

// A version as compared: no leading "v" and no build metadata (the part after "+").
export function normalizeVersion(v: string): string {
  return v.trim().replace(/^v/i, "").replace(/\+.*$/, "");
}

// The version of the newest released entry of a changelog: the first heading that carries a
// version number. An "Unreleased" heading is skipped.
export function topChangelogVersion(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const m = /^#{1,3}\s+\[?v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\]?/i.exec(line);
    if (m) {
      return m[1];
    }
  }
  return undefined;
}

// The manifest files read for a version, in the order they are tried.
export const MANIFESTS: readonly string[] = ["package.json", "pubspec.yaml", "Cargo.toml", "pyproject.toml"];

export interface ManifestVersion {
  file: string;
  version: string;
  // The package name when the manifest has one (a Cargo.lock lookup needs it).
  name?: string;
}

// The text between a TOML section header and the next one.
function tomlSection(text: string, header: string): string | undefined {
  const start = text.search(new RegExp(`^\\[${escapeRegExp(header)}\\]\\s*$`, "m"));
  if (start < 0) {
    return undefined;
  }
  const rest = text.slice(start).split(/\r?\n/).slice(1);
  const end = rest.findIndex((l) => /^\[/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

// One manifest's version, or undefined when it has none (a private package.json, a version
// inherited from a workspace).
export function readManifest(file: string, text: string): ManifestVersion | undefined {
  if (file === "package.json") {
    try {
      const j = JSON.parse(text) as { version?: unknown; name?: unknown };
      return typeof j.version === "string" && j.version.trim() !== "" ? { file, version: j.version, name: typeof j.name === "string" ? j.name : undefined } : undefined;
    } catch {
      return undefined;
    }
  }
  if (file === "pubspec.yaml") {
    const v = /^version:\s*['"]?([^\s'"#]+)/m.exec(text);
    return v ? { file, version: v[1], name: /^name:\s*(\S+)/m.exec(text)?.[1] } : undefined;
  }
  const section = file === "Cargo.toml" ? tomlSection(text, "package") : (tomlSection(text, "project") ?? tomlSection(text, "tool.poetry"));
  const v = section ? /^version\s*=\s*["']([^"']+)["']/m.exec(section) : undefined;
  return v ? { file, version: v[1], name: /^name\s*=\s*["']([^"']+)["']/m.exec(section ?? "")?.[1] } : undefined;
}

// The first manifest, in the usual order, that has a version.
export function firstManifestVersion(files: ReadonlyArray<{ file: string; text: string }>): ManifestVersion | undefined {
  for (const name of MANIFESTS) {
    const f = files.find((x) => x.file === name);
    const v = f ? readManifest(f.file, f.text) : undefined;
    if (v) {
      return v;
    }
  }
  return undefined;
}

// A version a file states about the project.
export interface Stated {
  source: string;
  version: string;
}

// The project's own version in package-lock.json (top level and the root package entry).
export function packageLockVersions(text: string): Stated[] {
  try {
    const j = JSON.parse(text) as { version?: unknown; packages?: { [k: string]: { version?: unknown } } };
    const out: Stated[] = [];
    if (typeof j.version === "string") {
      out.push({ source: "package-lock.json", version: j.version });
    }
    const root = j.packages?.[""]?.version;
    if (typeof root === "string") {
      out.push({ source: "package-lock.json (root package)", version: root });
    }
    return out;
  } catch {
    return [];
  }
}

// The project's own entry in Cargo.lock, found by crate name.
export function cargoLockVersion(text: string, crate: string | undefined): Stated[] {
  if (!crate) {
    return [];
  }
  for (const block of text.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    if (new RegExp(`^name\\s*=\\s*"${escapeRegExp(crate)}"\\s*$`, "m").test(block)) {
      const v = /^version\s*=\s*"([^"]+)"/m.exec(block);
      return v ? [{ source: "Cargo.lock", version: v[1] }] : [];
    }
  }
  return [];
}

// Versions that README badges state about the project: images whose text or address talks
// about a "version" or a "release" and carries a version number. A badge with no number in it
// (one the badge service fills in itself) states nothing.
export function badgeVersions(readme: string): Stated[] {
  const out: Stated[] = [];
  for (const m of readme.matchAll(/!\[([^\]\n]{0,200})\]\(\s{0,20}<?([^)\s>]{1,2000})/g)) {
    const alt = m[1];
    let url = m[2];
    try {
      url = decodeURIComponent(url);
    } catch {
      // Keep the raw address when it is not valid percent-encoding.
    }
    const label = /version|release/i.test(alt) || /\/badge\/(?:version|release|ver)[-_]/i.test(url);
    if (!label) {
      continue;
    }
    // In a badge address a single dash ends the version (the color follows); a pre-release dash is written twice.
    const found = /\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/.exec(alt) ?? /(?:version|release|ver)[-_ ]v?(\d+\.\d+\.\d+(?:--[0-9A-Za-z.]+)?)/i.exec(url);
    if (found) {
      out.push({ source: "README badge", version: found[1].replace("--", "-") });
    }
  }
  return out;
}

export interface VersionRow {
  source: string;
  version: string;
  agrees: boolean;
}

export interface VersionCheck {
  result: "pass" | "fail" | "unknown";
  // Files that disagree with the manifest.
  count: number;
  manifest?: ManifestVersion;
  rows: VersionRow[];
}

// Compares the manifest's version with what the lockfile and README state. Needs a manifest
// version and at least one other file to compare with; otherwise it cannot say.
export function checkVersions(manifest: ManifestVersion | undefined, others: readonly Stated[]): VersionCheck {
  if (!manifest || others.length === 0) {
    return { result: "unknown", count: 0, manifest, rows: [] };
  }
  const want = normalizeVersion(manifest.version);
  const rows = others.map((o) => ({ source: o.source, version: o.version, agrees: normalizeVersion(o.version) === want }));
  const count = rows.filter((r) => !r.agrees).length;
  return { result: count > 0 ? "fail" : "pass", count, manifest, rows };
}

export interface ChangelogCheck {
  result: "pass" | "fail" | "unknown";
  top?: string;
  manifest?: ManifestVersion;
}

// Whether the newest released changelog entry names the manifest's version.
export function checkChangelog(top: string | undefined, manifest: ManifestVersion | undefined): ChangelogCheck {
  if (!top || !manifest) {
    return { result: "unknown", top, manifest };
  }
  return { result: normalizeVersion(top) === normalizeVersion(manifest.version) ? "pass" : "fail", top, manifest };
}

export function changelogSummaryLine(c: ChangelogCheck, time: number): string {
  const s: ReportSummary = { recipe: feedInfo("changelog").recipeId, time, result: c.result, count: c.result === "fail" ? 1 : c.result === "pass" ? 0 : undefined };
  return formatSummaryLine(s);
}

export function versionSummaryLine(c: VersionCheck, time: number): string {
  const s: ReportSummary = { recipe: feedInfo("version").recipeId, time, result: c.result, count: c.result === "unknown" ? undefined : c.count };
  return formatSummaryLine(s);
}

const cell = escapeCell;

export function buildChangelogMarkdown(c: ChangelogCheck, changelogFile: string, generated: string): string {
  const head = c.result === "pass" ? "The top changelog entry matches the project version." : c.result === "fail" ? "The top changelog entry does not match the project version." : "Could not compare: a version is missing.";
  return [
    "# Changelog check",
    "",
    `Generated ${generated}`,
    "",
    `**Result:** ${head}`,
    "",
    "| Source | Version |",
    "|---|---|",
    `| ${cell(changelogFile)} (newest released entry) | ${cell(c.top ?? "not found")} |`,
    `| ${cell(c.manifest?.file ?? "manifest")} | ${cell(c.manifest?.version ?? "not found")} |`,
    "",
  ].join("\n");
}

export function buildVersionMarkdown(c: VersionCheck, generated: string): string {
  const head = c.result === "pass" ? "Every file checked states the same version." : c.result === "fail" ? `${c.count} file(s) state a different version.` : "Could not compare: needs a manifest version and at least one lockfile or README badge that states one.";
  const rows = [c.manifest ? `| ${cell(c.manifest.file)} (manifest) | ${cell(c.manifest.version)} | reference |` : "", ...c.rows.map((r) => `| ${cell(r.source)} | ${cell(r.version)} | ${r.agrees ? "same" : "**differs**"} |`)].filter((l) => l !== "");
  return ["# Version consistency", "", `Generated ${generated}`, "", `**Result:** ${head}`, "", "| Source | Version | Compared with the manifest |", "|---|---|---|", ...rows, ""].join("\n");
}
