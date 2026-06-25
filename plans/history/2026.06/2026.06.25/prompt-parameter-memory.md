# Zero-config parameter memory for interactive run tokens

A pin parameterized with `${prompt:…}` / `${pick:…}` re-asked for every value on
every run, even when the answer was the same as last time. This remembers the last
value entered per token per pin and defaults the next run to it, and adds a "Run with
Last Parameters" action that skips the prompts entirely.

## Finish Report (2026-06-25)

### Scope
VS Code extension (TypeScript). No Flutter/Dart code involved.

### What changed
- **New `exec/promptMemory.ts` singleton.** Stores, per pin id, the last value entered
  for each interactive token (keyed by the token's raw text, e.g. `${pick:dev,stage}`).
  Persisted in **`workspaceState`**, deliberately not `globalState`: a remembered
  value can be anything the user typed (possibly sensitive) and the choice is
  workspace-contextual (the branch/environment/target for this project), so it should
  stay on-device and per-workspace rather than ride Settings Sync to the cloud.
  Follows the established `telemetry`/`tappedPins` init-on-activate pattern;
  inert no-op before `init`.
- **`exec/promptTokens.ts` refactor.** Extracted the per-token prompt into
  `promptForToken(token, lastValue)`, which seeds an input box with the last value and
  moves a pick's last choice to the front (so it is the highlighted default).
  `resolveInteractiveTokens` now defaults each token from memory and remembers the
  answers after a successful run. New `resolveRememberedTokens` resolves from memory
  without prompting where a previous choice exists, prompting only for tokens never
  answered (so a first bypass still works and is then remembered).
- **New command `saropaWorkspace.runPinLastParams`** ("Run with Last Parameters"),
  handler `runWithLastParams` in `commands/pinCommands.ts`. For a pin with no
  interactive tokens it is a normal run; otherwise it resolves via
  `resolveRememberedTokens`, clones the pin with the resolved values
  (`cloneWithResolvedTokens`, sharing the pin id so uri/telemetry/missing-file paths
  are unchanged), and runs through the shared `runPinCommand`. The clone carries no
  remaining interactive tokens, so the runner does not prompt again. Canceling a
  still-needed prompt aborts with the existing "Run canceled" toast.
- **Memory cleanup on unpin.** The `unpin` handler calls `promptMemory.forget(pin.id)`
  so a removed pin's remembered values do not accumulate.
- **Manifest wiring**: command declaration (`$(run-all)` icon), `view/item/context`
  menu entry gated to stored pins (`viewItem == pin`), palette `when: false`, and the
  `package.nls.json` title. `promptMemory.init(context)` added to `activate`.

### Interaction note (design decision)
The pitch's second half was "hold Alt while double-clicking to force-run with last
params". The TreeView API exposes no modifier keys on item activation, so that gesture
is not implementable; the **Run with Last Parameters** menu command delivers the same
behavior (it can also be bound to a key in the Keyboard Shortcuts editor).

### Why it is correct / safe
The stored pin is never mutated — substitution applies to an ephemeral clone for the
run only, matching the existing interactive-token contract. Default-from-memory only
changes the pre-filled value, not the available pick options, so a stale memory cannot
inject an out-of-range choice. workspaceState keeps potentially sensitive input off the
sync channel.

### Verification
- `npx tsc -p ./ --noEmit` → exit 0.
- `node esbuild.js` → bundle built, exit 0.
- No automated tests were run: the extension has no test harness (no `test/`
  directory, no `*.test.ts`, no wired runner). Verified by type-check, build, and
  inspection. The new pure-ish resolvers are unit-testable should a harness be added.

### Localization
No new runtime strings (the cancel path reuses `run.canceledPromptToast`). One manifest
title added to `package.nls.json`. This repo has no machine-translation pipeline, so no
catalog regeneration applies.
