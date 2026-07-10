Status: Fixed

![alt text](BUG_REPEATED_OPENED_ANNOYING.png)

you have to debounce and set a higher limit for documents. files get opened repeatedly during development. that doesn't need permanent pinning.

also need an option to ignore files of a type. i.e. "Ignore .dart"

---

## Finish Report (2026-07-10)

The open-frequency shortcut suggester counted every active-editor change, so
routine development (flipping between files, search, go to definition) drove a
file to the open threshold in a single session and produced repeated "You have
opened {name} {count} times" prompts. The default threshold of 6 was also low
enough to trip on ordinary use, and there was no way to exclude a file type that
is opened often but never a shortcut candidate.

### Change

Scope: VS Code extension (TypeScript). All edits under `extension/`.

- `extension/src/views/suggestions.ts` — the decision logic was extracted into a
  pure `evaluateOpen(state, fsPath, isAlreadyShortcut, cfg, now)` core (mirroring
  the sibling `reconcileTabPins` in `tabPinSuggestions.ts`), and three behaviors
  were added:
  1. **Debounce.** `SuggestState` gained `lastCountedAt` (fsPath → epoch-ms of the
     last counted activation). A re-focus within the cooldown returns unchanged, so
     a burst of re-focus collapses to one count and the tally tracks distinct
     working sessions, not focus churn.
  2. **Higher threshold.** Default `suggestions.openThreshold` raised from 6 to 10.
  3. **Ignore by extension.** The prompt gained an "Ignore .ext" action; choosing
     it appends the extension to the new `suggestions.ignoreExtensions` setting
     (written to the Global target — a noisy extension is language-wide). Files of
     an ignored extension are never counted or offered.
- `extension/package.json` — `suggestions.openThreshold` default 6→10; new
  `suggestions.debounceMinutes` (default 30, range 0–1440) and
  `suggestions.ignoreExtensions` (string array).
- `extension/package.nls.json` — descriptions for the two new settings and the
  reworded threshold description.
- `extension/src/i18n/locales/en.json` — new `suggest.ignoreType`,
  `suggest.ignored`, and `suggest.ignoreFailed` keys.
- `extension/src/test/suggestions.test.ts` — new unit tests for `evaluateOpen`
  and `normalizeExtension`.

### Review outcomes acted on

- **Swallowed settings-write failure.** The ignore-write path ran behind a
  fire-and-forget `void this.onActivate(...)`, so a rejected `config.update`
  would be invisible. It is now wrapped in try/catch and surfaces
  `suggest.ignoreFailed`, naming the extension (VS Code API rule: a rejected
  promise behind a command emits a visible error).
- **Misleading compound-extension comment.** `path.extname` returns only the final
  segment, so an example of `.g.dart` could never be produced or matched. The
  comment now states the stored value is always single-segment.

Flagged but out of scope (pre-existing, not fixed): the whole-`globalState`
read-modify-write is last-write-wins across concurrent activations of different
files (the debounce reduces write frequency, so it is not worsened); `counts` and
`lastCountedAt` are unbounded (only `handled` is capped); and `appendHandled`
(pure) duplicates the `markHandled` class method.

### Validation

- `npx tsc -p ./ --noEmit` — clean.
- `node esbuild.test.js` — 949 tests pass (10 for this module: debounce
  within/past window, boundary at exactly the window, zero-debounce, ignore by
  extension, no-extension guard, already-shortcut, handled, threshold offer,
  no-mutation).
- `node esbuild.js` — bundle builds.
