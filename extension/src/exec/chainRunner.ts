import * as vscode from "vscode";
import { Shortcut, ShortcutTrigger, SystemEventName } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { shortcutEvents, ShortcutRunOutcome } from "./shortcutEvents";
import { systemEvents } from "./systemEvents";
import { IdleMonitor } from "./idleMonitor";
import { getOutputChannel, runBlockReason, blockReasonLabel } from "./runner";
import { hasInteractiveTokens } from "./promptTokens";
import { l10n } from "../i18n/l10n";

// The chain engine (WOW: recipe chaining + special events). It listens on two buses
// and auto-runs shortcuts whose triggers name the cause:
//   - shortcutEvents.onDidComplete: a shortcut finished. Forward that shortcut's `emits`
//     (build / publish) onto the system bus, then run every shortcut triggered "after"
//     this shortcut (honoring onlyOnSuccess).
//   - systemEvents.onDidFire: a system event happened (build / publish from an emit,
//     gitCommit / gitPush from the repo watcher). Run every shortcut triggered by it.
//
// Running a dependent goes through the normal Run command, so it reuses token
// resolution, the visible toast, telemetry, and — crucially — fires its OWN
// completion, which is how a chain of three (A -> B -> C) propagates.
//
// Storm / cycle guard: a configuration like A triggers B, B triggers A would loop
// forever. A per-shortcut cooldown breaks it: a shortcut will not be AUTO-run again within
// COOLDOWN_MS of its last auto-run. Manual runs are never blocked. The cooldown is
// per shortcut (not a global lock), so independent chains still run concurrently; it only
// stops a shortcut re-entering its own cascade. Disposable so both bus subscriptions are
// released on deactivation.
const COOLDOWN_MS = 3000;

