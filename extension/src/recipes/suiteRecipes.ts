import * as vscode from "vscode";
import { MacroStep, PinAction } from "../model/pin";
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

// Per-tool subgroup keys. Each tool's pins carry its key so the store nests them
// under a "Saropa Lints" / "Drift Advisor" / "Log Capture" subfolder beneath the
// top-level "Saropa Suite" group, instead of every suite pin sitting flat in one
// folder. The boot macro carries none, so it stays directly at the suite top level.
const SUB_LINTS = "lints";
const SUB_DRIFT = "drift";
const SUB_LOG = "log";

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
  pushSuiteMacro(out);
  return out;
}

// Recipe 59 — "Boot the Saropa suite": one macro that brings every detected tool
// up at once. Built from the per-tool boot actions already pushed above, so each
// step reuses a command that was only seeded when its tool's extension is present
// (the command therefore exists at run time). Created only when two or more tools
// contributed a boot step, so a single-tool project never offers a multi-tool
// sequence (the runner still skips any step whose command is unavailable). Reading
// from `out` rather than re-deriving the ext flags keeps the gating in one place.
function pushSuiteMacro(out: RecipeResult[]): void {
  // The canonical "bring this tool up" step per suite tool, keyed by the recipe id
  // whose presence proves the driving command was seeded (extension installed).
  const bootSteps: Array<{ proof: string; step: MacroStep }> = [
    {
      proof: "suite.drift.browser",
      step: { kind: "command", label: "Open Drift Advisor", commandId: "driftViewer.openInBrowser" },
    },
    {
      proof: "suite.lints.analysis",
      step: { kind: "command", label: "Run lint analysis", commandId: "saropaLints.runAnalysis" },
    },
    {
      proof: "suite.log.open",
      step: { kind: "command", label: "Open a capture log", commandId: "saropaLogCapture.openLogFile" },
    },
  ];

  const seeded = new Set(out.map((r) => r.recipeId));
  const steps = bootSteps.filter((b) => seeded.has(b.proof)).map((b) => b.step);
  if (steps.length < 2) {
    return;
  }

  out.push({
    recipeId: "suite.boot",
    label: "Boot the Saropa suite",
    description:
      "A macro that brings every detected Saropa Suite tool up in one action — opening the Drift Advisor inspector, running a Saropa Lints analysis, and opening a capture log, for whichever tools are installed. Offered only when two or more suite tools are detected.",
    icon: "rocket",
    color: "charts.green",
    group: "suite",
    action: { kind: "macro", steps },
  });
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
    out.push(suite("suite.lints.score", "Show Code Health score", "Reads the Saropa Lints public API and reports the exact 0-100 Code Health score with its error/warning/info breakdown — no report file to open. Offers to run the analysis first if no data exists yet. From the saropa.saropa-lints extension.", "pulse", color, command("saropaWorkspace.recipe.lintsHealth"), SUB_LINTS));
    out.push(suite("suite.lints.analysis", "Run lint analysis", "Runs Saropa Lints analysis and writes the violations report. From the saropa.saropa-lints extension.", "checklist", color, command("saropaLints.runAnalysis"), SUB_LINTS));
    out.push(suite("suite.lints.health", "Open Code Health dashboard", "Opens the Saropa Lints Code Health (project vibrancy) dashboard. From the saropa.saropa-lints extension.", "graph", color, command("saropaLints.openProjectVibrancyReport"), SUB_LINTS));
    out.push(suite("suite.lints.config", "Manage rule packs", "Opens the Saropa Lints config dashboard to manage rule packs. From the saropa.saropa-lints extension.", "settings-gear", color, command("saropaLints.openConfigDashboard"), SUB_LINTS));
    out.push(suite("suite.lints.packages", "Open Package Vibrancy", "Opens the Saropa Lints Package Vibrancy view. From the saropa.saropa-lints extension.", "package", color, command("saropaLints.openPackageVibrancy"), SUB_LINTS));
    out.push(suite("suite.lints.owasp", "Export OWASP report", "Exports a Saropa Lints OWASP report. From the saropa.saropa-lints extension.", "shield", color, command("saropaLints.exportOwaspReport"), SUB_LINTS));
  }

  // CLI pins — only when the package is in the project (the CLIs run from it).
  if (hasPackage) {
    out.push(suite("suite.lints.crossfile", "Lints: cross-file audit", "Runs the Saropa Lints cross-file audit CLI, producing an HTML report under reports/. Detected from saropa_lints in the project.", "references", color, shell(folder, "dart run saropa_lints:cross_file report"), SUB_LINTS));
    out.push(suite("suite.lints.baseline", "Lints: refresh baseline", "Refreshes the Saropa Lints baseline so existing violations are suppressed going forward. Detected from saropa_lints in the project.", "history", color, shell(folder, "dart run saropa_lints:baseline --update"), SUB_LINTS));
    out.push(suite("suite.lints.gate", "Lints: quality gate", "Runs the Saropa Lints CI-style quality gate against the violations report. Detected from saropa_lints in the project.", "pass", color, shell(folder, `dart run saropa_lints:quality_gate --report reports/${violationsPath}`), SUB_LINTS));
  }

  // File pin — only when the report has actually been written.
  if (hasViolations) {
    out.push({
      recipeId: "suite.lints.violations",
      label: "Open the violations report",
      description: "Opens the Saropa Lints violations report file. Offered only once the report has been written under reports/.saropa_lints/.",
      icon: "warning",
      color,
      group: "suite",
      subGroup: SUB_LINTS,
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
    out.push(suite("suite.drift.browser", "Open Drift Advisor (browser)", "Opens the Drift Advisor DB inspector in the browser. Pairs with an active debug session (server on 8642). From the saropa.drift-viewer extension.", "browser", color, command("driftViewer.openInBrowser"), SUB_DRIFT));
    out.push(suite("suite.drift.sql", "Open the SQL Notebook", "Opens the Drift Advisor SQL notebook. From the saropa.drift-viewer extension.", "notebook", color, command("driftViewer.openSqlNotebook"), SUB_DRIFT));
    out.push(suite("suite.drift.scan", "Scan Dart schema (offline)", "Scans the Dart schema definitions offline — no running app needed. From the saropa.drift-viewer extension.", "search", color, command("driftViewer.scanDartSchemaDefinitions"), SUB_DRIFT));
    out.push(suite("suite.drift.diagram", "Open the schema diagram", "Opens the Drift Advisor schema diagram. From the saropa.drift-viewer extension.", "type-hierarchy", color, command("driftViewer.schemaDiagram"), SUB_DRIFT));
    out.push(suite("suite.drift.report", "Export a portable DB report", "Exports a portable Drift Advisor DB report. From the saropa.drift-viewer extension.", "output", color, command("driftViewer.exportReport"), SUB_DRIFT));
    out.push(suite("suite.drift.forward", "Forward the emulator port", "Forwards the Android emulator port to the debug server (adb forward 8642). From the saropa.drift-viewer extension.", "plug", color, command("driftViewer.forwardPortAndroid"), SUB_DRIFT));
  }

  // The debug server's merged issues feed; useful whenever the package is used.
  if (hasPackage || hasExt) {
    out.push(suite("suite.drift.issues", "Open the DB issues feed", "Opens the Drift Advisor issues feed (index suggestions + anomalies as JSON) from the local debug server on 8642. Requires an active debug session.", "link-external", color, url("http://127.0.0.1:8642/api/issues"), SUB_DRIFT));
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
  out.push(suite("suite.log.open", "Open a capture log", "Opens a Saropa Log Capture log file. From the saropa.saropa-log-capture extension.", "output", color, command("saropaLogCapture.openLogFile"), SUB_LOG));
  out.push(suite("suite.log.search", "Search all logs", "Searches across all captured logs. From the saropa.saropa-log-capture extension.", "search", color, command("saropaLogCapture.searchLogs"), SUB_LOG));
  out.push(suite("suite.log.flowmap", "Export a session Flow Map", "Exports a Flow Map for a capture session. From the saropa.saropa-log-capture extension.", "git-merge", color, command("saropaLogCapture.exportFlowMap"), SUB_LOG));
  out.push(suite("suite.log.compare", "Compare two sessions", "Compares two capture sessions side by side. From the saropa.saropa-log-capture extension.", "diff", color, command("saropaLogCapture.compareSessions"), SUB_LOG));
  out.push(suite("suite.log.signals", "Show the Signals panel", "Opens the Saropa Log Capture Signals panel. From the saropa.saropa-log-capture extension.", "lightbulb", color, command("saropaLogCapture.showSignals"), SUB_LOG));
  out.push(suite("suite.log.start", "Start capture", "Starts a Saropa Log Capture session. From the saropa.saropa-log-capture extension.", "record", color, command("saropaLogCapture.start"), SUB_LOG));
}

// Build a suite-group recipe result from its parts (every suite recipe shares the
// group + the action-carrying shape; only file pins differ, built inline above).
// `subGroup` nests the pin under its per-tool subfolder; omit it (the boot macro)
// to keep the pin directly at the suite top level.
function suite(
  recipeId: string,
  label: string,
  description: string,
  icon: string,
  color: string,
  action: PinAction,
  subGroup?: string
): RecipeResult {
  return { recipeId, label, description, icon, color, group: "suite", subGroup, action };
}
