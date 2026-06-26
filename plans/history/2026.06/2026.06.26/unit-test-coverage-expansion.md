# Unit-test coverage expansion

The extension carried unit tests for only 28 of its ~131 source modules; a quality
audit flagged 113 untested modules. This task added Node-runner unit tests across the
testable surface of the model, import, exec, command, recipe, view, and i18n layers,
raising the count of covered modules and the suite from 219 to 716 passing tests.

## Finish Report (2026-06-26)

### Scope

VS Code extension (TypeScript) only. The change is additive test files under
`extension/src/test/**`; no production module was modified. The pure-logic test harness
already in place (`esbuild.test.js`) bundles each `*.test.ts` with the bare `vscode`
import aliased to the stub at `src/test/_stub/vscode.ts` and runs the bundles under
`node --test`. The coverage detector in `scripts/modules/_quality.py` maps a source
module to a test by basename, so each new file is named `<moduleBasename>.test.ts`.

### What changed

New test files exercise the host-independent behavior of their target modules:

- **model** — the pin model helpers (`pinKind`, annotation detection, the empty-project
  file factory, version/scope constants); the pin-store internals split out of the former
  monolith (base persistence and accessors, refresh, the mutation core and field-update
  toggles, and the shared helpers); the project-file relative-time formatter; the
  tapped-pins recency tracker.
- **import** — the Oleg Shilo, settings, and sibling favorites parsers (fixture-blob
  parse, map, and dedup paths); the share-link encode/decode round-trip and its
  malformed-input guards.
- **exec** — the run-lock record/staleness/acquire-release logic; the run-status and
  run-output registries; run planning and run targets; the process registry and poll
  helpers; the routine runner; the scheduler's run-on-startup skip/advance branches; the
  pin-event and system-event buses; trend-report listing and validation; badge parsing.
- **commands** — run-configuration command helpers (run mode, run command, run env,
  expiry, triggers), the boot sequence, the metric setter, and the tag mutator, driven
  where interactive through the stub's settable quick-pick / input-box handlers and a
  real `PinStore` against a temp directory.
- **recipes** — the detector ecosystem and run-target probes, the git-metadata reader,
  the scheduled-ritual / routine / hygiene / process recipe builders, and the
  detector-helper URL builders and name extractors.
- **views** — the pure formatters and asset invariants (row formatting, planner/dashboard
  HTML-asset theme-token and postMessage-contract checks, the project-files time
  formatter).
- **i18n** — `l10n` key lookup with `{token}` interpolation and missing-key fallback.

### Deliberately not covered

Modules whose only exported surface subclasses or constructs host types the stub does not
model — `TreeItem`, `WebviewPanel`, `StatusBarItem`, `createTerminal`,
`createFileSystemWatcher`, `registerCommand` at module evaluation — were left untested
rather than forced, because no pure logic is reachable without extending the shared stub.
This set includes the tree providers and tree-item classes, the dashboard and planner
panels, the status-bar views, the suggestion tracker, the expiry watcher, the background /
external / terminal launchers, the bloat / hygiene / process-monitor command registrars,
the lints-health and metric-badge reporters, the sound cue, the recipe-command registrar,
and the `activate()` wiring. Covering these requires the vscode stub to model the host
classes (a `TreeItem` base, a `ThemeIcon` / `ThemeColor` pair, a `WebviewPanel` fake, a
`createStatusBarItem`, and a `createFileSystemWatcher`), tracked as remaining work.

### Verification

`npm run test:unit` from `extension/` — 716 tests, 716 pass, 0 fail. Each new file was
also verified in isolation through a scoped single-file runner during authoring.

Two files produced by the authoring pass were removed rather than kept: a stray
module-evaluation probe and a `fileOps` lock test that failed on this platform
(`toggleFileLock` dereferenced an undefined value from an unmodeled path); `fileOps`
returns to untested.
