// Keeps the last two background-run outputs per shortcut so "Diff Last Two Runs"
// (roadmap WOW #20) can show exactly what changed between attempt A and attempt B —
// the same error twice, or a new one? Memory-only (a reload starts fresh; run output
// is not worth persisting) and bounded to two entries per shortcut.

export interface CapturedRun {
  // Combined stdout+stderr of the run, in arrival order.
  output: string;
  // Epoch ms the run ended, shown in the diff titles to distinguish the two.
  endedAt: number;
  // Process exit code (null = killed by signal / spawn failure).
  exitCode: number | null;
}

class RunOutputs {
  // Not wired to onDidRemoveShortcut — `clear()` below is called explicitly only
  // from the "unpin" command (shortcutConfigCommands.ts), not from the other removal
  // paths (fileOps.ts delete-then-unpin, shortcutOpen.ts remove-missing,
  // shortcutAddRemove.ts, ShortcutExpiry's sweep) that call store.removeShortcut()
  // directly and rely on the centralized subscriber in extension.ts — which does not
  // clear this map. LEAK on those paths: capped at 2 entries per removed id, but
  // never reclaimed for the life of the window.
  // shortcut id -> up to two captured runs, oldest first ([previous, latest]).
  private readonly byShortcut = new Map<string, CapturedRun[]>();

  // Record a finished run's output, evicting anything older than the last two.
  record(pinId: string, run: CapturedRun): void {
    const list = this.byShortcut.get(pinId) ?? [];
    list.push(run);
    while (list.length > 2) {
      list.shift();
    }
    this.byShortcut.set(pinId, list);
  }

  // The two most recent runs as [older, newer], or undefined when fewer than two
  // have been captured for the shortcut (nothing to diff yet).
  lastTwo(pinId: string): [CapturedRun, CapturedRun] | undefined {
    const list = this.byShortcut.get(pinId);
    if (!list || list.length < 2) {
      return undefined;
    }
    return [list[0], list[1]];
  }

  // Drop a shortcut's captured runs (called on remove so they do not linger).
  clear(pinId: string): void {
    this.byShortcut.delete(pinId);
  }
}

// Module-level singleton: the runner records, the diff command reads.
export const runOutputs = new RunOutputs();
