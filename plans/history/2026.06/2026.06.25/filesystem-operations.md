# Filesystem operations from the Pins tree (roadmap Later / Exploratory)

The Pins view listed the files a user works with but could not act on them as
files: creating, duplicating, renaming, copying, or deleting a pinned file all
required round-tripping through the Explorer. This adds five file-manager actions
to a file pin's context menu so the Pins view doubles as a lightweight file
manager, mirroring what kdcro101 Favorites offers.

## Finish Report (2026-06-25)

### Scope

(B) VS Code extension (TypeScript). No Dart/Flutter code.

### What changed

- **New module `extension/src/commands/fileOps.ts`** — five operations, each acting
  on a file pin's resolved target URI:
  - `newFileHere` — create an empty file in the pinned file's own directory, pin it
    in the same scope, and open it. Pre-fills the source file's extension.
  - `duplicateFile` — a byte-for-byte copy into a non-colliding sibling
    (`report.md` → `report copy.md` → `report copy 2.md`), pinned and opened.
    Deliberately distinct from `useAsTemplate`, which copies AND rewrites the
    file's identifiers across case styles; this is a plain copy.
  - `renameFileOnDisk` — rename the file and re-point the pin via
    `store.updatePinPath`, so the pin keeps its id, run config, schedule, and icon.
    The rename stays in the same directory, so a project pin's folder-relative
    constraint always holds.
  - `copyFileTo` — copy the file into a user-picked folder (the one-step "copy then
    paste elsewhere" gesture, with no hidden clipboard state). Offers Reveal after.
  - `deleteFile` — delete to the OS trash (recoverable) after a modal confirm that
    names the file, then offer to unpin the now-dangling pin. The pin is never
    auto-removed (a deletion may be temporary; the pin flags itself missing and can
    be relocated).

- **Safety invariants** — every create/copy/rename stats the destination first and
  aborts rather than overwrite (an overwritten file is unrecoverable from here);
  `fs.copy` / `fs.rename` are additionally called with `overwrite: false` to guard a
  file racing into existence between the check and the write. `uniqueSiblingUri` is
  bounded (≤1000) so a directory full of copies cannot loop forever. Delete uses
  `useTrash: true`, so it is recoverable, not a hard delete.

- **`extension/src/commands/pinCommands.ts`** — registers the five commands, each
  normalizing the menu argument to a pin via the existing `asPin` and delegating to
  the module.

- **Manifest / strings** — `package.json` declares the five commands (with
  codicons), adds a `4_file` group to the Pins view item context menu gated to file
  pins (`pin` / `pinScheduled` / `pinAuto`, never recipe pins), and hides all five
  from the command palette (they require a pin argument). `package.nls.json` carries
  the titles; `en.json` the `fileOps.*` runtime strings.

- **`CHANGELOG.md`** — Unreleased "Added" entry. **`ROADMAP.md`** — the
  Later/Exploratory "Filesystem operations from the tree" bullet removed.

### Why it is safe

- No operation overwrites silently: each destination is stat-checked and the
  filesystem call passes `overwrite: false`. Delete routes to the trash. The pin is
  only ever re-pointed (rename) or, on explicit opt-in, removed (delete) — a pin is
  never silently orphaned.
- Non-file pins (recipe / url / shell / command / macro) are rejected up front with
  a naming message, so an action pin in the tree cannot trigger a file operation.
- The menu is gated to file-pin context values in the Pins view only, so the
  actions never appear on recipes, group headers, scope roots, or the Project Files
  view.

### Verification

- `npx tsc -p ./ --noEmit` from `extension/` — clean, no errors.
- `node esbuild.js` from `extension/` — bundle builds.
- No automated test added: the extension has no test harness yet (roadmap Phase
  4.1, unshipped). Verified by type-cleanliness, bundle build, and inspection.

### Notes for maintainers

- "Copy File To..." intentionally replaces a stateful copy/paste pair with a single
  destination-picker gesture, so there is no cross-invocation clipboard to manage or
  leak. If a true two-step copy/paste is wanted later, it would layer on top.
