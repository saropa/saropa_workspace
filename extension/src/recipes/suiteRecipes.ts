import * as vscode from "vscode";
import { PinAction } from "../model/pin";
import { RecipeResult } from "./detectors";

// Saropa Suite integration recipes (recipe book section F, 36-59). Each detected
// sibling Saropa tool contributes a set of pins that drive it — its VS Code
// commands, its debug URLs, its CLIs, its reports. All carry group: "suite" so the
// store seeds them into the dedicated "Saropa Suite" folder rather than the generic
// "Recipes" group.
//
// Detection is folder-root cheap (a few manifest reads) plus an extension-presence
// check; never a recursive crawl. A recipe is only suggested when the thing it
// drives is actually present:
//   - command pins (the other extension's command ids) are seeded only when that
//     extension is installed, so the command exists when run;
//   - CLI / shell pins are seeded only when the package is a project dependency;
//   - file pins are seeded only when the target file exists.
// So a subgroup never offers a command for a tool you have not installed. (The
// runner still degrades gracefully if a command is unavailable at run time.)

const LINTS_EXT = "saropa.saropa-lints";
const DRIFT_EXT = "saropa.drift-viewer";
const LOG_EXT = "saropa.saropa-log-capture";

async function readText(
  folder: vscode.WorkspaceFolder,
  ...segments: string[]
): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(folder.uri, ...segments)
    );
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return undefined;
  }
}

async function exists(
  folder: vscode.WorkspaceFolder,
  ...segments: string[]
): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, ...segments));
    return true;
  } catch {
    return false;
  }
}

function extensionInstalled(id: string): boolean {
  return vscode.extensions.getExtension(id) !== undefined;
}

function command(commandId: string): PinAction {
  return { kind: "command", commandId };
}

function url(target: string): PinAction {
  return { kind: "url", url: target };
}

// A shell action run visibly in the integrated terminal, in the folder root.
function shell(folder: vscode.WorkspaceFolder, commandLine: string): PinAction {
  return {
    kind: "shell",
    shellCommand: commandLine,
    cwd: folder.uri.fsPath,
    useIntegratedTerminal: true,
  };
}

export async function detectSuiteRecipes(
  folder: vscode.WorkspaceFolder
): Promise<RecipeResult[]> {
  const out: RecipeResult[] = [];
  await pushLints(folder, out);
  await pushDrift(folder, out);
  await pushLogCapture(folder, out);
  return out;
}

// --- Saropa Lints (static analysis) ------------------------------------

async function pushLints(
  folder: vscode.WorkspaceFolder,
  out: RecipeResult[]
): Promise<void> {
  const pubspec = (await readText(folder, "pubspec.yaml")) ?? "";
  const analysis = (await readText(folder, "analysis_options.yaml")) ?? "";
  const violationsPath = ".saropa_lints/violations.json"; // under reports/
  const hasViolations = await exists(folder, "reports", ".saropa_lints", "violations.json");
  // The Dart package is present as a dependency or wired into analysis options.
  const hasPackage =
    /saropa_lints/.test(pubspec) || /saropa_lints/.test(analysis) || hasViolations;
  const hasExt = extensionInstalled(LINTS_EXT);
  if (!hasPackage && !hasExt) {
    return;
  }
  const color = "charts.blue";

  // Command pins — only when the extension that owns these commands is installed.
  if (hasExt) {
    out.push(suite("suite.lints.analysis", "Run lint analysis", "checklist", color, command("saropaLints.runAnalysis")));
    out.push(suite("suite.lints.health", "Open Code Health dashboard", "graph", color, command("saropaLints.openProjectVibrancyReport")));
    out.push(suite("suite.lints.config", "Manage rule packs", "settings-gear", color, command("saropaLints.openConfigDashboard")));
    out.push(suite("suite.lints.packages", "Open Package Vibrancy", "package", color, command("saropaLints.openPackageVibrancy")));
    out.push(suite("suite.lints.owasp", "Export OWASP report", "shield", color, command("saropaLints.exportOwaspReport")));
  }

  // CLI pins — only when the package is in the project (the CLIs run from it).
  if (hasPackage) {
    out.push(suite("suite.lints.crossfile", "Lints: cross-file audit", "references", color, shell(folder, "dart run saropa_lints:cross_file report")));
    out.push(suite("suite.lints.baseline", "Lints: refresh baseline", "history", color, shell(folder, "dart run saropa_lints:baseline --update")));
    out.push(suite("suite.lints.gate", "Lints: quality gate", "pass", color, shell(folder, `dart run saropa_lints:quality_gate --report reports/${violationsPath}`)));
  }

  // File pin — only when the report has actually been written.
  if (hasViolations) {
    out.push({
      recipeId: "suite.lints.violations",
      label: "Open the violations report",
      icon: "warning",
      color,
      group: "suite",
      filePath: `reports/${violationsPath}`,
    });
  }
}

