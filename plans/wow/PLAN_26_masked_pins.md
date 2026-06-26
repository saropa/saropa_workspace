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
