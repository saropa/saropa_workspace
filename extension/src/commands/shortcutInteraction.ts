import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { Shortcut, shortcutKind, isAnnotationShortcut } from "../model/shortcut";
import { tappedShortcuts } from "../model/tappedShortcuts";
import { telemetry } from "../exec/telemetry";
import { runStatusRegistry } from "../exec/runStatus";
import { readCurrentBranch } from "../exec/gitBranch";
import { l10n } from "../i18n/l10n";
import { runShortcutCommand } from "./shortcutExecution";

// The open / peek surface for a shortcut and its line-jump + tail-follow behavior, plus
// the missing-file recovery and branch-link toggle. Split out of pinCommands.ts so
// the command-registration file stays a thin dispatcher; the run-execution hub lives
// in pinExecution, the shortcut-picking/creation helpers in pinSelection.

// Whether a file exists on disk right now. The store's cached missing-set flags
// the shortcut in the tree, but a click re-checks authoritatively here so a file
// restored (or moved back) since the last refresh still opens without a stale
// "missing" verdict.
export async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

// A shortcut whose target file is gone: instead of letting VS Code surface a raw
// "cannot open file" error, name the shortcut and offer the useful next steps — relocate
// it to the moved/renamed file, remove the dead shortcut, or open the folder it used to
// live in (to find the file). The shortcut is never auto-removed: a deletion is often
// transient (a branch switch, a regenerated artifact), and project shortcuts are shared
// via the repo.
export async function handleMissingFile(
  store: ShortcutStore,
  shortcut: Shortcut,
  uri: vscode.Uri
): Promise<void> {
  const name = shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
  const relocate = l10n("pin.missing.relocate");
  const remove = l10n("pin.missing.unpin");
  const reveal = l10n("pin.missing.reveal");
  // Relocate leads: re-pointing a moved/renamed file keeps the shortcut (and its run
  // config, schedule, icon) intact, the better fix when the file still exists
  // somewhere; Remove and Show in Folder follow as the give-up / go-look paths.
  const choice = await vscode.window.showWarningMessage(
    l10n("pin.missing.message", { name, path: shortcut.path }),
    relocate,
    remove,
    reveal
  );
  if (choice === relocate) {
    await relocateShortcut(store, shortcut);
  } else if (choice === remove) {
    await store.removeShortcut(shortcut);
    // Drop any last-run badge so it does not outlive the shortcut.
    runStatusRegistry.clear(shortcut.id);
    vscode.window.showInformationMessage(l10n("pin.removed", { name }));
  } else if (choice === reveal) {
    // The file is gone, so reveal its parent folder (where it used to be) rather
    // than the missing file itself — revealFileInOS on a non-existent path is
    // unreliable across platforms.
    const parent = vscode.Uri.joinPath(uri, "..");
    await vscode.commands.executeCommand("revealFileInOS", parent);
  }
}

// Re-point a shortcut at a file the user picks — the one-click fix for a moved/renamed
// target. The shortcut keeps its id, run config, schedule, and icon; only its path
// changes. A project shortcut must land inside its owning workspace folder (its stored
// path is folder-relative); a file chosen elsewhere is rejected with a message
// naming why, so the gesture never silently writes an unresolvable path.
async function relocateShortcut(store: ShortcutStore, shortcut: Shortcut): Promise<void> {
  const name = shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: l10n("pin.missing.relocateOpenLabel"),
    title: l10n("pin.missing.relocateTitle", { name }),
  });
  if (!picked || picked.length === 0) {
    return;
  }
  const target = picked[0];
  const ok = await store.updateShortcutPath(shortcut, target);
  const fileName = target.path.split("/").pop() ?? target.fsPath;
  if (ok) {
    vscode.window.showInformationMessage(
      l10n("pin.relocated", { name, file: fileName })
    );
  } else {
    // The only rejection path is a project shortcut pointed outside its workspace folder.
    vscode.window.showWarningMessage(l10n("pin.relocateOutsideFolder", { name }));
  }
}

