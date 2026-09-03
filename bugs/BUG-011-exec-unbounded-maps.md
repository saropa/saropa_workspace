# BUG-011: Last-run tracking maps grow unbounded — no eviction on shortcut removal

**Status: Open**

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
