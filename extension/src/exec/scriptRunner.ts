import * as vscode from "vscode";
import * as fs from "fs";
import {
  LibraryScript,
  ScriptRequirement,
  resolveScriptEntry,
} from "../model/scriptLibrary";
import { Shortcut } from "../model/shortcut";
import { runShortcut } from "./runner";
import { findOnPath } from "./interpreterDetect";
import {
  hasInteractiveTokens,
  resolveRememberedTokens,
  cloneWithResolvedTokens,
} from "./promptTokens";
import { l10n } from "../i18n/l10n";

// The manifest-declared `requires` entries not found on PATH, excluding ones marked
// `optional` (a script that degrades gracefully without a tool, like device-connect's
// scrcpy mirror, should not block the run over it — only the tools it cannot proceed
// without do). Checked at run time rather than cached, since installing a tool between
// runs should immediately unblock the next one.
export function missingRequirements(script: LibraryScript): ScriptRequirement[] {
  return script.requires.filter(
    (req) => req.type === "command" && !req.optional && !findOnPath(req.name)
  );
}

// Synthesize a Shortcut from a manifest entry so the run pipeline (and, separately,
// the Set Params editor) handles interpreter resolution, token expansion
// ($workspaceRoot), interactive tokens (${prompt:...}), and terminal/background
// routing exactly as it would for a user-authored shortcut. The id uses the
// `library:` prefix so it never collides with a user shortcut's UUID, and so
// promptMemory keys a script's remembered params separately from any pin's.
// Exported so runLibraryScript and the "Set Params" command build the identical
// shortcut shape — the promptMemory key must match exactly, or a value set from
// one would not be read by the other.
export function buildScriptShortcut(
  script: LibraryScript,
  extensionPath: string
): Shortcut {
  const entryPath = resolveScriptEntry(extensionPath, script.entry);
  return {
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
}

// Run a bundled library script by synthesizing a Shortcut from its manifest
// entry and routing it through the existing run pipeline. The script's config
// (command, args, cwd, runLocation) maps 1:1 to ShortcutExecConfig, so the
// runner resolves the interpreter, expands $workspaceRoot, and opens a terminal
// exactly as it would for a user-authored shortcut.
export async function runLibraryScript(
  script: LibraryScript,
  extensionPath: string
): Promise<void> {
  const shortcut = buildScriptShortcut(script, extensionPath);
  const entryPath = shortcut.path;

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

  // Pre-flight the manifest's declared tool requirements before opening a terminal, so
  // a missing dependency (adb, scrcpy, ...) surfaces as a named diagnostic toast instead
  // of a cryptic mid-script failure the user has to scroll the terminal to find.
  const missing = missingRequirements(script);
  if (missing.length > 0) {
    const list = missing.map((req) => `${req.name} (${req.reason})`).join("; ");
    void vscode.window.showErrorMessage(
      l10n("scripts.run.missingRequirement", { name: script.label, list })
    );
    return;
  }

  // A bundled script is meant to be set up once and rerun the same way every
  // time (e.g. organize-output's target folder), not re-asked on every run —
  // unlike a user shortcut, which defaults to a fresh prompt (see runShortcut)
  // with an explicit "Run with Last Parameters" opt-in. So resolve interactive
  // tokens from memory here, before handing off: the first run still prompts
  // (and remembers), every run after that is silent. Only a token never
  // answered before still prompts, mirroring runWithLastParams for pins.
  let effectiveShortcut = shortcut;
  if (hasInteractiveTokens(shortcut)) {
    const values = await resolveRememberedTokens(shortcut);
    if (values === undefined) {
      void vscode.window.showInformationMessage(
        l10n("run.canceledPromptToast", { name: script.label })
      );
      return;
    }
    effectiveShortcut = cloneWithResolvedTokens(shortcut, values);
  }

  const uri = vscode.Uri.file(entryPath);
  try {
    await runShortcut(effectiveShortcut, uri, "manual");
  } catch (err: unknown) {
    // runShortcut surfaces most failures internally, but a truly unexpected
    // throw (malformed plan, missing interpreter) should not vanish silently.
    const detail = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(
      l10n("scripts.run.failed", { name: script.label, detail })
    );
  }
}
