# Handover — github_repo_watches
2026-09-04 16:00 UTC · saropa_workspace / main · session 5761e199-3ede-4b66-8084-b9fe29779449

## Unfinished tasks

1. [pending] Harden reflection items — Fix auth error handling in `getToken()` (swallows all errors including transient failures; should distinguish "user declined" from "auth provider failure" for the interactive path). Fix `watchAlertsIn()` path math on repo slugs (runs `isPathInside` on a GitHub slug which is meaningless; add an early return for `watchKind === "repo"` to skip the path-relative math and go straight to `alertScopes`). Address `getToken` error swallowing for private repo failure diagnosis. Consider adding basic logging to the output channel for auth/fetch failures so users can diagnose "repo watch never shows anything" issues. Poll timer error handling — `pollAllRepoWatches` errors are swallowed by `.finally()`; add a try/catch that logs to the output channel. Key files: `extension/src/github/githubClient.ts` (getToken ~line 38), `extension/src/model/folderWatch.ts` (watchAlertsIn ~line 176), `extension/src/exec/folderWatchEngine.ts` (scheduleRepoPoll ~line 133, pollAllRepoWatches ~line 142).

2. [pending] Implement label/author filter on repo watches — Add optional `filterLabels?: string[]` and `filterAuthor?: string` fields to `FolderWatch` (or a new `RepoWatchConfig` sub-object). Apply the filter in `scanRepoTarget()` before building the `FolderSnapshot` so filtered-out items never trigger toasts. `GitHubWatchItem` already carries `labels` and `author` fields. The add-flow (`githubWatchCommands.ts`) would need additional input prompts or a settings-based approach. Key files: `extension/src/model/folderWatch.ts`, `extension/src/exec/folderWatchEngine.ts` (scanRepoTarget), `extension/src/commands/githubWatchCommands.ts`.

3. [pending] Auto-detect current project's GitHub repo — Parse `git remote get-url origin` for the active workspace folder(s), extract `owner/repo` from SSH (`git@github.com:owner/repo.git`) or HTTPS (`https://github.com/owner/repo.git`) URLs, and offer to auto-watch detected repos. Could be a command ("Watch This Project's Repo") or a suggestion when the Watches view is empty. Key file to create or extend: `extension/src/github/githubClient.ts` (add `detectRepoFromGit(folderPath)`) and `extension/src/commands/githubWatchCommands.ts`.

