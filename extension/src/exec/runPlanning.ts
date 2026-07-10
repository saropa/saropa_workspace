import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Shortcut, ShortcutExecConfig, RunLocation } from "../model/shortcut";
import { processRegistry } from "./processRegistry";
import { isConcurrencyBlocked } from "./concurrency";
import * as runLock from "./runLock";
import { buildTokenMap, expandTokens } from "./tokens";
import {
  resolveInterpreter,
  isRunnablePlan,
  assembleCommandLine,
  parseShebangLine,
} from "./commandPlan";
import { l10n } from "../i18n/l10n";

// Pure run planning + the single-instance guard. No process launching happens here:
// these turn a shortcut + target into a concrete RunPlan (command line, cwd, env,
// where it runs) and decide whether a fresh run may start. Kept free of the terminal /
// background / external launchers so the assembly path is the one source of truth
// the scheduler's log line and the dry-run audit share with an actual run.

// Read a script's `#!` shebang and return the interpreter to run it through, or
// undefined when the file has none / cannot be read. Honors the Unix convention so
// an extensionless script (e.g. a `#!/usr/bin/env python3` file with no recognized
// extension) runs through its declared interpreter instead of depending on the
// file's executable bit — matching Code Runner. `#!/usr/bin/env X [args]` yields
// `X [args]` (the env wrapper is stripped); any other shebang yields its literal
// interpreter path + args. Reads only the first chunk (the shebang is the first
// line) so a large file is never slurped whole.
function shebangInterpreter(fsPath: string): string | undefined {
  let firstLine: string;
  try {
    const fd = fs.openSync(fsPath, "r");
    try {
      const buffer = Buffer.alloc(256);
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
      firstLine = buffer.toString("utf8", 0, bytesRead).split(/\r?\n/, 1)[0];
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Missing/unreadable file: no shebang to honor (the caller falls back to "").
    return undefined;
  }
  // The env-stripping precedence lives in the pure parser (shared with the run-target
  // detector) so there is one shebang convention, not two.
  return parseShebangLine(firstLine);
}

// Read the configured interpreter-defaults map (file extension -> command prefix).
// One reader so the prefix resolution and the runnable check share a source.
function interpreterDefaults(): Record<string, string> {
  return vscode.workspace
    .getConfiguration("saropaWorkspace")
    .get<Record<string, string>>("interpreterDefaults", {});
}

// Resolve the command prefix for a file. Reads the config + shebang here (the IO),
// then defers the precedence decision to the pure resolveInterpreter so the
// fallback order is unit-testable without the host. Empty result means "run
// directly".
function resolveCommandPrefix(shortcut: Shortcut, fsPath: string): string {
  return resolveInterpreter({
    explicitCommand: shortcut.exec?.command,
    ext: path.extname(fsPath).toLowerCase(),
    defaults: interpreterDefaults(),
    shebang: shebangInterpreter(fsPath),
    platform: process.platform,
  });
}

// The interpreter prefix a run would resolve for this shortcut + target, exposed so the
// Configure Run UI can show what a blank command falls back to (the file-type default or
// the file's shebang) without re-implementing the precedence. Pass a shortcut whose
// exec.command is undefined to read the pure default; pass the real shortcut to read its
// effective prefix.
export function resolveRunPrefix(shortcut: Shortcut, fsPath: string): string {
  return resolveCommandPrefix(shortcut, fsPath);
}

// Whether running this shortcut makes sense, i.e. there is a way to execute it. True
// when the user set an explicit command (including an explicit empty string,
// which means "run the file directly" — e.g. a shebang script), or the file's
// extension has a configured default interpreter, or the file carries a `#!`
// shebang. False for an ordinary document (.txt, .md, image, etc.) with no
// interpreter, where "run" has no meaning and the caller should open the file.
export function isRunnable(shortcut: Shortcut, fsPath: string): boolean {
  return isRunnablePlan({
    explicitCommand: shortcut.exec?.command,
    ext: path.extname(fsPath).toLowerCase(),
    defaults: interpreterDefaults(),
    hasShebang: shebangInterpreter(fsPath) !== undefined,
  });
}

// Resolve where a run happens. runLocation is the source of truth; for shortcuts
// written before it existed, fall back to the deprecated useIntegratedTerminal
// boolean (true -> terminal, false -> background); if neither is set, follow the
// workspace default. One resolver so the legacy field is read in exactly one place.
function resolveRunLocation(exec: ShortcutExecConfig | undefined): RunLocation {
  if (exec?.runLocation) {
    return exec.runLocation;
  }
  if (exec?.useIntegratedTerminal === true) {
    return "terminal";
  }
  if (exec?.useIntegratedTerminal === false) {
    return "background";
  }
  const defaultIntegrated = vscode.workspace
    .getConfiguration("saropaWorkspace")
    .get<boolean>("defaultUseIntegratedTerminal", true);
  return defaultIntegrated ? "terminal" : "background";
}

// Everything needed to launch a shortcut, resolved from its config and target. Kept
// as a single value so the scheduler can log the exact command it is about to
// run from one source of truth (planRun), rather than reassembling it.
export interface RunPlan {
  commandLine: string;
  cwd: string;
  env: Record<string, string> | undefined;
  name: string;
  // Where this run executes (integrated terminal / background channel / external
  // OS window), resolved from the shortcut's config and the workspace default.
  location: RunLocation;
  // Request administrator/elevated privileges; only meaningful when location is
  // "external".
  elevated: boolean;
  // $names that appeared in the command/args/cwd but are not recognized tokens.
  // Left literal in the command; surfaced once by runPin so they are not blanked
  // silently (a literal $name may also be an intentional shell variable).
  unknownTokens: string[];
  // Optional regex matched against a background run's output to extract one value to
  // the clipboard (WOW #16). Only honored for the background location.
  extractResult?: string;
}

// Resolve a shortcut + target into a concrete RunPlan. Pure of side effects so both
// runPin and the scheduler's log line share one assembly path. `extraTokens` adds
// run-specific token values (e.g. $droppedFile from a drag-and-drop run, WOW #8)
// merged over the standard file tokens.
export function planRun(
  shortcut: Shortcut,
  uri: vscode.Uri,
  extraTokens?: Record<string, string>
): RunPlan {
  const fsPath = uri.fsPath;
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;

  // Expand placeholder tokens in the command, each arg, and a custom cwd before
  // assembly/quoting, so a substituted path with spaces is quoted as one arg.
  const tokens = { ...buildTokenMap(fsPath, workspaceRoot), ...(extraTokens ?? {}) };
  const unknown = new Set<string>();

  const prefix = expandTokens(resolveCommandPrefix(shortcut, fsPath), tokens, unknown);
  const args = (shortcut.exec?.args ?? []).map((a) => expandTokens(a, tokens, unknown));
  const cwd = shortcut.exec?.cwd
    ? expandTokens(shortcut.exec.cwd, tokens, unknown)
    : workspaceRoot ?? path.dirname(fsPath);

  const name = shortcut.label ?? path.basename(fsPath);

  // Assemble <prefix> "<file>" <args...> via the pure core. includeFilePath ===
  // false omits the file entirely (npm-script / Make-target run configs name their
  // work in args and run against cwd, not the file path).
  const includeFile = shortcut.exec?.includeFilePath !== false;
  const commandLine = assembleCommandLine({ prefix, fsPath, args, includeFile });

  const location = resolveRunLocation(shortcut.exec);

  return {
    commandLine,
    cwd,
    env: shortcut.exec?.env,
    name,
    location,
    // Elevation only applies to an external window; ignored otherwise.
    elevated: location === "external" && shortcut.exec?.elevated === true,
    unknownTokens: [...unknown],
    extractResult: shortcut.exec?.extractResult,
  };
}

// Why a fresh run of this shortcut must not start, or undefined when it may. The
// single source of truth both the unattended runners (scheduler, chain, run-on-save)
// and the manual Run command consult, so the single-instance rule lives in one place:
//   - "running": one of THIS shortcut's runs is already tracked in this window (a
//     background / report-capture run); the in-process guard.
//   - "locked":  the shortcut's cross-process lock (lockName) is held by a LIVE holder
//     in another window / terminal / process.
// allowConcurrent:true opts a shortcut out of both. Integrated-terminal and external
// runs are untracked, so "running" never applies to them — only a lockName can
// guard those, and only against runs that also honor the lock.
export type RunBlockReason = "running" | "locked";

// Evaluate the guard above for one shortcut: check the cheap in-process registry
// first, then fall through to the cross-process file lock only when the
// in-process check clears and a lockName is actually configured.
export function runBlockReason(shortcut: Shortcut): RunBlockReason | undefined {
  // The in-process guard: a tracked run of this exact shortcut is still in flight.
  if (isConcurrencyBlocked(shortcut.allowConcurrent, processRegistry.isRunning(shortcut.id))) {
    return "running";
  }
  // The cross-process guard: a live holder owns this shortcut's shared lock elsewhere.
  if (!shortcut.allowConcurrent && shortcut.lockName && runLock.isHeld(shortcut.lockName)) {
    return "locked";
  }
  return undefined;
}

// Localized one-phrase reason for a block, shared by every skip/blocked message so
// the wording is defined once.
export function blockReasonLabel(reason: RunBlockReason): string {
  return l10n(
    reason === "locked" ? "concurrency.reasonLocked" : "concurrency.reasonRunning"
  );
}
