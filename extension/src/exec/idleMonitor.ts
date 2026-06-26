import * as vscode from "vscode";

// Editor-idle detector for the run-on-idle trigger (WOW #18 — the "coffee break"
// runner). Tracks the time since the user last interacted with VS Code and fires
// onDidGoIdle once each time that span crosses a configured per-shortcut threshold, so a
// heavy shortcut can run in the background while the user is away from the keyboard.
//
// "Idle" here is EDITOR-scoped, not OS-wide: VS Code exposes no global input hook, so
// this watches window focus, cursor/selection movement, and the active editor — the
// signals that the user is actually working in the window. That is the right meaning
// of "you stepped away from coding"; it does not track mouse movement across the OS.
//
// Self-retrigger guard: a text-document CHANGE is deliberately NOT treated as activity.
// An idle run that writes files the editor reloads would otherwise reset the clock and,
// after another idle stretch, fire itself again in a loop. Human typing already moves
// the cursor, so onDidChangeTextEditorSelection covers "the user is here" without the
// programmatic-edit false positive that watching document content would introduce.
//
// Disposed on deactivation; every listener and the poll timer are released so nothing
// survives a reload to double-fire.
export class IdleMonitor implements vscode.Disposable {
  private readonly _onDidGoIdle = new vscode.EventEmitter<number>();

  // Fires with the threshold (in minutes) that was just crossed. The consumer runs the
  // shortcuts whose idle threshold equals that value. Firing the exact crossed threshold
  // (rather than the raw idle span) means a 3-minute shortcut never re-runs when a separate
  // 10-minute shortcut's boundary is later crossed in the same idle period.
  readonly onDidGoIdle = this._onDidGoIdle.event;

  private readonly disposables: vscode.Disposable[] = [];
  private lastActivity = Date.now();
  // Distinct idle thresholds in minutes, ascending. Empty => no idle-triggered shortcuts
  // exist => the poll timer stays off (no background work when nothing needs it).
  private thresholds: number[] = [];
  // Thresholds already emitted since the last activity, so each fires at most once per
  // idle period; cleared when the user returns so the next idle stretch can fire again.
  private readonly firedThisPeriod = new Set<number>();
  private timer: NodeJS.Timeout | undefined;

  // Poll cadence. Fine enough that a crossed threshold fires within this window of the
  // boundary, coarse enough to be a negligible background cost; the timer only runs
  // while at least one idle-triggered shortcut exists.
  private static readonly TICK_MS = 15_000;

  constructor() {
    // A regained window focus, a cursor/selection move, and an editor switch all mean
    // "the user is here". Window BLUR is intentionally NOT activity — stepping away is
    // exactly what should let the idle span accrue — so only the focused transition
    // resets the clock.
    this.disposables.push(
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          this.markActivity();
        }
      }),
      vscode.window.onDidChangeTextEditorSelection(() => this.markActivity()),
      vscode.window.onDidChangeActiveTextEditor(() => this.markActivity())
    );
  }

  // Replace the set of idle thresholds (in minutes) the monitor watches. The consumer
  // calls this whenever the shortcut set changes so adding/removing an idle shortcut takes effect
  // without a reload. Drops fired flags for thresholds that no longer exist, then arms
  // or stops the poll timer to match whether any thresholds remain.
  setThresholds(minutes: number[]): void {
    const distinct = [...new Set(minutes.filter((m) => m > 0))].sort(
      (a, b) => a - b
    );
    this.thresholds = distinct;
    for (const fired of [...this.firedThisPeriod]) {
      if (!distinct.includes(fired)) {
        this.firedThisPeriod.delete(fired);
      }
    }
    if (distinct.length === 0) {
      this.stopTimer();
    } else {
      this.startTimer();
    }
  }

  private markActivity(): void {
    this.lastActivity = Date.now();
    // The user is back: let every threshold fire again on the next idle stretch.
    this.firedThisPeriod.clear();
  }

  private startTimer(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => this.tick(), IdleMonitor.TICK_MS);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  // One poll: fire each not-yet-fired threshold the current idle span has reached.
  private tick(): void {
    const idleMs = Date.now() - this.lastActivity;
    for (const minutes of this.thresholds) {
      if (idleMs >= minutes * 60_000 && !this.firedThisPeriod.has(minutes)) {
        this.firedThisPeriod.add(minutes);
        this._onDidGoIdle.fire(minutes);
      }
    }
  }

  dispose(): void {
    this.stopTimer();
    this.firedThisPeriod.clear();
    this._onDidGoIdle.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
