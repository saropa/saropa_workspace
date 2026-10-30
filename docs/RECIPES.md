# Run recipes

Common run configurations. Set them from a shortcut's context menu with
**Configure Run…** — no JSON editing required. Each recipe maps to the shortcut's
run config (command prefix, arguments, working directory, environment, and the
terminal-vs-background toggle).

## How a run command is assembled

By default a run is assembled as:

```
<command> <file> <args>
```

- **Command prefix** — the interpreter or runner placed before the file. If you
  leave it empty, the default for the file extension is used (see
  `saropaWorkspace.interpreterDefaults`, defaults below).
- **File** — the shortcut file's path. You can omit it with the **Pass file path
  to command** toggle (off) for run targets that name their work in the
  arguments instead (an npm script, a Make target).
- **Args** — appended after the file.

Default interpreters by extension (`saropaWorkspace.interpreterDefaults`):

| Extension | Command |
|---|---|
| `.py` | `python` |
| `.js`, `.mjs`, `.cjs` | `node` |
| `.ts` | `ts-node` |
| `.ps1` | `pwsh -File` |
| `.sh` | `bash` |
| `.rb` | `ruby` |

## Placeholder tokens

These expand at run time, in the command, arguments, and working directory
(quoting is preserved for paths with spaces):

| Token | Expands to |
|---|---|
| `$workspaceRoot` | the workspace folder path |
| `$dir` | the shortcut file's directory |
| `$file` | the full file path |
| `$fileName` | the file's base name |
| `$fileNameWithoutExt` | the base name without extension |

Interactive tokens, resolved when you run (the stored shortcut is unchanged):

| Token | Behavior |
|---|---|
| `${prompt:Label}` | opens an input box labeled `Label` |
| `${pick:a,b,c}` | opens a quick pick over `a`, `b`, `c` |

A token reused across fields is asked once; canceling any prompt aborts the run.
Scheduled runs skip shortcuts that use interactive tokens (see
[SCHEDULING.md](SCHEDULING.md)).

## Examples

### Run a Python script with arguments

- Command prefix: *(empty — uses `python`)*
- Arguments: `--out $dir/result.txt $fileNameWithoutExt`

### Run an npm script (file path omitted)

Add `package.json` as a shortcut, then in Configure Run:

- **Pass file path to command:** off
- Command prefix: `npm`
- Arguments: `run build`

Assembles as `npm run build` in the package directory. (Adding a
`package.json` as a shortcut also offers its scripts directly via run-target
inference.)

### Run a Make target

Add the `Makefile` as a shortcut:

- **Pass file path to command:** off
- Command prefix: `make`
- Arguments: `test`

### Ask for a value at run time

- Arguments: `--env ${pick:dev,staging,prod} --tag ${prompt:Release tag}`

### Run in the background instead of the terminal

Set **Run in** to *Background output channel* in Configure Run. Background runs
can be stopped from the tree and show a success/failure badge; terminal runs stay
interactive in the integrated terminal.

## Report recipes that feed the Release Board

Scheduled recipes that write a dated report under `reports/<date>_workspace/`. They are
read-only, seed switched off (enable the schedule from the recipe's context menu; the board's
**Turn on** button exists only for the build, lint and test reports), and are offered only
where their input exists. The first line of
each report is a hidden summary line the board reads: recipe, time, `pass`, `fail` or
`unknown`, and one count. A check that has nothing to compare, or could not look, writes
`unknown`, which the board treats as no evidence. The board never shows a report's text or
path; **Open report** buttons resolve the file on your machine.

### Release readiness summary

- **Report:** `*_release_readiness.md`. Default time 09:15.
- **Offered when:** the project has a test runner or a linter.
- **Reads:** the newest build, test, lint and dependency reports, within the age limit
  `releaseBoard.recipeEvidence.maxAgeHours`.
- **Result:** `fail` with the number of failing reports; `pass` only when the test and lint
  reports are fresh and passing and every other report that exists is passing; otherwise
  `unknown`. A missing report is listed as not covered.
- **Board:** one "Release checks" note on the project row. It never changes the light.

