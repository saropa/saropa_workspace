import * as vscode from "vscode";
import { PinStore } from "../model/pinStore";
import { Pin, PinScope, pinKind } from "../model/pin";
import { PinFolderItem, PinGroupItem, PinTreeItem } from "../views/pinTreeItem";
import { DoubleClickDispatcher } from "../exec/doubleClick";
import {
  runPin as execRunPin,
  runAction,
  getOutputChannel,
  isRunnable,
} from "../exec/runner";
import { processRegistry } from "../exec/processRegistry";
import { runStatusRegistry } from "../exec/runStatus";
import { telemetry } from "../exec/telemetry";
import { tappedPins } from "../model/tappedPins";
import {
  detectFavoritesFiles,
  detectSettingsFavoritesCount,
  importAllDetected,
  detectSiblingFavorites,
  importSiblingFavorites,
  SiblingFavorites,
} from "../import/favoritesImport";
import { configureRun, parseArgs, formatArgs } from "./configureRun";
import { configureSchedule } from "./configureSchedule";
import { configureTriggers } from "./configureTriggers";
import { configureAppearance } from "./configureAppearance";
import { simulateRun } from "./simulateRun";
import { showRunAnalytics } from "./runAnalytics";
import { configureBootSequence, runBootSequence } from "./bootSequence";
import { exportPinSet, importPinSet } from "./pinSetExport";
import { editPinsConfig } from "./editConfig";
import { newScratchpad } from "./scratchpad";
import { saveLayout, restoreLayout } from "./layoutPins";
import { diffLastRuns } from "./diffRuns";
import { useAsTemplate } from "./templatePin";
import { encodePinLink } from "../import/shareLink";
import { runOutputs } from "../exec/runOutputs";
import {
  hasInteractiveTokens,
  resolveRememberedTokens,
  cloneWithResolvedTokens,
} from "../exec/promptTokens";
import { promptMemory } from "../exec/promptMemory";
import { dependencyState } from "../exec/dependencies";
import { detectRunTargets, RunTarget } from "../exec/runTargets";
import { l10n } from "../i18n/l10n";

// Menu/command invocations hand us either a PinTreeItem (context menus, inline
// buttons) or a raw Pin (the click dispatcher). Normalize to a Pin.
function asPin(arg: unknown): Pin | undefined {
  if (arg instanceof PinTreeItem) {
    return arg.pin;
  }
  if (arg && typeof arg === "object" && "id" in arg && "scope" in arg) {
    return arg as Pin;
  }
  return undefined;
}

// The path-like string to copy for a right-clicked tree node. A file pin yields
// its resolved absolute fsPath (the canonical resolution used elsewhere), with
// the stored path as a fallback when it cannot be resolved (missing folder). A
// non-file recipe pin (url / shell / command / macro) has no file on disk, so
// its action target (`pin.path`) is the meaningful thing to copy. Any other tree
// item that carries a resourceUri (the Project Files rows) yields that path.
// Returns undefined for nodes with nothing to copy (scope roots, group folders).
function pathToCopy(store: PinStore, arg: unknown): string | undefined {
  if (arg instanceof PinTreeItem) {
    const pin = arg.pin;
    if (pinKind(pin) === "file") {
      return store.resolveUri(pin)?.fsPath ?? pin.path;
    }
    return pin.path;
  }
  if (arg instanceof vscode.TreeItem && arg.resourceUri) {
    return arg.resourceUri.fsPath;
  }
  return undefined;
}

// Whether a file exists on disk right now. The store's cached missing-set flags
// the pin in the tree, but a click re-checks authoritatively here so a file
// restored (or moved back) since the last refresh still opens without a stale
// "missing" verdict.
async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

// A pin whose target file is gone: instead of letting VS Code surface a raw
// "cannot open file" error, name the pin and offer the useful next steps — relocate
// it to the moved/renamed file, remove the dead pin, or open the folder it used to
// live in (to find the file). The pin is never auto-removed: a deletion is often
// transient (a branch switch, a regenerated artifact), and project pins are shared
// via the repo.
async function handleMissingFile(
  store: PinStore,
  pin: Pin,
  uri: vscode.Uri
): Promise<void> {
  const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
  const relocate = l10n("pin.missing.relocate");
  const unpin = l10n("pin.missing.unpin");
  const reveal = l10n("pin.missing.reveal");
  // Relocate leads: re-pointing a moved/renamed file keeps the pin (and its run
  // config, schedule, icon) intact, the better fix when the file still exists
  // somewhere; Unpin and Show in Folder follow as the give-up / go-look paths.
  const choice = await vscode.window.showWarningMessage(
    l10n("pin.missing.message", { name, path: pin.path }),
    relocate,
    unpin,
    reveal
  );
  if (choice === relocate) {
    await relocatePin(store, pin);
  } else if (choice === unpin) {
    await store.removePin(pin);
    // Drop any last-run badge so it does not outlive the pin.
    runStatusRegistry.clear(pin.id);
    vscode.window.showInformationMessage(l10n("pin.removed", { name }));
  } else if (choice === reveal) {
    // The file is gone, so reveal its parent folder (where it used to be) rather
    // than the missing file itself — revealFileInOS on a non-existent path is
    // unreliable across platforms.
    const parent = vscode.Uri.joinPath(uri, "..");
    await vscode.commands.executeCommand("revealFileInOS", parent);
  }
}

// Re-point a pin at a file the user picks — the one-click fix for a moved/renamed
// target. The pin keeps its id, run config, schedule, and icon; only its path
// changes. A project pin must land inside its owning workspace folder (its stored
// path is folder-relative); a file chosen elsewhere is rejected with a message
// naming why, so the gesture never silently writes an unresolvable path.
async function relocatePin(store: PinStore, pin: Pin): Promise<void> {
  const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: l10n("pin.missing.relocateOpenLabel"),
    title: l10n("pin.missing.relocateTitle", { name }),
  });
  if (!picked || picked.length === 0) {
    return;
  }
  const target = picked[0];
  const ok = await store.updatePinPath(pin, target);
  const fileName = target.path.split("/").pop() ?? target.fsPath;
  if (ok) {
    vscode.window.showInformationMessage(
      l10n("pin.relocated", { name, file: fileName })
    );
  } else {
    // The only rejection path is a project pin pointed outside its workspace folder.
    vscode.window.showWarningMessage(l10n("pin.relocateOutsideFolder", { name }));
  }
}

