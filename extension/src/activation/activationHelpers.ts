import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { Shortcut, shortcutKind } from "../model/shortcut";
import {
  isRunnable,
  runBlockReason,
  blockReasonLabel,
  getOutputChannel,
} from "../exec/runner";
import { toBackground } from "../exec/chainRunner";
import { matchesAnyGlob } from "../exec/globMatch";
import {
  detectFavoritesFiles,
  importAllDetected,
  KNOWN_FAVORITES_SOURCES,
} from "../import/favoritesImport";
import { decodeSharedShortcut, describeSharedShortcut } from "../import/shareLink";
import { tappedShortcuts } from "../model/tappedShortcuts";
import { telemetry } from "../exec/telemetry";
import { shortcutDisplayName } from "../model/shortcutDisplayName";
import { l10n } from "../i18n/l10n";

// Standalone activation helpers split out of extension.ts so activate() stays the
// wiring sequence and these self-contained functions (URI import, run-on-save, the
// one-time favorites-import offer, the shortcut-path context publisher, and a debounce
// utility) live on their own. Each takes its dependencies as explicit parameters, so
// none captures activate()'s locals.

// Gate flag so the one-time "import existing favorites" prompt does not reappear
// once the user has answered (imported or dismissed) for this workspace.
const IMPORT_PROMPT_KEY = "saropaWorkspace.favoritesImportOffered";

// Gate flag for the one-time notice that aiContext.enabled's default flipped from
// true to false (BUG-014). globalState (not workspaceState) because the flip is a
// once-per-install fact about this user's extension version, not something scoped
// to a workspace — showing it again in every workspace the user opens would be a nag.
const AI_CONTEXT_DEFAULT_CHANGE_KEY = "aiContext.defaultChangeNotified";

// One-time notice gate (#27): every "show this at most once" site in this file (and
// ecosystemAutoPins.ts) repeated the same four-step shape — bail if the latch is
// already set, run a check, bail again if the check found nothing to show, latch
// BEFORE showing so a dismissal or a reload mid-prompt can never re-trigger it, then
// show. Centralizing the shape means a new one-time notice only supplies its own
// check/show and cannot get the latch-before-show ordering backwards (the bug this
// pattern exists to avoid). `storage` is the Memento (workspaceState for a
// per-workspace gate, globalState for a once-per-install gate) so callers keep
// choosing their own scope. `check` returns `undefined` to mean "nothing to show
// this time" (the gate is NOT latched, so it can be re-checked later); any other
// value is passed to `show` and the gate is latched.
export async function gatedNotice<T>(
  storage: vscode.Memento,
  key: string,
  check: () => Promise<T | undefined> | T | undefined,
  show: (value: T) => Promise<void> | void
): Promise<void> {
  if (storage.get<boolean>(key, false)) {
    return;
  }
  const value = await check();
  if (value === undefined) {
    return;
  }
  // Latch before running show(): the previous per-site comments called this out
  // explicitly because it is easy to get backwards — a dismissal or a reload mid-
  // prompt must not re-offer the same notice next time.
  await storage.update(key, true);
  await show(value);
}

// Import a shortcut from a shared "Copy as Saropa Link" URI. Decodes the payload,
// shows a modal confirm naming what the shortcut does (a shared shell command must be
// a visible, deliberate choice — importing never runs it), then adds it. Targets the
// project scope when a workspace folder is open, else global. A malformed/expired link
// degrades to a single warning, never a crash.
export async function handleShortcutImportUri(
  uri: vscode.Uri,
  store: ShortcutStore
): Promise<void> {
  if (uri.path !== "/import") {
    return;
  }
  const data = new URLSearchParams(uri.query).get("data");
  const shared = decodeSharedShortcut(data);
  if (!shared) {
    vscode.window.showWarningMessage(l10n("share.import.invalid"));
    return;
  }
  const name = shared.label ?? shared.path ?? l10n("share.import.fallbackName");
  const importAction = l10n("share.import.action");
  const choice = await vscode.window.showInformationMessage(
    l10n("share.import.confirm", { name }),
    { modal: true, detail: describeSharedShortcut(shared) },
    importAction
  );
  if (choice !== importAction) {
    return;
  }
  const scope = (vscode.workspace.workspaceFolders?.length ?? 0) > 0
    ? "project"
    : "global";
  const added = await store.importShortcut(shared, scope);
  vscode.window.showInformationMessage(
    added
      ? l10n("share.import.done", { name })
      : l10n("share.import.noFolder")
  );
}

