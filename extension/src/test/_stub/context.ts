// A minimal in-memory ExtensionContext for the store / prompt-memory tests. The
// store reads/writes context.globalState (global pins + groups, recipe-group
// collapse state); promptMemory reads/writes context.workspaceState (remembered
// run-token values). Both are modeled as a Map-backed Memento so a value written
// by one store instance is read back by another sharing the SAME context — that is
// exactly the globalState round-trip under test. Everything else on the real
// ExtensionContext is unused by these paths and is cast away.

import type { ExtensionContext, Memento } from "vscode";

// A Map-backed Memento. get(key, default) returns the stored value or the default;
// update persists. setKeysForSync is a no-op (Settings Sync is a host concern).
function memento(): Memento & { setKeysForSync(keys: readonly string[]): void } {
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string, defaultValue?: T): T | undefined {
      return store.has(key) ? (store.get(key) as T) : defaultValue;
    },
    update(key: string, value: unknown): Thenable<void> {
      if (value === undefined) {
        store.delete(key);
      } else {
        store.set(key, value);
      }
      return Promise.resolve();
    },
    keys(): readonly string[] {
      return [...store.keys()];
    },
    setKeysForSync(): void {},
  };
}

// Build a fresh fake context. Reuse the SAME returned object across two PinStore /
// promptMemory instances to exercise a persistence round-trip; build a new one for
// an isolated test.
export function fakeContext(): ExtensionContext {
  return {
    globalState: memento(),
    workspaceState: memento(),
  } as unknown as ExtensionContext;
}
