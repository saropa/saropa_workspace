# Bundled recipes and scripts: how they feed the Release Board

Status: design only. Nothing in this document is built.
Owner request: review the bundled recipes and scripts, say which help the Release Board, add ideas for new ones, and design a forward-looking list of deferred work.

## 1. What the user gets

- Open the board. Each row already shows a dot and a reason.
- With this work, a row such as "Tests" says "passing, checked this morning at 06:02". The user opens nothing.
- A row backed by a daily report that is switched off says "Turn on the daily test report", with one button.
- A row whose report is old says "last checked 3 days ago". It never shows green on old data.

## 2. Where the board stands today

- The board reads one report file, the Saropa Lints violations file, and the recorded test runs.
- It does not read any other recipe report.
- The scheduled recipes already write dated files under `reports/`.
- The board never writes into the user's documents. Reports stay in `reports/`.

## 3. Bundled recipes that help the board

| Recipe | What the board gets | Where it shows |
|---|---|---|
| Build status | Last build passed or failed, and when | Build row |
| Test trend tracker | Pass and fail counts, and whether they are getting worse | Tests row |
| Dawn lint sweep | New lint findings since yesterday | Lint row |
| Dependency freshness | Outdated or vulnerable packages | Dependencies row |
| PR review queue | Pull requests waiting on the user | Open work row |
| End-of-day uncommitted guard | Files not committed | Uncommitted-work warning |
| Tech-debt harvest | TODO, FIXME, HACK counts, rising or falling | Tidy sweep candidates |
| Branch hygiene | Branches already merged, safe to delete | Tidy sweep candidates |
| Workspace bloat scan | Empty and oversized files | Tidy sweep candidates |
| Standup digest, Since yesterday | What changed | "Since you last looked" |
| Dev journal | Commits and files touched today | Sitting summary |
| Sunrise project stats | Size and language breakdown | Repo details tab |

Not relevant to the board: the Saropa suite recipes, the toolchain monitor, Start a new Claude chat.

## 4. Bundled scripts that help the board

| Script | Use |
|---|---|
| `run-test` | Source of the Tests row when the project has no recorded run |
| `dependency-report` | Backs the Dependencies row where no recipe applies |
| `daily-report` | Backs the "Since you last looked" summary |
| `organize-output` | Tidy sweep action: file stray reports into folders |
| `dart-process-clean` | Tidy action for Dart and Flutter projects: stop stuck processes before a build check |

Not relevant: `device-connect`, `flutter-sdk-repair`.

## 5. How a report becomes a row (design)

1. Each row has one setting, "Evidence report". The default is the matching recipe's report folder.
2. At each scan the board reads the newest file there.
3. The file is used only if its age is under a limit. The limit is a setting. Default 36 hours for daily reports.
4. Content is reduced to a short tally and a time. The board stores no raw report text.
5. A missing report gives a grey row with the reason "no report yet". It never gives green.
6. A stale report gives a grey row with the age. It never gives green.
7. A report can make a row worse. It can only make a row green when it is fresh and clean.
8. Each recipe writes a small machine-readable summary line at the top of its report, so the board does not parse free text. The summary line carries: recipe id, time, pass or fail, and one count. This is the one change to existing recipes.
9. Every part has a user setting with a safe default: on or off per row, the age limit, and which folder.

Open point: the exact summary line format for each recipe is not yet written. Each recipe's current report format has not been read in full.

## 6. Resume on start (machines shut down overnight)

What exists, from `extension/src/exec/scheduler.ts`:

- When VS Code starts, the scheduler checks every schedule.
- A schedule whose last due time is later than its last run counts as missed.
- A missed schedule with "catch up" turned on runs silently.
- Any other missed schedule is offered in one toast.
- Run-on-start shortcuts run first, then the missed catch-up.

What the board needs on top:

1. The recipes that feed the board seed with "catch up" on. The user can turn it off.
2. Catch-up runs one at a time, cheapest first (build status, then lint, then tests, then dependencies), so start-up stays fast.
3. Each report is written as soon as its job ends, and the board refreshes that one row. The user sees rows fill in during the first minute.
4. While a catch-up job is running the row says "checking now", not grey.
5. Heavy jobs (full test run) wait until the machine has been idle for a short time. Setting, default 2 minutes.
6. A job that missed several days runs once, not once per missed day.
7. If a job fails to start, the row says why. It does not stay "checking".
8. The Overnight proof run already exists, off by default. It stays separate: it is for machines left on.

Not verified: whether catch-up runs once or once per missed slot today. A test must prove "once".

## 7. New recipes and scripts to bundle for the board

Ordered by value to a board row. All are read-only unless noted.

| Idea | Feeds | Effort |
|---|---|---|
| Release readiness summary: one report combining build, tests, lint, dependencies | A single "ready to ship?" line | Small |
| Changelog check: does the top changelog entry match the version in the manifest | Release row | Small |
| Version consistency: same version in manifest, lockfile, README, store listing text | Release row | Small |
| Secrets scan: staged and tracked files against common key patterns | Safety row | Medium |
| Large new file watch: files added this week above a size limit | Tidy | Small |
| Stale branch age: unmerged branches older than 30 days | Open work row | Small |
| Open TODO age: debt markers older than 90 days by blame date | Tidy | Medium |
| License check: packages with licenses that block shipping | Release row | Medium |
| Store listing check: screenshots, description and icon files exist and are not older than the last release | Release row | Small |
| Broken links in docs: relative links that point nowhere | Documents rows | Small |
| Test flakiness tracker: tests that failed then passed with no code change | Tests row detail | Medium |
| Build time trend: build slower than last week | Build row detail | Small |
| Disk and cache cleaner (asks first) | Tidy action | Medium |
| Crash log summary from Saropa Log Capture, when installed | Live evidence | Depends on that extension's API |
| Database migration pending check from Supabase files | Release train row | Medium |

## 8. Order to build

1. Summary line in Build status, Test trend, Dawn lint sweep. Board reads them. Catch-up on start. (Section 5 and 6.)
2. Dependencies, PR review queue, uncommitted guard.
3. Tidy feeds (debt, branches, bloat).
4. New recipes from section 7: release readiness summary, changelog check, version consistency first.
5. Remaining new recipes.

Each step: Opus reviews the design, Sonnet builds, Opus reviews the diff. Tests prove stale data never gives green.

## 9. Forward list

Designed in `bugs/20261027_future_tab_deferred_work.md`.