export async function openShortcut(store: ShortcutStore, shortcut: Shortcut): Promise<void> {
  // A comment / separator annotation has nothing to open — it only labels or
  // divides the list. Inert by design (its tree row also carries no command, so
  // this guards only the command-palette / keybinding paths).
  if (isAnnotationShortcut(shortcut)) {
    return;
  }
  // Opening counts as "tapping" the shortcut: it clears the shortcut from the untapped
  // count that drives the activity-bar badge (a discovery cue for unused shortcuts).
  void tappedShortcuts.mark(shortcut.id);
  // A url/website shortcut opens the site directly on a single click — a website is
  // safe and instant, so it follows the product's single-click-opens gesture exactly
  // like a file, rather than the info-then-run path the heavier recipes take. Routed
  // through the normal run path (which calls openExternal + a toast naming the site).
  const kind = shortcutKind(shortcut);
  if (kind === "url") {
    await runShortcutCommand(store, shortcut);
    return;
  }
  // Every other non-file shortcut (shell/command/macro/routine) must NOT run on a
  // single click — a shell or scheduled recipe is a heavy, side-effecting task.
  // Instead, a single click shows what it does and offers to run or promote it. The
  // play button / double-click is the deliberate "run" path.
  if (kind !== "file") {
    await showActionInfo(store, shortcut);
    return;
  }
  const uri = store.resolveUri(shortcut);
  if (!uri) {
    vscode.window.showWarningMessage(l10n("pin.missingFile", { path: shortcut.path }));
    return;
  }
  if (!(await fileExists(uri))) {
    await handleMissingFile(store, shortcut, uri);
    return;
  }
  // Masked / vault shortcut (WOW #26 — the screen-share guard): a stray click must never
  // instantly display a secret file. Gate the open behind a modal reveal confirm that
  // names the real target — the one place the real name is surfaced, and only on a
  // deliberate confirm (the modal blocks, so a single errant click cannot fall
  // through to Reveal). Cancel (any non-Reveal result) leaves the file unopened. This
  // gates the OPEN; it cannot redact an already-open document (no API blurs editor
  // text), which is the documented fidelity limit of this feature.
  if (shortcut.masked) {
    const name = shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
    const reveal = l10n("mask.revealAction");
    const choice = await vscode.window.showWarningMessage(
      l10n("mask.revealConfirm", { name }),
      { modal: true, detail: l10n("mask.revealDetail") },
      reveal
    );
    if (choice !== reveal) {
      return;
    }
  }
  // Preview mode (opt-in, default off) opens a single click in VS Code's native
  // transient tab (italic title), so clicking through a group of reference shortcuts
  // reuses one tab instead of flooding the editor. When off, shortcuts open as
  // permanent tabs — the long-standing default. Promotion to a permanent tab is
  // handled natively (editing the file) or by the double-click path, which always
  // opens with preview:false.
  const usePreview = vscode.workspace
    .getConfiguration("saropaWorkspace")
    .get<boolean>("previewMode.enabled", false);
  const editor = await vscode.window.showTextDocument(uri, { preview: usePreview });
  // Record the open in the Recent list so a just-opened file shortcut is one click from
  // re-opening — the Recent group is no longer run-only. Distinct from a run: this
  // does NOT bump the lifetime run count (an open is not a run). The tappedShortcuts.mark
  // above already cleared this shortcut from the untapped badge; this adds the recency
  // entry. Only file shortcuts reach here (the non-file branch returned above), which is
  // exactly the "opened a file" semantics the Recent-on-open behavior targets.
  void telemetry.recordOpen(shortcut.id);
  // A tail-follow shortcut (WOW #5) opens at the end and stays pinned there as the file
  // grows; it supersedes a line jump, since following means "show me the newest
  // lines", not "land on line N". A plain line shortcut (WOW #22) jumps + flashes.
  if (shortcut.tailFollow) {
    startTailFollow(editor);
  } else if (shortcut.line !== undefined) {
    revealAndFlashLine(editor, shortcut.line);
  }
}

// Reusable decoration for the line-shortcut flash. A single shared type is created once
// (creating one per call leaks decoration types) and toggled on/off around a brief
// highlight so the jumped-to line is visually obvious without a permanent mark.
const lineFlashDecoration = vscode.window.createTextEditorDecorationType({
  backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
  isWholeLine: true,
});

