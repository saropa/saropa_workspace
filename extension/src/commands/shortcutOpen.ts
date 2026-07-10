import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { Shortcut, shortcutKind, isAnnotationShortcut } from "../model/shortcut";
import { tappedShortcuts } from "../model/tappedShortcuts";
import { telemetry } from "../exec/telemetry";
import { runStatusRegistry } from "../exec/runStatus";
import { l10n } from "../i18n/l10n";
import { runShortcutCommand } from "./shortcutExecution";
import { startTailFollow } from "./shortcutTailFollow";
import { showActionInfo } from "./shortcutPeek";

// The single-click "open" surface for a shortcut: resolving/opening its file (with
// missing-file recovery and relocate), the masked-file reveal gate, and the line-jump
// flash. Split out of shortcutInteraction.ts; tail-follow and the non-file info modal
// live in their own sibling files since openShortcut hands off to both.

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

// The single-click entry point for a shortcut: a url opens directly (safe and instant,
// so it follows the file gesture), any other non-file recipe shows its info panel instead
// of running (a click must never fire a side-effecting shell/command/macro), and a file
// resolves its uri, recovers from a missing target, gates a masked reveal, opens it, marks
// it tapped/recent, then applies tail-follow or a line jump.
export async function openShortcut(store: ShortcutStore, shortcut: Shortcut): Promise<void> {
  // A comment / separator annotation has nothing to open — it only labels or
  // divides the list. Inert by design (its tree row also carries no command, so
  // this guards only the command-palette / keybinding paths).
  if (isAnnotationShortcut(shortcut)) {
    return;
  }
  // Opening counts as "tapping" the shortcut: it clears the shortcut's untapped dot
  // (a discovery cue for unused shortcuts).
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
  // above already cleared this shortcut's untapped dot; this adds the recency
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
