# Plan — #26 Masked / Vault Pins (The Screen-Share Guard)

## Pain
You pin `.env.production` for quick access, then accidentally click it mid-Zoom and leak
API keys on screen.

## Target behavior (revised — see deviations)
Toggle **Masked** on a pin: its tree label is obscured (a generic name + lock glyph),
and opening it requires an explicit confirm ("Reveal `.env.production`?") so a stray
click never instantly displays secrets.

## Approach
### Model (`model/pin.ts`)
Add `Pin.masked?: boolean` and optionally `Pin.maskLabel?: string` (the generic name
shown when masked, default a localized "Protected file").

### Tree (`views/pinTreeItem.ts`)
- When `masked`: render the label as `maskLabel` (never the filename/path), a `lock`
  glyph, and **omit the path from the description and tooltip** (the whole point is that
  the real target is not visible while masked). contextValue stays pin-prefixed so menus
  work.

### Open gate (`commands/pinCommands.ts` `openPin`)
- When `masked`, before opening: a confirm naming the real target ("Reveal
  `.env.production`? It is masked to avoid accidental exposure.") with Reveal / Cancel.
  Only on Reveal does the file open. (This is the achievable equivalent of "blur the
  contents until you click reveal".)

### Commands
- `saropaWorkspace.toggleMask` — flip `masked`; `store.setMasked(pin, on, label?)`.

## Files & changes
- `model/pin.ts` — `masked?` / `maskLabel?`.
- `model/pinStore.ts` — `setMasked`.
- `views/pinTreeItem.ts` — masked rendering (label/glyph, hide path).
- `commands/pinCommands.ts` — toggle command + the reveal gate in `openPin`.
- `package.json` / nls / en.json — command, menu, confirm + toast strings.

## Deviations / limits (important — fidelity gap)
- **The pitch's core — "open the file with VS Code's text blurred out until you click a
  Reveal eye"— is not achievable.** A VS Code extension cannot blur or redact the text of
  a normally-opened document in the editor; there is no API to obscure editor content.
  Options considered and rejected: a custom read-only webview "viewer" that renders the
  file blurred would not be the real editor (no editing, no language features, and it
  would itself have to read+hold the secret) — worse than the file, not better.
- What ships instead: **label masking + a reveal confirm before open.** This addresses
  the actual reported pain (a stray click instantly showing secrets on a shared screen)
  without pretending to deliver content blur. The finish report must state the blur is
  not implemented and why, so this is not recorded as fully delivering the pitch.

## Risks / blast radius
- Low technical risk (label + a confirm). The risk is **overclaiming**: do not describe
  this as hiding the file's contents — it gates the *open*, it does not redact an opened
  document.

## Recommendation
Lowest-fidelity item in the backlog because its headline capability is API-blocked.
Worth shipping the label-mask + reveal-gate as a genuine accidental-exposure guard, but
flag clearly (here and in any changelog copy) that content blur is out of scope. If
content protection is the real goal, the honest path is OS/file-level encryption or not
pinning the secret — not an editor illusion.

## Verification
`tsc` + `esbuild`; manual: mask a pin, confirm the tree shows the generic label + lock
and no path in the hover; click it, confirm the reveal prompt precedes opening.

## Complexity & risk
Low complexity, low technical risk, **high expectation risk** — manage the claim
carefully.

## Finish Report (2026-06-26)

### Scope delivered
The revised, achievable scope shipped in full: **label masking + a reveal confirm
before open**. The pitch's headline — blurring an opened document's text — remains
**not implemented** and is documented as API-blocked (no VS Code extension surface
can redact editor content). The changelog copy states this limit explicitly, so the
feature is not recorded as delivering content blur.

### Deviation from the plan
The plan offered an optional `Pin.maskLabel` (a per-pin custom masked name). It was
**dropped**. A custom label would have no producer (the toggle is a single fast
action with no prompt), leaving a field whose only reader is the tree — a
documentation-only field. Every masked pin therefore renders one shared localized
label (`mask.label` → "Protected file"), which also leaks less than a user-authored
name. Only `Pin.masked?: boolean` was added to the model.

### Implementation
- **Model** (`extension/src/model/pin.ts`): `Pin.masked?: boolean`, stored on
  explicit file pins only (auto/recipe pins are recomputed, never persisted).
- **Store** (`extension/src/model/pinStore.ts`): `setMasked(pin, masked)`, routed
  through `mutatePin` (no-ops on auto/recipe). The off flag collapses to `undefined`
  for round-trip parity (no stale `masked:false`).
- **Tree row** (`extension/src/views/pinTreeItem.ts`): a masked pin renders the
  generic label, sets no `resourceUri` (so the file-type icon/extension cannot leak),
  drops the path/metric from the row detail and the Recent entry, and replaces the
  hover target line with `mask.tooltip` (no real path on a passive hover).
- **Icon** (`extension/src/views/pinRowTokens.ts`): a `masked` input returns a `lock`
  glyph, overriding the resting cosmetic glyphs (custom icon, last-run pass/fail, the
  default pin/file icon) but sitting under the transient running/missing/locked
  states, which reveal nothing identifying and convey live state worth showing.
- **Open gate** (`extension/src/commands/pinInteraction.ts` `openPin`): a **modal**
  reveal confirm naming the real target, gating the open. Modal so a stray click
  cannot fall through to Reveal. `toggleMask` added next to `toggleTail`, restricted
  to stored file pins.
- **Wiring**: command + context-menu (group `2_config`) + hidden-palette entries in
  `package.json`; title in `package.nls.json`; `mask.*` strings in
  `src/i18n/locales/en.json`; registration in `commands/pinCommands.ts`.

### Design decision: open gated, run not gated
Double-click (run) is intentionally **not** gated. The reported pain is a secret
file's contents flashing on a shared screen — that is the open/display path. Running
a script does not display its contents, so gating run would add friction without
addressing the stated risk.

### Verification
- `npx tsc -p ./ --noEmit` — clean.
- `node esbuild.js` — bundle builds.
- `npm test` — 189 pass / 0 fail, including a new `setMasked` persistence round-trip
  test in `src/test/pinStore.test.ts` (masks, reloads from disk in a fresh store,
  and confirms unmasking drops the field rather than storing `false`).
- Tree-row rendering and the icon resolver depend on the `vscode` host (ThemeIcon),
  so they are not unit-testable under the `node --test` stub; verified by inspection
  and left to the manual smoke test below.