async function openPin(store: PinStore, pin: Pin): Promise<void> {
  // Opening counts as "tapping" the pin: it clears the pin from the untapped
  // count that drives the activity-bar badge (a discovery cue for unused pins).
  void tappedPins.mark(pin.id);
  // A non-file pin (recipe: url/shell/command/macro) must NOT run on a single
  // click — a shell or scheduled recipe is a heavy, side-effecting task. Instead,
  // a single click shows what it does and offers to run or promote it. The play
  // button / double-click is the deliberate "run" path.
  if (pinKind(pin) !== "file") {
    await showActionInfo(store, pin);
    return;
  }
  const uri = store.resolveUri(pin);
  if (!uri) {
    vscode.window.showWarningMessage(l10n("pin.missingFile", { path: pin.path }));
    return;
  }
  if (!(await fileExists(uri))) {
    await handleMissingFile(store, pin, uri);
    return;
  }
  // Preview mode (opt-in, default off) opens a single click in VS Code's native
  // transient tab (italic title), so clicking through a group of reference pins
  // reuses one tab instead of flooding the editor. When off, pins open as
  // permanent tabs — the long-standing default. Promotion to a permanent tab is
  // handled natively (editing the file) or by the double-click path, which always
  // opens with preview:false.
  const usePreview = vscode.workspace
    .getConfiguration("saropaWorkspace")
    .get<boolean>("previewMode.enabled", false);
  const editor = await vscode.window.showTextDocument(uri, { preview: usePreview });
  // A tail-follow pin (WOW #5) opens at the end and stays pinned there as the file
  // grows; it supersedes a line jump, since following means "show me the newest
  // lines", not "land on line N". A plain line pin (WOW #22) jumps + flashes.
  if (pin.tailFollow) {
    startTailFollow(editor);
  } else if (pin.line !== undefined) {
    revealAndFlashLine(editor, pin.line);
  }
}

// Reusable decoration for the line-pin flash. A single shared type is created once
// (creating one per call leaks decoration types) and toggled on/off around a brief
// highlight so the jumped-to line is visually obvious without a permanent mark.
const lineFlashDecoration = vscode.window.createTextEditorDecorationType({
  backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
  isWholeLine: true,
});

// Scroll a freshly-opened editor to a pin's 1-based target line, place the cursor
// there, and flash the line briefly. The line is clamped to the document length so a
// pin that drifted past the end (edits removed lines) still lands on a valid line.
function revealAndFlashLine(editor: vscode.TextEditor, oneBasedLine: number): void {
  const lastLine = editor.document.lineCount - 1;
  const zeroBased = Math.min(Math.max(oneBasedLine - 1, 0), lastLine);
  const range = editor.document.lineAt(zeroBased).range;
  editor.selection = new vscode.Selection(range.start, range.start);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  editor.setDecorations(lineFlashDecoration, [range]);
  // Clear the highlight after a moment so it reads as a flash, not a permanent mark.
  // Wrapped because the editor may be disposed (tab closed) by the time this fires;
  // setDecorations on a gone editor would otherwise throw.
  setTimeout(() => {
    try {
      editor.setDecorations(lineFlashDecoration, []);
    } catch {
      // Editor closed before the flash cleared — nothing to clear.
    }
  }, 1200);
}

// --- tail-follow log pins (WOW #5) ------------------------------------------
// URIs currently followed `tail -f`-style, keyed by uri string. A single shared
// document-change listener (registered once via registerTailFollow) keeps every
// followed doc scrolled to its newest line; a close listener drops the entry so a
// closed tab leaves nothing behind. In-memory only: a follow lives for one tab's
// lifetime and is re-armed from pin.tailFollow each time the pin is opened.
const followedDocs = new Set<string>();

// Begin following a freshly-opened editor: jump to the end now and remember the
// document so the shared change listener re-pins it to the tail on every append.
function startTailFollow(editor: vscode.TextEditor): void {
  followedDocs.add(editor.document.uri.toString());
  revealDocEnd(editor);
}

// Scroll an editor to its final line (the tail). Used on open and on every append.
// A no-op on an empty document, where there is no last line to reveal.
function revealDocEnd(editor: vscode.TextEditor): void {
  const lastLine = editor.document.lineCount - 1;
  if (lastLine < 0) {
    return;
  }
  const end = editor.document.lineAt(lastLine).range.end;
  editor.revealRange(
    new vscode.Range(end, end),
    vscode.TextEditorRevealType.Default
  );
}

// Wire the two listeners that drive tail-follow, once. Both are pushed to
// subscriptions so they dispose on deactivate.
function registerTailFollow(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    // A followed file grew (or changed) on disk: re-pin every visible editor
    // showing it to its newest line, so split views all track the tail like a
    // terminal would in each pane.
    vscode.workspace.onDidChangeTextDocument((event) => {
      const key = event.document.uri.toString();
      if (!followedDocs.has(key)) {
        return;
      }
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.uri.toString() === key) {
          revealDocEnd(editor);
        }
      }
    }),
    // The tab closed: stop following so the set never accumulates dead entries (a
    // stale follow would yank an unrelated reopened file to its end).
    vscode.workspace.onDidCloseTextDocument((doc) => {
      followedDocs.delete(doc.uri.toString());
    })
  );
}

// Toggle tail-follow on a file pin (WOW #5). Persists the flag so it sticks across
// sessions; on enable, offers to open the file now so the follow takes effect
// immediately rather than only on the next open. On disable, drops any live follow
// on the pin's file so the current tab stops auto-scrolling at once.
async function toggleTail(store: PinStore, pin: Pin): Promise<void> {
  const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
  if (pinKind(pin) !== "file") {
    vscode.window.showWarningMessage(l10n("tail.fileOnly", { name }));
    return;
  }
  const next = !pin.tailFollow;
  await store.setPinTail(pin, next);
  if (next) {
    const openNow = l10n("tail.openNow");
    const choice = await vscode.window.showInformationMessage(
      l10n("tail.enabled", { name }),
      openNow
    );
    if (choice === openNow) {
      // Re-fetch the stored pin so openPin sees the freshly-written tailFollow flag.
      await openPin(store, store.findPin(pin.id) ?? pin);
    }
    return;
  }
  // Disabling: stop any in-flight follow on this file immediately, not just on the
  // next open, so an open log tab stops jumping the moment the user turns it off.
  const uri = store.resolveUri(pin);
  if (uri) {
    followedDocs.delete(uri.toString());
  }
  vscode.window.showInformationMessage(l10n("tail.disabled", { name }));
}

