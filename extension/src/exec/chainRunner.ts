import * as vscode from "vscode";
import { Pin, PinTrigger, SystemEventName } from "../model/pin";
import { PinStore } from "../model/pinStore";
import { pinEvents, PinRunOutcome } from "./pinEvents";
import { systemEvents } from "./systemEvents";
import { getOutputChannel } from "./runner";
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

  constructor(private readonly store: PinStore) {
    this.disposables.push(
      pinEvents.onDidComplete((c) => this.onPinCompleted(c.pinId, c.outcome)),
      systemEvents.onDidFire((event) => this.onSystemEvent(event))
    );
  }

  // A pin finished. First forward its emitted system events (only on a non-failing
  // completion — a failed build should not trigger the post-build steps), then run
  // the pins chained directly after it.
  private onPinCompleted(pinId: string, outcome: PinRunOutcome): void {
    const source = this.store.findPin(pinId);
    if (source?.emits && outcome !== "failure") {
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
  // per-pin cooldown. `cause` is a short human phrase ("after Build", "on git push")
  // logged with each fire so the output channel reads as an audit trail.
  private runMatching(
    predicate: (trigger: PinTrigger) => boolean,
    cause: string
  ): void {
    const now = Date.now();
    const channel = getOutputChannel();
    for (const pin of this.allStoredPins()) {
      if (!pin.triggers?.some(predicate)) {
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
      void vscode.commands
        .executeCommand("saropaWorkspace.runPin", pin)
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
