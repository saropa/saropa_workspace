# Plan: Release Board — Saropa Workspace 2.0

Status: planned. Target: next major version (2.0.0).
Mockup (dark by default, three tabs): https://claude.ai/artifact/3EtrV21zFQnUvKQFdkikrn

## The story

A person who runs several related projects opens the Workspace dashboard and sees one screen: **can we ship, and what do we do next.**

- Each project shows GO or NO-GO for the release profile they chose.
- Below it: what to resolve now, what to work on, what to track. Each line names the project and the file.
- Each line carries facts read from the document: "3 of 5 steps done, 4 SQL blocks, 7 source files named, 2,942 words, also mentions Supabase and Website."
- Lines that wait on another document say so, across projects.
- Nothing is a count of hundreds. Finished and deferred work is not displayed as a count.

No AI is involved. Every light comes from a coded rule the user can read and edit.

## Why Workspace and not a new extension

- It already has the bottom-panel launcher and the editor-tab dashboard.
- It already signs in to GitHub (`githubClient.ts`) and watches repos (`FolderWatchEngine`).
- It already has a multi-project precedent (`hygiene.roots`).
- Its shortcuts and recipes already run builds, tests and deploys.
- Today it reads one project at a time. 2.0 reads several.

## Core ideas

### 1. The folder is the status

- A document's status comes from the folder it sits in, not from a Status line inside it.
- Example: `history/` is done, `deferred/` is blue, `bugs/human/` is red.
- Status lines inside documents are stale too often to trust.

### 2. Rule sets, no folder names in the engine

- A rule set is a named, reusable file. A project lists the sets it uses and may override any setting.
- First matching rule wins. Project rules override set rules.
- Shipped sets: folder-states, reference-docs, doc-kinds, live-folders, pending-sql, status-line. Planned: inside-documents, index-documents.
- Renaming a folder is a parameter edit.
- Reusable outside Saropa: a team with `docs/backlog` and `docs/shipped` edits two folder lists.

### 3. Colors

| Color | Meaning |
|---|---|
| Red | Address now |
| Amber | Next priority. Review before new work starts |
| Purple | In progress. A manual mark, cannot be derived |
| Blue | Needs consideration (deferred). Never counted on screen |
| Green | Done. Never counted on screen |
| Grey | No rule placed it. Listed under "Needs a rule" with one click to the rule editor |

Users can mark any document by hand. Marks live in the local cache. Open question: also write a header into the document.

### 4. Severity and release profiles

- A phrase dictionary scores each document: extreme (payments, commercial), critical (data loss, security, privacy), high (user uptake), medium, low (cosmetic).
- Weights: title 3, first 20 lines 2, body 1 only at 3 or more hits per 1,000 words. Per-phrase cap 3. Negation skipped. Code fences stripped. File-name separators read as spaces.
- Audience tag: Pro or all users.
- Profiles decide what stops a release:
  - Rush to market: extreme and critical.
  - Deliberate: adds high.
  - Zero defects: adds medium.
- Users can pin a document as critical. It stays on the first screen in every profile.

### 5. Document facts (no AI)

Read from each markdown document and cached:

- Title and headings.
- Checklist boxes and table rows done versus total.
- Word and character count. Used as a size signal: small, medium, large, very large.
- Code blocks and their languages (Dart, Python, SQL, other).
- Source files named, other documents named, pull requests, links.
- Other projects mentioned.

Size is a hint, not a promise of effort. Not yet verified that size predicts effort.

### 6. Dependencies

- A document may carry a `Needs:` line naming another document, in this or another project.
- The board draws the chain: "SQL script waits on the app build, which waits on pull request 1923."
- The first chain to support is the share-keys rollout (Supabase waits on the app release, the website waits on the app release day).

### 7. Code health

- Lint: errors, warnings, info. Tests: pass or fail, with last-run time.
- An error or a failing test makes a project NO-GO in every profile. Warnings and info never do.
- Tests run only the files that open plans name. Never the whole suite (about 70 minutes for the app).
- Results come from Workspace shortcuts and recipes: when a shortcut that builds, tests or analyzes finishes, Workspace writes the result to the local cache.
- No change to the app's own runners is needed.

### 8. Cache

- Stored in extension storage, outside every repo. No index files in repos.
- Incremental scan by file size and modified time. A cold read of about 9.8 MB took about 3 seconds in the prototype.

### 9. Safety against silent mislabeling

- After a scan the board compares state counts with the last scan.
- A change of 20 percent or more in any state stops the update and asks.
- Folders no rule matches and rules that match nothing are listed.
- Prototype case: renaming `docs/deferred` to `docs/parked` would have turned 444 deferred into red and amber with no error.

## Optional integrations

Each link turns on only if that extension is installed. The board works fully without them.

| Extension | Today | Change needed |
|---|---|---|
| Saropa Lints | Writes `reports/.saropa_lints/violations.json` after every run (counts by severity, file, rule) | None |
| Saropa Drift Advisor | `getSessionSnapshot()` returns slow queries, anomalies, schema, health | None |
| Saropa Log Capture | No public hook found | One call returning the latest session's error and warning counts |
| Claude Chat Explorer | Lists chats that touched a file | Reverse lookup: document, branch or pull request to active and saved chats. Matching method not yet read |
| GitHub | Issues and pull requests via VS Code sign-in | Add "review requested" pull requests |

Community extensions appear as a separate group. They never change a core project's light.

## Settings

- Documentation folder names per project (plans, docs, or any other).
- Project importance, and which project depends on which.
- Ignored projects, folders and files.
- Local package and folder detection.
- Release profile per release (open: per project or per release).

## Build order

1. Scanner, cache and rule engine over several roots. Prototype: `engine.py`, `score.py`, `meta.py`.
2. First screen: profile, GO/NO-GO, resolve / work on / track lists.
3. Document facts line.
4. Marks, pins, `Needs:` dependencies.
5. Repo details tab and Settings tab (rule editor with preview).
6. Shortcut results into Code health.
7. Lints and Drift Advisor links.
8. GitHub review-requested list.
9. Chat Explorer lookup and Log Capture call.

## Not built or not verified

- Blast radius beyond a text search for a changed name.
- Whether the 29 Drift Advisor bug files are really open.
- Whether size predicts effort.
- The prototype's commit-hash count over-counts. Leave it out.
- Folder `bugs/` holds handover and tracker files that the prototype labels as bugs. Needs a rule.
- Where user marks live: local cache only, or also a header in the document.

## Version

2.0.0: a new mode that reads several projects changes what the extension is. Existing single-project behavior stays unchanged when only one root is configured.
