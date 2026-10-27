import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { promisify } from "util";
import { execFile as execFileCb } from "child_process";
import { expandRecipeTokens, reportRelativePath } from "./runner";
import { openReport } from "./reportOpen";
import { l10n } from "../i18n/l10n";
import { findNewestReport, readEvidenceSettings } from "../commands/boardRecipeEvidence";
import { readFeedReport } from "../board/recipeEvidence";
import { READINESS_FEEDS, buildReadinessMarkdown, combineReadiness, readinessSummaryLine } from "../board/releaseReadiness";
import { MANIFESTS, Stated, badgeVersions, buildChangelogMarkdown, buildVersionMarkdown, cargoLockVersion, changelogSummaryLine, checkChangelog, checkVersions, cleanRelativeFile, firstManifestVersion, packageLockVersions, topChangelogVersion, versionSummaryLine } from "./versionChecks";
import { BrokenLink, NEW_FILE_DAYS, SizedFile, bigFilesSummaryLine, branchAgeSummaryLine, buildBigFilesMarkdown, buildBranchAgeMarkdown, buildLinksMarkdown, clampBranchDays, clampLargeKb, extractLinks, linksSummaryLine, overLimit, parseBranchAges, parseZNames } from "./repoChecks";

// The small read-only report recipes: Release readiness summary, Changelog check, Version
// consistency, Stale branch age, Large new file watch and Broken links in docs. Each one
// reads files or asks git for a listing, writes one dated report under reports/ that starts
// with the summary line the Release Board reads, and changes nothing else. A report is opened
// only when it found something. Each takes the project folder as its first argument.

const execFile = promisify(execFileCb);
const GIT_TIMEOUT_MS = 30_000;
const MAX_GIT_BUFFER = 32 * 1024 * 1024;
// Files larger than this are not read as text.
const MAX_READ_BYTES = 1024 * 1024;
// Bounds for the scans, so a huge repository cannot make a run slow.
const MAX_NEW_FILES = 5000;
const MAX_DOCS = 2000;
const MAX_LINKS = 50_000;
const STAT_BATCH = 64;

function rootOf(folderPath?: unknown): string | undefined {
  return typeof folderPath === "string" && folderPath.length > 0 ? folderPath : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

// Standard output of a git command, or undefined when git failed or is missing.
async function git(root: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFile("git", args, { cwd: root, maxBuffer: MAX_GIT_BUFFER, timeout: GIT_TIMEOUT_MS });
    return stdout;
  } catch {
    return undefined;
  }
}

// A file under the project folder as text, or undefined when it is missing, a link, too large or unreadable.
async function readSmall(root: string, rel: string): Promise<string | undefined> {
  try {
    const file = path.join(root, ...rel.split("/"));
    // lstat: a link is never followed, so a read cannot leave the folder.
    const st = await fs.lstat(file);
    return st.isFile() && st.size <= MAX_READ_BYTES ? await fs.readFile(file, "utf8") : undefined;
  } catch {
    return undefined;
  }
}