// Show a file pin inside VS Code's native Peek overlay, floating over the active
// editor at the cursor, instead of opening a new tab (roadmap WOW #14). This lets
// the user glance at a pinned file without leaving the editor they are in — focus
// and the active tab are untouched; pressing Escape dismisses the overlay. Falls
// back gracefully: a non-file pin has no file to peek (its single-click info shows
// instead), and with no active editor there is nothing to overlay, so the file is
// opened normally.
async function peekPin(store: PinStore, pin: Pin): Promise<void> {
  // Peeking is a use of the pin, like opening: clear it from the untapped badge.
  void tappedPins.mark(pin.id);
  if (pinKind(pin) !== "file") {
    await showActionInfo(store, pin);
    return;
  }
  const uri = store.resolveUri(pin);
  if (!uri) {
    vscode.window.showWarningMessage(l10n("pin.missingFile", { path: pin.path }));
    return;
  }
  if (!(await fileExists(uri))) {
    await handleMissingFile(store, pin, uri);
    return;
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    // No editor to anchor the peek widget on; opening the file is the closest
    // behavior to "show me this file" when there is nothing to overlay.
    await vscode.window.showTextDocument(uri, { preview: false });
    return;
  }
  // editor.action.peekLocations(resource, position, locations, mode): render the
  // pinned file in an inline peek widget anchored at the current cursor. "peek"
  // keeps it a non-navigating overlay (focus stays in the active editor, no tab is
  // opened). The target position is the file's top (line 0), since the whole file
  // is the thing being glanced at, not a specific symbol.
  const target = new vscode.Location(uri, new vscode.Position(0, 0));
  await vscode.commands.executeCommand(
    "editor.action.peekLocations",
    editor.document.uri,
    editor.selection.active,
    [target],
    "peek"
  );
}

// Describe a non-file pin's action in one plain line — what running it would do.
function describeAction(pin: Pin): string {
  const action = pin.action;
  if (!action) {
    return pin.path;
  }
  switch (action.kind) {
    case "url":
      return l10n("recipe.desc.url", { url: action.url ?? "" });
    case "shell":
      return l10n("recipe.desc.shell", { command: action.shellCommand ?? "" });
    case "command":
      return l10n("recipe.desc.command", { id: action.commandId ?? "" });
    case "macro":
      return l10n("recipe.desc.macro", {
        steps: (action.steps ?? []).map((s) => s.label ?? s.kind).join(" -> "),
      });
    default:
      return pin.path;
  }
}

// Single-click surface for a non-file pin: a modal describing what it does, with
// Run / Promote actions. Nothing runs unless the user explicitly chooses Run, so
// a click can never kick off a heavy task by accident.
async function showActionInfo(store: PinStore, pin: Pin): Promise<void> {
  const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
  const scheduled = pin.schedule?.atTime
    ? l10n("recipe.info.scheduled", { time: pin.schedule.atTime })
    : "";
  // Lead the modal with the recipe's own description (what it does + what it was
  // detected from) when present, so the catalog prose is surfaced on click; the
  // concrete action line and any schedule note follow it.
  const detail = [pin.description, describeAction(pin), scheduled]
    .filter((part) => Boolean(part))
    .join("\n\n");

  const run = l10n("recipe.info.run");
  const promote = l10n("recipe.info.promote");
  const buttons = pin.isRecipe ? [run, promote] : [run];

  const choice = await vscode.window.showInformationMessage(
    l10n("recipe.info.title", { name }),
    { modal: true, detail },
    ...buttons
  );
  if (choice === run) {
    await runPinCommand(store, pin);
  } else if (choice === promote) {
    await vscode.commands.executeCommand("saropaWorkspace.promoteRecipe", pin);
  }
}

// Gate a run on the pin's prerequisite (WOW #13). Returns true when the pin may run
// (no dependency, or it succeeded this session). When the prerequisite has not yet
// succeeded, blocks with a warning that names it and offers to run it first, then
// returns false so the gated pin does not run this time.
async function ensureDependency(store: PinStore, pin: Pin): Promise<boolean> {
  const { pendingDependencyId } = dependencyState(pin, (id) => store.findPin(id));
  if (!pendingDependencyId) {
    return true;
  }
  const dep = store.findPin(pendingDependencyId);
  const depName = dep
    ? dep.label ?? (dep.path.split("/").pop() ?? dep.path)
    : pendingDependencyId;
  const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
  const runDep = l10n("depends.runAction", { dep: depName });
  const choice = await vscode.window.showWarningMessage(
    l10n("depends.blocked", { name, dep: depName }),
    runDep
  );
  // Offer to satisfy the prerequisite now; the user re-runs the gated pin once it
  // succeeds. Not chained automatically — the prerequisite may itself prompt, take
  // time, or fail, and silently cascading runs would be surprising.
  if (choice === runDep && dep) {
    await runPinCommand(store, dep);
  }
  return false;
}

async function runPinCommand(store: PinStore, pin: Pin): Promise<void> {
  // Running counts as "tapping" the pin (clears it from the untapped badge
  // count), the same as opening — every run path funnels through here.
  void tappedPins.mark(pin.id);
  // Block the run when a configured prerequisite has not succeeded this session,
  // offering to run it first (WOW #13).
  if (!(await ensureDependency(store, pin))) {
    return;
  }
  // Non-file pins (recipes: url/shell/command/macro) run through the action
  // dispatcher rather than the file runner.
  if (pinKind(pin) !== "file") {
    await runAction(pin);
    return;
  }
  const uri = store.resolveUri(pin);
  if (!uri) {
    vscode.window.showWarningMessage(l10n("pin.missingFile", { path: pin.path }));
    return;
  }
  // A deleted target cannot run: offer Unpin / Reveal instead of failing the
  // spawn with a cryptic shell error.
  if (!(await fileExists(uri))) {
    await handleMissingFile(store, pin, uri);
    return;
  }
  // A pin with no way to execute (a text doc, markdown, image — anything without
  // an interpreter) should not be flung at the shell on a double-click. Open it
  // instead (opening is itself the visible feedback) and say why "run" did not
  // run, naming the file so the message ties to a concrete pin.
  if (!isRunnable(pin, uri.fsPath)) {
    const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    await vscode.window.showTextDocument(uri, { preview: false });
    vscode.window.showInformationMessage(l10n("run.openedNotRunnable", { name }));
    return;
  }
  await execRunPin(pin, uri);
}

// Run a parameterized pin reusing the values entered last time, without re-asking
// (roadmap WOW #7 — the "force run" the un-capturable Alt+double-click stood for).
// For a pin with no interactive tokens it is just a normal run. For one with tokens,
// each token resolves from memory; only a token never answered for this pin still
// prompts (so a first bypass works and is then remembered). Canceling that one
// needed prompt aborts with nothing run. The resolved clone shares the pin's id, so
// uri resolution, telemetry, and the missing-file path are identical to a normal run.
async function runWithLastParams(store: PinStore, pin: Pin): Promise<void> {
  if (!hasInteractiveTokens(pin)) {
    await runPinCommand(store, pin);
    return;
  }
  const values = await resolveRememberedTokens(pin);
  if (values === undefined) {
    const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    vscode.window.showInformationMessage(l10n("run.canceledPromptToast", { name }));
    return;
  }
  await runPinCommand(store, cloneWithResolvedTokens(pin, values));
}

