# Workspace boot sequence (roadmap 3.1)

The extension could open and run individual pins, but offered no way to restore a
working context in one action when a workspace opens — a user repeated the same
file opens and dev-server starts every session. This adds a named, ordered set of
pins that runs on workspace open behind a one-time per-session confirm.

## Finish Report (2026-06-25)

### Scope

VS Code extension (TypeScript). No Dart/Flutter code touched.

### What changed

- **New module `extension/src/commands/bootSequence.ts`** holding the whole
  feature:
  - `BootSequenceStore` singleton (`bootSequence`) over `workspaceState`
    (per-workspace, not synced — a boot sequence is about this workspace's files
    and tasks). Data shape: `{ enabled, stopOnError, pinIds: string[] }`; order is
    the run order.
  - `maybeRunBootSequenceOnOpen(store)` — the activation trigger. No-op (no
    prompt) when disabled or empty; otherwise asks once per session (an in-memory
    `offeredThisSession` flag) with Run / Configure / dismiss. Dismiss skips it for
    the session. The confirm is the "no silent execution" gate (Principles).
  - `runBootSequence(store)` — runs members in order via the existing
    `saropaWorkspace.runPin` command, so each step reuses token resolution,
    missing-file handling, telemetry, and the per-run toast (a runnable pin runs, a
    non-runnable file opens, an action pin fires). A removed pin is logged and
    skipped; a throwing step is logged and, unless `stopOnError`, the run
    continues. A per-step log goes to the shared output channel; a summary toast
    reports `ran of total`.
  - `configureBootSequence(store)` — a hub-and-spoke QuickPick (same shape as
    Configure Run): toggle enabled, toggle stop-on-error, add pins (multi-select of
    pins not already in the set), per-member move-up / move-down / remove, run now,
    done. Every change persists immediately so Esc never loses edits.

- **Wiring:**
  - `extension/src/extension.ts` — `bootSequence.init(context)` alongside the
    other workspaceState singletons; `void maybeRunBootSequenceOnOpen(store)` after
    `store.init()` so member pins resolve.
  - `extension/src/commands/pinCommands.ts` — registers
    `saropaWorkspace.configureBootSequence` and `saropaWorkspace.runBootSequence`.
  - `extension/package.json` — both commands ($(rocket) / $(run-all)) and the
    Configure entry in the Pins view title menu.
  - `extension/package.nls.json` — the two command titles.
  - `extension/src/i18n/locales/en.json` — the `boot.*` strings (hub labels,
    confirm, output-channel log lines, summaries).

### Acceptance criteria (roadmap 3.1)

- Definable, reorderable, enable/disable through a Configure-Run-style UX.
  Satisfied by `configureBootSequence`.
- Prompts once on open before running; declining skips it for the session.
  Satisfied — the open-time confirm plus the per-session flag; a reload is a new
  session and re-offers.
- Each step surfaces an outcome; a failed step does not abort the rest unless
  configured to. Satisfied — steps run through the toasting Run command, errors
  are caught per step, and `stopOnError` gates the halt.

### Verification

- `npx tsc -p ./ --noEmit` from `extension/` — clean.
- `node esbuild.js` from `extension/` — bundle builds.
- No automated test added: the extension has no test harness yet (roadmap Phase
  4.1, unshipped). Verified by type-check, bundle build, and inspection.

### Notes for maintainers

- Membership references existing pins by id. The model intentionally stores ids,
  not pin copies, so an edited pin's new config is what runs and a removed pin is a
  skipped step rather than a stale snapshot.
- The hub QuickPick uses `act` as its discriminant field because `QuickPickItem`
  already owns `kind` (used for the non-selectable separators).