// --- Saropa Drift Advisor (runtime DB inspector) -----------------------

async function pushDrift(
  folder: vscode.WorkspaceFolder,
  out: RecipeResult[]
): Promise<void> {
  const pubspec = (await readText(folder, "pubspec.yaml")) ?? "";
  const hasPackage = /saropa_drift_advisor/.test(pubspec);
  const hasExt = extensionInstalled(DRIFT_EXT);
  if (!hasPackage && !hasExt) {
    return;
  }
  const color = "charts.purple";

  // Command pins — gated on the Drift Advisor extension being installed.
  if (hasExt) {
    out.push(suite("suite.drift.browser", "Open Drift Advisor (browser)", "browser", color, command("driftViewer.openInBrowser")));
    out.push(suite("suite.drift.sql", "Open the SQL Notebook", "notebook", color, command("driftViewer.openSqlNotebook")));
    out.push(suite("suite.drift.scan", "Scan Dart schema (offline)", "search", color, command("driftViewer.scanDartSchemaDefinitions")));
    out.push(suite("suite.drift.diagram", "Open the schema diagram", "type-hierarchy", color, command("driftViewer.schemaDiagram")));
    out.push(suite("suite.drift.report", "Export a portable DB report", "output", color, command("driftViewer.exportReport")));
    out.push(suite("suite.drift.forward", "Forward the emulator port", "plug", color, command("driftViewer.forwardPortAndroid")));
  }

  // The debug server's merged issues feed; useful whenever the package is used.
  if (hasPackage || hasExt) {
    out.push(suite("suite.drift.issues", "Open the DB issues feed", "link-external", color, url("http://127.0.0.1:8642/api/issues")));
  }
}

// --- Saropa Log Capture (debug-output recorder) ------------------------

async function pushLogCapture(
  folder: vscode.WorkspaceFolder,
  out: RecipeResult[]
): Promise<void> {
  const hasExt = extensionInstalled(LOG_EXT);
  // The extension owns every command below, so absent it there is nothing to seed.
  if (!hasExt) {
    return;
  }
  const color = "charts.orange";
  out.push(suite("suite.log.open", "Open a capture log", "output", color, command("saropaLogCapture.openLogFile")));
  out.push(suite("suite.log.search", "Search all logs", "search", color, command("saropaLogCapture.searchLogs")));
  out.push(suite("suite.log.flowmap", "Export a session Flow Map", "git-merge", color, command("saropaLogCapture.exportFlowMap")));
  out.push(suite("suite.log.compare", "Compare two sessions", "diff", color, command("saropaLogCapture.compareSessions")));
  out.push(suite("suite.log.signals", "Show the Signals panel", "lightbulb", color, command("saropaLogCapture.showSignals")));
  out.push(suite("suite.log.start", "Start capture", "record", color, command("saropaLogCapture.start")));
}

// Build a suite-group recipe result from its parts (every suite recipe shares the
// group + the action-carrying shape; only file pins differ, built inline above).
function suite(
  recipeId: string,
  label: string,
  icon: string,
  color: string,
  action: PinAction
): RecipeResult {
  return { recipeId, label, icon, color, group: "suite", action };
}
