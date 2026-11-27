# l10n passthrough markers on Launcher templates

The l10n checker reported five "expects params but none passed" warnings in `extension/src/views/launcherView.ts`. The calls were correct: the templates are sent unfilled and the webview substitutes the placeholders.

## Finish Report (2026-11-27)

### Change

The calls for `launcher.count`, `launcher.countFiltered`, `launcher.menu.ariaLabel`, `launcher.menu.subAriaLabel`, and `launcher.runHistory.count` carry a trailing `// l10n:passthrough` marker, and the comment above the first of them states what the marker means. No runtime behavior changed, so there is no changelog entry.

### Verification

- Substitution sites were traced statically: `launcherScriptRender.ts` (count, filtered count, run history count) and `launcherScriptMenu.ts` (both menu labels).
- The checker source (`l10nDiagnostics.ts` in Saropa Lints) skips a call when the marker is on the same line.
- A search of `extension/src/test` found no assertion on the marker, on these keys, or on the source text of `launcherView.ts`. Tests were not executed.
- The warnings have not been observed to clear. The diagnostics read after the edit still carried the pre-edit line positions.

### Open items

- Both menu labels substitute with a string replacement, so an item name containing `$&` is garbled in the accessibility label.
- The dead-key diagnostic flags 1083 of 3150 keys. Six have no consumer found: `customize.icon.count`, `branch.chip`, `releaseBoard.blockers.fixed`, `releaseBoard.noRule.openFile`, `releaseBoard.org.override.moved`, `releaseBoard.org.override.stale`. The rest are in use (the smaller key families were checked less thoroughly). The checker's bulk dead-key removal command must not be run.
