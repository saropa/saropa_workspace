# Remote / virtual resource pinning (roadmap Later / Exploratory)

A global pin stored only an absolute `fsPath` and resolved it with
`vscode.Uri.file(...)`, which discards the scheme. Pinning a file on a non-local
filesystem (Remote-SSH, WSL, dev container, or a virtual provider) therefore
resolved to a wrong `file:` path on the local machine. This stores the full
resource URI for non-local files so a global pin reaches the right filesystem,
closing the "pin + open" half of the remote/virtual gap.

## Finish Report (2026-06-25)

### Scope

(B) VS Code extension (TypeScript). No Dart/Flutter code. Store-layer change only —
no new commands, manifest entries, or user-facing strings.

### Defect

`PinStore.addPin` / `addLinePin` / `updatePinPath` stored `uri.fsPath` for global
pins, and `resolveUri` rebuilt them with `vscode.Uri.file(pin.path)`. Both drop the
URI scheme, so a remote file (`vscode-remote://…/home/u/x`) was stored as
`/home/u/x` and re-resolved as `file:///home/u/x` — a non-existent local path. Only
local `file:` pins worked.

### What changed (`extension/src/model/pinStore.ts`)

- **`globalStoredPath(uri)`** — returns `uri.fsPath` for the `file:` scheme (the
  common, human-readable, backward-compatible form) and `uri.toString()` for any
  other scheme (so the scheme survives the round-trip).
- **`parseGlobalPath(stored)`** — the inverse: `vscode.Uri.parse` when the stored
  string carries a `<scheme>://` separator, else `vscode.Uri.file`. A Windows drive
  path (`C:\…`) has a single colon but no `://`, so it is never mistaken for a URI;
  paths written by earlier versions are always plain fsPaths, so the change is fully
  backward compatible.
- `resolveUri`, `addPin`, `addLinePin`, and `updatePinPath` global branches now use
  these two helpers instead of raw `fsPath` / `Uri.file`.
- **`findPinByUri`** now compares full URI strings (`uri.toString()`), not `fsPath`,
  so a local `/home/x` and a remote `/home/x` are correctly treated as distinct
  resources (an fsPath compare would collide them and wrongly report "already
  pinned").

### Why the existing surfaces now cover remote/virtual pinning

- **Pin External File...** uses `showOpenDialog`, which in a remote window returns
  remote-scheme URIs; `pinUri → addPin` now stores them intact.
- **Pin Active File (Global)** / **Pin This Line** pass the active document's URI,
  which carries the remote/virtual scheme; both store paths now preserve it.
- **Open / Peek / Reveal** go through `resolveUri`, which reconstructs the original
  URI, so `showTextDocument` / peek / `revealFileInOS` act on the right resource.
- **Export / Import** carry `pin.path` (the stored form) via `toSharedPin`, so a
  remote pin round-trips through a pin-set file without losing its scheme.
- Project pins were already correct: their paths are folder-relative and resolved
  with `Uri.joinPath(folder.uri, …)`, which inherits the folder's scheme.

### Out of scope (recorded on the roadmap)

Running a pinned *script* on a remote host is unchanged — the runner still assembles
a local command line. The roadmap Later item and the competitive-gap table row are
reworded to "pin + open shipped; remote run remains".

### Verification

- `npx tsc -p ./ --noEmit` from `extension/` — clean, no errors.
- `node esbuild.js` from `extension/` — bundle builds.
- Backward compatibility reasoned from the detection rule: every previously stored
  global path is a plain fsPath with no `://`, so `parseGlobalPath` routes it to
  `Uri.file` exactly as before.
- No automated test added: the extension has no test harness yet (roadmap Phase
  4.1, unshipped). Verified by type-cleanliness, bundle build, and inspection.

### Notes for maintainers

- The single source of truth for the local-vs-URI storage decision is the
  `globalStoredPath` / `parseGlobalPath` pair; any new code path that persists a
  global pin's target must use them rather than touching `pin.path` directly.
