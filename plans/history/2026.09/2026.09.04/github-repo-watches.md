# GitHub repo watches — new issues/PRs surfaced through the Watches view

## Finish report (2026-09-04)

Shipped. The original plan for this item proposed a standalone 7th sidebar view
("GitHub", listing every linked repo's open issues and PRs as a tree). Mid-
implementation the design was redirected: the Watches view already exists to answer
exactly "tell me when something new lands" — for a folder, that's a new file; for a
repo, it's a new issue or PR. Rather than build a parallel notify mechanism, a GitHub
repo became a second **kind** of watch, reusing the existing store, tree, unseen-
count badge, and enable/global/scope commands. This report supersedes
`plans/PLAN_GITHUB_ISSUES_PRS.md`, which described the abandoned standalone-view
design and has been removed.

## Scope

TypeScript, `extension/src/`. Verified with `npx tsc -p ./ --noEmit` (clean),
`node esbuild.js` (bundles), and `npm test` (1256/1256 passing, including new
coverage for the changed/added logic). No manual smoke test was run in this session
(no F5 dev host available) — the GitHub auth flow, the toast wording, and the
tree row rendering are unverified end-to-end and should be smoke-tested before
release.

## Changes

**`model/folderWatch.ts`** — `FolderWatch` gained an optional `kind?: "folder" |
"repo"` field (the new `WatchKind` type). Absent `kind` reads as `"folder"` via the
new `watchKind()` helper, so every watch created before this change keeps behaving
identically — no migration needed. A repo watch's `target` holds an `"owner/repo"`
slug instead of an fsPath; `isFile` is unused (always `false`) and `mode` is fixed to
`"new"` (GitHub already has its own notion of "updated" — re-alerting on every edit
to an existing issue would be noise). Added `watchDisplayName()`, a single source of
truth for "the name to show for a watch" (label, else target — basenamed for a
folder watch, kept whole for a repo watch since `owner/repo` IS the display form).
Every call site that previously inlined `watch.label ?? path.basename(watch.target)`
now calls this instead (`folderWatchEngine.ts`, `folderWatchManageCommands.ts`,
`folderWatchRowCommands.ts`, `watchesTreeProvider.ts`).

**`github/githubTypes.ts`** (new) — `GitHubWatchItem` (an open issue or PR: key,
kind, number, title, URL, author, updatedAt, labels, optional draft flag) and
`RepoSlug`.

**`github/githubClient.ts`** (new) — `isValidRepoSlug` / `parseRepoSlug` (pure
regex validation, tested), `fetchOpenRepoItems(slug, interactive)` (fetches
`/issues` and `/pulls` for a repo and merges them into `GitHubWatchItem[]`, using
`vscode.authentication.getSession('github', ['repo'], { createIfNone: interactive
})` — `interactive: false` for background polling so a scan never pops an auth
prompt on its own; `interactive: true` only for the explicit "watch this repo"
command), and `repoIssuesUrl(slug)` (fallback deep-link target).

**`exec/folderWatchEngine.ts`** — extended, not replaced. `scanTarget` branches to
a new `scanRepoTarget` for a `kind: "repo"` watch, which fetches open items and
builds a `FolderSnapshot` keyed by `"issue:123"` / `"pr:45"` mapped to each item's
`updated_at` — the same shape `diffSnapshots` already understood, so no diff-logic
change was needed. A repo watch has no live filesystem event source, so `arm()` is
skipped for it in `reconcileWatchers()`; instead a self-rescheduling `setTimeout`
(`scheduleRepoPoll`, interval from `saropaWorkspace.github.pollIntervalMinutes`, re-
read every tick so a config edit takes effect on the next tick) scans every enabled,
in-scope repo watch. The baseline-seed-on-first-sight behavior (no toast for a
repo's existing open items) is shared with the folder-watch path via the same
`store.getBaseline(id) === undefined` check. A new in-memory `repoItemsCache` (Map,
per session, keyed by watch id) holds the last-fetched items — `FolderSnapshot`
alone can't carry a title/URL, and the toast and the row-click open action need
both. `toast()` branches to a new `toastRepo` that names new issues/PRs by title
(`#123 Fix null crash`, matching the folder-watch convention of naming the item, not
just a count) and opens the newest one on GitHub via `vscode.env.openExternal`.

**`commands/githubWatchCommands.ts`** (new) — `addGitHubRepoWatch`: prompts for a
slug (validated inline), rejects a duplicate, calls `fetchOpenRepoItems(slug, true)`
as both the interactive sign-in trigger and an existence check (a typo'd repo fails
here with a clear message rather than silently never reporting), then stores the
watch. Registered as `saropaWorkspace.watchGitHubRepo`.

**`commands/folderWatchRowCommands.ts`** — `openWatch` branches on `watchKind`: a
repo watch opens the newest unseen item's URL from the engine's cache, falling back
to the repo's issues page when the cache is empty (a reload cleared it, or nothing
is unseen). `openWatch` and `registerFolderWatchCommands` (`folderWatchCommands.ts`)
now take the engine as a parameter so the row command can reach
`getCachedRepoItems`.

**`commands/folderWatchManageCommands.ts`** — the "Manage Watches" hub's row
description, icon (github glyph for a repo watch), and title all branch on
`watchKind`/use `watchDisplayName`, so a repo watch reads correctly there instead of
picking up folder-watch wording ("folder - Only new files - on").

**`views/watchesTreeProvider.ts`** — `WatchTreeItem` branches its `kind`/`mode`
wording and base icon (github glyph vs eye) on `watchKind`; the disabled/global/
unseen state machine and `contextValue` scheme (`watchEnabled`/`watchDisabled`) are
unchanged and shared, so a repo watch's inline toggle/remove menu items work with no
`package.json` menu changes.

**`activation/wiringWatchers.ts`** — passes the engine into
`registerFolderWatchCommands`.

**`package.json`** — new command `saropaWorkspace.watchGitHubRepo` (github icon),
added to the Watches view's title-bar navigation menu (between "Watch Folder" and
"Manage Watches"); new setting `saropaWorkspace.github.pollIntervalMinutes` (number,
default 5, 1-60).

