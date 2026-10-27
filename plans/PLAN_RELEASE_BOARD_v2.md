# Plan: Release Board — Saropa Workspace 2.0

Status: planned. Target: next major version (2.0.0). Revised after an Opus review.
Mockup (dark by default, three tabs): https://claude.ai/artifact/3EtrV21zFQnUvKQFdkikrn

## The story

A person who runs several related projects opens the Workspace dashboard and sees one screen: **can we ship, and what do we do next.**

- Each project shows one light: GO, NO-GO or UNVERIFIED.
- Below it: what to resolve now, what to work on, what to track. Each line names the project and the file.
- Each line is a row of icons and colors. Numbers and text appear only on hover or when the row is opened.
- Lines that wait on another document show the link, across projects.
- Finished and deferred work is never shown as a count.

No AI is involved. Every light comes from a coded rule the user can read and edit.

## Two display rules (apply to every screen)

### Roll up into color and icons

- The first screen shows no raw statistics and no sentences of metadata.
- Each row carries at most six small marks. Each mark is an icon with a color. The exact figures appear in a tooltip and in the opened row.
- The marks:

| Mark | Meaning | Colors |
|---|---|---|
| Progress ring | Steps done of total | Grey none, amber partial, green all |
| Size | Small, medium, large, very large document | One to four bars |
| Code | Has code, with a letter for the main language | Neutral |
| Link | Waits on, or is waited on by, another item | Amber if the other item is not done, green if done |
| Other project | Mentions another project | One small dot per project |
| Chats | Active or saved chats are linked (2.x) | Purple if active |

- A project row shows its one light, plus a small bar of its open items by color. The bar contains red, amber and purple items only. Blue, grey and green are not in it. No counts of done or deferred work.
- Words and numbers appear after a click, never on the first screen.

### Always show linkages

- A linked item is never shown alone. Its row shows the link mark. Opening the row shows the chain, drawn as a short vertical path across projects:
  `Supabase SQL script → waits on → App build (pull request 1923) → waits on → two-phone device check`
- A project row shows a link mark when any of its items waits on another project.
- A blocked item sorts under the item that blocks it. It keeps its folder color. Its link mark is amber until the first item is done, then green.
- Linkages come from, in this order:
  1. A `Needs:` line in a document (explicit).
  2. A shared pull request number or document file name mentioned in both documents (inferred, 2.x, shown with a dashed link so the user can accept or reject it).
  3. A project dependency set in Settings (whole project waits on another).
- A `Needs:` line that points to a document that no longer exists, or that is already in `history/`, is flagged as stale.
- Status lines inside documents stay untrusted, but `Needs:` is an explicit statement of a dependency, not a status. A stale target is flagged so it cannot mislead.

## Why Workspace and not a new extension

- It already has the bottom-panel launcher and the editor-tab dashboard (`views/dashboardPanel.ts`).
- It already signs in to GitHub (`github/githubClient.ts`) and watches repos (`exec/folderWatchEngine.ts`).
- It already has a multi-root setting (`hygiene.roots`). Today only the bloat scan reads it, so 2.0 must add root-aware scanning.
- It already calls the sibling extensions' daily summary (`commands/dailyReport.ts`).
- Its shortcuts and recipes already run builds, tests and deploys.

## Honest light: GO, NO-GO, UNVERIFIED

A GO light requires evidence. Missing evidence is never GO.

- **NO-GO** when any of these holds under the chosen profile:
  - An open item of a stopping severity (see profiles).
  - Any item in a red folder, whatever its severity score. A red folder blocks in every profile.
  - A lint error or a failing test from a trusted result.
  - A `Needs:` chain whose waiting item itself stops the release under the chosen profile, and whose first item is not done. A low-severity item waiting on something never makes a project NO-GO under Rush to market.
- **UNVERIFIED** when no blocker is found but evidence is missing:
  - Documents that no rule placed (grey).
  - No trusted lint or test result for the project, or the result is older than the staleness limit.
  - The safety check below has stopped the last scan.
- **GO** only when no blocker exists and every evidence source is present and fresh.
- Until code health exists (build step 6), the first screen can show only NO-GO or UNVERIFIED, never GO.

## Core ideas

### 1. The folder is the status

- A document's status comes from the folder it sits in, not from a Status line inside it.
- Example: `history/` is done, `deferred/` is blue, `bugs/human/` is red.