### Changelog check

- **Report:** `*_changelog_check.md`. Default time 09:20.
- **Offered when:** the folder has `CHANGELOG.md` and a manifest (`package.json`,
  `pubspec.yaml`, `Cargo.toml` or `pyproject.toml`).
- **Compares:** the newest released heading (an Unreleased heading is skipped) with the
  manifest version. A leading `v` and build metadata after `+` are ignored.
- **Setting:** `recipes.changelogFile` (default `CHANGELOG.md`, relative to the folder).
- **Board:** a note on the row when they differ.

### Version consistency

- **Report:** `*_version_check.md`. Default time 09:25.
- **Offered when:** a manifest exists with a `package-lock.json`, `Cargo.lock` or `README.md`.
- **Compares:** the manifest version with the lockfile's own version and any README badge
  whose text or address names a version or release. At least one other file is needed.
- **Board:** a note on the row when any file differs.

### Stale branch age

- **Report:** `*_branch_age.md`. Default time 09:05.
- **Offered when:** the folder is a git repository.
- **Lists:** local branches not merged into the default branch whose last commit is at least
  the limit old. The checked-out and default branches are never listed. Nothing is deleted.
- **Setting:** `recipes.staleBranchDays` (default 30).
- **Board:** a note on the row with the count.

### Large new file watch

- **Report:** `*_large_new_files.md`. Default time 09:10.
- **Offered when:** the folder is a git repository.
- **Lists:** files added in the last 7 days, committed or not yet tracked, that are larger than
  the limit. A file exactly at the limit is not listed. Works from a subfolder of the
  repository (only that folder is checked). More than 5000 new files cuts the scan short:
  the result is unknown, or a failure if an oversized file was already found.
- **Setting:** `recipes.largeNewFileKB` (default 1024).
- **Board:** a read-only entry in the Tidy box.

### Broken links in docs

- **Report:** `*_broken_links.md`. Default time 09:30.
- **Offered when:** a git repository has a `README.md` or a `docs` folder.
- **Checks:** relative links in tracked Markdown documents (at most 2000 documents). Web
  links, page anchors, absolute paths and links inside code are not checked, and neither are
  links that leave the folder. At most 200 broken links are listed; the count is complete when the scan finishes. A scan cut short by a limit (more than 2000 documents, 50,000 links, or a document that is too large or unreadable) reports unknown, or a failure if it already found a broken link.
- **Board:** a note on the row with the count.

### Existing recipes that now feed the board

| Recipe | Board place |
|---|---|
| Dependency freshness | Dependencies mark; vulnerable or discontinued packages make the row worse |
| PR review queue | Row note: pull requests waiting for review |
| End-of-day uncommitted guard | Row note: files not committed |
| Tech-debt harvest | Tidy entry with the trend |
| Branch hygiene | Tidy entry: merged branches |
| Workspace bloat scan | Tidy entry |
| Standup digest, Since yesterday | A line in "Since you last looked" |

## Correct a status or severity on the Release Board

The board guesses a document's status from its rules and its severity from a phrase list. When a guess is wrong, fix it for that document:

1. Click the status pill on the document's row (or its kebab button, three dots).
2. Pick another status, or a severity: Raise, Lower, extreme, critical, high, medium or low. A line in the menu says what the choice would do to the project's light.
3. The choice is saved at once, with an **Undo** bar for ten seconds. It is written to `.saropa/release-board.json`: a rule for the exact path (status) or an entry under `severityOverrides` (severity), both for that project only.

A document changed this way shows a **Set** mark, and its tooltips say "Set by hand in the rules file. Back to automatic in the row menu." A line under the intro counts the severities set by hand and how many were lowered below a level that stops the release.

To undo, open the row menu and choose **Back to automatic**. It takes away your severity and your status for that document.

A lower severity can turn a blocker green, so the confirmation says so. A pinned document keeps stopping the release. A document whose text could not be read keeps its unverified light whatever you choose.

```json
{ "severityOverrides": [{ "project": "app", "path": "docs/PLAN_x.md", "severity": "low" }] }
```