// Scroll a freshly-opened editor to a shortcut's 1-based target line, place the cursor
// there, and flash the line briefly. The line is clamped to the document length so a
// shortcut that drifted past the end (edits removed lines) still lands on a valid line.
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

// --- tail-follow log shortcuts (WOW #5) ------------------------------------------
// URIs currently followed `tail -f`-style, keyed by uri string. A single shared
// document-change listener (registered once via registerTailFollow) keeps every
// followed doc scrolled to its newest line; a close listener drops the entry so a
// closed tab leaves nothing behind. In-memory only: a follow lives for one tab's
// lifetime and is re-armed from shortcut.tailFollow each time the shortcut is opened.
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
export function registerTailFollow(context: vscode.ExtensionContext): void {
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

// Toggle tail-follow on a file shortcut (WOW #5). Persists the flag so it sticks across
// sessions; on enable, offers to open the file now so the follow takes effect
// immediately rather than only on the next open. On disable, drops any live follow
// on the shortcut's file so the current tab stops auto-scrolling at once.
export async function toggleTail(store: ShortcutStore, shortcut: Shortcut): Promise<void> {
  const name = shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
  if (shortcutKind(shortcut) !== "file") {
    vscode.window.showWarningMessage(l10n("tail.fileOnly", { name }));
    return;
  }
  const next = !shortcut.tailFollow;
  await store.setShortcutTail(shortcut, next);
  if (next) {
    const openNow = l10n("tail.openNow");
    const choice = await vscode.window.showInformationMessage(
      l10n("tail.enabled", { name }),
      openNow
    );
    if (choice === openNow) {
      // Re-fetch the stored shortcut so openShortcut sees the freshly-written tailFollow flag.
      await openShortcut(store, store.findShortcut(shortcut.id) ?? shortcut);
    }
    return;
  }
  // Disabling: stop any in-flight follow on this file immediately, not just on the
  // next open, so an open log tab stops jumping the moment the user turns it off.
  const uri = store.resolveUri(shortcut);
  if (uri) {
    followedDocs.delete(uri.toString());
  }
  vscode.window.showInformationMessage(l10n("tail.disabled", { name }));
}

// Toggle a stored file shortcut's masked / vault flag (WOW #26 — the screen-share guard).
// Masking hides the shortcut's identity in the tree (generic label + lock glyph, path
// hidden from row and hover) and gates its open behind a reveal confirm, so a secret
// file (.env.production) never flashes on a shared screen from a stray click. A single
// toggle (mirroring toggleTail / toggleBranchLink) since the row's lock glyph makes
// the current state obvious. Restricted to a stored file shortcut: a non-file action has no
// document to guard, and auto/recipe shortcuts are recomputed (not stored) so a flag cannot
// persist on them — both are rejected with a naming message.
export async function toggleMask(store: ShortcutStore, shortcut: Shortcut): Promise<void> {
  const name = shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
  if (shortcut.isAuto || shortcut.isRecipe) {
    vscode.window.showWarningMessage(l10n("mask.unsupported", { name }));
    return;
  }
  if (shortcutKind(shortcut) !== "file") {
    vscode.window.showWarningMessage(l10n("mask.fileOnly", { name }));
    return;
  }
  // Already masked: reveal it permanently (the row shows the real name again).
  if (shortcut.masked) {
    await store.setMasked(shortcut, false);
    vscode.window.showInformationMessage(l10n("mask.off", { name }));
    return;
  }
  await store.setMasked(shortcut, true);
  vscode.window.showInformationMessage(l10n("mask.on", { name }));
}

// Toggle a stored shortcut's branch link (WOW #3). When the shortcut is unlinked, scope it to
// the current git branch of its owning folder (the first workspace folder for a
// global shortcut); when already linked, clear the link so it shows on every branch.
// Single toggle (mirroring toggleTail) rather than two menu entries, because the
// tree's contextValue scheme has no spare per-item dimension to gate two labels on
// without destabilizing the existing exact-match menu clauses; the row's "on
// <branch>" chip makes the current state obvious. Auto/recipe shortcuts are recomputed
// (not stored) and cannot carry a branch, so they are rejected up front. A read
// failure warns instead of guessing, so a shortcut never gets a branch it can never match.
export async function toggleBranchLink(store: ShortcutStore, shortcut: Shortcut): Promise<void> {
  const name = shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
  if (shortcut.isAuto || shortcut.isRecipe) {
    vscode.window.showWarningMessage(l10n("branch.unsupported", { name }));
    return;
  }
  // Already linked: clear it ("show on all branches").
  if (shortcut.branch !== undefined) {
    await store.setShortcutBranch(shortcut, undefined);
    vscode.window.showInformationMessage(l10n("branch.unlinked", { name }));
    return;
  }
  // Unlinked: scope it to the owning folder's current branch.
  const folder = store.folderOf(shortcut) ?? vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showWarningMessage(l10n("branch.noRepo", { name }));
    return;
  }
  const branch = await readCurrentBranch(folder);
  if (!branch) {
    vscode.window.showWarningMessage(l10n("branch.noBranch", { name }));
    return;
  }
  await store.setShortcutBranch(shortcut, branch);
  vscode.window.showInformationMessage(l10n("branch.linked", { name, branch }));
}

