# Morning report: exception-first redesign

Generated report documents opened with a command line and a fenced dump of raw output, so a morning routine's summary ran to roughly 400 lines of which a handful carried information, and it rendered identically whether or not anything was wrong. Separately, a routine member whose shortcut had been removed was scored as a non-failure, so a routine with a permanently broken step reported clean success and never opened the summary carrying the notice.

## Defects addressed

### 1. A missing routine member did not fail the routine

`runRoutineMember` in `exec/routineRunner.ts` returned `failed: false` for a member whose shortcut could not be resolved. The routine therefore recorded a success outcome, badged green, suppressed its auto-open, and emitted a success notification. The summary did carry a "Shortcut not found" banner, but nothing raised the document, so a routine could run daily for weeks with one step silently doing nothing.

An unresolved member now returns `failed: true`. The member's status remains `"missing"` rather than `"failed"`, so the report continues to distinguish a dead reference from a step that ran and failed.

### 2. A removed shortcut stayed referenced by every routine that ran it

Recipe removal is sticky by `recipeId` (`file.removedRecipes`), and `buildRecipeShortcuts` skips suppressed recipes. A routine listing such a member could therefore never resolve it again on any run — the only recovery was hand-editing `.vscode/saropa-workspace.json`.

`model/routineMembers.ts` now holds `pruneRoutineMembers`, called from `removeShortcut`, which unlinks the removed shortcut from every routine in the same file, matched on `recipeId` or `pinId`. `pruneSuppressedRoutineMembers` repairs configurations already broken this way. The helpers live in their own module because the recipe-seeding layer needs them and is a base class of the mutation layer; importing back into it would close an import cycle.

The repair runs once per folder per session, sequentially, and only from a detection sweep whose generation token is still current. An earlier arrangement ran it inside the per-folder `Promise.all` of `detectAllFolderRecipes` on every refresh; because `writeProjectFile` re-triggers the configuration watcher, that formed a write loop, and because the sweep's results are generation-checked only at publish time, a superseded sweep could land a write over a newer mutation.

### 3. Report volume

- `ritual.standup` used `git log --stat`, which prints one row per changed file. A single generated commit emitted hundreds of rows. Replaced with `--shortstat`.
- `buildStatsMarkdown` tabulated every file extension including zero-line buckets (images, fonts, archives). Zero-line buckets now collapse into one asset line; the table is ranked by lines and capped at ten rows with the folded remainder stated.
- The stats report repeated the last 30 commit subjects that the standup member of the same routine printed directly below it. Removed.
- The contributor shortlog renders only for more than one author; empty git output omits its section rather than printing `(none)` inside an empty fence.

### 4. Reports stated evidence before findings

Two conventions were introduced. A report writes `**Attention:** …` when its finding requires action, or `**Headline:** …` when it only informs, above the command block. `summarizeReportBody` in `exec/actionRunner.ts` derives both from the shape of the captured output rather than from the command string, so an equivalent digest reached through a hand-written shortcut is summarized identically and a change in flag order cannot silently disable it. Output that cannot be summarized meaningfully produces no headline, on the basis that a filler count trains a reader to skip the line that matters.

`writeRoutineSummary` lifts every member's finding to the top of the summary, opens with a `Needs attention (N)` or `All clear` heading counting failed and missing members plus attention findings, and orders failed/missing blockquotes, then attention findings, then informational findings under an "Also ran" heading. Member reports are read once up front and reused by the collapsed sections below.

### 5. Missing checks

`exec/ciStatus.ts` (`ritual.ci`) reports recent CI runs and, for a red commit, the GitHub check-run annotations naming the file and line that broke the build. It leads the morning member order.

`exec/overnightDelta.ts` (`ritual.delta`) reports the window's movement: commits, commits by other authors, files changed, lines added and removed, and the change in debt markers.

Both distinguish "the tool could not answer" from "the tool answered, and the answer was nothing"; their exec helpers return `undefined` rather than `""` for a failed invocation, and an unavailable tool produces an attention finding naming the diagnostic command. Reporting a broken build as a green one is the most damaging failure available to a health check.

## Design decision: derived comparison over stored state

Delta reporting was initially planned around persisting each run's numbers. It is instead derived: the baseline is `git rev-list -1 --before="24 hours ago" HEAD`, and the window is measured by diffing against that revision. A revision is exact, requires no state carried between runs, and remains correct on a fresh clone or a different machine, whereas a stored snapshot is only as good as the last occasion the job happened to run. `HEAD@{1 day ago}` was rejected because the reflog form resolves against local history and is empty on a fresh clone.

Debt markers are counted with `git grep -c` at each revision rather than by scanning the diff: two days of a large repository can exceed the pipe buffer outright — a translation sweep in one observed repository moved roughly 460,000 lines — while two greps stay bounded.

Quality counts that only ever run locally remain outside this scheme; where such a check runs in CI, its counts are available from check-run annotations.

## Verification

Commands and output shapes were exercised against a real repository and `gh` 2.76.2 before being wired: baseline resolution, author-email matching, the `rev:path:count` shape of `git grep -c`, and the check-run annotations API. This caught a defect in the CI summarizer, which read column 4 of `gh run list` as the workflow when column 4 is the branch and column 3 is the workflow; a failing run would have been attributed to "main". Test fixtures are captured rows, with the column order recorded beside them.

`npx tsc -p ./ --noEmit` clean; `node esbuild.js` builds; `npm test` reports 1036 of 1036 passing.

## Flagged, not addressed

- `projectStats.ts`, `overnightDelta.ts`, and `ciStatus.ts` each carry a private `execFile` wrapper of the same shape (buffer cap, timeout, swallow failure). Three copies is a single-source-of-truth violation and warrants one shared helper.
- CI-row classification now exists in two places: the generic `summarizeReportBody` branch that handles captured text, and `ciHeadline` over the structured `CiStatus`. They can drift.
- `relativeTime` remains duplicated between `views/dashboardPanel.ts` and `views/schedulePanel.ts`.
- `extractHeadline` scans raw file content and is not fence-aware. It is correct only because every current generator emits its headline before any captured output. That ordering is a contract enforced nowhere and pinned by no test.
- `runShellToReport` accumulates child-process output into a string with no size cap, unlike the new callers, which set `maxBuffer`. `writeRoutineSummary` now holds every member report in memory simultaneously while merging, which compounds that unbounded capture across members.

## Coverage gaps

The recipe wiring in `recipes/scheduledRecipes.ts` and the member ordering in `recipes/routineRecipes.ts` have no assertions: nothing pins that `ritual.ci` and `ritual.delta` are produced when detected, omitted when not, or ordered first. The self-heal integration in `model/shortcutStoreRecipeSeed.ts` is covered at the unit level through `pruneSuppressedRoutineMembers` but not end to end; no test drives a folder whose stored routine names a suppressed recipe through a refresh and confirms the file is rewritten exactly once. Both require the extension-host harness (`@vscode/test-electron`), which this project has not wired.