### 2. Rule sets, no folder names in the engine

- A rule set is a named, reusable file. A project lists the sets it uses and may override any setting.
- First matching rule wins. Project rules override set rules.
- Shipped sets: folder-states, reference-docs, doc-kinds, live-folders, pending-sql, status-line. Planned: inside-documents, index-documents.
- Renaming a folder is a parameter edit.
- Reusable outside Saropa: a team with `docs/backlog` and `docs/shipped` edits two folder lists.
- The `bugs/` folder holds handover and tracker files that the prototype labels as bugs. Needs a doc-kinds rule.

### 3. Colors

| Color | Meaning |
|---|---|
| Red | Address now |
| Amber | Next priority. Review before new work starts |
| Purple | In progress. A manual mark, cannot be derived |
| Blue | Needs consideration (deferred). Never counted on screen |
| Green | Done. Never counted on screen |
| Grey | No rule placed it. Makes the light UNVERIFIED. Listed under "Needs a rule" with one click to the rule editor (until the editor exists in step 5, a link to the rules file) |

Users mark any document by hand. Marks are stored in the local cache and can be exported to a shared file in the repo so a team sees them (open: the file name and format).

### 4. Severity and release profiles

- A phrase dictionary scores each document: extreme (payments, commercial), critical (data loss, security, privacy), high (user uptake), medium, low (cosmetic).
- Weights: title 3, first 20 lines 2, body 1 only at 3 or more hits per 1,000 words. Per-phrase cap 3. Negation skipped. Code fences stripped. File-name separators read as spaces.
- Audience tag: Pro or all users.
- Profiles decide what stops a release by severity:
  - Rush to market: extreme and critical.
  - Deliberate: adds high.
  - Zero defects: adds medium.
- A red folder and a lint error or failing test stop a release in every profile (see Honest light).
- Users can pin a document as critical. It stays on the first screen in every profile.

### 5. Document facts (no AI)

Read from each markdown document and cached, shown as the marks above:

- Title and headings (shown when the row is opened).
- Checklist boxes and table rows done versus total.
- Word and character count, used as a size hint. Not yet verified that size predicts effort.
- Code blocks and their languages (Dart, Python, SQL, other).
- Source files named, other documents named, pull requests, links.
- Other projects mentioned.

### 6. Code health

- Lint: errors, warnings, info. Tests: pass or fail, with last-run time.
- A lint error or a failing test makes a project NO-GO in every profile. Warnings and info never do.
- **Sources of results:**
  - Only background-mode shortcuts give a trusted pass or fail. Terminal, external-window, command and macro runs report only "dispatched" (`exec/shortcutEvents.ts`) and VS Code 1.74 exposes no terminal exit code. Their result is "unknown", never a pass.
  - Results are stored in the local cache. Today they are held in memory and lost on reload (`exec/runStatus.ts` says this is intended). Keeping them is a deliberate change, made only for the board's cache; the shortcut run status shown elsewhere is unchanged.
  - Lint results can also come from the Saropa Lints file `reports/.saropa_lints/violations.json`.
- **Trust checks on a lint file:** reuse Workspace's existing coverage gate (`exec/lintsHealth.ts`, refuses a score below 15 percent of files analyzed). Check `filesAnalyzed` and the file's `timestamp`. A file older than the staleness limit, or from a partial run, counts as missing.
- **Tests:** run only the test files that open plans name, never the whole suite (about 70 minutes for the app). The result reads "N tests run, M failed", never "tests pass". A project with no test run is UNVERIFIED, unless its setting `testsApply` is false (a project with no tests, such as a documentation-only or database-script repo). A root outside the open window is UNVERIFIED by design, and the board says so.
- **Other roots:** each root's results are stored per root. A sibling extension reports only its own window's workspace, so a root outside the open window gets health from its own result file, written by that root's shortcuts. Open: how a root outside the window runs shortcuts.

### 7. Cache and speed

- Stored in extension storage, outside every repo. No index files in repos.
- Incremental scan by file size and modified time.
- The prototype is Python (`engine.py`, `score.py`, `meta.py`) and must be ported to TypeScript. The 3-second figure for a cold read of about 9.8 MB is a Python figure and must be re-measured in the port.

### 8. Safety against silent mislabeling (built first)

