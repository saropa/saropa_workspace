# Launcher: copy-path button, wider cards, no share-link in card menus

In the Saropa Launcher Panel webview, a file-backed card offered no way to copy
the file's location, cards clipped longer names and paths, and every card's
right-click menu carried a rarely used "Copy as Saropa Link" share action. The
expanded drawer of a file-backed card now has a **Copy path** button, cards are
about 30% wider, and the launcher card menus no longer offer the share-link
action (it remains on the Shortcuts sidebar).

## Defect

- No on-disk-path affordance: a file shortcut, a file recipe, and a Project
  Files entry all open or run, but the webview exposed no action to put the
  file's full path on the clipboard — the user had to open the file to learn
  where it lived.
- Card width: the responsive grid track `minmax(190px, 1fr)` clipped longer
  labels and paths before the next column would have wrapped, so single-line
  names truncated unnecessarily on a wide Panel.
- Menu noise: both the stored-shortcut menu and the recipe menu in
  `launcherItems.ts` pushed a `saropaWorkspace.copyPinLink` entry ("Copy as
  Saropa Link"). The share-link action — which encodes a shortcut's whole
  configuration into a `vscode://` import URI — is rarely used and crowded the
  focused run/open/configure actions on every launcher card.

## Change

Pure data layer (`extension/src/views/launcherItems.ts`):

- `LauncherItem` gained an optional `copyable` flag, true only for cards backed
  by a real file on disk (a file shortcut/recipe via `toItem`, a surfaced
  project file via `fileLauncherItem`) and false for shell/macro/routine actions
  and watches. The webview never carries or trusts the path itself; the host
  resolves the real path from the card id.
- The `copyPinLink` entry was removed from both the stored-shortcut menu and the
  recipe menu, leaving the focused action set.

Webview asset module (`extension/src/views/launcherAssets.ts`):

- The card grid track widened from `minmax(190px, 1fr)` to
  `minmax(247px, 1fr)` (about 30% wider).
- A `copyable` card's expanded drawer renders a **Copy path** button that posts
  `{ type: 'copyPath', id }` to the host.

Host controller (`extension/src/views/launcherView.ts`):

- `copyPinLink` was dropped from the `MENU_COMMANDS` allowlist, so a stale or
  spoofed menu message for it is rejected.
- A `copyPath` message handler resolves the on-disk path host-side by id — a
  file shortcut through `store.findShortcut` + `store.resolveUri` (rejecting any
  non-file shortcut), or a surfaced project file by matching the validated
  `fsPath` — writes it to the clipboard, and confirms with a message naming the
  file. The webview-supplied path is never trusted, consistent with the existing
  untrusted-webview model.

i18n (`extension/src/i18n/locales/en.json`):

- Added `launcher.copyPath` ("Copy path") and `launcher.copiedPath`
  ("Copied path to {name}.").
- Removed the now-unused `launcher.menu.copyLink`.

The `saropaWorkspace.copyPinLink` command, the Shortcuts sidebar action, the
share-link encoder (`import/shareLink.ts`), and the `vscode://.../import` handler
were left intact — existing shared links still import, and the action is still
available from the sidebar.

## Result

- A file shortcut, file recipe, or Project Files card shows **Copy path** in its
  drawer; clicking it copies the full path and confirms with a message naming
  the file. Non-file actions and watches show no such button.
- Launcher cards are about 30% wider, so longer names and paths fit on one line
  before clipping.
- Right-clicking a launcher card no longer offers Copy as Saropa Link; the
  sidebar action is unchanged.

## Tests

Scoped run of `launcherItems.test.ts`, `launcherAssets.test.ts`, and
`l10n.test.ts` — 58 tests pass. The stored-shortcut menu test ("a stored
shortcut's menu mirrors the sidebar actions") and the recipe menu tests do not
assert on the removed share-link entry, so the menu trim needed no test update.
`launcherAssets.test.ts` asserts the grid uses an `auto-fill`/`minmax(` track
rather than a specific pixel value, so the width change passes. No test asserts
on the new `copyable`/`copyPath` behavior at the webview boundary (the host
handler imports `vscode` and is outside the Node-runner unit scope).

## Style guide

No new convention. The Copy-path drawer button and its file-naming confirmation
follow existing rules already in `plans/guides/STYLEGUIDE.md` (externalized
strings, no-silent-async feedback that names the item acted on); the width and
menu-trim changes adjust existing values, not patterns.
