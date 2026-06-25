import * as vscode from "vscode";
import * as path from "path";
import { ScanMode, ScanOptions, ScanReport, scanOutliers } from "./hygieneScan";
import { expandRecipeTokens } from "./runner";
import { l10n } from "../i18n/l10n";

// Commands for the workspace hygiene scanner (recipe book #63). One command runs a
// scan of the whole project (the first slice — a single configurable scan via
// settings; per-instance scan pins with auto-generated names are a follow-up),
// writes a structured dated JSON report, and raises a sticky toast naming the issue
// count with an Open-report action.
const CONFIG = "saropaWorkspace.hygiene";

export function registerHygieneCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("saropaWorkspace.recipe.runHygieneScan", () =>
      runHygieneScan()
    )
  );
}

function readOptions(): ScanOptions | undefined {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    return undefined;
  }
  const cfg = vscode.workspace.getConfiguration(CONFIG);
  const mode = cfg.get<ScanMode>("mode", "both");
  const fileMaxBytes = cfg.get<number>("fileMaxMB", 100) * 1024 * 1024;
  const folderMaxBytes = cfg.get<number>("folderMaxMB", 1024) * 1024 * 1024;
  // A floor of 0 (the default) means "no floor"; only a positive value enables the
  // under-size check, so the common case never flags small-but-valid files.
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
// workspace folder, the dated convention the recipe book specifies (and the same
// $date/$stamp tokens the shell-to-report path uses, so naming stays consistent).
async function writeReport(report: ScanReport): Promise<vscode.Uri | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return undefined;
  }
  const relative = expandRecipeTokens("reports/$date/$stamp_filereport.json");
  const file = path.join(folder.uri.fsPath, ...relative.split("/"));
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

// A non-auto-dismissing toast for a scan that found something (a notification with
// an action button persists until the user acts, which is the "sticky" behavior the
// recipe book asks for), naming the issue count and offering Open report. A clean
// scan reports transiently and still wrote the report.
function announce(report: ScanReport, reportUri: vscode.Uri): void {
  const count = report.findings.length;
  if (count === 0) {
    vscode.window.showInformationMessage(
      l10n("hygiene.clean", { files: report.filesScanned, dirs: report.dirsScanned })
    );
    return;
  }
  const open = l10n("hygiene.openReport");
  // Never imply the report is exhaustive when the finding cap was hit.
  const more = report.truncated ? l10n("hygiene.truncated", { max: count }) : "";
  void vscode.window
    .showWarningMessage(l10n("hygiene.found", { count, more }), open)
    .then((choice) => {
      if (choice === open) {
        void vscode.window.showTextDocument(reportUri, { preview: false });
      }
    });
}
