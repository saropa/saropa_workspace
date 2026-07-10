import * as vscode from "vscode";
import * as path from "path";
import {
  BloatOptions,
  BloatReport,
  DEFAULT_FILE_COUNT_CEILING,
  DEFAULT_FOLDER_CEILING_BYTES,
  humanBytes,
  measureDirectory,
  renderBloatReport,
  scanBloat,
} from "./bloatScan";
import { expandRecipeTokens, reportRelativePath } from "./runner";
import { l10n } from "../i18n/l10n";

// Commands for the workspace bloat scan (recipe book #63). The scan measures the
// directories VS Code crawls on folder-open and the test-downloader watcher guard,
// writes a dated Markdown report, and (only when a finding crosses a ceiling) opens
// it and raises a sticky toast. A clean scan is silent — the no-noise rule the
// scheduled rituals follow. Remediation (Guard / Prune) is registered alongside.
const CONFIG = "saropaWorkspace.hygiene";

// Wire the three bloat-scan commands (run the scan, guard a project's watcher
// excludes, prune the .vscode-test cache) into the extension's disposables so they are
// unregistered on deactivation like every other command.
export function registerBloatCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("saropaWorkspace.recipe.runBloatScan", () =>
      runBloatScan()
    ),
    vscode.commands.registerCommand(
      "saropaWorkspace.recipe.guardProject",
      (root?: unknown, glob?: unknown) => guardProject(asString(root), asString(glob))
    ),
    vscode.commands.registerCommand(
      "saropaWorkspace.recipe.pruneVscodeTest",
      (root?: unknown) => pruneVscodeTest(asString(root))
    )
  );
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// Build the per-PROJECT root list. Each open workspace folder is one project. A
// parent root configured in hygiene.roots (e.g. D:\src) is EXPANDED to its immediate
// child directories, so a cross-project "morning sweep" covers every sibling project
// rather than treating the parent as one giant tree (§2.4). Deduped by absolute path.
async function buildProjectRoots(): Promise<string[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const roots = new Set<string>(folders.map((f) => f.uri.fsPath));

  const parents = vscode.workspace.getConfiguration(CONFIG).get<string[]>("roots", []);
  const fs = await import("fs/promises");
  for (const parent of parents) {
    try {
      const entries = await fs.readdir(parent, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          roots.add(path.join(parent, entry.name));
        }
      }
    } catch {
      // An unreadable / missing configured root is skipped rather than failing the scan.
    }
  }
  return [...roots];
}

function readCeilings(): Pick<BloatOptions, "folderCeilingBytes" | "fileCountCeiling"> {
  const cfg = vscode.workspace.getConfiguration(CONFIG);
  const folderMB = cfg.get<number>("bloat.folderCeilingMB", DEFAULT_FOLDER_CEILING_BYTES / 1024 / 1024);
  const fileCount = cfg.get<number>("bloat.fileCountCeiling", DEFAULT_FILE_COUNT_CEILING);
  return {
    folderCeilingBytes: folderMB > 0 ? folderMB * 1024 * 1024 : DEFAULT_FOLDER_CEILING_BYTES,
    fileCountCeiling: fileCount > 0 ? fileCount : DEFAULT_FILE_COUNT_CEILING,
  };
}

async function runBloatScan(): Promise<void> {
  const roots = await buildProjectRoots();
  if (roots.length === 0) {
    vscode.window.showWarningMessage(l10n("bloat.noFolder"));
    return;
  }
  const options: BloatOptions = { roots, ...readCeilings() };
  const report = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: l10n("bloat.scanning") },
    () => scanBloat(options)
  );
  const reportUri = await writeReport(report);
  announce(report, reportUri);
}

// Write reports/<stamp>_workspace_hygiene.md under the first workspace folder (or the
// first scanned root when no folder is open). Returns the uri, or undefined on write
// failure (already surfaced to the user).
async function writeReport(report: BloatReport): Promise<vscode.Uri | undefined> {
  const base = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? report.roots[0];
  if (!base) {
    return undefined;
  }
  const relative = expandRecipeTokens(reportRelativePath("workspace_hygiene"));
  const file = path.join(base, ...relative.split("/"));
  try {
    const fs = await import("fs/promises");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, renderBloatReport(report, new Date().toLocaleString()), "utf8");
    return vscode.Uri.file(file);
  } catch (err) {
    vscode.window.showErrorMessage(
      l10n("bloat.failed", { error: err instanceof Error ? err.message : String(err) })
    );
    return undefined;
  }
}

// Visible outcome. A clean scan reports transiently (the report is still written for
// the trend). A scan with findings raises a sticky warning naming the count, with
// Open report and — when exactly one project is implicated and unguarded — a one-tap
// Guard action.
function announce(report: BloatReport, reportUri: vscode.Uri | undefined): void {
  if (report.findings.length === 0) {
    vscode.window.showInformationMessage(
      l10n("bloat.clean", { count: report.perRoot.length })
    );
    return;
  }
  const open = l10n("bloat.openReport");
  // Offer a one-tap Guard when every finding shares one root — the common single-
  // project case; a multi-project sweep routes the user to the report instead.
  const roots = new Set(report.findings.map((f) => f.root));
  const single = roots.size === 1 ? [...roots][0] : undefined;
  const guard = single ? l10n("bloat.guardAction") : undefined;
  const actions = guard ? [open, guard] : [open];

  void vscode.window
    .showWarningMessage(l10n("bloat.found", { count: report.findings.length }), ...actions)
    .then((choice) => {
      if (choice === open && reportUri) {
        void vscode.window.showTextDocument(reportUri, { preview: false });
      } else if (choice === guard && single) {
        // Guard every flagged glob for this one project in a single edit.
        const globs = report.findings
          .filter((f) => f.root === single)
          .map((f) => f.watcherGlob);
        void guardProject(single, undefined, globs);
      }
    });
}

