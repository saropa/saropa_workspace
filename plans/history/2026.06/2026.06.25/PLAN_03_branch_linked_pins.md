# Plan — #3 Branch-Linked Pin Sets (The Context Time-Machine)

## Pain
You have six files pinned for a refactor on `feature/auth`. You switch to `main` for a
hotfix and those pins are now noise; your `main` pins are buried or absent.

## Target behavior
A pin can be **linked to a git branch**. The tree shows only pins linked to the current
branch plus all unlinked (always-shown) pins. Switching branches re-filters the tree
live. A pin's context menu gains **Link to Current Branch** / **Show on All Branches**.

## Approach
### Model (`model/pin.ts`)
Add `Pin.branch?: string` — the branch name this pin is scoped to. Absent = shown on
every branch (the default, fully backward compatible).

### Current branch + change detection (`exec/gitBranch.ts`, new)
- `currentBranch(folder): Promise<string | undefined>` — read `.git/HEAD`
  (`ref: refs/heads/<name>` → `<name>`; a detached HEAD returns the short sha). Reading
  the file is enough; no `git` process spawn (matches the existing `systemEvents.ts`
  approach of reading `.git` directly).
- A `BranchWatcher` (mirror `systemEvents.ts` git watcher): a `FileSystemWatcher` on
  `.git/HEAD` per workspace folder, debounced, firing an `onDidChangeBranch` event.
  Wire it in `extension.ts`; on fire, call `store.refresh()` so the tree re-filters.

### Store / tree filter
- `PinStore` exposes the active branch (cache it, refreshed by the watcher) and filters
  `getProjectPins()` consumers — better: keep the store returning all pins and apply the
  branch predicate in `views/pinsTreeProvider.ts` `getChildren`, so the data layer stays
  branch-agnostic and the filter lives with the other tree-display logic. A pin is shown
  when `!pin.branch || pin.branch === activeBranch`.
- Branch is per-folder; a project pin's branch is checked against its own folder's
  current branch, a global pin against the first workspace folder's branch (global pins
  are rarely branch-linked — document that).

### Commands
- `saropaWorkspace.linkPinToBranch` — sets `pin.branch = currentBranch(folder)` via a
  new `store.setPinBranch(pin, branch?)` mutator (uses `mutatePin`). Toast names the
  branch.
- `saropaWorkspace.unlinkPinBranch` — clears it ("show on all branches").
- Context-menu entries gated so "Link" shows when unlinked and "Show on all" when linked.

### Tree affordance
A branch-linked pin carries a small `git-branch` glyph or a `· on <branch>` description
suffix so it reads as scoped even when shown.

## Files & changes
- `model/pin.ts` — `branch?` field.
- `model/pinStore.ts` — `setPinBranch`; expose active branch.
- `exec/gitBranch.ts` (new) — read HEAD + branch watcher + event.
- `extension.ts` — construct the watcher, refresh on branch change.
- `views/pinsTreeProvider.ts` — branch predicate in `getChildren`; subscribe to the
  branch-change event for repaint.
- `views/pinTreeItem.ts` — optional "on <branch>" affordance (small surface).
- `package.json` / nls / en.json — two commands, menus, strings.

## Deviations / limits
- The pitch's "smooth animate away" is not an API a TreeView exposes; pins simply
  filter in/out on the branch-change refresh (instant, not animated).

## Risks / blast radius
- Touches the **shared tree provider** (`getChildren`) and `pinTreeItem` — coordinate
  with #17/#28, which add the general filter mechanism; branch filtering should compose
  with (not duplicate) that predicate.
- A pin scoped to a deleted branch would vanish forever — provide an escape: a
  "Show pins from other branches" toggle, or surface branch-scoped-but-hidden counts so
  they are never silently unreachable.

## Verification
`tsc` + `esbuild`; manual: link a pin on branch A, `git checkout B`, confirm it hides
and reappears on checkout of A.

## Complexity & risk
Moderate. The branch watcher is straightforward (clone of the existing git watcher);
the risk is the shared tree-filter coupling and the "hidden forever" escape hatch.

## Finish Report (2026-06-25)

Branch-linked pins shipped. A pin may carry an optional `Pin.branch` naming the git
branch it is scoped to; absent (the default) means shown on every branch, so existing
pins are fully backward compatible.

### What changed
- **Model** (`extension/src/model/pin.ts`): added `Pin.branch?: string`, stored on
  explicit pins only (auto/recipe pins are recomputed each refresh and carry none).
- **Branch reader + tracker** (`extension/src/exec/gitBranch.ts`, new): `readCurrentBranch`
  was moved here from `pinExpiry.ts` so it is the single source shared by branch-linked
  pins and time-bomb "until branch changes" expiry; `pinExpiry.ts` and
  `configureExpiry.ts` now import it. A new `BranchTracker` watches each folder's
  `.git/HEAD`, caches the current branch, and fires `onDidChangeBranch` on a checkout
  (debounced; disposable). It reads `.git/HEAD` directly — no `git` process, no
  dependency — mirroring `systemEvents.ts`.
- **Store** (`extension/src/model/pinStore.ts`): added `setPinBranch(pin, branch?)`,
  routed through `mutatePin` so it no-ops on auto/recipe pins.
- **Tree filter** (`extension/src/views/pinsTreeProvider.ts`): a `branchMatches`
  predicate applied inside `scopePins`, so branch filtering composes with — rather than
  duplicates — the text/chip/tag filter. The data layer stays branch-agnostic. The
  predicate fails OPEN: when the folder or its branch cannot be read, the pin is shown,
  never hidden. A reveal-path count fix routes `makeScopeRoot` / `makeFolderItem`
  through `scopePins` so reveal-built headers agree with live ones.
- **Row affordance** (`extension/src/views/pinTreeItem.ts`): an `on <branch>` chip in
  the row description plus a hover line, so a linked pin reads as branch-scoped even
  while shown.
- **Commands**: `toggleBranchLink` (`extension/src/commands/pinCommands.ts`) links the
  pin to the current branch or clears the link; `showAllBranches` / `filterByBranch`
  (`extension/src/extension.ts`) drive the escape-hatch toggle. The `BranchTracker` is
  constructed in `activate`, its `init()` deferred so activation never blocks; the
  `branchShowAll` / `branchHasHidden` context keys gate the title-bar buttons.
- **Manifest + strings**: three commands, two title buttons, one context-menu entry,
  `package.nls.json` titles, and `en.json` runtime strings.
- **Tests** (`extension/src/test/gitBranch.test.ts`, new): five unit tests against the
  fs-backed `vscode` stub — `readCurrentBranch` symbolic-ref / detached / no-repo
  parsing, and `setPinBranch` link round-trip + clear. Full suite: 141 pass, 0 fail.

### Deviations from the plan
1. **Single toggle command instead of two state-gated menu entries.** The tree's
   `contextValue` scheme has no spare per-item dimension to gate two labels
   ("Link to Current Branch" vs "Show on All Branches") without widening the existing
   exact-match menu clauses, which the code comments there explicitly warn against. The
   established `toggleTail` single-toggle pattern was mirrored; the `on <branch>` row
   chip makes the current state obvious.
2. **Escape hatch is a "Show Pins from All Branches" toolbar toggle** (the plan's first
   suggested option), gated by a `branchHasHidden` context key so it appears only when
   branch filtering is actually hiding something — never a dead control.

### Not covered
- The pitch's "smooth animate away" is not a TreeView capability; pins filter in/out on
  the branch-change refresh (instant, not animated) — as the plan anticipated.
- The Recent group is not branch-filtered (it is cross-cutting run history, not the
  branch-scoped view).