// Writes the report with its summary line first and opens it when `attention` is set.
async function writeReport(root: string, suffix: string, summaryLine: string, markdown: string, attention: boolean): Promise<string | undefined> {
  const file = path.join(root, ...expandRecipeTokens(reportRelativePath(suffix)).split("/"));
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${summaryLine}\n${markdown}`, "utf8");
  } catch (err) {
    vscode.window.showErrorMessage(l10n("checks.failed", { error: err instanceof Error ? err.message : String(err) }));
    return undefined;
  }
  if (attention) {
    await openReport(file);
  }
  return file;
}

const stamp = (): string => new Date().toLocaleString();

// ---- Release readiness summary ----

async function runReadiness(folderPath?: unknown): Promise<string | undefined> {
  const root = rootOf(folderPath);
  if (!root) {
    vscode.window.showWarningMessage(l10n("checks.noFolder"));
    return undefined;
  }
  const now = Date.now();
  const maxAgeMs = readEvidenceSettings().maxAgeMs;
  const uri = vscode.Uri.file(root);
  const reads: Parameters<typeof combineReadiness>[0] = {};
  for (const feed of READINESS_FEEDS) {
    reads[feed] = readFeedReport(feed, await findNewestReport(uri, feed), now, maxAgeMs);
  }
  const c = combineReadiness(reads);
  return writeReport(root, "release_readiness", readinessSummaryLine(c, now), buildReadinessMarkdown(c, stamp()), c.result === "fail");
}

// ---- Changelog check and Version consistency ----

async function manifestFiles(root: string): Promise<Array<{ file: string; text: string }>> {
  const out: Array<{ file: string; text: string }> = [];
  for (const file of MANIFESTS) {
    const text = await readSmall(root, file);
    if (text !== undefined) {
      out.push({ file, text });
    }
  }
  return out;
}

async function runChangelogCheck(folderPath?: unknown): Promise<string | undefined> {
  const root = rootOf(folderPath);
  if (!root) {
    vscode.window.showWarningMessage(l10n("checks.noFolder"));
    return undefined;
  }
  const name = cleanRelativeFile(vscode.workspace.getConfiguration("saropaWorkspace.recipes").get<string>("changelogFile", "CHANGELOG.md"), "CHANGELOG.md");
  const text = await readSmall(root, name);
  const c = checkChangelog(text === undefined ? undefined : topChangelogVersion(text), firstManifestVersion(await manifestFiles(root)));
  return writeReport(root, "changelog_check", changelogSummaryLine(c, Date.now()), buildChangelogMarkdown(c, name, stamp()), c.result === "fail");
}

async function runVersionCheck(folderPath?: unknown): Promise<string | undefined> {
  const root = rootOf(folderPath);
  if (!root) {
    vscode.window.showWarningMessage(l10n("checks.noFolder"));
    return undefined;
  }
  const manifest = firstManifestVersion(await manifestFiles(root));
  const others: Stated[] = [];
  const lock = await readSmall(root, "package-lock.json");
  if (lock !== undefined) {
    others.push(...packageLockVersions(lock));
  }
  const cargoLock = manifest?.file === "Cargo.toml" ? await readSmall(root, "Cargo.lock") : undefined;
  if (cargoLock !== undefined) {
    others.push(...cargoLockVersion(cargoLock, manifest?.name));
  }
  for (const readmeName of ["README.md", "Readme.md", "readme.md"]) {
    const readme = await readSmall(root, readmeName);
    if (readme !== undefined) {
      others.push(...badgeVersions(readme));
      break;
    }
  }
  const c = checkVersions(manifest, others);
  return writeReport(root, "version_check", versionSummaryLine(c, Date.now()), buildVersionMarkdown(c, stamp()), c.result === "fail");
}

// ---- Stale branch age ----

// The default branch as a git ref and as a branch name, or undefined when git cannot say.
async function defaultBranch(root: string): Promise<{ ref: string; name: string } | undefined> {
  const head = (await git(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]))?.trim();
  if (head) {
    return { ref: head, name: head.replace(/^origin\//, "") };
  }
  for (const name of ["main", "master"]) {
    if ((await git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]))?.trim()) {
      return { ref: name, name };
    }
  }
  return undefined;
}

async function runBranchAge(folderPath?: unknown): Promise<string | undefined> {
  const root = rootOf(folderPath);
  if (!root) {
    vscode.window.showWarningMessage(l10n("checks.noFolder"));
    return undefined;
  }
  const days = clampBranchDays(vscode.workspace.getConfiguration("saropaWorkspace.recipes").get<number>("staleBranchDays", 30));
  const base = await defaultBranch(root);
  const listing = base ? await git(root, ["for-each-ref", `--no-merged=${base.ref}`, "--format=%(HEAD)%09%(refname:short)%09%(committerdate:unix)%09%(authorname)", "refs/heads"]) : undefined;
  const known = base !== undefined && listing !== undefined;
  const old = known ? parseBranchAges(listing, base.name, Math.floor(Date.now() / 1000), days) : [];
  return writeReport(root, "branch_age", branchAgeSummaryLine(known, old, Date.now()), buildBranchAgeMarkdown(known, old, days, base?.name ?? "", stamp()), old.length > 0);
}

// ---- Large new file watch ----

// Sizes of the regular files named, in small batches. A name that is gone, a link or a
// folder is left out. With `sinceMs`, a file last changed before it is left out too.
async function sizesOf(root: string, names: readonly string[], sinceMs?: number): Promise<SizedFile[]> {
  const out: SizedFile[] = [];
  for (let i = 0; i < names.length; i += STAT_BATCH) {
    const batch = await Promise.all(
      names.slice(i, i + STAT_BATCH).map(async (name) => {
        try {
          const st = await fs.lstat(path.join(root, name));
          return st.isFile() && (sinceMs === undefined || st.mtimeMs >= sinceMs) ? { path: name, bytes: st.size } : undefined;
        } catch {
          return undefined;
        }
      })
    );
    out.push(...batch.filter((f): f is SizedFile => f !== undefined));
  }
  return out;
}

async function runLargeNewFiles(folderPath?: unknown): Promise<string | undefined> {
  const root = rootOf(folderPath);
  if (!root) {
    vscode.window.showWarningMessage(l10n("checks.noFolder"));
    return undefined;
  }
  const limitKb = clampLargeKb(vscode.workspace.getConfiguration("saropaWorkspace.recipes").get<number>("largeNewFileKB", 1024));
  const now = Date.now();
  const since = now - NEW_FILE_DAYS * 86_400_000;
  // --relative: names are relative to the folder and limited to it, also when it is a subfolder of the repository.
  const added = await git(root, ["log", "--relative", `--since=${NEW_FILE_DAYS}.days.ago`, "--diff-filter=A", "--name-only", "-z", "--pretty=format:"]);
  const untracked = await git(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const known = added !== undefined && untracked !== undefined;
  let files: SizedFile[] = [];
  let complete = true;
  if (known) {
    const allCommitted = parseZNames(added);
    const allFresh = parseZNames(untracked);
    complete = allCommitted.length <= MAX_NEW_FILES && allFresh.length <= MAX_NEW_FILES;
    const committed = allCommitted.slice(0, MAX_NEW_FILES);
    const fresh = allFresh.slice(0, MAX_NEW_FILES);
    const seen = new Set(committed);
    files = [...(await sizesOf(root, committed)), ...(await sizesOf(root, fresh.filter((n) => !seen.has(n)), since))];
  }
  const big = overLimit(files, limitKb);
  return writeReport(root, "large_new_files", bigFilesSummaryLine(known, big, now, complete), buildBigFilesMarkdown(known, big, files.length, limitKb, stamp(), complete), big.length > 0);
}

// ---- Broken relative links in documents ----

async function isLink(file: string): Promise<boolean> {
  try {
    return (await fs.lstat(file)).isSymbolicLink();
  } catch {
    return false;
  }
}

async function runBrokenLinks(folderPath?: unknown): Promise<string | undefined> {
  const root = rootOf(folderPath);
  if (!root) {
    vscode.window.showWarningMessage(l10n("checks.noFolder"));
    return undefined;
  }
  const listing = await git(root, ["ls-files", "-z"]);
  const allDocs = listing === undefined ? [] : parseZNames(listing).filter((n) => /\.(?:md|markdown)$/i.test(n));
  const docs = allDocs.slice(0, MAX_DOCS);
  // Anything skipped for a limit (too many documents or links, a document too large or unreadable) makes the result incomplete.
  let complete = allDocs.length <= MAX_DOCS;
  const exists = new Map<string, boolean>();
  const broken: BrokenLink[] = [];
  let checked = 0;
  let linksChecked = 0;
  for (const doc of docs) {
    const text = await readSmall(root, doc);
    if (text === undefined) {
      // A link to another file is left alone on purpose; anything else that could not be read is a gap.
      if (!(await isLink(path.join(root, ...doc.split("/"))))) {
        complete = false;
      }
      continue;
    }
    checked += 1;
    for (const link of extractLinks(text)) {
      const abs = path.resolve(root, path.dirname(doc), link.target);
      const rel = path.relative(root, abs);
      // A link that leaves the project folder is not checked.
      if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
        continue;
      }
      if (linksChecked >= MAX_LINKS) {
        complete = false;
        continue;
      }
      linksChecked += 1;
      let ok = exists.get(abs);
      if (ok === undefined) {
        ok = await fs.lstat(abs).then(() => true, () => false);
        exists.set(abs, ok);
      }
      if (!ok) {
        broken.push({ file: doc, line: link.line, target: link.target });
      }
    }
  }
  return writeReport(root, "broken_links", linksSummaryLine(checked, broken.length, Date.now(), complete), buildLinksMarkdown(checked, linksChecked, broken, stamp(), complete), broken.length > 0);
}

/** Registers the report recipes' commands. Each takes the project folder path as its first argument. */
export function registerReleaseChecksCommands(context: vscode.ExtensionContext): void {
  const reg = (id: string, run: (folderPath?: unknown) => Promise<string | undefined>): void => {
    context.subscriptions.push(vscode.commands.registerCommand(`saropaWorkspace.recipe.${id}`, (folderPath?: unknown) => run(folderPath)));
  };
  reg("releaseReadiness", runReadiness);
  reg("changelogCheck", runChangelogCheck);
  reg("versionCheck", runVersionCheck);
  reg("branchAge", runBranchAge);
  reg("largeNewFiles", runLargeNewFiles);
  reg("brokenLinks", runBrokenLinks);
}