- Built in the first step with the rule engine, before any light is shown.
- After each scan, compare with the last scan. Stop the update and ask when any of these holds:
  - A folder that matched a rule last scan now matches none.
  - A rule that matched documents last scan now matches zero.
  - The count in any state changes by 20 percent or more AND by at least 5 documents. The absolute floor stops small counts from firing on every change.
  - A bulk move is recognized when the documents reappear in `history/`. It is shown as a summary the user accepts, not as an error.
- The first scan has no baseline. It is shown as UNVERIFIED until the user accepts it.
- Prototype case: renaming `docs/deferred` to `docs/parked` would have turned 444 deferred into red and amber with no error. The first two checks catch that case even though it is 2 percent of some folders.

## Titles and groups

### Real titles
- Every row shows the document's own title (its first heading), not the file name. The file name appears on hover.
- A SQL file has no heading, so its title is its first descriptive comment line. Comment lines that are only `cspell`, a date, a file name or a `Why:` label are skipped.
- A document with no heading falls back to its file name.

### Groups (clusters)
- Documents that belong together appear under one group heading. The heading carries the worst severity of its members and one small square per member.
- A group is formed by the first of these rules that matches:
  1. Same project and same file-name prefix after the date is removed (OWNER_*, HANDOVER_*, emergency_*).
  2. Two or more shared source files under `lib/` or the database folders. Shared tool scripts (`scripts/`) do not count.
  3. One document that names several files, or several documents, is a **hub** when it is very large or names many other documents. A hub links to the groups it names and never merges them.
- A group can be set by hand in Settings, and a document can be pulled out of a group.
- Real result on today's blockers: "Owner actions and checks" (5 documents), "Handover documents" (2), "Emergency data fixes" (5 SQL scripts). The Launch Test checklist is a hub. Without the hub rule it merged the owner and handover groups into one group of eight.
- Groups are the unit for linkage. A `Needs:` link between two groups is drawn once, group to group. Opening the group shows the document-level links.
- A group's progress ring adds up the steps of its members. A group with a member that waits on another project shows the link mark.
- The same grouping applies to a Claude session that works on several documents, and to one document that spans several files (2.x, with the Chat Explorer lookup).

## Optional integrations

Each link turns on only if that extension is installed. The board works fully without them.

| Extension | Today | Use in the board |
|---|---|---|
| Saropa Lints | Writes `reports/.saropa_lints/violations.json` after every run | Read it with the trust checks above |
| Saropa Log Capture | Already exports `SaropaLogCaptureApi` with `getDailySummary` (error and warning counts); Workspace already calls it in `commands/dailyReport.ts` | Reuse the existing call. No change needed |
| Claude Chat Explorer | No public API (`activate` returns nothing). Matches chats to files by exact path and sibling worktrees. Chats record branches and pull requests | 2.x. Needs a new exported API and a branch and pull-request index |
| Saropa Drift Advisor | `getSessionSnapshot()` returns null unless a debug server is connected, and covers only the open window | Not used in 2.0 |
| GitHub | Issues and pull requests via VS Code sign-in | 2.x: add "review requested" pull requests |

Community extensions appear as a separate group. They never change a core project's light.

## Scope

**2.0 contains:** the rule engine and safety check, folder status, severity and profiles, the honest light, the roll-up marks, the `Needs:` linkages and the first screen. Document facts shown as marks. Code health from background shortcuts and the Lints file.

**2.x contains:** the Chat Explorer lookup, the GitHub review-requested list, the community-extension group, inferred (dashed) linkages, shared marks export.

## Settings

- Documentation folder names per project (plans, docs, or any other).
- Project importance, and which project depends on which.
- Ignored projects, folders and files.
- Local package and folder detection.
- Release profile per release (open: per project or per release).
- Staleness limit for lint and test results.

## How it is built

