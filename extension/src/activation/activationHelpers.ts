import * as vscode from "vscode";
import { PinStore } from "../model/pinStore";
import { Pin, pinKind } from "../model/pin";
import {
  isRunnable,
  runBlockReason,
  blockReasonLabel,
  getOutputChannel,
} from "../exec/runner";
import { toBackground } from "../exec/chainRunner";
import { matchesAnyGlob } from "../exec/globMatch";
import { detectFavoritesFiles, importAllDetected } from "../import/favoritesImport";
import { decodeSharedPin, describeSharedPin } from "../import/shareLink";
import { l10n } from "../i18n/l10n";

// Standalone activation helpers split out of extension.ts so activate() stays the
// wiring sequence and these self-contained functions (URI import, run-on-save, the
// one-time favorites-import offer, the pinned-path context publisher, and a debounce
// utility) live on their own. Each takes its dependencies as explicit parameters, so
// none captures activate()'s locals.

// Gate flag so the one-time "import existing favorites" prompt does not reappear
// once the user has answered (imported or dismissed) for this workspace.
const IMPORT_PROMPT_KEY = "saropaWorkspace.favoritesImportOffered";

// Import a pin from a shared "Copy as Saropa Link" URI. Decodes the payload, shows a
// modal confirm naming what the pin does (a shared shell command must be a visible,
// deliberate choice — importing never runs it), then adds it. Targets the project
// scope when a workspace folder is open, else global. A malformed/expired link
// degrades to a single warning, never a crash.
export async function handlePinImportUri(
  uri: vscode.Uri,
  store: PinStore
): Promise<void> {
  if (uri.path !== "/import") {
    return;
  }
  const data = new URLSearchParams(uri.query).get("data");
  const shared = decodeSharedPin(data);
  if (!shared) {
    vscode.window.showWarningMessage(l10n("share.import.invalid"));
    return;
  }
  const name = shared.label ?? shared.path ?? l10n("share.import.fallbackName");
  const importAction = l10n("share.import.action");
  const choice = await vscode.window.showInformationMessage(
    l10n("share.import.confirm", { name }),
    { modal: true, detail: describeSharedPin(shared) },
    importAction
  );
  if (choice !== importAction) {
    return;
  }
  const scope = (vscode.workspace.workspaceFolders?.length ?? 0) > 0
    ? "project"
    : "global";
  const added = await store.importPin(shared, scope);
  vscode.window.showInformationMessage(
    added
      ? l10n("share.import.done", { name })
      : l10n("share.import.noFolder")
  );
}

// Coalesce rapid calls into one trailing call after `delayMs` of quiet. Used by
// the pins-config watcher so the store's write-then-notify burst (and a flurry of
// editor saves) triggers a single refresh, not one per filesystem event.
export function makeDebounced(fn: () => void, delayMs: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(fn, delayMs);
  };
}

// Re-entrancy / storm guard for the cross-file watch links (#25): pinId -> epoch ms
// of its last watch-triggered run. A burst of saves (format-on-save touching several
// files, Save All) must not fan out into a run storm, so a watch run is suppressed
// within COOLDOWN_MS of the pin's previous watch run. Mirrors the ChainRunner cooldown
// but is independent of it (a watch run and a chain run are separate causes). Keyed
// per pin, so unrelated watch links still fire concurrently.
const WATCH_COOLDOWN_MS = 3000;
const watchLastRun = new Map<string, number>();

// React to a saved document: fire both kinds of save-driven run.
//   1. run-on-save (exec.runOnSave) — a runnable file pin whose OWN target is the
//      saved file, run with its configured location (unchanged behavior).
//   2. watch links (exec.runOnSaveGlobs, #25) — any pin whose watch globs match the
//      saved file's path, run in the BACKGROUND with a per-pin cooldown. This is the
//      cross-file case: "I saved schema.graphql, run the generate-types pin."
// The same file can be pinned/linked more than once, so all matches fire; a pin that
// already fired as a run-on-save match this save is not also fired as a watch match
// (a pin that both targets and globs the saved file runs once, not twice).
export function runPinsOnSave(store: PinStore, savedUri: vscode.Uri): void {
  const saved = savedUri.fsPath;
  const pins = [...store.getProjectPins(), ...store.getGlobalPins()];
  // Ids fired by the run-on-save pass, so the watch pass below does not double-run them.
  const fired = new Set<string>();
  for (const pin of pins) {
    // A paused pin does not run on save — run-on-save is an unattended runner, so
    // pausing suspends it like the scheduler and chain triggers.
    if (pin.paused || pin.exec?.runOnSave !== true || pinKind(pin) !== "file") {
      continue;
    }
    const uri = store.resolveUri(pin);
    if (!uri || uri.fsPath !== saved || !isRunnable(pin, uri.fsPath)) {
      continue;
    }
    // Single-instance guard: skip the save-triggered run when one is already in
    // flight (or the cross-process lock is held) rather than stacking a second on
    // every save. Quiet beyond a channel line — repeated saves must not spam toasts;
    // the manual-run path is where the user gets the interactive "already running"
    // choice. Checked here so an unattended save never reaches the manual toast.
    const block = runBlockReason(pin);
    if (block) {
      const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
      getOutputChannel().appendLine(
        l10n("save.skipped", { name, reason: blockReasonLabel(block) })
      );
      continue;
    }
    fired.add(pin.id);
    void vscode.commands.executeCommand("saropaWorkspace.runPin", pin);
  }

  runWatchLinksOnSave(store, savedUri, pins, fired);
}

