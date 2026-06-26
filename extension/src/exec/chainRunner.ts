import * as vscode from "vscode";
import { Pin, PinTrigger, SystemEventName } from "../model/pin";
import { PinStore } from "../model/pinStore";
import { pinEvents, PinRunOutcome } from "./pinEvents";
import { systemEvents } from "./systemEvents";
import { IdleMonitor } from "./idleMonitor";
import { getOutputChannel, runBlockReason, blockReasonLabel } from "./runner";
import { hasInteractiveTokens } from "./promptTokens";
import { l10n } from "../i18n/l10n";

// The chain engine (WOW: recipe chaining + special events). It listens on two buses
// and auto-runs pins whose triggers name the cause:
//   - pinEvents.onDidComplete: a pin finished. Forward that pin's `emits`
//     (build / publish) onto the system bus, then run every pin triggered "after"
//     this pin (honoring onlyOnSuccess).
//   - systemEvents.onDidFire: a system event happened (build / publish from an emit,
//     gitCommit / gitPush from the repo watcher). Run every pin triggered by it.
//
// Running a dependent goes through the normal Run command, so it reuses token
// resolution, the visible toast, telemetry, and — crucially — fires its OWN
// completion, which is how a chain of three (A -> B -> C) propagates.
//
// Storm / cycle guard: a configuration like A triggers B, B triggers A would loop
// forever. A per-pin cooldown breaks it: a pin will not be AUTO-run again within
// COOLDOWN_MS of its last auto-run. Manual runs are never blocked. The cooldown is
// per pin (not a global lock), so independent chains still run concurrently; it only
// stops a pin re-entering its own cascade. Disposable so both bus subscriptions are
// released on deactivation.
const COOLDOWN_MS = 3000;

