import * as vscode from "vscode";
import * as path from "path";
import { ScanMode, ScanOptions, ScanReport, scanOutliers } from "./hygieneScan";
import { expandRecipeTokens } from "./runner";
import { ShortcutStore } from "../model/shortcutStore";
import { SharedShortcut } from "../import/shareLink";
import { l10n } from "../i18n/l10n";

// Commands for the workspace hygiene scanner (recipe book #63). Three entry points:
//   - runHygieneScan: the whole-project scan configured by saropaWorkspace.hygiene.*
//     settings (the original single scan).
//   - newHygieneScan: a wizard that captures a scope + mode + ceilings and SAVES them
//     as a reusable shortcut with an auto-generated name (the per-instance scan
//     follow-up).
//   - runSavedHygieneScan: runs a saved scan shortcut's stored config (invoked by that
//     shortcut's command action, manually or on a schedule).
// All three share one execute-and-report path, so a saved scan reports identically to
// the settings scan: a structured dated JSON report plus a sticky toast.
const CONFIG = "saropaWorkspace.hygiene";

export function registerHygieneCommands(
  context: vscode.ExtensionContext,
  store: ShortcutStore
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("saropaWorkspace.recipe.runHygieneScan", () =>
      runHygieneScan()
    ),
    vscode.commands.registerCommand("saropaWorkspace.recipe.newHygieneScan", () =>
      newHygieneScan(store)
    ),
    vscode.commands.registerCommand(
      "saropaWorkspace.recipe.runSavedHygieneScan",
      (config?: unknown) => runSavedHygieneScan(config)
    )
  );
}

// The whole-project scan driven by the hygiene.* settings.
function readOptions(): ScanOptions | undefined {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    return undefined;
  }
  const cfg = vscode.workspace.getConfiguration(CONFIG);
  const mode = cfg.get<ScanMode>("mode", "both");
  const fileMaxBytes = cfg.get<number>("fileMaxMB", 100) * 1024 * 1024;
  const folderMaxBytes = cfg.get<number>("folderMaxMB", 1024) * 1024 * 1024;
  const fileMinMB = cfg.get<number>("fileMinMB", 0);
  return {
    roots: folders.map((f) => f.uri.fsPath),
    mode,
    fileMaxBytes,
    folderMaxBytes,
    fileMinBytes: fileMinMB > 0 ? fileMinMB * 1024 * 1024 : undefined,
    respectGitignore: cfg.get<boolean>("respectGitignore", true),
    excludeGlobs: cfg.get<string[]>("exclude", []),
  };
}

async function runHygieneScan(): Promise<void> {
  const options = readOptions();
  if (!options) {
    vscode.window.showWarningMessage(l10n("hygiene.noFolder"));
    return;
  }
  await executeAndReport(options);
}

// Run a saved scan shortcut's stored config. The shortcut's command action carries
// the ScanOptions verbatim in commandArgs[0]; validate the shape defensively (it came
// from disk and could be hand-edited) before scanning.
async function runSavedHygieneScan(config?: unknown): Promise<void> {
  const options = asScanOptions(config);
  if (!options) {
    vscode.window.showWarningMessage(l10n("hygiene.savedInvalid"));
    return;
  }
  await executeAndReport(options);
}

// Narrow an untyped persisted value to ScanOptions, filling any missing field with a
// safe default rather than rejecting an older/partial saved config outright.
function asScanOptions(value: unknown): ScanOptions | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const v = value as Record<string, unknown>;
  const roots = Array.isArray(v.roots)
    ? v.roots.filter((r): r is string => typeof r === "string")
    : [];
  if (roots.length === 0) {
    return undefined;
  }
  const mode: ScanMode =
    v.mode === "empty" || v.mode === "oversized" || v.mode === "both"
      ? v.mode
      : "both";
  return {
    roots,
    mode,
    fileMaxBytes: numOr(v.fileMaxBytes, 100 * 1024 * 1024),
    folderMaxBytes: numOr(v.folderMaxBytes, 1024 * 1024 * 1024),
    fileMinBytes: typeof v.fileMinBytes === "number" ? v.fileMinBytes : undefined,
    respectGitignore: v.respectGitignore !== false,
    excludeGlobs: Array.isArray(v.excludeGlobs)
      ? v.excludeGlobs.filter((g): g is string => typeof g === "string")
      : [],
  };
}

function numOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

// The wizard: capture a scope folder, a mode, and (for an oversized scan) the
// ceilings, generate a descriptive name, and save it as a command-action shortcut that
// re-runs this exact scan. Saved to project scope when a folder is open, else global.
async function newHygieneScan(store: ShortcutStore): Promise<void> {
  const root = await pickScope();
  if (!root) {
    return;
  }
  const mode = await pickMode();
  if (!mode) {
    return;
  }

  let fileMaxBytes = 100 * 1024 * 1024;
  let folderMaxBytes = 1024 * 1024 * 1024;
  if (mode === "oversized" || mode === "both") {
    const fileMB = await pickNumber(
      l10n("hygiene.new.fileCeilingPrompt"),
      100
    );
    if (fileMB === undefined) {
      return;
    }
    const folderMB = await pickNumber(
      l10n("hygiene.new.folderCeilingPrompt"),
      1024
    );
    if (folderMB === undefined) {
      return;
    }
    fileMaxBytes = fileMB * 1024 * 1024;
    folderMaxBytes = folderMB * 1024 * 1024;
  }

  const options: ScanOptions = {
    roots: [root],
    mode,
    fileMaxBytes,
    folderMaxBytes,
    respectGitignore: true,
    excludeGlobs: [],
  };
  const name = buildScanName(root, options);
  const shortcut: SharedShortcut = {
    // v is the share-link envelope version; importShortcut reads the fields below, not v.
    v: 1,
    label: name,
    action: {
      kind: "command",
      commandId: "saropaWorkspace.recipe.runSavedHygieneScan",
      commandArgs: [options],
    },
    icon: "search",
    color: "charts.blue",
  };
  const scope = (vscode.workspace.workspaceFolders?.length ?? 0) > 0
    ? "project"
    : "global";
  const added = await store.importShortcut(shortcut, scope);
  if (added) {
    vscode.window.showInformationMessage(l10n("hygiene.new.saved", { name }));
  } else {
    vscode.window.showWarningMessage(l10n("hygiene.new.notSaved"));
  }
}

