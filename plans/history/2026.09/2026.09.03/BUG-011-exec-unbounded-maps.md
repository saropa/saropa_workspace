# BUG-011: Last-run tracking maps grow unbounded — no eviction on shortcut removal

**Status: Fixed**

<!-- Status values: Open → Investigating → Fix Ready → Closed -->

Created: 2026-09-02
Area: Execution
File(s): `extension/src/exec/activationHelpers.ts` (`watchLastRun` Map), `extension/src/exec/shortcutExecution.ts` (`lastRunAtByShortcutId` Map)
Severity: Low
Extension version: 1.6.12

---

## Summary

Two in-memory `Map` instances that track last-run timestamps for shortcuts grow unbounded for the life of the extension host:

- `activationHelpers.ts`: the `watchLastRun` Map stores an entry for every shortcut id that has ever fired. Entries are never removed when shortcuts are deleted or unpinned.
- `shortcutExecution.ts`: the `lastRunAtByShortcutId` Map is written on every run but never pruned when a shortcut is removed.

Over a long-running VS Code session with frequent shortcut creation and deletion, these maps accumulate stale entries that will never be read again.

---

## Attribution Evidence

Both maps are in `extension/src/exec/` — `activationHelpers.ts` and `shortcutExecution.ts`. Extension code.

---

## Reproducer

1. Create a shortcut, run it, then delete the shortcut. Repeat many times.
2. The maps retain entries for every deleted shortcut's id.
3. Over a long session (hours/days with VS Code open), the maps grow with no bound.

**Frequency:** Continuous — every run adds an entry, no operation removes one.

---

## Expected vs Actual

| | Behavior |
|---|---|
| **Expected** | When a shortcut is removed or unpinned, its entry is evicted from the last-run tracking maps. |
| **Actual** | Entries accumulate indefinitely. The maps are never pruned. |

---

## State / Flow Context

```
shortcut runs → watchLastRun.set(id, timestamp)      ← never deleted
shortcut runs → lastRunAtByShortcutId.set(id, timestamp)   ← never deleted

shortcut removed → pinStore removes pin
  └─ no cleanup of watchLastRun or lastRunAtByShortcutId
```

---

## Root Cause

Neither map has a cleanup hook tied to shortcut removal. The pin store does not notify the execution tracking module when a shortcut is deleted, so stale entries persist. In practice the memory impact is small (each entry is an id string + a timestamp number), but it is unbounded growth in principle.

---

## Suggested Fix

When a shortcut is removed (in `pinStore` or `pinCommands`), delete its entry from both maps:

```ts
watchLastRun.delete(shortcutId);
lastRunAtByShortcutId.delete(shortcutId);
```

Alternatively, add a periodic sweep that compares map keys against the current set of shortcut ids and evicts any that no longer exist. The direct cleanup on removal is simpler and more reliable.

---

## Changes Made

<!-- Fill in when a fix is written. -->

---

## Verification

- [ ] `tsc -p ./ --noEmit` clean
- [ ] `npm run build` succeeds
- [ ] Manual smoke test: create a shortcut, run it, delete it — confirm the map entry is cleaned up (add a temporary log or debugger check)

---

## Commits

<!-- Add commit hashes as fixes land. -->

---

## Environment

- saropa_workspace version: 1.6.12
- VS Code version: any
- OS: any
- Pin scope (project / global): both
- Settings Sync enabled (yes / no): n/a

---

## Reflection

### Hardening items

- **Only 3 of many id-keyed maps are wired to the cleanup event.** `extension.ts` (~line 225) subscribes `runStatusRegistry.clear`, `clearWatchLastRun`, `clearLastRunAt` to `onDidRemoveShortcut`, but a repo-wide scan turns up id-keyed state in `exec/lastBrief.ts`, `exec/promptTokens.ts`, `exec/standupDigest.ts`, `exec/trendReports.ts`, `exec/runOutputs.ts`, `exec/processRegistry.ts`, `exec/shortcutBadges.ts`, `exec/metricBadges.ts`, `exec/projectStats.ts`, and `exec/gitBranch.ts`. Any of these that key a `Map` by shortcut id and lack their own eviction path will reproduce the exact bug BUG-011 fixed, just in a different module. Worth an audit pass to confirm each either subscribes to `onDidRemoveShortcut` or has no per-id state.
- **The three cleanup calls run as one listener, not three independent ones.** In `extension.ts`, `runStatusRegistry.clear(id)`, `clearWatchLastRun(id)`, and `clearLastRunAt(id)` are sequential statements inside a single callback (lines 226-228). If the first call throws, the other two never run and that shortcut's entries in `watchLastRun`/`lastRunAtByShortcutId` leak silently — no error surfaces to the user per this repo's "no silent async" rule, but there is no user-facing action here to attach feedback to, and no log either.
- **No error handling around the `fire()` call itself.** `shortcutStoreMutationCore.ts` calls `this._onDidRemoveShortcut.fire(shortcut.id)` (lines 150 and 185) with no try/catch. `vscode.EventEmitter.fire` invokes listeners synchronously and does not itself swallow exceptions from misbehaving listeners in all VS Code versions/paths — a throwing subscriber could unwind into `removeShortcut`'s caller and abort a remove that had already written/refreshed successfully, leaving the store correct but the caller believing the remove failed.
- **`_onDidRemoveShortcut` (the `EventEmitter` itself) is never disposed.** It is declared in `shortcutStoreBase.ts` (line 71) but not pushed to `context.subscriptions` and the store has no `dispose()` that extension.ts calls. Harmless today because `ShortcutStore` is a singleton for the extension host's lifetime, but if the store is ever recreated (e.g., a future multi-root or reload-without-restart path) this becomes a real leak.
- **Bulk/expiry removal paths need to be confirmed as funneling through `removeShortcut`.** The doc comment above `_onDidRemoveShortcut` (lines 63-70) lists "manual unpin, file-delete, missing-file cleanup, expiry sweep" as covered removal paths. `exec/shortcutExpiry.ts` was not inspected as part of this reflection — confirm it calls `store.removeShortcut()` per-shortcut rather than mutating the underlying file list directly, which would bypass the event entirely and reintroduce the leak for expired shortcuts specifically.

### Suggestions

- Add a one-line comment or `// eslint`-style marker at each map declaration site (`watchLastRun`, `lastRunAtByShortcutId`, and any of the other id-keyed maps found above) noting "cleared via `onDidRemoveShortcut`, see extension.ts" or "no cleanup needed because ___" — makes the next audit a grep instead of a re-investigation.
- Wrap the three cleanup calls in `extension.ts` in a `try { … } catch` per call (or a small loop over `[fn, fn, fn]`) so one misbehaving clear function cannot block the others from running.
- Consider a lightweight dev-only assertion (behind a debug flag) that periodically diffs the keys of `watchLastRun`/`lastRunAtByShortcutId` against the live shortcut id set and logs any drift — cheap insurance against a future removal path that forgets to fire the event.
