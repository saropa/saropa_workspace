# Set Params editor for parameterized shortcuts and scripts

Once a bundled script (or a pin run via "Run with Last Parameters") resolves an
interactive run token from memory instead of prompting fresh, the only way to
change an already-answered value was to run it again and answer differently, or
clear extension workspace state by hand. There was no dedicated way to configure
a parameter without triggering a run.

## Finish Report (2026-07-20)

### What changed

**`extension/src/exec/promptTokens.ts`**: exported `getInteractiveTokens` (was
the private `collectInteractiveTokens`) and the `InteractiveToken` interface, so
a caller outside the resolve/run path can list a shortcut's tokens. Also fixed
an existing type-cast gap where a token's `kind` was cast to `"prompt" | "pick"`
only, omitting `"pickFolder"` (a pre-existing bug from when pickFolder was
added; harmless at runtime since the cast doesn't affect the actual string
value, but incorrect for callers relying on the type).

**`extension/src/exec/scriptRunner.ts`**: extracted `buildScriptShortcut(script,
extensionPath)`, the Shortcut-synthesis logic `runLibraryScript` already had
inline, so both the run path and the new Set Params command build the
identical shortcut shape — the `library:<id>` id is the promptMemory key, so a
value set from one path must be read by the other.

**`extension/src/views/setParamsPanel.ts`** (new): `SetParamsPanel`, a webview
form listing one editable row per detected interactive token — a text box for
`prompt`, a dropdown for `pick`, a text box + Browse button for `pickFolder` —
seeded from `promptMemory`'s current values. Save writes straight to
`promptMemory.remember` without running anything; Cancel discards. A shortcut
with no interactive tokens gets a named "nothing to set" toast instead of an
empty form (`SetParamsPanel.show`'s early-return guard), so the command is
offered everywhere without needing a `hasInteractiveTokens` contextValue
variant threaded through the existing run/paused/scheduled state machine.
Reuses `CONFIGURE_RUN_STYLE` wholesale for visual consistency with the
existing Configure Run form, and follows the same `ready`/`init` postMessage
handshake `ConfigureRunPanel` uses — field data (labels, remembered folder
paths) is never embedded directly into the HTML string, only posted after the
client is ready, so no per-shortcut string is ever concatenated into
executable JS or risks breaking out of an inline `<script>` tag.

**Commands**: `saropaWorkspace.setPinParams` (registered in
`shortcutConfigCommands.ts`, alongside `configureRun`) and
`saropaWorkspace.setScriptParams` (registered in `wiringViews.ts`, alongside
`runScript`). Both call `SetParamsPanel.show` with the appropriate Shortcut —
directly for a pin, via `buildScriptShortcut` for a library script.

**Surfaces wired** (per explicit request — "useful on all launcher scripts,
not just the prepackaged scripts"):
- Pins/Recipes tree view: `saropaWorkspace.setPinParams` added to the existing
  `saropaWorkspace.configureSubmenu` context menu, gated the same as
  `configureRun` (`viewItem =~ /^shortcut(Scheduled)?(Paused)?$/`).
- Scripts tree view: `saropaWorkspace.setScriptParams` added as a
  `view/item/context` entry for `viewItem == libraryScript`.
- Saropa Launcher panel, "mine" pane: `setPinParams` entry added to
  `launcherItemMenu.ts`'s `buildMenu`, routed through the existing generic
  `MENU_COMMANDS` allowlist + `command` message type in
  `launcherViewMessages.ts`.
- Saropa Launcher panel, Scripts section: `scriptLauncherItem` gained a
  `hasParams: boolean` input (computed in `launcherViewData.ts` via
  `hasInteractiveTokens` against the manifest's raw `config`, without needing
  `extensionPath`) that conditionally populates the card's `menu` array — a
  script with no interactive tokens keeps an empty menu (unchanged from
  before). `launcherViewMessages.ts`'s `library:`-id branch, previously only
  intercepting `run`, now also handles the `setScriptParams` `command` message
  (library-script ids never resolve through `ctx.store.findShortcut`, so they
  need their own branch, same as the existing `run` interception).

Both `saropaWorkspace.setPinParams` and `saropaWorkspace.setScriptParams` are
hidden from the global Command Palette (`"when": "false"` in the
`commandPalette` menu contribution) since both require a shortcut/script
argument context, matching `configureRun`/`runScript`'s existing treatment.

**`package.json`** / **`package.nls.json`**: command declarations, menu
contributions (context menu group entries, palette hides), and manifest
titles ("Set Params...") for both commands.

**`extension/src/i18n/locales/en.json`**: `setParams.title` ("Saropa Params:
{name}", carrying the required Saropa screen-title prefix per
`plans/guides/STYLEGUIDE.md` §1.1), `setParams.subtitle`, `setParams.save`,
`setParams.cancel`, `setParams.saved`, `setParams.none`,
`launcher.menu.setParams`.

**`plans/guides/STYLEGUIDE.md`**: documented two new conventions under
"Native-first surfaces" — the Set Params editor pattern itself, and the
"always-offer the menu entry, guard with a named toast" pattern used in place
of a new contextValue suffix (chosen because `shortcutRowContext.ts`'s
existing state machine is explicitly documented as load-bearing/fragile, and
adding a "has interactive tokens" axis to it would multiply its suffix
combinations for a low-value gate a runtime check already covers cheaply).

**`CHANGELOG.md`**: added a bullet under the existing `Unreleased` → `Added`
section.

### Design decisions

- **A design question was put to the user** (surfaces to wire up first) via
  AskUserQuestion; the user deferred the choice ("i dont know"), so all three
  low-marginal-cost surfaces were wired (Pins tree, Scripts tree, Launcher
  panel for both pins and scripts) since none required touching a fragile
  system — the Launcher panel's menu/message dispatch is already
  command-driven and generic (`buildMenu` + `MENU_COMMANDS` allowlist), so
  parity there turned out to be a small, contained addition rather than the
  larger webview-JS change it initially looked like.
- **Rejected: threading a new contextValue axis through
  `shortcutRowContext.ts`.** That module's own comment calls its suffix
  composition load-bearing; adding a "has params" dimension would multiply
  combinations (`shortcutParamsScheduledPaused`, etc.) for marginal benefit
  over the simpler "always show, toast if nothing to configure" guard chosen
  instead.
- **Rejected: embedding field data directly in the initial HTML string** (the
  first draft did this via `esc(JSON.stringify(fields))` re-stringified into
  the inline script). Caught during self-review: HTML-escaping JSON text
  before `JSON.parse` corrupts the JSON syntax itself (every `"` becomes
  `&quot;`), and even without that bug, concatenating any string (a folder
  path, a token label) into an inline `<script>` risks an accidental
  `</script>` sequence breaking out of the tag. Replaced with the
  `ready`/`init` postMessage handshake `ConfigureRunPanel` already
  establishes as the project's pattern for this exact problem.

### Tests

`npm test` (extension) — 999 tests pass, 0 failures. New coverage:
- `promptTokens.test.ts`: `getInteractiveTokens` returns every unique token
  with kind/label/options in first-seen order, dedups a token reused across
  command/args/cwd, and returns `[]` for a shortcut with none.
- `scriptRunner.test.ts`: `buildScriptShortcut` produces the exact id/exec
  shape `runLibraryScript` runs, so a value set via Set Params round-trips.
- `scriptLibrary.test.ts`: `scriptLauncherItem` offers the Set Params menu
  entry only when `hasParams` is true, empty menu otherwise.

`SetParamsPanel` itself is not unit-tested — `vscode.window.createWebviewPanel`
is not modeled in the test stub (`_stub/vscode.ts`), matching the existing
precedent that `ConfigureRunPanel`/`ScheduleEditorPanel` are exercised only
through their pure logic modules (`configureRun.ts`, `configureRunCommand.ts`),
never the panel class directly.

### Verification

- `npx tsc -p ./ --noEmit` — clean.
- `node esbuild.js` — bundle builds.
- `node -e "JSON.parse(...)"` — confirmed `package.json`, `package.nls.json`,
  and `en.json` still parse after every manifest edit.
- No manual/host-level smoke test was run in this environment (no Extension
  Development Host session).

## What to test

1. In an Extension Development Host: right-click a pin whose exec carries a
   `${prompt:}`/`${pick:}`/`${pickFolder:}` token (or the bundled
   **Organize output folder** script row in the Scripts view) and choose
   **Set Params…**.
2. Confirm the form opens listing each token with its current remembered
   value (blank if never run before), matching the field type — text box,
   dropdown, or text box + Browse button.
3. Edit a value (or use Browse for the folder field), click **Save**, confirm
   a toast names the shortcut, and confirm the panel closes.
4. Run the shortcut/script and confirm it uses the value just saved, with no
   further prompt.
5. Right-click a shortcut with NO interactive tokens and choose **Set
   Params…** — confirm a "has no run parameters to set" message appears and
   no panel opens.
6. Repeat from the Saropa Launcher panel's card menu (both a pin card and a
   parameterized script card) and confirm the same behavior.
7. Open Set Params on a second shortcut while the panel is already open for
   another — confirm it repoints the existing panel (title and fields update)
   rather than opening a second tab.

## Not yet verified

- No live VS Code host session in this environment — the webview's actual
  rendering, the Browse dialog round-trip, and the repoint-on-reopen behavior
  are unverified beyond code inspection and the `ConfigureRunPanel` precedent
  they were modeled on.
- The Save button's disabled-while-any-field-blank behavior is implemented
  but not exercised in a host (it's client-side JS, outside the test stub's
  reach).

## Open questions for you

None outstanding — the one design question asked (which surfaces to wire up
first) was deferred back to me ("i dont know"), and resolved by choosing the
lowest-blast-radius option that still matched the literal request ("all
launcher scripts, not just prepackaged").

## Handoff reflection

1. **Least confident about:** (a) the client-side `updateSaveState` disabling
   Save when any field is blank — this is a blanket rule for every token kind,
   not confirmed against every real use case (a `pick` field always has a
   selected value by construction, so it never blocks; a `prompt` field
   legitimately blank on first setup does block, which may surprise a user
   trying to save an intentionally-empty answer); (b) whether reusing
   `CONFIGURE_RUN_STYLE` wholesale (a stylesheet built for a much larger form)
   introduces any unused-selector visual quirk at this panel's much smaller
   scale — not visually verified; (c) no host-level smoke test at all.
2. **If this breaks in 3 months, the most likely reason is:** a new
   interactive token kind gets added to `promptTokens.ts` without a matching
   `case` in `setParamsPanel.ts`'s client `makeRow` — the client's `else`
   branch would render it as a plain text field, which happens to be a safe
   default but wouldn't validate/constrain the new kind's shape.
3. **Unstated assumptions:** that saving a `pick` field's value to something
   outside its current `arg`-declared option list is impossible (the client
   only ever submits one of the rendered `<option>` values) — true today, but
   if a shortcut's manifest changes its `pick` options after a value was
   already remembered, the editor silently offers only the new list with no
   affordance to see or preserve the old (now-invalid) remembered value.
4. **One unrequested feature:** a "Reset to unanswered" action per field
   (clearing just that token's promptMemory entry, distinct from Save/Cancel)
   for the case where a user wants the NEXT run to prompt fresh again rather
   than just editing to a new fixed value. Not built — brainstorm only.

## Finish Report (2026-07-20, hardening pass)

Addressed the items named in the prior handoff reflection and built the
brainstormed "Reset to unanswered" action.

### What changed

**`extension/src/exec/promptMemory.ts`**: added `forgetToken(pinId,
tokenRaw)`, a per-token variant of the existing per-shortcut `forget` — drops
one token's remembered value, leaving the shortcut's other tokens (and the
memory entry itself, if any remain) intact. Deletes the shortcut's whole
memory entry only when the last token is removed, keeping `has()` accurate.

**`extension/src/views/setParamsPanel.ts`**:
- Save's disabled-state rule narrowed from "any field blank" to "a
  `pickFolder` field is blank" — a blank folder path is meaningless to the
  script it feeds, but a blank `prompt` answer is a legitimate, deliberate
  save (e.g. clearing an optional flag), and a `pick` field always carries a
  selection by construction so it was never actually at risk. The client's
  `input.dataset.kind` now carries the field kind so this check does not need
  to re-consult the fields array.
- `postInit` now folds the currently remembered value into a `pick` field's
  option list when the manifest's declared options no longer include it (a
  stale-but-still-remembered choice), instead of letting it silently vanish
  behind whatever the `<select>` would otherwise default to.
- Added the "Reset to unanswered" action: each field carrying a remembered
  value (`answered: true`) gets an icon button (reusing `CONFIGURE_RUN_STYLE`'s
  existing `.iconbtn` class, same as the env-row delete button) that posts a
  new `reset` message; the host calls `promptMemory.forgetToken` and
  re-`postInit`s so the field visibly reverts to blank/default — the redraw
  itself is the feedback, so no separate toast fires for what is meant to be
  a quick, low-friction action (distinct from Save's toast, which persists a
  meaningfully new answer).

**`extension/src/test/_stub/vscode.ts`**: added `createWebviewPanel` /
`FakeWebviewPanel` / `FakeWebview` — a webview panel stand-in modeling the
`html` setter (via `.webview`), `postMessage` (recorded), `onDidReceiveMessage`
(test-driven via `__receiveFromClient`), `onDidDispose`, `reveal`, and
`dispose`. Also added `ViewColumn` and `window.activeTextEditor` (always
`undefined`, sufficient since `SetParamsPanel` only reads
`?.viewColumn`). This is the piece that turns "no host-level smoke test" from
a total gap into a partially-closed one: the panel's MESSAGE PROTOCOL is now
directly testable, even though the client script's actual DOM rendering still
is not (Node has no `document`).

**`extension/src/test/setParamsPanel.test.ts`** (new): 8 tests covering
`show()`'s init payload (values/kinds/options seeded from promptMemory), the
stale-pick-option preservation, save writing to promptMemory and disposing,
reset clearing one token without disposing or touching the other token,
browse round-tripping the picked folder to the right field, cancel disposing
without writing, the no-tokens early-return opening no panel, and repoint-not-
duplicate on a second `show()` while a panel is already open.

**`extension/src/test/promptMemory.test.ts`**: 3 new tests for
`forgetToken` — drops only the named token, clears `has()` once the last
token is gone, and is a no-op for an unremembered token or pin.

**`plans/guides/STYLEGUIDE.md`**: extended the Set Params entry with the
Reset action and the per-kind Save validation rule, and added a new bullet
documenting the `ready`/`init` postMessage protocol as the required pattern
for any webview form carrying per-item data — naming the exact bug this
pass's predecessor caught in review (HTML-escaping JSON before `JSON.parse`
corrupts it; an unescaped value could break out of an inline `<script>` via
`</script>`).

**`CHANGELOG.md`**: extended the existing Set Params bullet with the Reset
action.

### Handoff reflection response

The prior reflection named four items; this pass addresses them as follows:
1. *Least confident about, part (a) — blanket blank-field validation*: fixed
   — narrowed to `pickFolder` only, per-kind rather than blanket.
   Part (b) — `CONFIGURE_RUN_STYLE` reuse at a smaller scale — not
   fixable without a host to render in; still unverified, noted again below.
   Part (c) — no host-level smoke test — partially closed: the panel's
   message protocol (init/save/reset/browse/cancel/repoint) is now unit
   tested directly via a new webview-panel stub; the client script's actual
   DOM rendering remains untested (no `document` under Node).
2. *If this breaks in 3 months (new token kind, no matching client case)*:
   not changed — the client's `else` branch remains a deliberate, safe
   fallback (a plain text field) for an unrecognized kind, which is graceful
   degradation rather than a defect; documented as intentional rather than
   "fixed", since there is nothing wrong to fix.
3. *Unstated assumption (stale `pick` option list)*: fixed — a remembered
   value not in the current declared options now stays visible and
   selectable instead of silently disappearing.
4. *One unrequested feature (Reset to unanswered)*: built, per explicit
   request this pass.

### Tests

`npm test` (extension) — 1014 tests pass, 0 failures (up from 999: 8 new in
`setParamsPanel.test.ts`, 3 new `forgetToken` tests, 4 pre-existing failures
in unrelated in-progress work — `summarizeReportBody`/`extractHeadline`,
neither touched by this session — resolved themselves between runs, confirmed
not caused by anything in this change).

### Verification

- `npx tsc -p ./ --noEmit` — clean.
- `node esbuild.js` — bundle builds.
- No manual/host-level smoke test — still not possible in this environment;
  narrowed by the new message-protocol test coverage above, not eliminated.

### Not yet verified (unchanged from the prior pass)

- Live rendering of the client script's DOM output, the Reset/Browse buttons'
  actual on-screen appearance, and the `CONFIGURE_RUN_STYLE` reuse at this
  panel's smaller scale — still require an Extension Development Host session
  this environment cannot run.
