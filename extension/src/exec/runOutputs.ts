// Keeps the last two background-run outputs per pin so "Diff Last Two Runs"
// (roadmap WOW #20) can show exactly what changed between attempt A and attempt B —
// the same error twice, or a new one? Memory-only (a reload starts fresh; run output
// is not worth persisting) and bounded to two entries per pin.

export interface CapturedRun {
  // Combined stdout+stderr of the run, in arrival order.
  output: string;
  // Epoch ms the run ended, shown in the diff titles to distinguish the two.
  endedAt: number;
  // Process exit code (null = killed by signal / spawn failure).
  exitCode: number | null;
}

class RunOutputs {
  // pinId -> up to two captured runs, oldest first ([previous, latest]).
  private readonly byPin = new Map<string, CapturedRun[]>();

  // Record a finished run's output, evicting anything older than the last two.
  record(pinId: string, run: CapturedRun): void {
    const list = this.byPin.get(pinId) ?? [];
    list.push(run);
    while (list.length > 2) {
      list.shift();
    }
    this.byPin.set(pinId, list);
  }

  // The two most recent runs as [older, newer], or undefined when fewer than two
  // have been captured for the pin (nothing to diff yet).
  lastTwo(pinId: string): [CapturedRun, CapturedRun] | undefined {
    const list = this.byPin.get(pinId);
    if (!list || list.length < 2) {
      return undefined;
    }
    return [list[0], list[1]];
  }

  // Drop a pin's captured runs (called on unpin so they do not linger).
  clear(pinId: string): void {
    this.byPin.delete(pinId);
  }
}

// Module-level singleton: the runner records, the diff command reads.
export const runOutputs = new RunOutputs();
