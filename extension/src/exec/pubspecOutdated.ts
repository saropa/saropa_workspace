import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import { promisify } from "util";
import { execFile as execFileCb } from "child_process";
import { expandRecipeTokens, reportRelativePath } from "./runner";
import { l10n } from "../i18n/l10n";

const execFile = promisify(execFileCb);

// Pubspec dependency-freshness ritual (report bug item 4). `dart pub outdated` in a
// terminal prints EVERY dependency — up-to-date ones included — which buries the few
// packages that actually need a bump. This runs the machine-readable form
// (`--json`), keeps ONLY the packages whose resolved version trails the latest, and
// writes a compact Markdown table of just those. An all-current project produces a
// one-line "everything is current" report instead of a wall of unchanged rows.
//
// In-process (parse the JSON here) rather than a raw shell line so the "only the
// out-of-date items" filter is deterministic and cross-platform, the same reason the
// project-stats ritual is a command and not a shell capture.

// git/pub output can exceed execFile's 1 MB default on a large dependency tree.
const MAX_BUFFER = 16 * 1024 * 1024;
// Hard ceiling so a wedged `pub` resolution (network stall, credential prompt) turns
// into a graceful empty result rather than hanging the scheduled run.
const PUB_TIMEOUT_MS = 120_000;

// One package as `dart pub outdated --json` reports it. Every version slot is
// nullable — a package with no resolvable upgrade reports null for that slot — so
// each is read defensively.
interface OutdatedVersion {
  version?: string | null;
}
interface OutdatedPackage {
  package: string;
  isDiscontinued?: boolean;
  kind?: string;
  current?: OutdatedVersion | null;
  upgradable?: OutdatedVersion | null;
  resolvable?: OutdatedVersion | null;
  latest?: OutdatedVersion | null;
}

// A package the report will show: it is behind latest (or discontinued), reduced to
// the four version strings the table renders.
interface StalePackage {
  name: string;
  kind: string;
  current: string;
  upgradable: string;
  resolvable: string;
  latest: string;
  discontinued: boolean;
}

const NONE = "—";

function version(slot: OutdatedVersion | null | undefined): string {
  const v = slot?.version;
  return v && v.length > 0 ? v : NONE;
}

// A package is "out of date" when it has a current version and a latest version and
// the two differ. A package with no current (not installed) or no latest (unknown)
// is not actionable as a freshness bump, so it is left out — the report is only the
// items the user can act on. A discontinued package is always surfaced. Exported for
// the unit test: this predicate is the core of report-bug item 4 (only stale items).
export function isStale(pkg: OutdatedPackage): boolean {
  if (pkg.isDiscontinued === true) {
    return true;
  }
  const current = pkg.current?.version;
  const latest = pkg.latest?.version;
  return (
    typeof current === "string" &&
    typeof latest === "string" &&
    current.length > 0 &&
    latest.length > 0 &&
    current !== latest
  );
}

// Run `dart pub outdated --json` in the project root and return the packages that
// are behind latest. On any failure (dart missing, not a pub project, resolution
// error) it throws with a message the caller surfaces — a freshness report that
// silently claims "all current" when the tool failed would be a false all-clear.
export async function collectOutdated(root: string): Promise<StalePackage[]> {
  const { stdout } = await execFile("dart", ["pub", "outdated", "--json"], {
    cwd: root,
    maxBuffer: MAX_BUFFER,
    timeout: PUB_TIMEOUT_MS,
  });

  const parsed = JSON.parse(stdout) as { packages?: OutdatedPackage[] };
  const packages = parsed.packages ?? [];
  return packages.filter(isStale).map((pkg) => ({
    name: pkg.package,
    kind: pkg.kind ?? "direct",
    current: version(pkg.current),
    upgradable: version(pkg.upgradable),
    resolvable: version(pkg.resolvable),
    latest: version(pkg.latest),
    discontinued: pkg.isDiscontinued === true,
  }));
}

// Render the stale packages as a Markdown report. Only out-of-date items appear; an
// empty list becomes an explicit "everything is current" line so the report reads as
// a deliberate all-clear, not an empty file.
export function buildOutdatedMarkdown(stale: StalePackage[]): string {
  const lines: string[] = [];
  lines.push("# Pubspec dependency freshness");
  lines.push("");
  lines.push(`**Generated** ${new Date().toLocaleString()}`);
  lines.push("");
  lines.push("**Command** `dart pub outdated --json` (only out-of-date packages shown)");
  lines.push("");

  if (stale.length === 0) {
    lines.push("All dependencies are up to date.");
    lines.push("");
    return lines.join("\n");
  }

  lines.push(`${stale.length} package(s) behind latest.`);
  lines.push("");
  lines.push("| Package | Kind | Current | Upgradable | Resolvable | Latest |");
  lines.push("|---|---|---|---|---|---|");
  for (const p of stale) {
    // Flag a discontinued package inline — it will never gain a newer version, so a
    // plain "behind latest" row would understate that it needs replacing.
    const name = p.discontinued ? `${p.name} (discontinued)` : p.name;
    lines.push(
      `| ${name} | ${p.kind} | ${p.current} | ${p.upgradable} | ${p.resolvable} | ${p.latest} |`
    );
  }
  lines.push("");
  return lines.join("\n");
}

// Register the pubspec-outdated command: collect the out-of-date packages, write a
// dated report under reports/, and open it ONLY when something is behind (an
// all-current project stays quiet, the no-noise rule the scheduled rituals follow).
// The folder is the command arg (a scheduled recipe stores its path) or the first
// workspace folder. Returns the written report path so a routine summary links it.
export function registerPubspecOutdatedCommand(
  context: vscode.ExtensionContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "saropaWorkspace.recipe.pubspecOutdated",
      (folderPath?: unknown) => runPubspecOutdated(folderPath)
    )
  );
}

async function runPubspecOutdated(
  folderPath?: unknown
): Promise<string | undefined> {
  const root =
    typeof folderPath === "string" && folderPath.length > 0
      ? folderPath
      : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    vscode.window.showWarningMessage(l10n("deps.noFolder"));
    return undefined;
  }

  let stale: StalePackage[];
  try {
    stale = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: l10n("deps.collecting") },
      () => collectOutdated(root)
    );
  } catch (err) {
    // A failed resolution must not masquerade as "all current"; report it plainly.
    vscode.window.showErrorMessage(
      l10n("deps.failed", { error: err instanceof Error ? err.message : String(err) })
    );
    return undefined;
  }

  const relative = expandRecipeTokens(reportRelativePath("pubspec_outdated"));
  const file = path.join(root, ...relative.split("/"));
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buildOutdatedMarkdown(stale), "utf8");
  } catch (err) {
    vscode.window.showErrorMessage(
      l10n("deps.failed", { error: err instanceof Error ? err.message : String(err) })
    );
    return undefined;
  }

  // Open and toast only when there is something to act on; a clean run is silent
  // save for the returned path the summary links.
  if (stale.length > 0) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    await vscode.window.showTextDocument(doc, { preview: false });
    vscode.window.showInformationMessage(
      l10n("deps.done", { count: stale.length })
    );
  }
  return file;
}
