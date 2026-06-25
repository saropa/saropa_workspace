# Share a pin as a one-click import link

A perfected run/macro pin could only be shared by describing it for a teammate to
recreate by hand. This encodes a pin's portable configuration into a clickable
`vscode://` link and adds a URI handler that imports it (after a confirm) in one
click.

## Finish Report (2026-06-25)

### Scope
VS Code extension (TypeScript). No Flutter/Dart code.

### What changed
- **New `import/shareLink.ts`.** `toSharedPin` reduces a pin to its portable fields
  (label, path, action, exec, icon, color, schedule — never id/scope/order).
  `encodePinLink` JSON-encodes that, base64url-encodes it (no `+/=` to survive chat
  clients), and builds `vscode://saropa.saropa-workspace/import?data=…`.
  `decodeSharedPin` reverses it defensively (rejects bad base64/JSON, wrong schema
  version, and a payload carrying nothing runnable/openable; never throws).
  `describeSharedPin` renders a one-line "what it does" using the existing
  `recipe.desc.*` strings.
- **New command `saropaWorkspace.copyPinLink`** ("Copy as Saropa Link") on every
  pin's copy menu group; writes the link to the clipboard with a confirming toast.
- **`PinStore.importPin(shared, scope)`** adds a stored pin from the portable shape
  with a fresh id/order; project scope writes the first workspace folder's file
  (false when none open), global writes globalState. Never runs the pin.
- **URI handler in `extension.ts`** (`handlePinImportUri`, registered via
  `window.registerUriHandler`): on `/import`, decodes `?data=`, shows a modal confirm
  naming what the pin does, and imports to the project scope (or global when no folder
  is open). A malformed link degrades to one warning.

### Security
Importing only ADDS the pin; it never runs it, so a shared shell command stays a
visible, deliberate choice the user can inspect and delete. The confirm dialog shows
the command/URL before adding.

### Verification
`npx tsc --noEmit` exit 0; `node esbuild.js` exit 0; package.json / package.nls.json /
en.json parse-validated. No test harness in the extension; verified by type-check,
build, and inspection.

### Localization
`share.*` runtime strings added to `en.json`; `command.copyPinLink.title` to
`package.nls.json`. No MT pipeline in this repo.