4. [pending] Edit repo watch target — Add an "Edit Watch" command (or extend the existing manage-watches hub's action menu) that lets users change the `target` slug of an existing repo watch without removing and re-adding. Should re-validate the new slug, re-fetch to confirm existence, clear the baseline/unseen state, and update the store. Key files: `extension/src/commands/folderWatchManageCommands.ts` (actOnWatch), `extension/src/model/folderWatch.ts` (FolderWatchStore needs an `update` method or similar).

5. [verify] Smoke-test in F5 dev host — The entire GitHub repo watch feature has never been tested end-to-end. Test: add a repo watch (GitHub auth flow), see it in the Watches tree, wait for poll, verify toast on new issue, verify launcher card shows github glyph, test disable/enable/global/remove lifecycle, test Manage Watches icons.

6. [pending] Update changelog and git commit — CHANGELOG.md has already been updated (user changed `[Unreleased]` to `[1.9.1]`). After all implementation work is done, commit all changes (16 modified + 4 new files). The `/finish` checklist was partially completed through Section 7 (finish report written). Section 9 reflection gate was answered: user wants all items. The `CHANGELOG_HISTORY.md` file also changed on disk (user edit).

## Completed tasks

1. GitHub repo watch feature — Full implementation of `WatchKind: "repo"` integrated into the existing Watches view. Repo watches poll GitHub's REST API for open issues/PRs, diff against a baseline snapshot, and toast new items. Verified: `npx tsc --noEmit` clean, `node esbuild.js` bundles, `npm test` 1257/1257 passing.

2. Code review (medium level) — 8-angle review completed. Found and fixed 6 bugs: icon precedence in Manage Watches, case-sensitive slug duplicate detection, validateInput/trim mismatch, repoItemsCache memory leak on watch removal, sequential API calls (now parallel), and launcher view not updated for repo watches. Two simplification findings noted but not acted on (formatItems/formatFiles duplication, unused `draft` field fetched but never read).

3. Finish report — Written to `plans/history/2026.09/2026.09.04/github-repo-watches.md` with both the original implementation details and the post-review fixes section.

## Session narrative

### User requests
1. "i need a solution to link n github repos to a project and surface open issues and PRs in projects running saropa workspace"
2. Referenced saropa_lints' existing GitHub API code as prior art
3. "write a plan document" — plan was written as `plans/PLAN_GITHUB_ISSUES_PRS.md`
4. "implement the plan" — implementation started based on the plan
5. **Critical redirect mid-implementation:** "note that you surface new docs in watched folders. watching REPOs is the logical place for this" — pivoted from standalone 7th sidebar view to integration into existing Watches view
6. "so where will i see the git issues / prs in the new UI?" — answered: Watches sidebar (row with github glyph + unseen badge), toast notifications (naming items by title), Launcher (Quick Open card), Manage Watches hub
7. "do you auto-detect git repos for the active project?" — No, currently manual entry only
8. "can i edit the repo path/url?" — No, currently remove + re-add only
9. User selected all 5 options for next steps: harden reflection items, implement label/author filter, auto-detect project repo, edit repo URL, update changelog and commit
10. User changed CHANGELOG from `[Unreleased]` to `[1.9.1]` directly in the editor
11. "change your config. you are NOT authorized to ever run compact skill. instead when you feel context pressure you need to run /handover skill" — explicit instruction about context management

### Investigation & analysis
- The key design insight was that `FolderSnapshot` (Record<string, number>) already represents "key → timestamp" generically — keying by `"issue:123"` instead of a filename makes `diffSnapshots` work unchanged for GitHub items.
- GitHub's `/issues` endpoint returns both issues and PRs (PRs carry a `pull_request` field); the `/pulls` endpoint is only needed for `draft` status, which is currently fetched but never consumed by any UI.
- `vscode.authentication.getSession('github', ['repo'])` is the VS Code-native auth API; `interactive: true` pops a sign-in prompt, `interactive: false` silently returns `undefined` if not signed in (for background polling).
- The `repoItemsCache` (in-memory Map) was needed because `FolderSnapshot` can't carry titles/URLs, but toasts and row-click need them. Falls back to repo issues page when empty (e.g. after window reload).
- Code review found the launcher view (`launcherViewData.ts`, `launcherWatchItem.ts`) was missed in the original implementation — still using `path.basename(w.target)` and `isFile` without `WatchKind` branching, causing repo watches to render as "react" labeled "Folder".

### Changes made

**New files:**
- `extension/src/github/githubTypes.ts` — `GitHubWatchItem` and `RepoSlug` types
- `extension/src/github/githubClient.ts` — slug validation (`isValidRepoSlug`, `parseRepoSlug`), auth (`getToken`), fetch (`fetchOpenRepoItems` — now parallel via `Promise.all`), `repoIssuesUrl`
- `extension/src/commands/githubWatchCommands.ts` — `addGitHubRepoWatch` (input box, validate+trim, case-insensitive dedup, interactive auth + existence check, store)
- `extension/src/test/githubClient.test.ts` — 8 tests for slug validation/parsing/URL building
- `plans/history/2026.09/2026.09.04/github-repo-watches.md` — finish report

**Modified files:**
- `extension/src/model/folderWatch.ts` — added `WatchKind`, optional `kind` field on `FolderWatch`, `watchKind()` helper (defaults absent kind to "folder"), `watchDisplayName()` (single source of truth for display name)
- `extension/src/exec/folderWatchEngine.ts` — `repoPollTimer` (self-rescheduling setTimeout), `repoItemsCache` (Map, cleaned up on disarm), `scanRepoTarget()`, `toastRepo()`, `formatItems()`, `seedRepoWatchIfNew()`, `getCachedRepoItems()`, `pollAllRepoWatches()`
- `extension/src/commands/folderWatchCommands.ts` — now takes `engine` as 3rd param, registers `watchGitHubRepo` command
- `extension/src/commands/folderWatchRowCommands.ts` — `openWatch` branches on `watchKind` for repo watches, `openRepoWatch()` opens newest unseen item URL from cache
- `extension/src/commands/folderWatchManageCommands.ts` — icon precedence fixed (disabled/global wins over kind), `describeWatch` branches for repo kind/mode text
- `extension/src/views/watchesTreeProvider.ts` — `WatchTreeItem` branches icon/kind/mode on `watchKind`, uses `watchDisplayName`
- `extension/src/views/launcherViewData.ts` — imports `watchDisplayName`/`watchKind`, passes `watchKind` to `WatchItemInput`
- `extension/src/views/launcherWatchItem.ts` — added `watchKind` to `WatchItemInput`, branches icon/kind/mode for repo watches (github glyph, `github.kindRepo`/`github.modeNewItems`)
- `extension/src/activation/wiringWatchers.ts` — passes engine to `registerFolderWatchCommands`
- `extension/package.json` — new command `saropaWorkspace.watchGitHubRepo`, menu entry, `saropaWorkspace.github.pollIntervalMinutes` setting
- `extension/package.nls.json` — manifest strings for command title and setting description
- `extension/src/i18n/locales/en.json` — 11 new `github.*` runtime keys
- `extension/src/test/folderWatch.test.ts` — 5 new tests for watchKind/watchDisplayName
- `extension/src/test/launcherItems.test.ts` — added `watchKind: "folder"` to 5 existing tests, 1 new test for repo-watch launcher card
- `CHANGELOG.md` — user changed to `[1.9.1]`, Added/Changed/Fixed sections

### Decisions & trade-offs
- **Integration into Watches view** (not a standalone sidebar) — user's explicit direction. Reuses store, tree, unseen-count badges, enable/disable/global/scope infrastructure.
- **`FolderSnapshot` keyed by `"issue:123"`** — avoids any diff-logic change; `diffSnapshots` works identically on issue keys and filenames.
- **In-memory `repoItemsCache`** (not persisted) — titles/URLs are session-only; falls back to repo issues page after reload. Acceptable because the data refreshes on next poll.
- **`draft` field populated but never read** — left in place as plausible future work (filter draft PRs). Costs one extra API call per poll per repo. Review flagged it; decision was to keep it.
- **No pagination past 100 items** — deliberate scope limit for v1. High-traffic repos with >100 open items silently drop older ones.
- **Poll-based (no webhooks/SSE)** — VS Code extensions can't receive incoming HTTP; polling is the only option. Self-rescheduling setTimeout re-reads interval config each tick.

### Rejected / dismissed / deferred
- **Standalone 7th sidebar view** — original plan, rejected by user mid-implementation in favor of Watches integration
- **formatItems/formatFiles deduplication** — code review flagged near-identical truncate-join helpers; deferred as simplification (2 uses, not 3+)
- **Removing the `/pulls` fetch** — review flagged `draft` field unused; kept for future filter-by-draft capability
- **Shared `@saropa/github-client` package** — mentioned in finish report as future work if saropa_lints and saropa_workspace both need GitHub API access
- **Sub-minute polling** — deliberately excluded; 1-60 minute range in settings

### User feedback & corrections
- "note that you surface new docs in watched folders. watching REPOs is the logical place for this" — the critical pivot from standalone view to Watches integration
- "change your config. you are NOT authorized to ever run compact skill. instead when you feel context pressure you need to run /handover skill" — explicit instruction; never run `/compact`
- User changed `[Unreleased]` to `[1.9.1]` in CHANGELOG directly — respect their version choice

## Key files & paths
- `extension/src/model/folderWatch.ts` — `FolderWatch` model, `WatchKind`, `watchKind()`, `watchDisplayName()`, `watchAlertsIn()`
- `extension/src/github/githubTypes.ts` — `GitHubWatchItem`, `RepoSlug`
- `extension/src/github/githubClient.ts` — slug validation, GitHub auth, fetch issues+pulls
- `extension/src/exec/folderWatchEngine.ts` — poll timer, repo scan, cache, toast
- `extension/src/commands/githubWatchCommands.ts` — add-repo-watch flow
- `extension/src/commands/folderWatchManageCommands.ts` — Manage Watches hub (icon precedence fixed)
- `extension/src/views/watchesTreeProvider.ts` — Watches tree row rendering
- `extension/src/views/launcherWatchItem.ts` — Launcher card for watches (now WatchKind-aware)
- `extension/src/views/launcherViewData.ts` — Launcher data builder (now uses watchDisplayName/watchKind)
- `extension/src/i18n/locales/en.json` — runtime l10n keys
- `extension/package.nls.json` — manifest l10n keys
- `extension/package.json` — command + setting registration
- `plans/history/2026.09/2026.09.04/github-repo-watches.md` — finish report
- `CHANGELOG.md` — user versioned as `[1.9.1]`

## How to verify
1. `cd extension && npx tsc -p ./ --noEmit` — type-check (currently clean)
2. `cd extension && node esbuild.js` — bundle build (currently clean)
3. `cd extension && npm test` — 1257/1257 passing
4. F5 dev host smoke test — add a repo watch, verify GitHub auth flow, see the row in Watches tree, wait for poll, check toast on new issue, verify Launcher card, test disable/enable/global/remove

## Gotchas & traps
- **Never run `/compact`** — user explicitly forbade it. Use `/handover` for context management.
- **`CHANGELOG.md` is versioned as `[1.9.1]` by the user** — do not change back to `[Unreleased]`.
- **`extension/CHANGELOG.md` and `extension/README.md` are generated copies** — always edit the root files. A PreToolUse hook blocks edits to the extension copies.
- **No Dart/Flutter in this repo** — do not run `dart analyze`, `flutter test`, or any Dart tooling.
- **Style guide hooks fire on UI file edits** — check `plans/guides/STYLEGUIDE.md` when the hook reminds you. All new strings must be externalized via l10n.
- **`watchAlertsIn()` runs path math on repo slugs** — this is a known issue to fix in the hardening task. It works by accident (falls through to alertScopes) but is semantically wrong.
- **`getToken()` catches all errors** — another hardening item. For private repos, a transient auth failure silently degrades to unauthenticated (404) with no diagnostic.
- **The `/finish` checklist was partially completed** — Sections 1-8 done, Section 9 reflection gate answered (user wants all 5 items), Section 10 (commit) pending after all work is done. The finish report exists but needs updating after the remaining implementation work.
- **16 modified + 4 new files are uncommitted** — all changes are in the working tree, nothing staged or committed yet.
