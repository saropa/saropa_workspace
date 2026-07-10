import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { Shortcut, shortcutKind } from "../model/shortcut";
import { readCurrentBranch } from "../exec/gitBranch";
import { l10n } from "../i18n/l10n";

// Simple per-shortcut flag toggles: the masked/vault screen-share guard (WOW #26) and
// the git-branch link (WOW #3). Split out of shortcutInteraction.ts.

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