// --- remediation (current project only) --------------------------------

// Merge files.watcherExclude entries into a project's .vscode/settings.json so VS
// Code stops crawling the flagged dirs. Scoped to ONE project; merges into the
// existing files.watcherExclude rather than overwriting it. Applied only to the open
// workspace — a finding in another (swept) project reports its command but is never
// silently edited (the workspace's standing "another project is handed back" rule).
async function guardProject(
  root: string | undefined,
  glob: string | undefined,
  globs?: string[]
): Promise<void> {
  if (!root) {
    return;
  }
  // Editing another project's settings is out of scope: only the open workspace may
  // be guarded automatically.
  if (!isOpenWorkspace(root)) {
    vscode.window.showWarningMessage(
      l10n("bloat.guardForeign", { project: path.basename(root) })
    );
    return;
  }
  const toAdd = (globs ?? (glob ? [glob] : [])).filter((g) => g.length > 0);
  if (toAdd.length === 0) {
    return;
  }
  const fs = await import("fs/promises");
  const settingsDir = path.join(root, ".vscode");
  const settingsPath = path.join(settingsDir, "settings.json");

  let settings: Record<string, unknown> = {};
  try {
    const text = await fs.readFile(settingsPath, "utf8");
    settings = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Missing or unparseable: a JSONC settings file we cannot safely round-trip is
    // not overwritten — bail with guidance rather than clobbering hand-edited config.
    const existing = await pathExists(settingsPath);
    if (existing) {
      vscode.window.showWarningMessage(l10n("bloat.guardUnparseable", { path: settingsPath }));
      return;
    }
  }

  const current =
    settings["files.watcherExclude"] && typeof settings["files.watcherExclude"] === "object"
      ? (settings["files.watcherExclude"] as Record<string, unknown>)
      : {};
  let added = 0;
  for (const g of toAdd) {
    if (current[g] !== true) {
      current[g] = true;
      added++;
    }
  }
  settings["files.watcherExclude"] = current;

  try {
    await fs.mkdir(settingsDir, { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
  } catch (err) {
    vscode.window.showErrorMessage(
      l10n("bloat.guardFailed", { error: err instanceof Error ? err.message : String(err) })
    );
    return;
  }
  vscode.window.showInformationMessage(
    added > 0
      ? l10n("bloat.guarded", { count: added, project: path.basename(root) })
      : l10n("bloat.guardedNoop", { project: path.basename(root) })
  );
}

// Confirm-gated delete of a project's .vscode-test cache, naming the size reclaimed.
// Current workspace only.
async function pruneVscodeTest(root: string | undefined): Promise<void> {
  const target =
    root ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!target) {
    return;
  }
  if (!isOpenWorkspace(target)) {
    vscode.window.showWarningMessage(
      l10n("bloat.guardForeign", { project: path.basename(target) })
    );
    return;
  }
  const cacheDir = path.join(target, ".vscode-test");
  const fs = await import("fs/promises");
  try {
    const stat = await fs.stat(cacheDir);
    if (!stat.isDirectory()) {
      vscode.window.showInformationMessage(l10n("bloat.pruneAbsent"));
      return;
    }
  } catch {
    vscode.window.showInformationMessage(l10n("bloat.pruneAbsent"));
    return;
  }
  // Name the exact size reclaimed in the confirm — a delete prompt the user can tie
  // to a concrete number, not a vague "clear the cache".
  const { bytes } = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: l10n("bloat.pruneMeasuring") },
    () => measureDirectory(cacheDir)
  );
  const confirm = l10n("bloat.pruneConfirm");
  const choice = await vscode.window.showWarningMessage(
    l10n("bloat.pruneMessage", { project: path.basename(target), size: humanBytes(bytes) }),
    { modal: true },
    confirm
  );
  if (choice !== confirm) {
    return;
  }
  try {
    await fs.rm(cacheDir, { recursive: true, force: true });
  } catch (err) {
    vscode.window.showErrorMessage(
      l10n("bloat.pruneFailed", { error: err instanceof Error ? err.message : String(err) })
    );
    return;
  }
  vscode.window.showInformationMessage(
    l10n("bloat.pruned", { project: path.basename(target), size: humanBytes(bytes) })
  );
}

function isOpenWorkspace(root: string): boolean {
  const folders = vscode.workspace.workspaceFolders ?? [];
  return folders.some((f) => path.resolve(f.uri.fsPath) === path.resolve(root));
}

async function pathExists(p: string): Promise<boolean> {
  try {
    const fs = await import("fs/promises");
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}
