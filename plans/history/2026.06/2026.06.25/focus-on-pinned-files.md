# Focus the Explorer on pinned files (roadmap Later / Exploratory: files.exclude)

The Explorer showed the whole workspace regardless of which files a user had
pinned, so a favorites-only view was not possible. This adds a toggle that drives
VS Code's `files.exclude` from the pin set to hide everything except pinned files
and the folders that lead to them, and restores the prior excludes exactly on exit.

## Finish Report (2026-06-25)

### Scope

(B) VS Code extension (TypeScript). No Dart/Flutter code.

### What changed

- **New module `extension/src/commands/focusMode.ts`**:
  - `enterFocusMode` — for each workspace folder, compute the set of pinned file
    paths inside it, then hide (via `files.exclude`) every Explorer entry that is
    neither a pinned file nor an ancestor directory of one. The user's prior
    folder-level `files.exclude` is snapshotted to workspaceState and merged under
    the new globs, so nothing of theirs is lost.
  - `exitFocusMode` — restore each folder's snapshot verbatim (or clear our
    folder-level value when there was none), then drop the snapshots and flag.
  - `initFocusMode` — re-establish the `saropaWorkspace.focusActive` context key
    from the persisted flag on activation, so a reload while focus is active keeps
    the correct menu ("Exit Focus") and attribution.

- **Bounded computation** — `files.exclude` has no negation/"show only" operator, so
  focus is built by walking ONLY the directories on the path to a pinned file
  (`computeExcludes`) and hiding the non-kept siblings at each. The walk is bounded
  by the pin set, not the tree size, so a large repo stays fast. A folder with no
  pinned files (or only root-level pins) is left untouched — a workspace root cannot
  be hidden, and blanking an unrelated root is not the intent.

- **`extension/src/commands/pinCommands.ts`** — registers `focusPinnedFiles` and
  `exitFocusPinnedFiles` (passing the extension context for state + config writes).

- **`extension/src/extension.ts`** — calls `initFocusMode(context)` at the end of
  activation.

- **Manifest / strings** — `package.json` declares the two commands, adds them to the
  Pins view title menu (group `0_new@5`) gated on the `saropaWorkspace.focusActive`
  context key so exactly one shows, and gates the command palette the same way.
  `package.nls.json` carries the titles; `en.json` the `focus.*` runtime strings.

- **`CHANGELOG.md`** — Unreleased "Added" entry. **`ROADMAP.md`** — the
  Later/Exploratory "`files.exclude` integration" bullet removed.

### Why it is safe

- The prior `files.exclude` (folder-level value) is snapshotted before any write and
  restored verbatim on exit, so the user's own filters round-trip. A `null` snapshot
  (no prior folder value) restores to `undefined`, removing our key rather than
  leaving a stray empty object.
- Writes are at `ConfigurationTarget.WorkspaceFolder`, scoped per folder; a folder
  that was never focused (no snapshot) is skipped on exit, so unrelated folders are
  never touched.
- Multi-root safe: globs are folder-relative and applied to each folder's own
  configuration, so a pinned file in folder A never hides anything in folder B.

### Verification

- `npx tsc -p ./ --noEmit` from `extension/` — clean, no errors.
- `node esbuild.js` from `extension/` — bundle builds.
- No automated test added: the extension has no test harness yet (roadmap Phase
  4.1, unshipped). Verified by type-cleanliness, bundle build, and inspection.

### Notes for maintainers

- Focus writes to each folder's `.vscode/settings.json` (`files.exclude`) while
  active and reverts it on exit; that is the documented mechanism for the feature.
  The toggle state persists in workspaceState (not the committed file), so the menu
  and context key recover after a reload.
- The exclude set is computed once at toggle-on from the current pin set; pinning a
  new file while focus is active does not auto-reveal it. Re-toggling (exit, then
  focus again) recomputes against the current pins. A live recompute on pin change
  could layer on later if wanted.
