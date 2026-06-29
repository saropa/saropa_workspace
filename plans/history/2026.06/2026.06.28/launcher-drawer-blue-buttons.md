# Launcher drawer action buttons render blue

The expanded launcher card's drawer buttons (Open, Copy path, Pin, Schedule)
used the secondary gray style and read as flat labels rather than buttons. They
now render with the primary blue style, matching the card head's Run/Open button,
so every drawer action carries a visible button affordance.

## Finish Report (2026-06-28)

### Defect

In the launcher webview, the per-card drawer surfaced its actions through
`actionButton(label, icon, primary, onClick)`. Three of the four calls passed
`primary = false`, rendering `.btn` (the secondary gray style backed by
`--vscode-button-secondaryBackground`). Against the card background those buttons
read as static text labels, not tappable controls — only the head's Run/Open
button and the drawer's Open action were blue. The result was an inconsistent
drawer where Copy path, Pin, and Schedule looked inert.

### Change

`extension/src/views/launcherAssets.ts` — flipped the `primary` flag to `true`
on the three secondary drawer calls:

- Copy path (`actionButton(strings.copyPath || 'Copy path', 'copy', true, …)`)
- Pin (`actionButton(strings.pin || 'Pin', 'star-full', true, …)`)
- Schedule (`actionButton(strings.schedule || 'Schedule', 'clock', true, …)`)

Open was already `true`. All four drawer actions now resolve to `.btn.primary`
(`--vscode-button-background`, blue), matching the head button. No string,
command, layout, or behavior changed — only the button style class.

### Tests

`extension/src/test/launcherAssets.test.ts` gained a guard,
"drawer action buttons use the primary (blue) style", asserting the embedded
client script passes `primary = true` for Pin, Schedule, and Copy path. This
pins the new behavior so a regression back to the secondary style fails the
suite. Full unit run: 866 pass, 0 fail. Type-check (`npx tsc -p ./ --noEmit`)
clean.

### Style guide

`plans/guides/STYLEGUIDE.md` — the launcher section now records that every drawer
action button renders as `.btn.primary` to match the head, and that a secondary
gray `.btn` reads as a label rather than a button. The earlier "secondary action
buttons" wording in the expand-then-act rule was corrected to "action buttons".

### Scope

VS Code extension (TypeScript) and docs only. No Dart, no localization strings
added or changed (the labels were already externalized via the `strings`
catalog). No bug file closed.
