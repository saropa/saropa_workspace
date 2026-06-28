# Launcher recipe pin/schedule actions and board spacing

The Saropa Launcher recommended recipes but exposed no discoverable way to adopt
or automate one — the only adopt action ("Add to Shortcuts") was buried in the
right-click menu and there was no way to schedule a recommendation at all — and
the board still read as one dense block of cards. This record covers adding Pin
and Schedule actions to recipe cards and loosening the board's vertical/whitespace
rhythm.

## Finish Report (2026-06-28)

### Defects

1. **No discoverable adopt action on recipe cards.** A detected recipe's only
   adopt path was the right-click menu's "Add to Shortcuts"; a user browsing the
   recipes pane saw Run but no visible way to keep a recommendation.
2. **No way to schedule a recommended recipe.** Recommended recipes carry schedule
   metadata (for example "daily, default 09:00") but nothing surfaced a schedule
   action. A recipe is recomputed each refresh and persists nothing, so a schedule
   cannot be set on it directly — it must be adopted first.
3. **Cramped board.** Card grid gap, card vertical padding, and group-heading
   spacing were tight, so the board read as one dense block.

### Changes

VS Code extension (`extension/src/`), TypeScript:

- **`views/launcherAssets.ts`** — (a) CSS: card grid gap 7 to 10px, card padding
  vertical 5 to 8px, `.group` margin-top 8 to 14px, `.group-head` padding 3 to 7px.
  (b) Client script: the expanded drawer renders **Pin** and **Schedule** buttons
  gated on `it.pane === 'recipes'`, posting `command` messages for
  `saropaWorkspace.promoteRecipe` and `saropaWorkspace.scheduleRecipe`.
- **`views/launcherItems.ts`** — the recipe right-click menu gained a Schedule
  entry (`scheduleRecipe`, clock icon) beside the existing Pin (`promoteRecipe`).
- **`views/launcherView.ts`** — `scheduleRecipe` added to the `MENU_COMMANDS`
  allowlist; `pin` and `schedule` strings added to the posted `strings` payload.
- **`model/shortcutStoreMutation.ts`** — `promoteRecipeInternal` now returns the
  new stored shortcut's id (`string | undefined`) instead of a boolean;
  `promoteRecipe` and `enableScheduledRecipe` coerce that to their existing boolean
  contract; a new public `promoteRecipeReturningId` exposes the id so a caller can
  act on the adopted copy.
- **`commands/shortcutConfigCommands.ts`** — new `saropaWorkspace.scheduleRecipe`
  command: adopt the recipe via `promoteRecipeReturningId`, resolve the new
  shortcut with `findShortcut`, and open `ScheduleEditorPanel` on it (pre-filled
  from the recipe's own schedule when it carries one). Null-guards both the promote
  result and the re-resolve.
- **`i18n/locales/en.json`** — added `launcher.pin` ("Pin"), `launcher.schedule`
  ("Schedule"), `launcher.menu.schedule` ("Schedule…").

No hex literal introduced; all colors remain theme-bound.

### Tests

- `test/launcherItems.test.ts` — a recipe's menu offers both `promoteRecipe` and
  `scheduleRecipe`.
- `test/launcherAssets.test.ts` — the client script renders the Pin and Schedule
  drawer buttons gated on the recipes pane (references both command ids and the
  `it.pane === 'recipes'` guard).
- `test/shortcutStoreMutation.test.ts` — `promoteRecipeReturningId` returns
  `undefined` for a non-recipe pin (shares promoteRecipe's guard).
- Full suite: 832 passing, 0 failing. Type-check (`npx tsc -p ./tsconfig.json
  --noEmit`) clean; bundle (`node esbuild.js`) clean.

### Convention recorded

`plans/guides/STYLEGUIDE.md` (section 1.1a, Panel launcher) gained bullets for the
board's deliberate spacing and for surfacing a recipe's adopt actions (Pin +
Schedule) on the card, with the adopt-then-schedule rule and the
`promoteRecipeReturningId` mechanism noted.

### Files

- `extension/src/views/launcherAssets.ts`
- `extension/src/views/launcherItems.ts`
- `extension/src/views/launcherView.ts`
- `extension/src/model/shortcutStoreMutation.ts`
- `extension/src/commands/shortcutConfigCommands.ts`
- `extension/src/i18n/locales/en.json`
- `extension/src/test/launcherItems.test.ts`
- `extension/src/test/launcherAssets.test.ts`
- `extension/src/test/shortcutStoreMutation.test.ts`
- `CHANGELOG.md`
- `plans/guides/STYLEGUIDE.md`