// Offer each workspace folder plus a "choose a folder" picker as the scan scope.
async function pickScope(): Promise<string | undefined> {
  interface ScopeItem extends vscode.QuickPickItem {
    root?: string;
    browse?: boolean;
  }
  const folders = vscode.workspace.workspaceFolders ?? [];
  const items: ScopeItem[] = folders.map((f) => ({
    label: `$(root-folder) ${f.name}`,
    description: f.uri.fsPath,
    root: f.uri.fsPath,
  }));
  items.push({ label: l10n("hygiene.new.browse"), browse: true });
  const pick = await vscode.window.showQuickPick(items, {
    title: l10n("hygiene.new.title"),
    placeHolder: l10n("hygiene.new.scopePlaceholder"),
  });
  if (!pick) {
    return undefined;
  }
  if (pick.browse) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: l10n("hygiene.new.browseOpen"),
      title: l10n("hygiene.new.title"),
    });
    return picked?.[0]?.fsPath;
  }
  return pick.root;
}

async function pickMode(): Promise<ScanMode | undefined> {
  interface ModeItem extends vscode.QuickPickItem {
    mode: ScanMode;
  }
  const items: ModeItem[] = [
    { label: l10n("hygiene.new.mode.both"), mode: "both" },
    { label: l10n("hygiene.new.mode.empty"), mode: "empty" },
    { label: l10n("hygiene.new.mode.oversized"), mode: "oversized" },
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title: l10n("hygiene.new.title"),
    placeHolder: l10n("hygiene.new.modePlaceholder"),
  });
  return pick?.mode;
}

async function pickNumber(
  prompt: string,
  defaultValue: number
): Promise<number | undefined> {
  const entered = await vscode.window.showInputBox({
    title: l10n("hygiene.new.title"),
    prompt,
    value: String(defaultValue),
    validateInput: (input) => {
      const n = Number(input.trim());
      return Number.isFinite(n) && n > 0 ? undefined : l10n("hygiene.new.numberInvalid");
    },
  });
  if (entered === undefined) {
    return undefined;
  }
  return Number(entered.trim());
}

// A descriptive, auto-generated name: "Hygiene: <folder> (oversized, files >100MB)".
function buildScanName(root: string, options: ScanOptions): string {
  const scopeName = path.basename(root) || root;
  const parts: string[] = [options.mode];
  if (options.mode !== "empty") {
    parts.push(`files >${Math.round(options.fileMaxBytes / 1024 / 1024)}MB`);
  }
  return l10n("hygiene.new.name", { scope: scopeName, detail: parts.join(", ") });
}

// Run a scan, write its dated report, and announce it. Shared by every entry point so
// the report shape and the sticky toast are identical.
async function executeAndReport(options: ScanOptions): Promise<void> {
  const report = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: l10n("hygiene.scanning") },
    () => scanOutliers(options)
  );
  const reportUri = await writeReport(report);
  if (!reportUri) {
    return;
  }
  announce(report, reportUri);
}

// Write the report to reports/<date>/<date_time>_filereport.json under the first
// workspace folder (the dated convention #63 specifies). When no folder is open (a
// global saved scan over an external path), fall back to the scan root.
async function writeReport(report: ScanReport): Promise<vscode.Uri | undefined> {
  const base =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? report.scope[0];
  if (!base) {
    return undefined;
  }
  const relative = expandRecipeTokens("reports/$date/$stamp_filereport.json");
  const file = path.join(base, ...relative.split("/"));
  try {
    const fs = await import("fs/promises");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(report, null, 2), "utf8");
    return vscode.Uri.file(file);
  } catch (err) {
    vscode.window.showErrorMessage(
      l10n("hygiene.failed", { error: err instanceof Error ? err.message : String(err) })
    );
    return undefined;
  }
}

// A non-auto-dismissing toast for a scan that found something (a notification with an
// action button persists until acted on), naming the issue count with Open report. A
// clean scan reports transiently and still wrote the report.
function announce(report: ScanReport, reportUri: vscode.Uri): void {
  const count = report.findings.length;
  if (count === 0) {
    vscode.window.showInformationMessage(
      l10n("hygiene.clean", { files: report.filesScanned, dirs: report.dirsScanned })
    );
    return;
  }
  const open = l10n("hygiene.openReport");
  const more = report.truncated ? l10n("hygiene.truncated", { max: count }) : "";
  void vscode.window
    .showWarningMessage(l10n("hygiene.found", { count, more }), open)
    .then((choice) => {
      if (choice === open) {
        void vscode.window.showTextDocument(reportUri, { preview: false });
      }
    });
}