// Cross-file watch-link pass (#25). Match the saved file against each pin's watch
// globs and run the matches in the background. Matching is done against the
// workspace-relative path (the natural form to author a glob in) AND the absolute
// fsPath, both forward-slashed, so either an in-workspace relative glob or an
// absolute glob (a global pin watching a file outside the workspace) resolves.
function runWatchLinksOnSave(
  store: PinStore,
  savedUri: vscode.Uri,
  pins: Pin[],
  fired: Set<string>
): void {
  const relPath = vscode.workspace.asRelativePath(savedUri, false).replace(/\\/g, "/");
  const absPath = savedUri.fsPath.replace(/\\/g, "/");
  const fileName = relPath.split("/").pop() ?? relPath;
  const now = Date.now();
  for (const pin of pins) {
    const globs = pin.exec?.runOnSaveGlobs;
    // Skip a paused pin, a pin already fired by run-on-save above, and any pin with
    // no watch globs. Annotation pins never carry exec, so the glob check excludes them.
    if (pin.paused || fired.has(pin.id) || !globs || globs.length === 0) {
      continue;
    }
    if (!matchesAnyGlob(relPath, globs) && !matchesAnyGlob(absPath, globs)) {
      continue;
    }
    const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    // Single-instance guard, same stance as run-on-save: never stack a watch run on
    // top of one already in flight; note it on the channel rather than toasting.
    const block = runBlockReason(pin);
    if (block) {
      getOutputChannel().appendLine(
        l10n("watch.skipped", { name, reason: blockReasonLabel(block) })
      );
      continue;
    }
    // Cooldown: collapse a save burst into at most one run per pin per window.
    const previous = watchLastRun.get(pin.id);
    if (previous !== undefined && now - previous < WATCH_COOLDOWN_MS) {
      getOutputChannel().appendLine(l10n("watch.cooldown", { name, file: fileName }));
      continue;
    }
    watchLastRun.set(pin.id, now);
    fired.add(pin.id);
    // Audit line names the script AND the file that triggered it (the run's own
    // "Running…"/"finished" toasts are the user-facing acknowledgment). Forced to the
    // background so a foreign save never steals the terminal or pops an OS window.
    getOutputChannel().appendLine(l10n("watch.firing", { name, file: fileName }));
    void vscode.commands.executeCommand("saropaWorkspace.runPin", toBackground(pin));
  }
}

export async function maybeOfferFavoritesImport(
  context: vscode.ExtensionContext,
  store: PinStore
): Promise<void> {
  if (context.workspaceState.get<boolean>(IMPORT_PROMPT_KEY, false)) {
    return;
  }
  const detected = await detectFavoritesFiles();
  if (detected.length === 0) {
    return;
  }
  // Record that the offer was made before awaiting the user's answer, so a
  // dismissal (or window reload mid-prompt) does not re-trigger it.
  await context.workspaceState.update(IMPORT_PROMPT_KEY, true);

  const first = detected[0];
  const action = l10n("import.promptAction");
  const choice = await vscode.window.showInformationMessage(
    l10n("import.prompt", { file: first.fileName, count: detected.length }),
    action
  );
  if (choice === action) {
    const result = await importAllDetected(store);
    vscode.window.showInformationMessage(
      l10n("import.done", {
        count: result.added,
        file: detected.map((d) => d.fileName).join(", "),
      })
    );
  }
}

// Publish the set of absolute paths pinned in each scope as when-clause context
// objects, so the "Workspace Pin" submenu can hide the invalid action per file.
// Both the OS path (uri.fsPath, e.g. "d:\\src\\a.ts") and the URI path (uri.path,
// e.g. "/d:/src/a.ts") are registered for every pin because VS Code's resourcePath
// context key uses one form or the other depending on platform; the `in` operator
// only checks key existence, so registering both matches whichever VS Code supplies.
// Non-file recipe pins have no on-disk path and are skipped.
export function syncPinnedPathContext(store: PinStore): void {
  const collect = (pins: Pin[]): Record<string, true> => {
    const set: Record<string, true> = {};
    for (const pin of pins) {
      if (pinKind(pin) !== "file") {
        continue;
      }
      const uri = store.resolveUri(pin);
      if (!uri) {
        continue;
      }
      set[uri.fsPath] = true;
      set[uri.path] = true;
    }
    return set;
  };
  void vscode.commands.executeCommand(
    "setContext",
    "saropaWorkspace.projectPinnedPaths",
    collect(store.getProjectPins())
  );
  void vscode.commands.executeCommand(
    "setContext",
    "saropaWorkspace.globalPinnedPaths",
    collect(store.getGlobalPins())
  );
}