// Whether a pin's run config already references the $droppedFile token, so a
// drag-and-drop run knows whether to inject the path via the token (the user placed
// it where they want) or append it as a trailing argument (a plain script that just
// expects the file as its last arg).
function execReferencesDroppedFile(exec: Pin["exec"]): boolean {
  const strings = [exec?.command ?? "", ...(exec?.args ?? [])];
  return strings.some((s) => s.includes("$droppedFile"));
}

// Run a script pin against a file dropped onto it from the Explorer (WOW #8). The
// dropped path is exposed as the $droppedFile token; if the pin does not reference
// that token, the path is appended as a trailing argument so a plain script still
// receives the file. The stored pin is untouched — the appended arg applies to this
// run only. A non-file or non-runnable pin is a no-op with a naming message.
async function runPinOnDroppedFile(
  store: PinStore,
  pin: Pin,
  droppedFsPath: string
): Promise<void> {
  void tappedPins.mark(pin.id);
  const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
  if (pinKind(pin) !== "file") {
    return;
  }
  const uri = store.resolveUri(pin);
  if (!uri) {
    vscode.window.showWarningMessage(l10n("pin.missingFile", { path: pin.path }));
    return;
  }
  if (!(await fileExists(uri))) {
    await handleMissingFile(store, pin, uri);
    return;
  }
  if (!isRunnable(pin, uri.fsPath)) {
    vscode.window.showInformationMessage(l10n("drop.notRunnable", { name }));
    return;
  }
  // Inject the token; append it only when the pin does not already place it.
  const effectivePin: Pin = execReferencesDroppedFile(pin.exec)
    ? pin
    : {
        ...pin,
        exec: { ...pin.exec, args: [...(pin.exec?.args ?? []), "$droppedFile"] },
      };
  await execRunPin(effectivePin, uri, "manual", { droppedFile: droppedFsPath });
}

// Pin the active editor's file at the current cursor line as a "line pin" (WOW #22):
// opening it later jumps straight to this line and flashes it. Project scope when the
// file is inside a workspace folder, else global (a project pin must be folder-
// relative). The label carries the line so several line pins to one file are
// distinguishable in the tree.
async function pinToLine(store: PinStore): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage(l10n("pin.noActiveFile"));
    return;
  }
  const uri = editor.document.uri;
  const line = editor.selection.active.line + 1; // store 1-based
  const base = uri.path.split("/").pop() ?? uri.fsPath;
  const label = l10n("linePin.label", { name: base, line });
  // Project scope only when the file lives in a workspace folder (its path must be
  // folder-relative); otherwise global, so an external file still gets a line pin.
  const scope: PinScope = vscode.workspace.getWorkspaceFolder(uri)
    ? "project"
    : "global";
  await store.addLinePin(uri, scope, line, label);
  vscode.window.showInformationMessage(l10n("linePin.added", { name: base, line }));
}

async function pinUri(store: PinStore, uri: vscode.Uri, scope: PinScope): Promise<void> {
  const name = uri.path.split("/").pop() ?? uri.fsPath;
  const added = await store.addPin(uri, scope);
  if (added) {
    vscode.window.showInformationMessage(l10n("pin.added", { name }));
    // Offer inferred run targets (npm scripts, Make targets, a shebang) so the
    // pin runs the right thing without the user typing a command (7.5).
    await offerRunTarget(store, uri, scope, name);
  } else {
    vscode.window.showInformationMessage(l10n("pin.alreadyPinned", { name }));
  }
}

// After a file is pinned, detect run targets within it and, if any exist, let the
// user pick one to write as the pin's run config. Esc/dismiss leaves the pin with
// no run config (today's interpreter-default behavior) — the offer never blocks.
async function offerRunTarget(
  store: PinStore,
  uri: vscode.Uri,
  scope: PinScope,
  name: string
): Promise<void> {
  const targets = await detectRunTargets(uri);
  if (targets.length === 0) {
    return;
  }
  type TargetItem = vscode.QuickPickItem & { target: RunTarget };
  const items: TargetItem[] = targets.map((t) => ({
    label: t.label,
    detail: t.detail,
    target: t,
  }));
  const pick = await vscode.window.showQuickPick(items, {
    title: l10n("runTarget.title", { name }),
    placeHolder: l10n("runTarget.placeholder"),
  });
  if (!pick) {
    return;
  }
  const pin = store.findPinByUri(uri, scope);
  if (!pin) {
    return;
  }
  await store.updatePinExec(pin, pick.target.exec);
  vscode.window.showInformationMessage(
    l10n("runTarget.applied", { name, target: pick.label.replace(/^\$\([^)]*\)\s*/, "") })
  );
}

function activeFileUri(): vscode.Uri | undefined {
  return vscode.window.activeTextEditor?.document.uri;
}

// The file an editor-title / editor-tab "Pin Active File" invocation targets. The
// editor/title (and /context) menu passes the URI of the tab the user acted on as
// the first argument; honoring it is what makes right-clicking a specific tab pin
// THAT tab rather than whichever editor happens to be active (the bug where the
// active config tab was re-pinned no matter which tab was clicked). Falls back to
// the active editor for the keyboard / command-palette path, which passes no arg.
function editorTargetUri(arg: unknown): vscode.Uri | undefined {
  if (arg instanceof vscode.Uri) {
    return arg;
  }
  return activeFileUri();
}

// The file an add/remove-pin command should act on, resolved from whatever the
// invoking surface hands over: a raw Uri (the Explorer "Workspace Pin" submenu),
// a pin row (the Pins view — resolve its pin back to a file), or any other tree
// row carrying a resourceUri (the Project Files rows). One resolver lets the four
// add/remove commands serve all three surfaces, so the gesture never depends on
// which editor is focused.
function targetUri(store: PinStore, arg: unknown): vscode.Uri | undefined {
  // The editor-title (tab) and Explorer menus pass the acted-on file as a Uri —
  // honor it, so right-clicking a specific tab targets THAT tab, not the active
  // one.
  if (arg instanceof vscode.Uri) {
    return arg;
  }
  // A Pins-view row: resolve the pin back to its file (undefined for a non-file
  // recipe, which the submenu is gated against).
  if (arg instanceof PinTreeItem) {
    return store.resolveUri(arg.pin);
  }
  // A Project Files row (or any other file-backed tree row).
  if (arg instanceof vscode.TreeItem) {
    return arg.resourceUri;
  }
  // The editor-body context menu, command palette, and keybindings pass no tree
  // context: act on the file in the active editor.
  return activeFileUri();
}