// Callable function with an optional cancel method, returned by makeDebounced.
// Callers that need cleanup on dispose can call .cancel() to drop any pending timer;
// callers that don't care about cancellation just invoke it as a plain function.
export type DebouncedFn = (() => void) & { cancel(): void };

// Coalesce rapid calls into one trailing call after `delayMs` of quiet. Used by
// the shortcuts-config watcher so the store's write-then-notify burst (and a flurry of
// editor saves) triggers a single refresh, not one per filesystem event. The returned
// function exposes .cancel() so callers can drop the pending timer on dispose.
export function makeDebounced(fn: () => void, delayMs: number): DebouncedFn {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = (() => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(fn, delayMs);
  }) as DebouncedFn;
  // Cancel any pending timer — safe to call even when nothing is scheduled.
  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  return debounced;
}

// Re-entrancy / storm guard for the cross-file watch links (#25): shortcutId -> epoch
// ms of its last watch-triggered run. A burst of saves (format-on-save touching
// several files, Save All) must not fan out into a run storm, so a watch run is
// suppressed within COOLDOWN_MS of the shortcut's previous watch run. Mirrors the
// ChainRunner cooldown but is independent of it (a watch run and a chain run are
// separate causes). Keyed per shortcut, so unrelated watch links still fire
// concurrently.
const WATCH_COOLDOWN_MS = 3000;
const watchLastRun = new Map<string, number>();

// Drop a removed shortcut's cooldown entry. Without this, watchLastRun grows by one
// entry per shortcut that has ever fired a watch-triggered run and never shrinks —
// over a long-running window (VS Code windows routinely stay open for weeks) a
// churn-heavy project (shortcuts added/removed repeatedly) leaks memory forever.
// Called from every "shortcut removed" path (see shortcutAddRemove.ts,
// shortcutConfigCommands.ts, shortcutOpen.ts, fileOps.ts, shortcutExpiry.ts).
export function clearWatchLastRun(shortcutId: string): void {
  watchLastRun.delete(shortcutId);
}

// React to a saved document: fire both kinds of save-driven run.
//   1. run-on-save (exec.runOnSave) — a runnable file shortcut whose OWN target is the
//      saved file, run with its configured location (unchanged behavior).
//   2. watch links (exec.runOnSaveGlobs, #25) — any shortcut whose watch globs match
//      the saved file's path, run in the BACKGROUND with a per-shortcut cooldown. This
//      is the cross-file case: "I saved schema.graphql, run the generate-types shortcut."
// The same file can have a shortcut/link more than once, so all matches fire; a
// shortcut that already fired as a run-on-save match this save is not also fired as a
// watch match (a shortcut that both targets and globs the saved file runs once, not
// twice).
export function runShortcutsOnSave(store: ShortcutStore, savedUri: vscode.Uri): void {
  const saved = savedUri.fsPath;
  const shortcuts = [...store.getProjectShortcuts(), ...store.getGlobalShortcuts()];
  // Ids fired by the run-on-save pass, so the watch pass below does not double-run them.
  const fired = new Set<string>();
  for (const shortcut of shortcuts) {
    // A paused shortcut does not run on save — run-on-save is an unattended runner, so
    // pausing suspends it like the scheduler and chain triggers.
    if (shortcut.paused || shortcut.exec?.runOnSave !== true || shortcutKind(shortcut) !== "file") {
      continue;
    }
    const uri = store.resolveUri(shortcut);
    if (!uri || uri.fsPath !== saved || !isRunnable(shortcut, uri.fsPath)) {
      continue;
    }
    // Single-instance guard: skip the save-triggered run when one is already in
    // flight (or the cross-process lock is held) rather than stacking a second on
    // every save. Quiet beyond a channel line — repeated saves must not spam toasts;
    // the manual-run path is where the user gets the interactive "already running"
    // choice. Checked here so an unattended save never reaches the manual toast.
    const block = runBlockReason(shortcut);
    if (block) {
      const name = shortcutDisplayName(shortcut);
      getOutputChannel().appendLine(
        l10n("save.skipped", { name, reason: blockReasonLabel(block) })
      );
      continue;
    }
    fired.add(shortcut.id);
    void vscode.commands.executeCommand("saropaWorkspace.runPin", shortcut);
  }

  runWatchLinksOnSave(store, savedUri, shortcuts, fired);
}

