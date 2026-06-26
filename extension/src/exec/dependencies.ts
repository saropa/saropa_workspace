import { Shortcut } from "../model/shortcut";
import { runStatusRegistry } from "./runStatus";

// Run-dependency gating (roadmap WOW #13). A shortcut may name another shortcut in
// `exec.dependsOn` that must have run successfully this session before it will run.
// Success is read from runStatusRegistry, which is in-memory and per-session, so a
// fresh window starts with nothing satisfied (a build must be re-run before a deploy).

export interface DependencyState {
  // The unmet prerequisite's shortcut id, or undefined when the shortcut is cleared
  // to run: it has no dependsOn, the prerequisite already succeeded this session, or
  // the prerequisite shortcut no longer exists (a dangling id must never lock a
  // shortcut forever).
  pendingDependencyId?: string;
}

// Resolve a shortcut's dependency state. `findShortcut` maps an id to a live shortcut
// (the store's findShortcut), used both to detect a dangling reference and, by
// callers, to name the prerequisite.
export function dependencyState(
  shortcut: Shortcut,
  findShortcut: (id: string) => Shortcut | undefined
): DependencyState {
  const depId = shortcut.exec?.dependsOn;
  if (!depId) {
    return {};
  }
  // A deleted prerequisite is treated as satisfied — better than a shortcut that can
  // never run again because the shortcut it pointed at is gone.
  if (!findShortcut(depId)) {
    return {};
  }
  if (runStatusRegistry.get(depId)?.outcome === "success") {
    return {};
  }
  return { pendingDependencyId: depId };
}