**i18n** — `command.watchGitHubRepo.title` and `config.github.pollIntervalMinutes.
description` in `package.nls.json`; `github.*` runtime keys (kindRepo, modeNewItems,
addRepoTitle/Prompt, invalidSlug, alreadyWatched, addRepoFailed, repoAdded,
newIssues/newPrs/newMixed) in `src/i18n/locales/en.json`. The Watches view's empty-
state welcome content now mentions repo watching and links the new command.

## Tests

`src/test/folderWatch.test.ts` — added coverage for `watchKind` (defaults absent
`kind` to `"folder"`; reads an explicit `"repo"`) and `watchDisplayName` (keeps a
repo slug intact where `path.basename` would have mangled it; basenames a folder
target; label always wins). `src/test/githubClient.test.ts` (new) — `isValidRepoSlug`
/ `parseRepoSlug` / `repoIssuesUrl`, the pure parts of the GitHub client (the
authenticated-fetch path needs the extension host and is not covered by the
Node-runner unit tests, matching this repo's existing test-scoping rule for
`vscode`-dependent code).

## Post-review fixes (2026-09-04)

A medium-level code review surfaced six bugs and one missed call site:

1. **Icon precedence in Manage Watches** (`folderWatchManageCommands.ts`): the QuickPick icon ternary checked `watchKind === "repo"` before `!w.enabled` and `isGlobalWatch`, so a disabled or global repo watch showed the github glyph instead of eye-closed/globe. Restructured to match the tree row's disabled-first precedence.

2. **Case-sensitive duplicate detection** (`githubWatchCommands.ts`): `w.target === trimmed` used strict equality on GitHub slugs, which are case-insensitive. Normalized to `.toLowerCase()` so `Facebook/react` and `facebook/REACT` are recognized as the same target.

3. **Validator/trim mismatch** (`githubWatchCommands.ts`): `validateInput` ran `isValidRepoSlug` on the raw (untrimmed) input, while the stored value was trimmed post-submit. Trailing whitespace (common when pasting) triggered a false "invalid" error. Now trims before validating.