// Cross-file watch-link pass (#25). Match the saved file against each shortcut's watch
// globs and run the matches in the background. Matching is done against the
// workspace-relative path (the natural form to author a glob in) AND the absolute
// fsPath, both forward-slashed, so either an in-workspace relative glob or an
// absolute glob (a global shortcut watching a file outside the workspace) resolves.
function runWatchLinksOnSave(
  store: ShortcutStore,
  savedUri: vscode.Uri,
  shortcuts: Shortcut[],
  fired: Set<string>
): void {
  const relPath = vscode.workspace.asRelativePath(savedUri, false).replace(/\\/g, "/");
  const absPath = savedUri.fsPath.replace(/\\/g, "/");
  const fileName = relPath.split("/").pop() ?? relPath;
  const now = Date.now();
  for (const shortcut of shortcuts) {
    const globs = shortcut.exec?.runOnSaveGlobs;
    // Skip a paused shortcut, a shortcut already fired by run-on-save above, and any
    // shortcut with no watch globs. Annotation shortcuts never carry exec, so the glob
    // check excludes them.
    if (shortcut.paused || fired.has(shortcut.id) || !globs || globs.length === 0) {
      continue;
    }
    if (!matchesAnyGlob(relPath, globs) && !matchesAnyGlob(absPath, globs)) {
      continue;
    }
    const name = shortcutDisplayName(shortcut);
    // Single-instance guard, same stance as run-on-save: never stack a watch run on
    // top of one already in flight; note it on the channel rather than toasting.
    const block = runBlockReason(shortcut);
    if (block) {
      getOutputChannel().appendLine(
        l10n("watch.skipped", { name, reason: blockReasonLabel(block) })
      );
      continue;
    }
    // Cooldown: collapse a save burst into at most one run per shortcut per window.
    const previous = watchLastRun.get(shortcut.id);
    if (previous !== undefined && now - previous < WATCH_COOLDOWN_MS) {
      getOutputChannel().appendLine(l10n("watch.cooldown", { name, file: fileName }));
      continue;
    }
    watchLastRun.set(shortcut.id, now);
    fired.add(shortcut.id);
    // Audit line names the script AND the file that triggered it (the run's own
    // "Running…"/"finished" toasts are the user-facing acknowledgment). Forced to the
    // background so a foreign save never steals the terminal or pops an OS window.
    getOutputChannel().appendLine(l10n("watch.firing", { name, file: fileName }));
    void vscode.commands.executeCommand("saropaWorkspace.runPin", toBackground(shortcut));
  }
}

