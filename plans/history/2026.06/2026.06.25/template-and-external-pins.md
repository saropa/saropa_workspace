# Template pins and external-file pins

Two friction removers shipped together. "Use as Template" duplicates a file pin with
a casing-aware rename so a boilerplate file becomes a new one in a click; "Pin
External File" pins any file on disk — including one in another repo — as a global
pin without opening a second window.

## Finish Report (2026-06-25)

### Scope
VS Code extension (TypeScript). No Flutter/Dart code.

### What changed — Template Pins (WOW #27)
- **New `commands/templatePin.ts`.** `useAsTemplate` reads a file pin's target, asks
  for a new name, and writes a sibling file with the file's base identifier renamed in
  every case style at once. `splitWords` breaks an identifier on camelCase humps and
  `_ - space`; `renderCase` re-renders words as snake / kebab / camel / pascal /
  UPPER_SNAKE; `replaceAllCases` substitutes each style throughout the text (the five
  styles render to distinct strings, so per-style split/join cannot cross-replace).
  The new file name matches the source's detected style. An existing target is never
  overwritten (stat-then-abort); the copy is opened.
- **New command `saropaWorkspace.useAsTemplate`** ("Use as Template…") on file pins
  (`viewItem == pin || pinAuto`); the handler also guards non-file pins with a message.

### What changed — External File Pins / "Wormhole" (WOW #21)
- **New command `saropaWorkspace.pinExternalFile`** ("Pin External File…") in the Pins
  view title menu and the command palette. Opens a file picker and pins the chosen
  file as a global pin via the existing `pinUri` path (so it reports the result and
  offers run targets, identical to pinning from the editor). A global pin opens in the
  current window on single click — no second workspace instance — which is the
  cross-project glance the pitch wanted.

### Verification
`npx tsc --noEmit` exit 0; `node esbuild.js` exit 0; manifests parse-validated. No
test harness in the extension; verified by type-check, build, and inspection. The
case-conversion helpers are pure and unit-testable should a harness be added.

### Notes / limits
Template transformation reads the source as UTF-8 text; a binary "template" would not
carry meaningful identifiers and is out of scope. A single-word file name (e.g.
`utils`) will rename that common word — inherent to templating and opt-in via the
explicit action.

### Localization
`template.*` and `external.*` runtime strings added to `en.json`;
`command.useAsTemplate.title` and `command.pinExternalFile.title` to
`package.nls.json`. No MT pipeline in this repo.