### Where the work can run
- **Online (a cloud session):** install, typecheck (`npm run lint`), the unit tests (`npm test`, about 1,500 tests, 3 seconds) and the bundle build (`npm run build`). Checked in the cloud on 27 Oct: install and typecheck pass; 1,501 tests pass and 2 fail on `main` before any change (`runTargets.test.ts`, package.json script detection). Cause: the test stub's `Uri.joinPath` (`src/test/_stub/vscode.ts`) does not resolve `..`, so on Linux the lockfile paths are invalid. A stub bug, not a product bug. Fix first: normalize the path in the stub.
- **Online, with fixtures:** the board screens, by rendering the webview page in a headless browser against fixture data. This catches layout and script errors, not VS Code behavior.
- **Online, against the real repos:** the scanner and rule engine run over the checked-out app, Supabase and website repos.
- **Headless browser caveat:** the webview needs `acquireVsCodeApi` and its security policy shimmed in the test page. Not yet tried.
- **Not online:** opening the extension inside VS Code, GitHub sign-in, and the sibling extensions (Lints, Log Capture, Chat Explorer). Each build step ends with a short checklist for you to run in VS Code (install the built package, open the board, check the listed items).

### Shape of the code
- A **core** folder (`extension/src/board/`) with no VS Code imports. Its tests live in `extension/src/test/board/`, because the test build (`esbuild.test.js`) collects only `*.test.ts` under `src/test`. One unit test fails if any file in `src/board/` imports `vscode`, since the test build replaces `vscode` with a stub and a stray import would otherwise pass. File reading is passed in from the VS Code layer, so the core also works in remote workspaces: rule engine, scanner, document reader, severity scorer, safety check, cache format, linkage and grouping. Unit-tested with the existing node test runner, like the rest of the extension.
- A thin **VS Code layer** on top (the file reader, the webview, the commands, file watching, shortcut-result capture.
- Rules and the phrase dictionary are JSON files shipped with the extension and overridable per project.

### Build steps and what proves each one
0. **Test stub fix** (the two failing tests above). Small pull request first, so a green baseline exists.
1. **Scanner, cache, rule engine, safety check.** Proof: a frozen fixture committed with the tests (the file-path list of each repo and the expected state counts: App red 10, amber 53, grey 4; Supabase red 6, amber 3, grey 8; Website red 2, amber 26). The fixture is what the unit test runs, because the three repos live outside this repo and their counts change with every commit. Running against the live repos is a manual script, not a test. The prototype scripts move into this repo under `scripts/` as the reference. Plus tests for the rename case, the first scan, and a bulk archive.
2. **Roll-up marks and first screen.** Proof: headless-browser render with fixtures, checked in dark and light, and a pass at phone width.
3. **Document facts.** Proof: the TypeScript reader matches the prototype's facts on the 20 real blockers (words, headings, steps, code languages, groups).
4. **Linkages, groups and project dependencies set in Settings.** Proof: the share-keys chain and the three groups come out as in the mockup; a stale `Needs:` is flagged.
5. **Severity and profiles.** Proof: the 20 blockers get the same levels as the prototype; each profile gives the same NO-GO set.
6. **Code health.** Proof: unit tests with recorded Lints files (fresh, stale, partial) and recorded shortcut results (background, terminal). Live check by you in VS Code.
7. **Shared marks and inferred links** (2.x).

### Delivery
- One pull request per step, each with tests, a changelog line and the VS Code checklist. The version is bumped to 2.0.0 when step 6 ships, since GO becomes possible then. Steps 1 to 5 ship as 1.x minor versions behind the setting `saropaWorkspace.releaseBoard.enabled` (off by default, like the existing `previewMode.enabled`), so the extension is unchanged for current users. Steps 7 and later ship as 2.x.
- Each pull request is reviewed by a second model before merge.

## Build order

0. Fix the test stub so the baseline is green.
1. Scanner, cache, rule engine over several roots, **and the safety check**. Port the prototype to TypeScript.
2. Roll-up marks and the first screen. Lights are NO-GO or UNVERIFIED only.
3. Document facts as marks.
4. `Needs:` linkages and the chain view, marks, pins.
5. Severity, profiles, and the repo details and settings tabs (rule editor with preview).
6. Code health from background shortcuts and the Lints file. GO light is allowed from this step.
7. Shared marks export, inferred linkages (2.x).
8. 2.x items: Chat Explorer lookup, GitHub review-requested list, community group.

## Not built or not verified

- Blast radius beyond a text search for a changed name.
- Whether the 29 Drift Advisor bug files are really open.
- Whether size predicts effort.
- The prototype's commit-hash count over-counts. Leave it out.
- Whether the GitHub `repo` scope covers a review-requested search. Likely yes, not tested.
- Whether a sibling extension can be read from another window. Not checked.

## Version

2.0.0: a new mode that reads several projects changes what the extension is. Existing single-project behavior stays unchanged when only one root is configured.