4. **repoItemsCache leak** (`folderWatchEngine.ts`): `disarm()` disposed the FileSystemWatcher but never called `repoItemsCache.delete(id)`, so a removed repo watch's cached items (up to 200 objects) leaked for the extension host's lifetime. Added cleanup.

5. **Sequential API calls** (`githubClient.ts`): `/issues` and `/pulls` fetches were awaited sequentially. Switched to `Promise.all` to halve per-repo scan latency.

6. **Launcher view not updated** (`launcherViewData.ts`, `launcherWatchItem.ts`): `buildWatchItems` still used `path.basename(w.target)` and the `WatchItemInput` interface had no `WatchKind` field, so a repo watch on `facebook/react` rendered as "react" labeled "Folder" with a plain eye icon. Added `watchKind` to the interface, updated the call site to use `watchDisplayName()` and `watchKind()`, and branched icon/kind/mode text for repo watches (github glyph, `github.kindRepo`/`github.modeNewItems` l10n keys). New test pins the repo-watch launcher card behavior (1257/1257 passing).

## What was deliberately not built

Carried over from the superseded standalone-view plan, still not done and still
plausible future work: checkout-PR-branch from a row, a GitHub Actions status watch
kind, and (if a second consumer needs individual-item listings, not just aggregate
metrics like `saropa_lints`' `github-api.ts` already has) a shared
`@saropa/github-client` package. None of these were requested for this pass and none
are implied by "watch a repo for new issues/PRs." (Label/author filtering, listed
here as future work in the original pass, was built in the hardening pass below.)

## Hardening & review-fix pass (2026-09-04)

Four items deferred from the original pass were implemented: auth-failure and
poll-timer error logging to the output channel, `watchAlertsIn`'s path-containment
check no longer running on a repo slug, optional label/author filtering on a repo
watch, auto-detecting the active project's GitHub repo to prefill the add-watch
prompt, and a "Change repository" action in Manage Watches to retarget a repo watch
in place. Full detail and rationale for each is in `CHANGELOG.md` under `[1.9.1]`.

An 8-angle code review of the resulting commit then surfaced defects the original
pass's own review had not caught, several confirmed independently by more than one
review angle:

**`repoItemsCache` leak was never actually fixed.** The original pass's "Post-review
fixes" item 4 above added `repoItemsCache.delete(id)` inside `disarm()`, believing
this closed the leak. It did not: `disarm()` is only invoked for watch ids present
in `this.armed`, a map populated exclusively by `arm()` — and `arm()` is only called
for non-repo watches (`reconcileWatchers()` routes repo watches through
`seedRepoWatchIfNew()` instead, which never touches `this.armed`). A repo watch's id
therefore never reached `disarm()`, so the "fix" was dead code and the leak
persisted through the entire hardening pass above, which itself repeated the same
false claim in `CHANGELOG.md`. Corrected by moving the cleanup into
`reconcileWatchers()` itself (which does run for repo watches on every store
change), dropping any `repoItemsCache` entry whose watch is no longer
enabled/in-scope/present — mirroring what the `armed`-watcher disarm loop already
does for folder watches, just against the right collection.

**"Open newest" opened the wrong item.** `toastRepo()`'s toast-click handler and
`openRepoWatch()`'s row-click handler both assumed the last element of an array
built from composite keys (`"issue:9"`, `"pr:45"`) was the most recent item. Those
arrays come from `diffSnapshots`'s `added.sort()` and `FolderWatchStore.addUnseen`'s
`[...merged].sort()` — plain lexicographic string sorts, not chronological or
numeric ones, so `"issue:9"` sorts after `"issue:80"` and every `"issue:*"` key
sorts before any `"pr:*"` key regardless of actual recency. A poll that picked up
issue #5 and PR #200 in the same tick would open issue #5 — the opposite of "the
newest." Fixed with a new `newestRepoItem()` (`github/githubTypes.ts`), which
selects by `updatedAt` instead of array position; both call sites now use it.

**A repo watch added with no project folder open never alerted, permanently.**
`watchAlertsIn`'s rule 2 ("a project always watches its own target") does not apply
to a repo watch (fixed in this same pass — a slug has no "containing project" to
watch its own), so a repo watch depends entirely on `alertScopes`. `creationScopes()`
returns `undefined` when no folder is open at add time, and nothing populates
`alertScopes` for a repo watch afterward — so a watch added from the Command Palette
in an empty window was silently dead in every window forever, with no warning.
Fixed by defaulting a repo watch to `global: true` when no folder is open at
creation (a folder watch does not need this, since rule 2 already gives it a home).

**Reuse:** `detectRepoFromGit` (new in the hardening pass) spawned a `git` subprocess
and re-implemented SSH/HTTPS remote-URL parsing that `recipes/gitMeta.ts`
(`getGitRemote`/`normalizeRemote`) already provides — reading `.git/config` directly,
no subprocess, and already used by the URL recipes. Replaced with a call to the
existing reader. The near-duplicate dedup-check and existence-check blocks between
`addGitHubRepoWatch` and `editGitHubRepoWatch` were factored into shared
`findDuplicateRepoWatch`/`verifyRepoReachable` helpers in the same file.

**Simplification:** the kind/mode label ternary and base-icon ternary, each
independently re-implemented in three files (`folderWatchManageCommands.ts`,
`watchesTreeProvider.ts`, `launcherWatchItem.ts`), met the project's own "3+ uses"
abstraction threshold. Centralized as `watchKindLabel`/`watchModeLabel`/
`watchBaseIcon` in `model/folderWatch.ts` and adopted by two of the three sites;
`launcherWatchItem.ts` keeps its own copy deliberately — that file is documented as
vscode-free/unit-testable by design, and `folderWatch.ts` carries a runtime
`vscode` import, so importing from it there would trade a few duplicated lines for
a real architectural boundary violation.

**Efficiency:** repo watches polled sequentially (`for...await`) despite each
being a fully independent fetch; switched to `Promise.all`. A duplicate-fetch race
in `seedRepoWatchIfNew` — two store mutations landing while a watch's first seed
fetch is still in flight (e.g. adding two repo watches back to back) could each
observe "no baseline yet" and fire their own concurrent fetch pair for the same
repo — was closed with an in-flight-id guard (`seedingRepoIds`).

**Deferred, not fixed this pass:** a repo with more than 100 open issues+PRs has no
pagination; an item that ages out of the unpaginated baseline and is later edited
(bumping it back into the fetched top-100) can re-surface as a spurious "new" item
toast, which is worse than the previously-understood "some old items are silently
dropped" scope limit. Properly fixing this needs either full pagination or a
persisted all-time-seen set independent of the top-100 window — deferred as a
separate, larger piece of work rather than folded into this pass. Also deferred:
`saropaWorkspace.github.pollIntervalMinutes` only takes effect on the next scheduled
tick, not immediately on edit (unlike the existing `Heartbeat` timer, which
re-arms on a config-change listener); `FolderWatch` modeling kind-varying fields
(`isFile`/`glob` for folder watches, `filterLabels`/`filterAuthor` for repo
watches) as one flat optional-field interface rather than a discriminated union,
which the project's own TypeScript conventions call out as the case for a union —
deferred as a larger, more deliberate refactor given how many call sites read
`FolderWatch` today; and skipping the `/pulls` fetch when an `/issues` page
contains no PRs, since doing so would revert the just-parallelized fetch back to
sequential for repos that DO have open PRs, an unclear net trade-off rather than a
clear win.

Verified with `npx tsc -p ./ --noEmit` (clean), `node esbuild.js` (bundles), and
`npm test` (1267/1267 passing, including new coverage for `newestRepoItem` and the
removal of now-obsolete `detectRepoFromGit` tests). No F5 dev-host smoke test was
run in this session either — the GitHub auth flow, the "Change repository" action,
the label/author filter prompts, and the auto-detect prefill remain unverified
end-to-end.