// Show a file shortcut inside VS Code's native Peek overlay, floating over the active
// editor at the cursor, instead of opening a new tab (roadmap WOW #14). This lets
// the user glance at a shortcut's file without leaving the editor they are in — focus
// and the active tab are untouched; pressing Escape dismisses the overlay. Falls
// back gracefully: a non-file shortcut has no file to peek (its single-click info shows
// instead), and with no active editor there is nothing to overlay, so the file is
// opened normally.
export async function peekShortcut(store: ShortcutStore, shortcut: Shortcut): Promise<void> {
  // A comment / separator annotation has no file to peek — inert by design.
  if (isAnnotationShortcut(shortcut)) {
    return;
  }
  // Peeking is a use of the shortcut, like opening: clear it from the untapped badge.
  void tappedShortcuts.mark(shortcut.id);
  if (shortcutKind(shortcut) !== "file") {
    await showActionInfo(store, shortcut);
    return;
  }
  const uri = store.resolveUri(shortcut);
  if (!uri) {
    vscode.window.showWarningMessage(l10n("pin.missingFile", { path: shortcut.path }));
    return;
  }
  if (!(await fileExists(uri))) {
    await handleMissingFile(store, shortcut, uri);
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
  // shortcut's file in an inline peek widget anchored at the current cursor. "peek"
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

// Describe a non-file shortcut's action in one plain line — what running it would do.
function describeAction(shortcut: Shortcut): string {
  const action = shortcut.action;
  if (!action) {
    return shortcut.path;
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
      return shortcut.path;
  }
}

// Single-click surface for a non-file shortcut: a modal describing what it does, with
// Run / Promote actions. Nothing runs unless the user explicitly chooses Run, so
// a click can never kick off a heavy task by accident.
export async function showActionInfo(store: ShortcutStore, shortcut: Shortcut): Promise<void> {
  const name = shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
  const scheduled = shortcut.schedule?.atTime
    ? l10n("recipe.info.scheduled", { time: shortcut.schedule.atTime })
    : "";
  // Lead the modal with the recipe's own description (what it does + what it was
  // detected from) when present, so the catalog prose is surfaced on click; the
  // concrete action line and any schedule note follow it.
  const detail = [shortcut.description, describeAction(shortcut), scheduled]
    .filter((part) => Boolean(part))
    .join("\n\n");

  const run = l10n("recipe.info.run");
  const promote = l10n("recipe.info.promote");
  const buttons = shortcut.isRecipe ? [run, promote] : [run];

  const choice = await vscode.window.showInformationMessage(
    l10n("recipe.info.title", { name }),
    { modal: true, detail },
    ...buttons
  );
  if (choice === run) {
    await runShortcutCommand(store, shortcut);
  } else if (choice === promote) {
    await vscode.commands.executeCommand("saropaWorkspace.promoteRecipe", shortcut);
  }
}
