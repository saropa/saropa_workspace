import * as vscode from "vscode";
import * as path from "path";
import { pollProcesses, buildProcessReportMarkdown } from "./processPoll";
import { DashboardPanel } from "../views/dashboardPanel";
import { expandRecipeTokens } from "./runner";
import { l10n } from "../i18n/l10n";

// Commands that drive the developer process monitor (recipe book section G):
//   - openProcessMonitor (#60) opens the live Saropa Dashboard webview.
//   - recipe.snapshotProcesses (#62, grouped) writes the two-sample, per-tool
//     rolled-up table to a dated report and opens it — the upgrade over the basic
//     one-instant tasklist/ps snapshot, now that the process-poll helper exists.
export function registerProcessMonitorCommands(
  context: vscode.ExtensionContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("saropaWorkspace.openProcessMonitor", () =>
      DashboardPanel.show(context)
    ),
    vscode.commands.registerCommand("saropaWorkspace.recipe.snapshotProcesses", () =>
      snapshotProcesses()
    )
  );
}

// Write the grouped, live-CPU process snapshot to reports/<stamp>_processes.md and
// open it — the artifact a bug report or a "my machine is thrashing" message
// attaches. Uses the same two-sample poll as the live panel, so the CPU column is
// the live delta, not the OS's cumulative CPU time.
async function snapshotProcesses(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showWarningMessage(l10n("monitor.snapshot.noFolder"));
    return;
  }
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: l10n("monitor.snapshot.sampling") },
    async () => {
      const result = await pollProcesses();
      const report = buildProcessReportMarkdown(result);
      // The same $stamp the shell-to-report path uses, so the file name convention
      // matches the other dated reports under reports/.
      const relative = expandRecipeTokens("reports/$stamp_processes.md");
      const file = path.join(folder.uri.fsPath, ...relative.split("/"));
      try {
        const fs = await import("fs/promises");
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, report, "utf8");
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
        await vscode.window.showTextDocument(doc, { preview: false });
        vscode.window.showInformationMessage(l10n("monitor.snapshot.wrote", { path: file }));
      } catch (err) {
        vscode.window.showErrorMessage(
          l10n("monitor.snapshot.failed", { error: err instanceof Error ? err.message : String(err) })
        );
      }
    }
  );
}
