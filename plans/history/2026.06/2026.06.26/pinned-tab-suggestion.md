# Long-pinned-tab suggestion

A manually pinned editor tab carries a strong "this file matters" signal, but the
extension previously had no way to act on it. This change adds a suggester that
offers to promote a tab kept pinned past a threshold into a durable Saropa pin.

## Finish Report (2026-06-26)

### Summary

A new on-device suggester watches native VS Code editor-tab pins via
`vscode.window.tabGroups`. When a file-backed tab has stayed pinned longer than a
configurable threshold (default 2 hours) and is not already a Saropa pin, it
offers a toast to add the file to the workspace pins (shareable via the repo) or
the global pins. The feature is enabled by default and gated by two settings.

### Why this shape

- **VS Code exposes `tab.isPinned` but no pin timestamp.** Elapsed time is tracked
  by the extension: the first time a tab is seen pinned, its epoch-ms is stored in
  `globalState` keyed by `fsPath`, and the stamp is dropped when the tab is
  unpinned or closed. The stamp survives reloads because VS Code restores pinned
  tabs, so it remains valid across sessions.
- **Activation snapshot.** A tab may already be pinned with no stored stamp (pinned
  before the extension watched, or never written). On the first reconcile such a
  tab is stamped with the current time, so a pre-existing pin starts its clock at
  snapshot time and waits the full threshold rather than firing on an age that
  cannot be determined — the safe direction.
- **Permanent dismissal.** Choosing "Don't ask again" records the `fsPath` in a
  persistent `dismissed` list; the file is never offered again, surviving
  unpin/re-pin and reloads. The `saropaWorkspace.restoreTabSuggestions` command
  clears that list so a dismissal is reversible. Closing the toast without
  choosing is a session-only suppression (an in-memory set), so the file remains
  eligible in a later session.
- **No silent async / names the item.** The offer and the resulting confirmation
  name the file; the offer scope adapts (workspace + global inside a folder,
  global only outside any folder), mirroring the existing open-frequency
  suggester.

### Implementation

- `extension/src/views/tabPinSuggestions.ts` — new `TabPinSuggester` class plus an
  exported pure `reconcileTabPins(state, pinned, isAlreadyPinned, now, thresholdMs)`
  function holding the threshold / snapshot / dismiss logic. The class wires a
  `tabGroups.onDidChangeTabs` listener and a 15-minute timer to drive reconcile;
  the pure function is host-independent so it is unit-testable.
- `extension/src/extension.ts` — constructs the suggester (held so the restore
  command can clear its dismissals) and registers
  `saropaWorkspace.restoreTabSuggestions`.
- `extension/package.json` — adds settings `saropaWorkspace.suggestPinnedTab.enabled`
  (boolean, default true) and `saropaWorkspace.suggestPinnedTab.afterHours` (number,
  default 2, range 1–168), and the restore command.
- `extension/package.nls.json` — manifest strings for the two settings and the
  command title.
- `extension/src/i18n/locales/en.json` — runtime strings: `tabSuggest.prompt`,
  `tabSuggest.pinWorkspace`, `tabSuggest.pinGlobal`, `tabSuggest.never`,
  `tabSuggest.restored`.
- `CHANGELOG.md` (root, `[Unreleased]` → Added) and `README.md` (Smart suggestions
  section + settings table) document the feature.

### Tests

- `extension/src/test/tabPinSuggest.test.ts` — 8 unit tests over the pure
  `reconcileTabPins` core: first-sighting stamping, under-threshold no-offer,
  past-threshold offer, permanent-dismiss suppression, already-a-Saropa-pin stamp
  clearing, unpin clock reset, input-not-mutated, and the activation-snapshot
  full-threshold wait. All pass under `node --test`.
- The `TabPinSuggester` class itself (tab enumeration, toasts, persistence) is
  VS Code-host-dependent and is not covered by `node --test`; the host harness
  (`@vscode/test-electron`) is not wired in this repo.

### Verification

- `npx tsc -p ./ --noEmit` — clean.
- Scoped `node --test` on the bundled `tabPinSuggest.cjs` — 8 pass, 0 fail.
- `package.json` / `package.nls.json` parse as valid JSON.

### Not verified by automation

The timer-driven, hours-scale toast flow has not been exercised in an Extension
Development Host. A manual smoke test (threshold lowered) is needed to confirm the
toast fires, the scope choices pin correctly, and dismiss/restore round-trips.