// Remove the pin in a given scope that resolves to a file, naming it in the
// toast. A no-op-with-feedback when the file is not actually pinned in that scope
// (the "Remove from ... Pins" submenu item is static, so it can be invoked on a
// file that is not pinned there).
async function removePinForUri(
  store: PinStore,
  uri: vscode.Uri,
  scope: PinScope
): Promise<void> {
  const fileName = uri.path.split("/").pop() ?? uri.fsPath;
  const pin = store.findPinByUri(uri, scope);
  if (!pin) {
    const where =
      scope === "global"
        ? l10n("pin.group.global")
        : l10n("pin.group.project");
    vscode.window.showInformationMessage(
      l10n("pin.notPinned", { name: fileName, scope: where })
    );
    return;
  }
  const name = pin.label ?? fileName;
  await store.removePin(pin);
  // Drop any last-run badge so it does not outlive the pin.
  runStatusRegistry.clear(pin.id);
  vscode.window.showInformationMessage(l10n("pin.removed", { name }));
}

// Number of generic "run top pin N" keybinding slots exposed (4.2).
const TOP_PIN_SLOTS = 5;

// The pins in tree order (project first, then global) — the order the "top pin N"
// keybindings and reorder-by-drag designate.
function orderedPins(store: PinStore): Pin[] {
  return [...store.getProjectPins(), ...store.getGlobalPins()];
}

// Run the Nth pin (1-based) for the runTopPinN keybindings.
function runTopPin(store: PinStore, slot: number): void {
  const pin = orderedPins(store)[slot - 1];
  if (pin) {
    void runPinCommand(store, pin);
  } else {
    vscode.window.showInformationMessage(l10n("runTop.noPin", { slot }));
  }
}

// Resolve a keybinding `args` reference to a pin: by id, then label, then full
// path, then basename. First match across project + global wins.
function resolvePinRef(store: PinStore, ref: unknown): Pin | undefined {
  if (typeof ref !== "string" || ref.trim() === "") {
    return undefined;
  }
  const needle = ref.trim();
  const pins = orderedPins(store);
  return (
    pins.find((p) => p.id === needle) ??
    pins.find((p) => p.label === needle) ??
    pins.find((p) => p.path === needle) ??
    pins.find((p) => (p.path.split("/").pop() ?? p.path) === needle)
  );
}

// Build the scope + group descriptor shown beside a pin in the Run Pin palette,
// so the same filename in two scopes/groups is distinguishable at a glance.
function pinLocation(store: PinStore, pin: Pin): string {
  const scope =
    pin.scope === "global"
      ? l10n("pin.group.global")
      : l10n("pin.group.project");
  if (!pin.groupId) {
    return scope;
  }
  const group = store.getGroups(pin.scope).find((g) => g.id === pin.groupId);
  return group ? `${scope} / ${group.label}` : scope;
}

// QuickPick over every pin across scopes and groups, recently-run ones first, so
// a pin can be chosen without opening the sidebar (4.1). Shared by "Run Pin..."
// and "Run Pin with Overrides...". Returns undefined on empty set or dismissal.
async function pickPin(
  store: PinStore,
  placeHolder: string
): Promise<Pin | undefined> {
  const all = [...store.getProjectPins(), ...store.getGlobalPins()];
  if (all.length === 0) {
    vscode.window.showInformationMessage(l10n("runAny.empty"));
    return undefined;
  }

  type PinItem = vscode.QuickPickItem & { pin?: Pin };
  const toItem = (pin: Pin): PinItem => ({
    label: pin.label ?? (pin.path.split("/").pop() ?? pin.path),
    description: pinLocation(store, pin),
    detail: pin.path,
    pin,
  });

  // Recents first (only ids that still resolve to a live pin), then a separator
  // and the full set ordered as the tree shows it.
  const recentPins = telemetry
    .list()
    .map((id) => store.findPin(id))
    .filter((p): p is Pin => p !== undefined);

  const items: PinItem[] = [];
  if (recentPins.length > 0) {
    items.push({
      label: l10n("runAny.recent"),
      kind: vscode.QuickPickItemKind.Separator,
    });
    items.push(...recentPins.map(toItem));
    items.push({
      label: l10n("runAny.all"),
      kind: vscode.QuickPickItemKind.Separator,
    });
  }
  items.push(...all.map(toItem));

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder,
    matchOnDescription: true,
    matchOnDetail: true,
  });
  return pick?.pin;
}

// Run a chosen pin directly through the shared runPinCommand path (4.1).
async function runAnyPin(store: PinStore): Promise<void> {
  const pin = await pickPin(store, l10n("runAny.placeholder"));
  if (pin) {
    await runPinCommand(store, pin);
  }
}

// Run a pin with one-off argument / working-directory / environment overrides for
// this invocation only — the stored pin is untouched (7.7). Pre-fills from the
// stored config; canceling any step runs nothing. Runs through runPinCommand on
// an ephemeral clone that shares the pin's id, so uri resolution and recents are
// identical to a normal run.
async function runPinWithOverrides(store: PinStore): Promise<void> {
  const pin = await pickPin(store, l10n("override.pickPlaceholder"));
  if (!pin) {
    return;
  }

  const argsLine = await vscode.window.showInputBox({
    title: l10n("override.title", { name: pin.label ?? pin.path }),
    prompt: l10n("override.argsPrompt"),
    value: pin.exec?.args ? formatArgs(pin.exec.args) : "",
  });
  if (argsLine === undefined) {
    return;
  }

  const cwd = await vscode.window.showInputBox({
    title: l10n("override.title", { name: pin.label ?? pin.path }),
    prompt: l10n("override.cwdPrompt"),
    value: pin.exec?.cwd ?? "",
  });
  if (cwd === undefined) {
    return;
  }

  const envLine = await vscode.window.showInputBox({
    title: l10n("override.title", { name: pin.label ?? pin.path }),
    prompt: l10n("override.envPrompt"),
    placeHolder: l10n("override.envPlaceholder"),
    value: formatEnv(pin.exec?.env),
  });
  if (envLine === undefined) {
    return;
  }

  // Ephemeral clone: overrides apply to this run only; the persisted pin is
  // unchanged. cwd left blank reverts to the default (owning folder).
  const parsedArgs = parseArgs(argsLine);
  const overridden: Pin = {
    ...pin,
    exec: {
      ...pin.exec,
      args: parsedArgs.length > 0 ? parsedArgs : undefined,
      cwd: cwd.trim() === "" ? undefined : cwd.trim(),
      env: parseEnv(envLine),
    },
  };
  await runPinCommand(store, overridden);
}