// One-time "import existing favorites" prompt, gated per workspace by IMPORT_PROMPT_KEY.
// Detects any known favorites source, marks the gate BEFORE awaiting the user's answer
// (so a dismissal or reload mid-prompt does not re-trigger it), then imports all
// detected sources on confirm. Called once at activation and again by
// registerFavoritesImportWatchers whenever a favorites source appears or changes later.
export async function maybeOfferFavoritesImport(
  context: vscode.ExtensionContext,
  store: ShortcutStore
): Promise<void> {
  await gatedNotice(
    context.workspaceState,
    IMPORT_PROMPT_KEY,
    // check: detect any known favorites source; undefined (skip, don't latch)
    // when none is found so a source that appears later still gets offered.
    async () => {
      const detected = await detectFavoritesFiles();
      return detected.length === 0 ? undefined : detected;
    },
    // show: confirm, then import everything detected.
    async (detected) => {
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
  );
}

// One-time notice for BUG-014: aiContext.enabled's default flipped from true to
// false, so an existing user who never explicitly set the setting silently lost
// their Active AI Threads shortcuts on upgrade with no explanation. Shown at most
// once per install (globalState), and only when the user's own settings do not
// already carry an explicit value — inspect() (not get()) is required here because
// get() cannot distinguish "user set it to false" from "no value, falling back to
// the new false default"; only inspect() exposes the per-scope raw values.
export function maybeNotifyAiContextDefaultChange(context: vscode.ExtensionContext): void {
  // Fire-and-forget: this must stay synchronous-looking from the caller's side (it
  // runs before store.init(), see the call site comment in extension.ts) even though
  // gatedNotice itself is async.
  void gatedNotice(
    context.globalState,
    AI_CONTEXT_DEFAULT_CHANGE_KEY,
    // check: inspect() (not get()) is required here because get() cannot distinguish
    // "user set it to false" from "no value, falling back to the new false default";
    // only inspect() exposes the per-scope raw values. Returns undefined (skip,
    // don't latch) when the user already has an explicit opinion set at any scope.
    () => {
      // Fresh-install guard: a brand-new install has empty globalState — the old
      // aiContext.enabled default (true) never applied to this user, so showing a
      // "default changed" notice would be confusing noise. keys() was added in VS Code
      // 1.78; on 1.74-1.77 it is undefined, and we accept the one-time false positive
      // on fresh installs of those older hosts (a harmless toast, latched forever).
      const keys = context.globalState.keys?.();
      if (keys && keys.length === 0) {
        return undefined;
      }
      const inspected = vscode.workspace
        .getConfiguration("saropaWorkspace")
        .inspect<boolean>("aiContext.enabled");
      const explicitlySet =
        inspected?.globalValue !== undefined ||
        inspected?.workspaceValue !== undefined ||
        inspected?.workspaceFolderValue !== undefined;
      return explicitlySet ? undefined : true;
    },
    // show: an action button, not a bare acknowledgment — the notice exists so the
    // user can act on it (turn the feature back on), so it persists until dismissed
    // rather than auto-clearing like a transient confirmation (STYLEGUIDE.md 4.1a).
    () => {
      const openSettings = l10n("aiContext.defaultChangeNotice.openSettings");
      void vscode.window
        .showInformationMessage(l10n("aiContext.defaultChangeNotice"), openSettings)
        .then((choice) => {
          if (choice === openSettings) {
            void vscode.commands.executeCommand(
              "workbench.action.openSettings",
              "saropaWorkspace.aiContext.enabled"
            );
          }
        });
    }
  );
}

// Arm watchers so the one-time import offer also fires when a favorites source
// APPEARS or CHANGES after activation — a user who installs Saropa first and then
// uses another favorites extension (or a teammate who pulls a `.favorites.json`
// mid-session) would otherwise never be offered the import. maybeOfferFavoritesImport
// owns the gate: it prompts at most once per workspace until acted on or dismissed,
// so re-running it on every file event is safe and cannot nag. A broad `**/<name>`
// glob covers folders added later too; when an event names a file the root-only
// detector does not recognize, the offer is a no-op (it gates nothing).
export function registerFavoritesImportWatchers(
  context: vscode.ExtensionContext,
  store: ShortcutStore
): void {
  const offer = (): void => void maybeOfferFavoritesImport(context, store);
  for (const source of KNOWN_FAVORITES_SOURCES) {
    const watcher = vscode.workspace.createFileSystemWatcher(`**/${source.fileName}`);
    watcher.onDidCreate(offer, undefined, context.subscriptions);
    watcher.onDidChange(offer, undefined, context.subscriptions);
    // The watcher itself is disposable (its native file handle); dispose on reload
    // so it does not survive and double-fire.
    context.subscriptions.push(watcher);
  }
  // The settings-key sources (howardzuo `favorites.resources`, sabitovvt
  // `favoritesPanel.*`) have no file on disk; a change to their configuration is
  // the equivalent "appeared" signal.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("favorites.resources") ||
        e.affectsConfiguration("favoritesPanel.commands") ||
        e.affectsConfiguration("favoritesPanel.commandsForWorkspace")
      ) {
        offer();
      }
    })
  );
}

