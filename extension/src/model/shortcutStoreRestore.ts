import * as vscode from "vscode";
import { Shortcut } from "./shortcut";
import { ShortcutStoreFieldUpdates } from "./shortcutStoreFieldUpdates";

// Restore (undo) layer: re-adding a time-bomb-expired shortcut, recording a scheduled
// fire's outcome, and the bulk "restore all removed auto-shortcuts / recipes"
// commands. Split out of shortcutStoreMutation.ts (which now holds only promote-
// recipe, via ShortcutStoreMutation) purely to keep that file under the project's
// line-count cap.
export abstract class ShortcutStoreRestore extends ShortcutStoreFieldUpdates {
  // Re-add a shortcut removed by the time-bomb sweep — the Undo path (WOW #9). The
  // expiry condition is dropped on the way back in, so an already-expired snapshot
  // is not swept away again the instant it returns (Undo defuses the bomb). The id
  // is preserved so any reused per-shortcut state lines up. A global shortcut is
  // pushed back to globalState; a project shortcut is written to its captured owning
  // folder (passed in, since the projectShortcutFolder map no longer holds the removed
  // id), falling back to the first workspace folder.
  async restoreShortcut(snapshot: Shortcut, folder?: vscode.WorkspaceFolder): Promise<void> {
    const restored: Shortcut = { ...snapshot, expires: undefined };
    if (snapshot.scope === "global") {
      const shortcuts = this.readGlobalShortcuts();
      restored.order = shortcuts.length;
      shortcuts.push(restored);
      await this.writeGlobalShortcuts(shortcuts);
      await this.refresh();
      return;
    }
    const owner = folder ?? vscode.workspace.workspaceFolders?.[0];
    if (!owner) {
      return;
    }
    const file = await this.readProjectFile(owner);
    restored.order = file.pins.length;
    file.pins.push(restored);
    await this.writeProjectFile(owner, file);
    await this.refresh();
  }

  // Record a scheduled fire: its epoch-ms time (for reopen de-duplication and
  // interval advancement, see nextOccurrence) and, when the fire produced a tracked
  // result, its outcome and the report it wrote (durable across reloads, unlike the
  // session-only runStatusRegistry — the Schedule screen reads these). `result` is
  // omitted for a bare time-stamp update (e.g. a skipped/missing fire that only
  // advances the schedule); when present, both fields are written even if undefined
  // so a fresh success clears a stale prior report path. No-op if the shortcut has
  // no schedule.
  async updateShortcutScheduleLastRun(
    shortcut: Shortcut,
    lastRun: number,
    result?: { outcome?: "success" | "failure"; reportRelPath?: string }
  ): Promise<void> {
    await this.mutateShortcut(shortcut, (target) => {
      if (!target.schedule) {
        return;
      }
      target.schedule.lastRun = lastRun;
      if (result) {
        target.schedule.lastOutcome = result.outcome;
        target.schedule.lastReportPath = result.reportRelPath;
      }
    });
  }

  // Re-add every removed auto-shortcut across all folders. Returns how many were
  // restored so the caller can report it.
  async restoreAutoShortcuts(): Promise<number> {
    let restored = 0;
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const file = await this.readProjectFile(folder);
      if (file.removedAutoPins.length > 0) {
        restored += file.removedAutoPins.length;
        file.removedAutoPins = [];
        await this.writeProjectFile(folder, file);
      }
    }
    if (restored > 0) {
      await this.refresh();
    }
    return restored;
  }

  async restoreRecipes(): Promise<number> {
    let restored = 0;
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const file = await this.readProjectFile(folder);
      if (file.removedRecipes.length > 0) {
        restored += file.removedRecipes.length;
        file.removedRecipes = [];
        await this.writeProjectFile(folder, file);
      }
    }
    if (restored > 0) {
      await this.refresh();
    }
    return restored;
  }
}
