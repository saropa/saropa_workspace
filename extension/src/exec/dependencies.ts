import { Pin } from "../model/pin";
import { runStatusRegistry } from "./runStatus";

// Run-dependency gating (roadmap WOW #13). A pin may name another pin in
// `exec.dependsOn` that must have run successfully this session before it will run.
// Success is read from runStatusRegistry, which is in-memory and per-session, so a
// fresh window starts with nothing satisfied (a build must be re-run before a deploy).

export interface DependencyState {
  // The unmet prerequisite's pin id, or undefined when the pin is cleared to run:
  // it has no dependsOn, the prerequisite already succeeded this session, or the
  // prerequisite pin no longer exists (a dangling id must never lock a pin forever).
  pendingDependencyId?: string;
}

// Resolve a pin's dependency state. `findPin` maps an id to a live pin (the store's
// findPin), used both to detect a dangling reference and, by callers, to name the
// prerequisite.
export function dependencyState(
  pin: Pin,
  findPin: (id: string) => Pin | undefined
): DependencyState {
  const depId = pin.exec?.dependsOn;
  if (!depId) {
    return {};
  }
  // A deleted prerequisite is treated as satisfied — better than a pin that can
  // never run again because the pin it pointed at is gone.
  if (!findPin(depId)) {
    return {};
  }
  if (runStatusRegistry.get(depId)?.outcome === "success") {
    return {};
  }
  return { pendingDependencyId: depId };
}