// Keep the Recent list and the untapped dot in step with the editor, not only
// with shortcut clicks: a file with a shortcut the user focuses by ANY means —
// Ctrl+P, the Explorer, a tab switch — or closes counts as "used", so it lands in
// Recent and clears its per-row untapped dot. This is
// the companion to the shortcut-click open path (which records the same thing);
// recordOpen's front-dup guard and the idempotent mark make the overlap a no-op, and a
// per-uri guard here keeps a plain tab re-focus from re-firing for the file already at
// the front.
export function wireRecentEditorTracking(
  context: vscode.ExtensionContext,
  store: ShortcutStore
): void {
  // The last file URI we recorded, so re-activating the same editor (a frequent
  // focus event) does not repeat the work. Cleared on a close so re-opening the
  // same file after closing it records again (the close pushed it to the front).
  let lastTouchedUri: string | undefined;
  const touch = (uri: vscode.Uri | undefined): void => {
    if (!uri) {
      return;
    }
    const key = uri.toString();
    if (key === lastTouchedUri) {
      return;
    }
    // Match the focused/closed file to a shortcut in either scope; a file without a
    // shortcut is ignored, so ordinary editing never writes to the Recent store.
    const shortcut =
      store.findShortcutByUri(uri, "project") ?? store.findShortcutByUri(uri, "global");
    if (!shortcut) {
      return;
    }
    lastTouchedUri = key;
    void tappedShortcuts.mark(shortcut.id);
    void telemetry.recordOpen(shortcut.id);
  };
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) =>
      touch(editor?.document.uri)
    ),
    // A closed file with a shortcut jumps to the top of Recent (the "recently closed"
    // model). Clearing the guard first lets the close record even if that file was the
    // last one we touched while it was open.
    vscode.workspace.onDidCloseTextDocument((doc) => {
      lastTouchedUri = undefined;
      touch(doc.uri);
    })
  );
}

// Publish the set of absolute paths that have a shortcut in each scope as when-clause
// context objects, so the "Workspace Shortcut" submenu can hide the invalid action per
// file. Both the OS path (uri.fsPath, e.g. "d:\\src\\a.ts") and the URI path
// (uri.path, e.g. "/d:/src/a.ts") are registered for every shortcut because VS Code's
// resourcePath context key uses one form or the other depending on platform; the `in`
// operator only checks key existence, so registering both matches whichever VS Code
// supplies. Non-file recipe shortcuts have no on-disk path and are skipped.
export function syncShortcutPathContext(store: ShortcutStore): void {
  const collect = (shortcuts: Shortcut[]): Record<string, true> => {
    const set: Record<string, true> = {};
    for (const shortcut of shortcuts) {
      if (shortcutKind(shortcut) !== "file") {
        continue;
      }
      const uri = store.resolveUri(shortcut);
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
    collect(store.getProjectShortcuts())
  );
  void vscode.commands.executeCommand(
    "setContext",
    "saropaWorkspace.globalPinnedPaths",
    collect(store.getGlobalShortcuts())
  );
}