export class ChainRunner implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  // pinId -> epoch ms of its last auto-run, for the re-entrancy cooldown.
  private readonly lastAutoRun = new Map<string, number>();

  constructor(
    private readonly store: ShortcutStore,
    private readonly idleMonitor: IdleMonitor
  ) {
    this.disposables.push(
      shortcutEvents.onDidComplete((c) => this.onShortcutCompleted(c.pinId, c.outcome)),
      systemEvents.onDidFire((event) => this.onSystemEvent(event)),
      // Run-on-idle (WOW #18): the monitor fires the exact idle threshold crossed; run
      // every shortcut whose idle trigger names that threshold.
      idleMonitor.onDidGoIdle((minutes) => this.onIdle(minutes)),
      // Keep the monitor's watched thresholds in step with the shortcut set: any store
      // change can add or remove an idle-triggered shortcut (or edit its minutes), so the
      // set of distinct thresholds is re-derived each time. The store fires onDidChange
      // on init too, so the monitor is seeded before the first idle stretch.
      store.onDidChange(() => this.syncIdleThresholds())
    );
    // Seed immediately in case the store's init refresh already fired above.
    this.syncIdleThresholds();
  }

  // Collect the distinct idle thresholds (minutes) across all stored shortcuts and hand them
  // to the monitor, which only runs its poll timer while at least one exists.
  private syncIdleThresholds(): void {
    const minutes: number[] = [];
    for (const shortcut of this.allStoredShortcuts()) {
      // A paused shortcut contributes no idle threshold — pausing suspends its idle
      // trigger like every other unattended runner, so the monitor need not poll
      // for a stretch only a paused shortcut would react to.
      if (shortcut.paused) {
        continue;
      }
      for (const trigger of shortcut.triggers ?? []) {
        if (trigger.kind === "idle") {
          minutes.push(trigger.minutes);
        }
      }
    }
    this.idleMonitor.setThresholds(minutes);
  }

  // The window has been idle long enough to cross `minutes`. Run every shortcut whose idle
  // trigger names exactly that threshold, forced to the background channel so an
  // unattended run never hijacks the terminal or pops an external window.
  private onIdle(minutes: number): void {
    this.runMatching(
      (trigger) => trigger.kind === "idle" && trigger.minutes === minutes,
      l10n("chain.cause.idle", { minutes }),
      true
    );
  }

  // A shortcut finished. First forward its emitted system events (only on a non-failing
  // completion — a failed build should not trigger the post-build steps), then run
  // the shortcuts chained directly after it.
  private onShortcutCompleted(pinId: string, outcome: ShortcutRunOutcome): void {
    const source = this.store.findShortcut(pinId);
    // A paused shortcut emits no system events on completion (a manual run of a paused
    // build shortcut should not trigger its downstream publish chain), matching how its
    // own triggers are suppressed below.
    if (source?.emits && !source.paused && outcome !== "failure") {
      for (const event of source.emits) {
        systemEvents.fire(event);
      }
    }

    // onlyOnSuccess gates a shortcut trigger: skip it when the source failed. A
    // "dispatched" outcome (an untracked run with no known exit) counts as success,
    // because there is no failure signal to withhold on.
    const failed = outcome === "failure";
    this.runMatching(
      (trigger) =>
        trigger.kind === "pin" &&
        trigger.pinId === pinId &&
        !(failed && trigger.onlyOnSuccess),
      l10n("chain.cause.afterPin", {
        name: source ? nameOf(source) : pinId,
      })
    );
  }

  // A system event happened: run every shortcut triggered by it.
  private onSystemEvent(event: SystemEventName): void {
    this.runMatching(
      (trigger) => trigger.kind === "event" && trigger.event === event,
      l10n("chain.cause.event", { event: l10n(`chain.event.${event}`) })
    );
  }

  // Run every stored shortcut that carries a trigger matching `predicate`, subject to the
  // per-shortcut cooldown. `cause` is a short human phrase ("after Build", "on git push",
  // "while idle 3m") logged with each fire so the output channel reads as an audit
  // trail. `forceBackground` is set for the idle path: the run is routed to the
  // background channel regardless of the shortcut's saved location, and a shortcut needing
  // interactive input is skipped (an unattended idle run cannot answer a prompt).
  private runMatching(
    predicate: (trigger: ShortcutTrigger) => boolean,
    cause: string,
    forceBackground = false
  ): void {
    const now = Date.now();
    const channel = getOutputChannel();
    for (const shortcut of this.allStoredShortcuts()) {
      // A paused shortcut's triggers are inert: skip it before any cooldown / interactive
      // bookkeeping so a paused dependent never auto-runs as part of a cascade.
      if (shortcut.paused) {
        continue;
      }
      if (!shortcut.triggers?.some(predicate)) {
        continue;
      }
      // Single-instance guard: never auto-run a shortcut whose previous run is still in
      // flight (a background run that hung) or whose cross-process lock is held. A
      // chained dependent must not stack on itself. Checked before the cooldown so a
      // genuinely-running shortcut is reported as such, not as a re-entrancy bounce.
      const block = runBlockReason(shortcut);
      if (block) {
        channel.appendLine(
          l10n("chain.skipped", { name: nameOf(shortcut), cause, reason: blockReasonLabel(block) })
        );
        continue;
      }
      // An idle run is unattended; a shortcut whose run needs ${prompt}/${pick} input
      // cannot be answered, so skip it and note why (same stance as the scheduler).
      if (forceBackground && hasInteractiveTokens(shortcut)) {
        channel.appendLine(
          l10n("chain.idleInteractiveSkipped", { name: nameOf(shortcut) })
        );
        continue;
      }
      const previous = this.lastAutoRun.get(shortcut.id);
      if (previous !== undefined && now - previous < COOLDOWN_MS) {
        // Re-entrancy / storm guard tripped: this shortcut was just auto-run as part of
        // the same cascade. Note it once so a misconfigured cycle is visible rather
        // than silently dropped.
        channel.appendLine(
          l10n("chain.cooldown", { name: nameOf(shortcut), cause })
        );
        continue;
      }
      this.lastAutoRun.set(shortcut.id, now);
      channel.appendLine(l10n("chain.firing", { name: nameOf(shortcut), cause }));
      // Fire-and-forget through the normal Run command so the dependent gets the
      // same treatment a manual run does (and fires its own completion to continue
      // the chain). A throw here must not break the cascade for sibling shortcuts.
      const target = forceBackground ? toBackground(shortcut) : shortcut;
      void vscode.commands
        .executeCommand("saropaWorkspace.runPin", target)
        .then(undefined, (err: unknown) => {
          channel.appendLine(
            l10n("chain.failed", {
              name: nameOf(shortcut),
              error: err instanceof Error ? err.message : String(err),
            })
          );
        });
    }
  }

  private allStoredShortcuts(): Shortcut[] {
    return [...this.store.getProjectShortcuts(), ...this.store.getGlobalShortcuts()];
  }

  dispose(): void {
    this.lastAutoRun.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

function nameOf(shortcut: Shortcut): string {
  return shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
}

// A shallow clone of a shortcut forced to run in the background, for the idle trigger. An
// unattended idle run must never steal the integrated terminal or pop a separate OS
// window, so the saved run location is overridden here (the clone applies to this run
// only; the stored shortcut is untouched). A shell-recipe shortcut carries its own terminal flag
// on its action, so clear that the same way; a plain file shortcut overrides runLocation and
// drops the deprecated useIntegratedTerminal so the two cannot disagree. Exported so
// the cross-file watch links (#25) reuse the one force-background clone instead of
// re-deriving it.
export function toBackground(shortcut: Shortcut): Shortcut {
  if (shortcut.action) {
    return { ...shortcut, action: { ...shortcut.action, useIntegratedTerminal: false } };
  }
  return {
    ...shortcut,
    exec: {
      ...(shortcut.exec ?? {}),
      runLocation: "background",
      useIntegratedTerminal: undefined,
    },
  };
}