// Render an env map as "KEY=value KEY2=value2" for the overrides input box.
function formatEnv(env: Record<string, string> | undefined): string {
  if (!env) {
    return "";
  }
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
}

// Parse a "KEY=value KEY2=value2" line back into an env map; entries without an
// "=" are skipped. Returns undefined when empty so the run inherits the
// environment unchanged.
function parseEnv(line: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const token of parseArgs(line)) {
    const eq = token.indexOf("=");
    if (eq > 0) {
      out[token.slice(0, eq)] = token.slice(eq + 1);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// The "New Group" action fires from the view title (no argument -> project, the
// repo-shared scope) or a scope root's context menu (a PinGroupItem carrying its
// scope). Default to project so a title-bar click has a defined home.
function scopeFromAddGroupArg(arg: unknown): PinScope {
  return arg instanceof PinGroupItem ? arg.group : "project";
}

export function registerPinCommands(
  context: vscode.ExtensionContext,
  store: PinStore,
  dispatcher: DoubleClickDispatcher
): void {
  const reg = (id: string, handler: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));

  // The manual Refresh is the user's explicit "re-scan now" — clear the cached
  // glob/detection so newly-added files matching auto-pin patterns or new recipes
  // surface (a plain refresh reuses the caches for speed).
  reg("saropaWorkspace.refresh", () => store.rescan());

  reg("saropaWorkspace.runAnyPin", () => runAnyPin(store));

  reg("saropaWorkspace.runPinWithOverrides", () => runPinWithOverrides(store));

  // Clear the local, on-device run history (the Recent group + palette recents).
  // Modal confirm because it is not undoable; the data never left the machine, so
  // there is nothing else to revoke.
  reg("saropaWorkspace.resetRunHistory", async () => {
    const confirm = l10n("telemetry.resetConfirmAction");
    const choice = await vscode.window.showWarningMessage(
      l10n("telemetry.resetConfirm"),
      { modal: true },
      confirm
    );
    if (choice === confirm) {
      await telemetry.reset();
      vscode.window.showInformationMessage(l10n("telemetry.resetDone"));
    }
  });

  // Open the on-demand local run-analytics summary (most-run pins, totals, the
  // session's success/failure split, last-run times) as a read-only Markdown
  // preview. Reads only on-device state; transmits nothing.
  reg("saropaWorkspace.showRunAnalytics", () => showRunAnalytics(store));

  // Define/reorder/enable the ordered pin set that runs on workspace open, and
  // run it on demand. The open-time confirm is wired in activate(); these are the
  // explicit, user-invoked entry points.
  reg("saropaWorkspace.configureBootSequence", () => configureBootSequence(store));
  reg("saropaWorkspace.runBootSequence", () => runBootSequence(store));

  // Export the user's pins (and their groups) to a shareable, versioned file, and
  // import such a file back in. Import is idempotent and additive — it never
  // overwrites existing pins, only adds the ones not already present.
  reg("saropaWorkspace.exportPins", () => exportPinSet(store));
  reg("saropaWorkspace.importPins", () => importPinSet(store));

  // Open the raw project pins JSON for direct editing; the file watcher in
  // activate() refreshes the tree live when it is saved.
  reg("saropaWorkspace.editPinsConfig", () => editPinsConfig());

  // Open a throwaway in-memory scratch buffer (WOW #6): an untitled doc that never
  // touches disk and never shows in git status. No store interaction — it is a pure
  // editor action — so it takes no pin/store argument.
  reg("saropaWorkspace.newScratchpad", () => newScratchpad());

  // Save / restore a named editor-grid layout (WOW #19). Pure editor actions backed
  // by globalState (passed the extension context), so they take no pin/store arg.
  reg("saropaWorkspace.saveLayout", () => saveLayout(context));
  reg("saropaWorkspace.restoreLayout", () => restoreLayout(context));

  // Bind a specific pin to a key. The keybinding's `args` is matched against a
  // pin's id, label, file path, or basename (in that order), so a user can bind
  // by a human-friendly reference instead of an opaque id:
  //   { "key": "...", "command": "saropaWorkspace.runPinById", "args": "deploy.sh" }
  reg("saropaWorkspace.runPinById", (ref: unknown) => {
    const pin = resolvePinRef(store, ref);
    if (pin) {
      void runPinCommand(store, pin);
    } else {
      vscode.window.showWarningMessage(l10n("runTop.notFound", { ref: String(ref) }));
    }
  });

  // Generic "run the Nth pin" commands, bindable without knowing any id. The Nth
  // pin is the Nth in the tree's order (project pins, then global) — reorder pins
  // by dragging to designate which are "top". One command per slot so each binds
  // to its own key.
  for (let slot = 1; slot <= TOP_PIN_SLOTS; slot++) {
    reg(`saropaWorkspace.runTopPin${slot}`, () => runTopPin(store, slot));
  }

  // Click dispatcher entry point: defer to single/double-click logic by pin id.
  reg("saropaWorkspace.activatePin", (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      dispatcher.activate(pin.id);
    }
  });

  reg("saropaWorkspace.openPin", (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      void openPin(store, pin);
    }
  });

  reg("saropaWorkspace.peekPin", (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      void peekPin(store, pin);
    }
  });

  // Tail-follow (WOW #5): toggle "auto-scroll to the end as the file grows" on a
  // file pin, and wire the listeners that keep followed docs pinned to their tail.
  reg("saropaWorkspace.toggleTail", (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      void toggleTail(store, pin);
    }
  });
  registerTailFollow(context);

  reg("saropaWorkspace.runPin", (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      void runPinCommand(store, pin);
    }
  });

  // "Run now" — the same run path as runPin, exposed under a distinct title so a
  // scheduled pin's context menu reads "Run now" (firing ahead of the timer is
  // intentional) rather than a generic "Run". The handler is identical; only the
  // label differs, gated by the pinScheduled / pinRecipeScheduled contextValue.
  reg("saropaWorkspace.runPinNow", (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      void runPinCommand(store, pin);
    }
  });

  reg("saropaWorkspace.runPinLastParams", (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      void runWithLastParams(store, pin);
    }
  });

  reg("saropaWorkspace.renamePin", async (arg: unknown) => {
    const pin = asPin(arg);
    if (!pin) {
      return;
    }
    const current = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    const label = await vscode.window.showInputBox({
      prompt: l10n("pin.renamePrompt", { name: current }),
      value: pin.label ?? "",
    });
    if (label !== undefined) {
      await store.renamePin(pin, label);
    }
  });

  reg("saropaWorkspace.configureRun", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await configureRun(store, pin);
    }
  });

  // Dry-run audit: show the exact command/cwd/env/location a run would use, in a
  // read-only Markdown preview, without executing anything. Available on every pin
  // kind (file, recipe, auto) since auditing a shared macro before running it is
  // the point.
  reg("saropaWorkspace.simulateRun", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await simulateRun(store, pin);
    }
  });

  // Drag-and-drop execution: run a script pin against a file dropped onto it from
  // the Explorer (WOW #8). Invoked by the tree's drop controller with the pin and
  // the dropped file's path.
  reg("saropaWorkspace.runPinOnFile", async (pinArg: unknown, fsPath: unknown) => {
    const pin = asPin(pinArg);
    if (pin && typeof fsPath === "string") {
      await runPinOnDroppedFile(store, pin, fsPath);
    }
  });

  // Diff a pin's last two background-run outputs to see what changed (WOW #20).
  reg("saropaWorkspace.diffLastRuns", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await diffLastRuns(pin);
    }
  });

  // Duplicate a file pin's target into a new file with a casing-aware rename, then
  // open it — the "template" boilerplate-buster (WOW #27).
  reg("saropaWorkspace.useAsTemplate", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await useAsTemplate(store, pin);
    }
  });

  // Copy a clickable Saropa import link for a pin to the clipboard, so its exact
  // configuration can be shared and re-imported in one click (WOW #4). The link
  // carries only the pin's configuration, never its id/scope — see shareLink.
  reg("saropaWorkspace.copyPinLink", async (arg: unknown) => {
    const pin = asPin(arg);
    if (!pin) {
      return;
    }
    const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    await vscode.env.clipboard.writeText(encodePinLink(pin));
    vscode.window.showInformationMessage(l10n("share.copied", { name }));
  });

  // Pin any file on disk — including one outside this workspace, in another repo —
  // as a global pin, without opening a second VS Code window (the "wormhole",
  // WOW #21). pinUri reports the result and offers run targets, the same as pinning
  // a file from the editor.
  reg("saropaWorkspace.pinExternalFile", async () => {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: l10n("external.openLabel"),
      title: l10n("external.title"),
    });
    if (picked && picked.length > 0) {
      await pinUri(store, picked[0], "global");
    }
  });

  reg("saropaWorkspace.stopPin", (arg: unknown) => {
    const pin = asPin(arg);
    if (!pin) {
      return;
    }
    const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    // Graceful stop: the pin shows a "stopping…" badge until the process exits,
    // and the registry auto-escalates to a forced kill if it does not.
    const stopping = processRegistry.stop(pin.id);
    if (stopping) {
      getOutputChannel().appendLine(
        l10n("run.stopped", { time: new Date().toLocaleString(), name })
      );
      vscode.window.showInformationMessage(l10n("run.stopMessage", { name }));
    } else {
      vscode.window.showInformationMessage(l10n("run.notRunning", { name }));
    }
  });

  // Force-kill the escape hatch: when a graceful Stop does not take, terminate the
  // process tree immediately.
  reg("saropaWorkspace.forceKillPin", (arg: unknown) => {
    const pin = asPin(arg);
    if (!pin) {
      return;
    }
    const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    const killed = processRegistry.forceKill(pin.id);
    if (killed) {
      getOutputChannel().appendLine(
        l10n("run.forceKilled", { time: new Date().toLocaleString(), name })
      );
      vscode.window.showInformationMessage(l10n("run.forceKillMessage", { name }));
    } else {
      vscode.window.showInformationMessage(l10n("run.notRunning", { name }));
    }
  });

  reg("saropaWorkspace.configureSchedule", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await configureSchedule(store, pin);
    }
  });

  reg("saropaWorkspace.configureTriggers", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await configureTriggers(store, pin);
    }
  });

  reg("saropaWorkspace.configureAppearance", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await configureAppearance(store, pin);
    }
  });

  reg("saropaWorkspace.unpin", async (arg: unknown) => {
    const pin = asPin(arg);
    if (!pin) {
      return;
    }
    const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    await store.removePin(pin);
    // Drop any last-run badge so it does not outlive the pin (the id is reused
    // for an identical re-pin only after a fresh run records a new result).
    runStatusRegistry.clear(pin.id);
    // Drop any remembered run-parameter values for the gone pin so they do not
    // accumulate in workspace state.
    void promptMemory.forget(pin.id);
    // Drop any captured run outputs so they do not linger for a reused id.
    runOutputs.clear(pin.id);
    vscode.window.showInformationMessage(l10n("pin.removed", { name }));
  });

  // Copy a tree node's full path to the clipboard. Available on every file-backed
  // row across both views (file pins, recipes, and the Project Files list); a
  // non-file recipe copies its action target. Nodes with nothing to copy (scope
  // roots, group folders) are no-ops — the menu is gated to file-backed items.
  reg("saropaWorkspace.copyPath", async (arg: unknown) => {
    const value = pathToCopy(store, arg);
    if (!value) {
      return;
    }
    await vscode.env.clipboard.writeText(value);
    vscode.window.showInformationMessage(l10n("path.copied", { path: value }));
  });

  // Reveal the shared output channel (background-run output, scheduled-run log,
  // and the "Show Output" target from a failed-run toast).
  reg("saropaWorkspace.showOutput", () => getOutputChannel().show(true));

  // Create a group in the project or global scope (see scopeFromAddGroupArg for
  // how the scope is resolved). Pins are dragged into it afterward.
  reg("saropaWorkspace.addGroup", async (arg: unknown) => {
    const scope = scopeFromAddGroupArg(arg);
    const label = await vscode.window.showInputBox({
      prompt: l10n("group.addPrompt"),
      placeHolder: l10n("group.addPlaceholder"),
      validateInput: (value) =>
        value.trim().length === 0 ? l10n("group.nameEmpty") : undefined,
    });
    if (label === undefined) {
      return;
    }
    const id = await store.createGroup(scope, label);
    if (id) {
      vscode.window.showInformationMessage(
        l10n("group.added", { name: label.trim() })
      );
    } else {
      // The only failure path for a non-empty label is a project group with no
      // workspace folder open; name that so the user knows why nothing changed.
      vscode.window.showWarningMessage(l10n("group.noWorkspace"));
    }
  });

  reg("saropaWorkspace.renameGroup", async (arg: unknown) => {
    if (!(arg instanceof PinFolderItem)) {
      return;
    }
    const label = await vscode.window.showInputBox({
      prompt: l10n("group.renamePrompt", { name: arg.pinGroup.label }),
      value: arg.pinGroup.label,
      validateInput: (value) =>
        value.trim().length === 0 ? l10n("group.nameEmpty") : undefined,
    });
    if (label !== undefined) {
      await store.renameGroup(arg.pinGroup, arg.scope, label);
    }
  });

  reg("saropaWorkspace.deleteGroup", async (arg: unknown) => {
    if (!(arg instanceof PinFolderItem)) {
      return;
    }
    const name = arg.pinGroup.label;
    // Modal confirm: deletion is destructive to the grouping (not the pins,
    // which move to the top level), so it should be a deliberate choice.
    const confirm = l10n("group.deleteConfirmAction");
    const choice = await vscode.window.showWarningMessage(
      l10n("group.deleteConfirm", { name }),
      { modal: true },
      confirm
    );
    if (choice !== confirm) {
      return;
    }
    const reparented = await store.deleteGroup(arg.pinGroup, arg.scope);
    vscode.window.showInformationMessage(
      l10n("group.deleted", { name, count: reparented })
    );
  });

  reg("saropaWorkspace.pinActiveFile", (arg: unknown) => {
    const uri = editorTargetUri(arg);
    if (!uri) {
      vscode.window.showWarningMessage(l10n("pin.noActiveFile"));
      return;
    }
    void pinUri(store, uri, "project");
  });

  // Pin the active file at the cursor line; opening the pin jumps back to it (#22).
  reg("saropaWorkspace.pinToLine", () => void pinToLine(store));

  reg("saropaWorkspace.pinActiveFileGlobal", (arg: unknown) => {
    const uri = editorTargetUri(arg);
    if (!uri) {
      vscode.window.showWarningMessage(l10n("pin.noActiveFile"));
      return;
    }
    void pinUri(store, uri, "global");
  });

  // Explorer context: VS Code passes (clickedUri, selectedUris[]).
  reg("saropaWorkspace.pinFile", (uri: vscode.Uri) => {
    if (uri) {
      void pinUri(store, uri, "project");
    }
  });

  reg("saropaWorkspace.pinFileGlobal", (uri: vscode.Uri) => {
    if (uri) {
      void pinUri(store, uri, "global");
    }
  });

  // Add/remove a file to/from each scope. One set of four commands backs the
  // Explorer "Workspace Pin" submenu, the Pins view row submenu, and the Project
  // Files inline toggle. The target file is resolved from whatever the surface
  // passes (a Uri, a pin row, or a file row) — see targetUri. The submenu hides
  // the invalid action per file via `resourcePath in/not in` context keys (synced
  // in extension.ts), but each command still validates at click time so a
  // command-palette / keybinding invocation (no resource gating) stays correct.
  reg("saropaWorkspace.addProjectPin", (arg: unknown) => {
    const uri = targetUri(store, arg);
    if (uri) {
      void pinUri(store, uri, "project");
    }
  });

  reg("saropaWorkspace.removeProjectPin", async (arg: unknown) => {
    const uri = targetUri(store, arg);
    if (uri) {
      await removePinForUri(store, uri, "project");
    }
  });

  reg("saropaWorkspace.addGlobalPin", (arg: unknown) => {
    const uri = targetUri(store, arg);
    if (uri) {
      void pinUri(store, uri, "global");
    }
  });

  reg("saropaWorkspace.removeGlobalPin", async (arg: unknown) => {
    const uri = targetUri(store, arg);
    if (uri) {
      await removePinForUri(store, uri, "global");
    }
  });

  // Convert a detected recipe into a stored, fully-editable pin (and suppress the
  // detected one so it does not duplicate).
  reg("saropaWorkspace.promoteRecipe", async (arg: unknown) => {
    const pin = asPin(arg);
    if (!pin) {
      return;
    }
    const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    const promoted = await store.promoteRecipe(pin);
    if (promoted) {
      vscode.window.showInformationMessage(l10n("recipe.promoted", { name }));
    }
  });

  reg("saropaWorkspace.restoreRecipes", async () => {
    const count = await store.restoreRecipes();
    vscode.window.showInformationMessage(
      count > 0
        ? l10n("recipe.restored", { count })
        : l10n("recipe.noneRemoved")
    );
  });

  reg("saropaWorkspace.restoreAutoPins", async () => {
    const count = await store.restoreAutoPins();
    vscode.window.showInformationMessage(
      count > 0
        ? l10n("pin.autoRestored", { count })
        : l10n("pin.autoNoneRemoved")
    );
  });

  reg("saropaWorkspace.importFavorites", async () => {
    const detected = await detectFavoritesFiles();
    const settingsCount = detectSettingsFavoritesCount();
    if (detected.length === 0 && settingsCount === 0) {
      vscode.window.showInformationMessage(l10n("import.none"));
      return;
    }
    const result = await importAllDetected(store);
    // Name every source the import drew from (files plus the settings key) so the
    // toast tells the user exactly where the pins came from.
    const sources = [
      ...detected.map((d) => d.fileName),
      ...(settingsCount > 0 ? ["favorites.resources"] : []),
    ];
    const fileList = sources.join(", ");
    if (result.added === 0) {
      vscode.window.showInformationMessage(l10n("import.nothingNew", { file: fileList }));
      return;
    }
    // Skipped entries (unsupported or malformed) are detailed in the output
    // channel; offer a one-click jump to it rather than burying the count.
    if (result.skipped > 0) {
      const showOutput = l10n("run.showOutput");
      const choice = await vscode.window.showInformationMessage(
        l10n("import.doneWithSkips", {
          count: result.added,
          file: fileList,
          skipped: result.skipped,
        }),
        showOutput
      );
      if (choice === showOutput) {
        void vscode.commands.executeCommand("saropaWorkspace.showOutput");
      }
      return;
    }
    vscode.window.showInformationMessage(
      l10n("import.done", { count: result.added, file: fileList })
    );
  });

  // Scan immediate sibling projects (one directory level up) for favorites files
  // and import the user's selection as GLOBAL pins. Explicit and user-invoked, so
  // cross-project disk reads only happen on demand.
  reg("saropaWorkspace.scanSiblingFavorites", async () => {
    const found = await detectSiblingFavorites();
    if (found.length === 0) {
      vscode.window.showInformationMessage(l10n("import.sibling.none"));
      return;
    }

    // Pre-checked multi-select: the user confirms which siblings to pull in.
    type SiblingItem = vscode.QuickPickItem & { sibling: SiblingFavorites };
    const items: SiblingItem[] = found.map((s) => ({
      label: s.siblingName,
      description: s.fileLabel,
      detail: s.fileUri.fsPath,
      picked: true,
      sibling: s,
    }));
    const picks = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: l10n("import.sibling.placeholder"),
    });
    if (!picks || picks.length === 0) {
      return;
    }

    let total = 0;
    for (const pick of picks) {
      total += await importSiblingFavorites(pick.sibling, store);
    }
    vscode.window.showInformationMessage(
      total > 0
        ? l10n("import.sibling.done", { count: total })
        : l10n("import.sibling.nothingNew")
    );
  });
}
