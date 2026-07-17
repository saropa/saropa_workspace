import * as vscode from "vscode";
import * as fs from "fs";
import {
  LibraryScript,
  resolveScriptEntry,
} from "../model/scriptLibrary";
import { Shortcut } from "../model/shortcut";
import { runShortcut } from "./runner";
import { l10n } from "../i18n/l10n";

// Run a bundled library script by synthesizing a Shortcut from its manifest
// entry and routing it through the existing run pipeline. The script's config
// (command, args, cwd, runLocation) maps 1:1 to ShortcutExecConfig, so the
// runner resolves the interpreter, expands $workspaceRoot, and opens a terminal
// exactly as it would for a user-authored shortcut.
export async function runLibraryScript(
  script: LibraryScript,
  extensionPath: string
): Promise<void> {
  const entryPath = resolveScriptEntry(extensionPath, script.entry);

  if (!fs.existsSync(entryPath)) {
    void vscode.window.showErrorMessage(
      l10n("scripts.run.missingEntry", { name: script.label })
    );
    return;
  }

  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    void vscode.window.showWarningMessage(
      l10n("scripts.run.noWorkspace", { name: script.label })
    );
    return;
  }

  // Synthesize a Shortcut so the run pipeline handles interpreter resolution,
  // token expansion ($workspaceRoot), interactive tokens (${prompt:...}), and
  // terminal/background routing. The id uses the `library:` prefix so it never
  // collides with a user shortcut's UUID.
  const shortcut: Shortcut = {
    id: `library:${script.id}`,
    path: entryPath,
    label: script.label,
    scope: "project",
    order: 0,
    exec: {
      command: script.config.command,
      args: script.config.args,
      cwd: script.config.cwd,
      runLocation: script.config.runLocation,
    },
  };

  const uri = vscode.Uri.file(entryPath);
  void vscode.window.showInformationMessage(
    l10n("scripts.run.starting", { name: script.label })
  );
  await runShortcut(shortcut, uri, "manual");
}
