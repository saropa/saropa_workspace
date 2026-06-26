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