export class ChainRunner implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  // pinId -> epoch ms of its last auto-run, for the re-entrancy cooldown.
  private readonly lastAutoRun = new Map<string, number>();

  constructor(
    private readonly store: PinStore,
    private readonly idleMonitor: IdleMonitor
  ) {
    this.disposables.push(
      pinEvents.onDidComplete((c) => this.onPinCompleted(c.pinId, c.outcome)),
      systemEvents.onDidFire((event) => this.onSystemEvent(event)),
      // Run-on-idle (WOW #18): the monitor fires the exact idle threshold crossed; run
      // every pin whose idle trigger names that threshold.
      idleMonitor.onDidGoIdle((minutes) => this.onIdle(minutes)),
      // Keep the monitor's watched thresholds in step with the pin set: any store
      // change can add or remove an idle-triggered pin (or edit its minutes), so the
      // set of distinct thresholds is re-derived each time. The store fires onDidChange
      // on init too, so the monitor is seeded before the first idle stretch.
      store.onDidChange(() => this.syncIdleThresholds())
    );
    // Seed immediately in case the store's init refresh already fired above.
    this.syncIdleThresholds();
  }

  // Collect the distinct idle thresholds (minutes) across all stored pins and hand them
  // to the monitor, which only runs its poll timer while at least one exists.
  private syncIdleThresholds(): void {
    const minutes: number[] = [];
    for (const pin of this.allStoredPins()) {
      // A paused pin contributes no idle threshold — pausing suspends its idle
      // trigger like every other unattended runner, so the monitor need not poll
      // for a stretch only a paused pin would react to.
      if (pin.paused) {
        continue;
      }
      for (const trigger of pin.triggers ?? []) {
        if (trigger.kind === "idle") {
          minutes.push(trigger.minutes);
        }
      }
    }
    this.idleMonitor.setThresholds(minutes);
  }

  // The window has been idle long enough to cross `minutes`. Run every pin whose idle
  // trigger names exactly that threshold, forced to the background channel so an
  // unattended run never hijacks the terminal or pops an external window.
  private onIdle(minutes: number): void {
    this.runMatching(
      (trigger) => trigger.kind === "idle" && trigger.minutes === minutes,
      l10n("chain.cause.idle", { minutes }),
      true
    );
  }

  // A pin finished. First forward its emitted system events (only on a non-failing
  // completion — a failed build should not trigger the post-build steps), then run
  // the pins chained directly after it.
  private onPinCompleted(pinId: string, outcome: PinRunOutcome): void {
    const source = this.store.findPin(pinId);
    // A paused pin emits no system events on completion (a manual run of a paused
    // build pin should not trigger its downstream publish chain), matching how its
    // own triggers are suppressed below.
    if (source?.emits && !source.paused && outcome !== "failure") {
      for (const event of source.emits) {
        systemEvents.fire(event);
      }
    }

    // onlyOnSuccess gates a pin trigger: skip it when the source failed. A
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

  // A system event happened: run every pin triggered by it.
  private onSystemEvent(event: SystemEventName): void {
    this.runMatching(
      (trigger) => trigger.kind === "event" && trigger.event === event,
      l10n("chain.cause.event", { event: l10n(`chain.event.${event}`) })
    );
  }

  // Run every stored pin that carries a trigger matching `predicate`, subject to the
  // per-pin cooldown. `cause` is a short human phrase ("after Build", "on git push",
  // "while idle 3m") logged with each fire so the output channel reads as an audit
  // trail. `forceBackground` is set for the idle path: the run is routed to the
  // background channel regardless of the pin's saved location, and a pin needing
  // interactive input is skipped (an unattended idle run cannot answer a prompt).
  private runMatching(
    predicate: (trigger: PinTrigger) => boolean,
    cause: string,
    forceBackground = false
  ): void {
    const now = Date.now();
    const channel = getOutputChannel();
    for (const pin of this.allStoredPins()) {
      // A paused pin's triggers are inert: skip it before any cooldown / interactive
      // bookkeeping so a paused dependent never auto-runs as part of a cascade.
      if (pin.paused) {
        continue;
      }
      if (!pin.triggers?.some(predicate)) {
        continue;
      }
      // Single-instance guard: never auto-run a pin whose previous run is still in
      // flight (a background run that hung) or whose cross-process lock is held. A
      // chained dependent must not stack on itself. Checked before the cooldown so a
      // genuinely-running pin is reported as such, not as a re-entrancy bounce.
      const block = runBlockReason(pin);
      if (block) {
        channel.appendLine(
          l10n("chain.skipped", { name: nameOf(pin), cause, reason: blockReasonLabel(block) })
        );
        continue;
      }
      // An idle run is unattended; a pin whose run needs ${prompt}/${pick} input
      // cannot be answered, so skip it and note why (same stance as the scheduler).
      if (forceBackground && hasInteractiveTokens(pin)) {
        channel.appendLine(
          l10n("chain.idleInteractiveSkipped", { name: nameOf(pin) })
        );
        continue;
      }
      const previous = this.lastAutoRun.get(pin.id);
      if (previous !== undefined && now - previous < COOLDOWN_MS) {
        // Re-entrancy / storm guard tripped: this pin was just auto-run as part of
        // the same cascade. Note it once so a misconfigured cycle is visible rather
        // than silently dropped.
        channel.appendLine(
          l10n("chain.cooldown", { name: nameOf(pin), cause })
        );
        continue;
      }
      this.lastAutoRun.set(pin.id, now);
      channel.appendLine(l10n("chain.firing", { name: nameOf(pin), cause }));
      // Fire-and-forget through the normal Run command so the dependent gets the
      // same treatment a manual run does (and fires its own completion to continue
      // the chain). A throw here must not break the cascade for sibling pins.
      const target = forceBackground ? toBackground(pin) : pin;
      void vscode.commands
        .executeCommand("saropaWorkspace.runPin", target)
        .then(undefined, (err: unknown) => {
          channel.appendLine(
            l10n("chain.failed", {
              name: nameOf(pin),
              error: err instanceof Error ? err.message : String(err),
            })
          );
        });
    }
  }

  private allStoredPins(): Pin[] {
    return [...this.store.getProjectPins(), ...this.store.getGlobalPins()];
  }

  dispose(): void {
    this.lastAutoRun.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

function nameOf(pin: Pin): string {
  return pin.label ?? (pin.path.split("/").pop() ?? pin.path);
}

// A shallow clone of a pin forced to run in the background, for the idle trigger. An
// unattended idle run must never steal the integrated terminal or pop a separate OS
// window, so the saved run location is overridden here (the clone applies to this run
// only; the stored pin is untouched). A shell-recipe pin carries its own terminal flag
// on its action, so clear that the same way; a plain file pin overrides runLocation and
// drops the deprecated useIntegratedTerminal so the two cannot disagree.
function toBackground(pin: Pin): Pin {
  if (pin.action) {
    return { ...pin, action: { ...pin.action, useIntegratedTerminal: false } };
  }
  return {
    ...pin,
    exec: {
      ...(pin.exec ?? {}),
      runLocation: "background",
      useIntegratedTerminal: undefined,
    },
  };
}
