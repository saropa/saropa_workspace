# Changelog

```text
                                    ....
                             -+shdmNMMMMNmdhs+-
                          -odMMMNyo/-..``.++:+o+/-
                       /dMMMMMM/               `````
                      dMMMMMMMMNdhhhdddmmmNmmddhs+-
                      /MMMMMMMMMMMMMMMMMMMMMMMMMMMMMNh/
                    . :sdmNNNNMMMMMNNNMMMMMMMMMMMMMMMMm+
                    o     ..~~~::~+==+~:/+sdNMMMMMMMMMMMo
                    m                        .+NMMMMMMMMMN
                    m+                         :MMMMMMMMMm
                    /N:                        :MMMMMMMMM/
                     oNs.                    +NMMMMMMMMo
                      :dNy/.              ./smMMMMMMMMm:
                       /dMNmhyso+++oosydNNMMMMMMMMMd/
                          .odMMMMMMMMMMMMMMMMMMMMdo-
                             -+shdNNMMMMNNdhs+-
                                     ``

Made by Saropa. All rights reserved.

Learn more at https://saropa.com, or mailto://dev.tools@saropa.com
```

All notable changes to Saropa Workspace are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- MAINTENANCE NOTES -- IMPORTANT --

    The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

    **Overview** — Each release (and [Unreleased]) opens with one plain-language line for humans—user-facing only, casual wording—then end it with: [log](https://github.com/saropa/saropa-workspace/blob/vX.Y.Z/CHANGELOG.md) substituting X.Y.Z.

    **Tagged changelog** — Published versions use git tag **`vx.y.z`**; compare to [current `main`](https://github.com/saropa/saropa_workspace/blob/main/CHANGELOG.md).

    **Published version**: See field "version": "x.y.z" in [package.json](./package.json)

    NOTE: try to keep this file to approx 500 lines
    
cspell:disable
-->

---

## [Unreleased]

The Release Board is calmer: red only for what really blocks a release, a one-line header, and fewer marks on every row.

### Changed
- **Release Board: calmer page.** The NO-GO light is a tinted pill. Red now means only "blocks the release"; errors in named files, a stale `Needs:` line and a waiting link are amber. Each row is a status pill (shape, word and severity), the title and one facts pill; the row menu button shows on hover or focus. Project rows show count pills instead of a row of squares. Counts no longer sit in brackets, and every new pill and mark has a tooltip.
- **Release Board: one-line header.** A This project / All projects switch, the tabs and two menus (view options with the release mode, project actions with scan again, projects, rules file, keywords, settings and start-up). Applied time and context filters show as removable pills under the header.

---

## [2.5.0]

You can now choose which files and folders the Release Board leaves out. [log](https://github.com/saropa/saropa-workspace/blob/v2.5.0/CHANGELOG.md)

### Added
- **Release Board: exclude files and folders.** New setting `saropaWorkspace.releaseBoard.exclude`, a list of globs matched against each path in a project. The default is `reports/**`, so generated reports no longer show on the board.

---

## [2.4.0]

The Release Board is tidier: icons on the Future controls, one fold style everywhere, and an icon before every section heading. [log](https://github.com/saropa/saropa-workspace/blob/v2.4.0/CHANGELOG.md)

### Changed
- **Release Board: Future tab declutter.** Wow, Reach, Effort and Risk show as small icons (hover for the full name). The Research question only appears once a research state is set, in its own multi-line box. The "Research needed" checkbox is gone; use the Research dropdown. A guessed value is now shown in italic with the normal dropdown border.
- **Release Board: one fold style.** Every folding section uses the same box, with the arrow at the far right, shown on hover or focus.
- **Release Board: section icons.** Each section heading starts with a colored icon. Turn them off with the setting `saropaWorkspace.releaseBoard.sectionIcons`.

### Fixed
- **Process sampling on macOS.** The process list was empty on macOS because CPU times with fractions of a second were dropped.
- **Doc shortcuts on macOS.** A README is now offered under its real file name spelling.

---

## [2.3.0]

The Release Board opens in its own tab group beside your files and remembers where you move it, has a Future tab for deferred and blocked work, its Build, Lint and Tests marks now read the daily reports, with missed reports catching up at start, and more daily reports now add a Dependencies mark, row notes, Tidy entries and a line in "Since you last looked", plus six new read-only report recipes, and a document's severity can be corrected from its row menu (Change severity, Back to automatic). [log](https://github.com/saropa/saropa-workspace/blob/v2.3.0/CHANGELOG.md)

### Added
- **Stop the board opening at start-up, from the board.** A checkbox **Open this board at start-up** sits in the top right corner of the board's top bar. Untick it and the board no longer opens when a window starts; it still opens from the sidebar or the command. Tick it again to restore the earlier choice (when projects are found, or always). It shows the `releaseBoard.openOnStartup` setting and follows it when you change it in Settings.
- **Documents open beside the board.** A document opened from the Release Board (a link, a row menu, a step, a Sittings line) now opens in the other editor group, so it sits side by side with the board. It uses an existing other group or opens a new one beside. Turn it off with `releaseBoard.openBeside`. It does not apply when the board is set to open in the same group as your files.
- **Change severity on any document.** The row menu has **Change severity** (extreme, critical, high, medium, low) and **Back to automatic**. The severity is guessed from phrases, so you can correct it. Your choice replaces the guess for that document only, is stored in `.saropa/release-board.json` under `severityOverrides` (for the project and the exact path), and is asked about first. The confirmation says it can change the release light. **Back to automatic** in the row menu also takes away a status you set with **Change status**.
- **What is set by hand is marked.** A document whose severity or status is set by hand shows a small **Set** mark, and its tooltips say "Set by hand in the rules file. Back to automatic in the row menu." A line under the intro counts the severities set by hand and how many were lowered below a level that stops the release, so a lowered blocker is never hidden. The sidebar tooltip of a project and the status bar tooltip also count lowered blockers. A pinned document keeps stopping the release, and a document whose text was not read stays unverified.

- **Release Board: a clearer page.** The tab and panel are named **Saropa Release Board** and the big heading is gone (screen readers still hear it). All buttons now share one size and the editor's button colors, with a primary and a secondary style that stay readable in light, dark and high-contrast themes.
- **Documents are links.** An openable document shows as an underlined link; hover to see its path inside the project. Names that cannot be opened stay plain text with their buttons. Path to GO steps use links too, instead of an **Open** button.
- **Tooltips on everything.** Every button, tab, list, row, count and mark has a tooltip. Every colored dot, triangle, square, diamond, ring, flame and icon says what it looks like and what it means, for example "Red triangle: critical severity".
- **A menu on every document row.** Each row has a small kebab button that opens a menu: **Open document**, **Change status**, **Assign rule**, **Hand to chat** and **Open the rules file**, each with a tooltip, all reachable with the keyboard. **Change status** lists the categories of your rules, shows the rule it would add for that one document, and writes it to `.saropa/release-board.json` only after you confirm; it is placed ahead of the rule that placed the document. The Hand to chat entry is left out when that feature is off. The severity of a document is worked out from its text and cannot be set by hand, so the menu has no entry for it.
- **Safer rule writes.** A rule written from the board (Add a rule, Change status, Assign rule) names its project, so it never changes another project's documents at the same path, and it works for chosen projects too. A row's Assign rule and Change status are placed ahead of the shipped rules so they take effect; the confirmation says plainly that the rule can turn a blocking document green and move the project's light, for example to GO. These rules are tried before all others, including a chosen project's own rules, and the document's Status line cannot undo them. A project whose id already had a number added because two folders share a name is refused. This only catches ids that collide when the rule is written; an id can still shift if folders are added later. Nothing is written, and a message says why, when the rules file has unsaved edits, is a symbolic link, is not plain UTF-8 (a byte order mark, or other bytes), repeats a key, or holds a number too large to keep exactly. A folder or document name with a `$` is refused. While a scan runs the menu entries say to wait instead of doing nothing.
- **A board options menu.** A kebab button in the top bar opens **Open the rules file**, **Projects** and **Settings**. The rules file no longer has links in the page: it opens only from this menu and from the row menu.
- **Less clutter on rows.** With one project in focus the project name is no longer shown on each row. On a narrow panel the project name, the Hand to chat button and all icons but the most severe one are hidden (hover the remaining icon to read all of them) and the row menu holds what no longer fits.
- **Counts are pills.** Every number the board counts is a small rounded badge in the editor's badge colors.
- **Every section folds.** Sections and sub-sections open and close with the mouse or the keyboard, and the board remembers which ones you closed. Lists of more than 25 rows start closed and show a "+ N more" line.
- **Narrow panels.** The board reflows down to a panel about 280 pixels wide: the top bar wraps, project rows stack, list buttons go under the text, targets are at least 32 pixels high, and nothing scrolls sideways.
- **Steps I can do now.** The hidden "I have..." button and panel are replaced by an always-visible filter: **Time I have** (Any, 15 min, 30 min, 1 hour, Half a day) and a chip for each thing you have in hand, with an **All** chip. By default everything is allowed for any time. Your choice is remembered on this machine.
- **In progress shows what you are editing.** The In progress list now starts with the open documents that have unsaved edits or are changed in git and belong to the board, then the documents marked in progress. It is capped and the rest is counted ("N more"). Settings: `releaseBoard.inProgress.enabled` (on) and `releaseBoard.inProgress.max` (15, from 1 to 50).
- **Documents with no rule.** The bottom section of the board (it used to show only a gray square) now has a heading, a sentence saying what it is, a count, and one row per folder with the number of documents. **Add a rule** asks which category the folder gets, shows the rule, and after you confirm writes it to `.saropa/release-board.json` (a file that does not parse is never changed) and scans again. **Preview** shows what it would match. With nothing to place it says so.
- **Settings:** the `releaseBoard.sittings.defaultTimeBox` list gains `240` (half a day).
- **README** lists every Release Board feature and every `releaseBoard.*` setting; a test keeps the table and `package.json` the same.
- **Release Board: correct the severity yourself.** Severity comes from keywords, which can be wrong, so you can now change them. A line under the board's intro says "Severity uses the shipped keywords" with an **Edit keywords** button (the options menu has the same entry). The editor shows the phrases of the Extreme, Critical, High and Low levels as chips you add or remove, the threshold and weights with a one-line explanation each, and the negation words; each list and all lists can be restored to the shipped values. As you type it counts the open documents that would change level, with examples (before to after) and how many would stop the release no longer, because lowering a severity can turn a light greener. **Save** asks first, in plain words, then writes only what differs from the shipped keywords into the `severity` key of `.saropa/release-board.json` (nothing else in the file changes; a file that is not plain UTF-8, repeats a key, is open with unsaved edits or is a symbolic link is left alone). Whenever your file changes the keywords, the board shows **Keywords customized by you** with a tooltip naming what changed and a **Restore defaults** button. Settings: `releaseBoard.keywordEditor.enabled` and `releaseBoard.keywordEditor.previewMaxDocuments`.
- **Release Board: Hand to chat works with the chat tool you use.** The message after copying now names what the prompt is about and says it is on the clipboard, ready to paste. A new setting `releaseBoard.handToChat.agent` (`none` by default, or `claudeCode`, `copilotChat`, `cursor`, `custom`) adds an **Open <tool>** button to that message; `custom` runs the command id in `releaseBoard.handToChat.customCommand`. `releaseBoard.handToChat.autoOpen` (off by default) opens the tool at once after copying. If the tool's command is not installed, the message says so and the prompt stays on the clipboard. The prompt is never passed to the command; paste it.
- **Release Board: several projects at once.** A **Projects** button in the top bar of the board opens a menu: **Add a folder...** (pick one or more folders), **Add all folders in a parent folder...** (lists each folder inside it that has `.git`, `.saropa`, `plans`, `docs` or `bugs`, and you untick what you do not want), **Remove...**, and **Show only the open project** / **Show all chosen projects**. Chosen folders are read like the open ones, each with its own `.saropa/release-board.json` when it has one, and stay on this computer (a user setting). Until a folder is chosen, a one-line hint at the top of the board says "Only this project is shown" and offers **Add more projects**; **Dismiss** hides it for good.
- **Umbrella view.** With more than one project the board shows a header with the number of projects and how many are NO-GO, UNVERIFIED and GO. The projects of the open window come first and are marked **open**, the chosen ones follow. A chosen folder that is missing, not a folder, cannot be read or does not answer in time shows as a grey **NOT READ** row with the reason; it is never counted as a light, but the status bar button and the sidebar then show at best UNVERIFIED, the sidebar gets an UNVERIFIED row per unread folder, and the status bar tooltip names them. With **Show only the open project** the board, the sidebar and the status bar tooltip say how many chosen projects are hidden. A chosen project is never greener than its own evidence, and a chosen folder's rules file cannot set lint, test or build evidence. Taking a chosen project off the list does not hold the board for an accept; adding one asks for an accepted scan of its own, like any new project.
- **Release Board: Settings.** A **Settings** button in the top bar and the command **Release Board: Settings** open the Settings editor filtered to the board's settings. The command **Release Board: Choose Projects** opens the same menu as the Projects button.
- **Settings:** `releaseBoard.projects` (list of folders, empty by default; user level) and `releaseBoard.projectScope` (`all` or `openOnly`, default `all`).

- **Release Board: Future tab.** When a project has deferred or blocked documents (`plans/deferred`, `plans/blocked`, `docs/deferred/<area>`, `docs/blocked`), a **Future** tab appears next to **Board** at the top of the board page, with the count. It lists every such document from every project under its importance flag: Unflagged first (so nothing is forgotten), then Build next, Marketable, Nice to have, Needs a decision, and last Not feasible, which shows the blocker line. Each row shows wow (1 to 5), reach (daily, weekly, rare), effort (S to XL) and risk (low, medium, high). Inside a flag the default order is wow times reach, divided by effort, with lower risk first on a tie; a Sort by list switches to wow, effort, risk or reach. These items never count as problems and never change a light.
- **Folder names follow your rules.** The tab reads the `deferredFolders` and `blockedFolders` parameters of the board rules, so renamed folders work; a `declined` folder is never listed.
- **Setting flags from the tab.** Each row has lists for the flag and the four characteristics. Choosing a value writes a short block of `Key: value` lines (`Importance`, `Wow`, `Reach`, `Effort`, `Risk`, `Blocker`) at the top of that document, right under its title, and changes nothing else in it: line endings, front matter and all other text stay byte for byte. A document without the block is still listed; values the board guessed are drawn with a dashed amber border and can be written with one click on **Proposed: ...**. Only a complete block is edited (every value valid, followed by a blank line); a paragraph that merely starts with a word like `Risk:` is left alone and a new block is written above it. Documents with unsaved edits, that changed while being written, that are not plain UTF-8 text, or whose front matter never closes, are not written.
- **Moving between deferred and blocked.** Changing a flag to or from Not feasible asks, in a dialog naming the exact source and destination, whether to move the document between `deferred` and `blocked`. The board never moves a file on its own; decline and the flag is still written.
- **Later work outside the deferred folders.** Bullets under a Later or Exploratory heading in `ROADMAP.md` and `plans/MASTER_PLAN.md`, and master plan headings whose Status says Not started, are listed in a read-only box at the bottom of the tab, with their source and line. Click one to open it there.
- **Settings:** `releaseBoard.future.enabled` (on) and `releaseBoard.future.defaultSort` (`score`, `wow`, `effort`, `risk` or `reach`; default `score`).
- **Future tab: research flag.** Each row has a **Research needed** checkbox, a research state list (none, needed, in progress, ready, reviewed) and a **Question** field. They write `Research:` and a one-line `Research question:` (up to 300 characters) into the document's header block, with the same care as the other keys: only a complete block is edited, prose is never overwritten, and a document with unsaved edits, that changed while being written, that is not plain UTF-8 text, or whose front matter never closes, is not written. Above the list the tab counts the documents waiting for research, those being researched and those with **Research ready, not reviewed**.
- **Future tab: Hand all to chat.** Whenever a document is flagged needed, a **Hand all to chat** button appears. It uses Hand to chat, which copies one prompt at a time, so the documents are handed one after another: each prompt names the document, the question and the rules (add one dated Research section to that document only, cite sources, say what could not be confirmed, set Research to ready, never change the Importance line, delete text or build anything). After you confirm you pasted a prompt, that document becomes in progress; stopping leaves the rest unchanged. At most `releaseBoard.future.researchParallel` documents go in one round; the button says how many remain queued. Turn Hand to chat off and the button stays but is disabled.
- **Future tab: Mark reviewed.** A document whose research is ready shows **Research ready, not reviewed** and a **Mark reviewed** button. It asks first, then writes `Research: reviewed` only if the file still says ready.
- **Settings:** `releaseBoard.future.enabled` (on), `releaseBoard.future.defaultSort` (`score`, `wow`, `effort`, `risk` or `reach`; default `score`) and `releaseBoard.future.researchParallel` (3, from 1 to 10).
- **Release Board: daily reports feed the Build, Lint and Tests marks.** The newest report of the Build status, Dawn lint sweep and Test trend tracker recipes is now read as evidence. Each of those reports starts with one hidden summary line (recipe, time, pass or fail, one count). A fresh failing report makes the project's row worse (the new Build mark turns red, and a failing build stops GO). A fresh passing report counts like any other fresh passing result, so GO still needs fresh, clean evidence of both lint and tests. A report older than the age limit, a missing report or one that cannot be read is never green: the row stays grey and says "Report is 3 days old" or "No report yet". When no report exists, every light is exactly what it was. Settings: `releaseBoard.recipeEvidence.enabled` (on) and `.maxAgeHours` (36, from 1 to 720).
- **Release Board: missed reports run at start.** The three recipes above now start with "catch up" on, so after the machine was off at their time, each missed report runs once at the next start (not once per missed day), one at a time: build, then lint, then tests. The full test run waits until the editor has been quiet for 2 minutes. A row says "Checking the build now." while its job runs, says why when a job could not start, and the board refreshes after each report is written. A recipe you already stored keeps your own catch-up choice. Setting: `releaseBoard.recipeEvidence.idleMinutes` (2, from 0 to 60; 0 starts at once).
- **Release Board: turn on the daily report.** When a row has no fresh report and the matching recipe's daily schedule is off, its Path to GO step says "Turn on the daily test report" (or lint, or build) with one **Turn on** button that switches that schedule on.
- **Release Board: the dependency report feeds a Dependencies mark.** The Dependency freshness report now starts with the summary line too. A fresh report that finds vulnerable packages (npm audit) or discontinued packages (pubspec) turns a new Dependencies mark red, makes the project NO-GO and adds a Path to GO step. A report with only packages behind is a passing mark and changes nothing else. An old, missing or unreadable report, a project whose ecosystem has no advisory check, and a pubspec run that returned no package list are grey or absent, never green and never blocking. The recipe now catches up at start like the build, lint and test recipes.
- **Release Board: notes from the other daily reports.** A project's row now shows short notes, with the report's own figures in the tooltip: pull requests waiting for your review (PR review queue), files not committed (End-of-day uncommitted guard, in amber), a changelog or version mismatch, old unmerged branches, broken links and one "Release checks" line from the readiness summary. The notes are information: they never change a light, and a clean, old, missing or unreadable report adds nothing. Setting: `releaseBoard.recipeEvidence.rowNotes` (on).
- **Release Board: Tidy lists the debt, branch and bloat reports.** The Tidy box now also lists, read-only, the newest Tech-debt harvest (marker count, rising, falling or unchanged since the report before), Branch hygiene (merged branches you can delete), Workspace bloat scan and Large new file watch reports that found something, each with an **Open report** button. The board only opens the report; it deletes and changes nothing, and moving a document still asks first. Setting: `releaseBoard.tidy.reports` (on).
- **Release Board: standup and since-yesterday lines.** "Since you last looked" adds one line per project when a new Standup digest or Since yesterday report was written, for example "standup digest: 7 commits in the last day". It clears with the rest of the strip. Setting: `releaseBoard.sinceLast.reports` (on).
- **New recipes, all read-only.** Each writes one dated report under `reports/` that starts with the summary line the board reads, opens it only when it finds something, seeds switched off, and is offered where its input exists. **Release readiness summary** combines the newest build, test, lint and dependency reports; it passes only when the test and lint reports are fresh and passing and nothing else is failing, and a missing or old report keeps it from passing. **Changelog check** compares the newest released changelog entry with the version in the manifest. **Version consistency** compares the manifest version with `package-lock.json`, `Cargo.lock` and any version badge in the README. **Stale branch age** lists local branches not merged into the default branch with no commit for 30 days (nothing is deleted). **Large new file watch** lists files added in the last 7 days, committed or not yet tracked, over 1 MB. **Broken links in docs** lists relative links in tracked Markdown documents that point at a file that does not exist. A check with nothing to compare, or a git repository it cannot read, says "could not tell" and is never a pass. Settings: `recipes.staleBranchDays` (30), `recipes.largeNewFileKB` (1024) and `recipes.changelogFile` (`CHANGELOG.md`).

### Changed

- **Release Board: opens beside your files.** The board tab used to open among the files; it now opens in its own editor group next to the files instead of among them. Opening it again shows the existing tab where it is, and it remembers the group you moved it to, per workspace. If that group is gone it opens beside again. The tab that opens at window start uses the same place and still does not take focus. Setting: `releaseBoard.placement` (`beside` or `sameGroup`, default `beside`).
- In a chosen project the board's file scan no longer follows links to folders or files (a linked folder could loop or lead outside the project). Open workspace folders are scanned as before.

### Fixed

- **Planner: no empty menu on event nodes.** Right-clicking an event node in the Workflow tab that nothing is linked to used to open a small empty box; now it opens nothing.
- **Configure Run: the preview for a file that cannot be run.** For a document such as a text or Markdown file with no run command, the preview used to show the file's path as if it would be run. It now says the file is opened, which is what Run does.
- **Customize: saving a cleared name.** When you cleared a shortcut's name and saved, the confirmation still showed the old name. It now shows the name the shortcut has after saving. A malformed save from the page can no longer stop the save.
- **Settings editor: values that do not fit.** The Settings editor now refuses a value of the wrong kind, a choice that is not offered, or a number outside the allowed range, instead of writing it to your settings.
- **Planner: links, times and layout.** Retiming ignores a time that is not a real HH:mm time or a weekday that is not 0 to 6. A link from a shortcut that no longer exists is refused. Removing a link can no longer remove an idle trigger. Saved layout positions that are not numbers are dropped. The confirmation names an unlabeled shortcut by its file name instead of its id.

---

## [2.2.0]

The Release Board is now always in view: a sidebar section, a status bar light and a tab that opens at window start, plus a list of what to do next, a strip of what changed since you last looked, tidy-up suggestions, one-click prompts for a chat, live error marks, a release train row and an optional overnight proof run. [log](https://github.com/saropa/saropa-workspace/blob/v2.2.0/CHANGELOG.md)

### Added

- **Release Board: live evidence on each row.** A small flame appears on a board row when the source files that document names have errors or warnings right now. Red means errors or crashes, amber means warnings only. Hover to see each file and its counts. A document whose named files are clean and quiet has no mark. Counts come from the Problems panel and the Saropa Lints violations file; when the Log Capture extension is installed and offers `signalsForFiles`, crashes and errors from recent debug runs are added (it is asked for at most 3 seconds, and the board is silent if it is missing, too old or slow). The mark never changes a light: a document's severity, a project's NO-GO and GO come out exactly as before. A new "Errors with no document" box lists crash signals from debug runs in files that no open document names, each with a **Start a bug document** button that writes one new file in the project's bugs folder (title, signal, file and date filled in) and opens it for you to finish; this box needs Log Capture. Settings: `releaseBoard.liveEvidence.enabled` (on), `.includeWarnings` (on), `.lookbackDays` (1 to 30, default 1) and `.unnamedBox` (on).
- **Release Board: Prove overnight.** Optional. Once a night, at a time you set, the board runs each project's own lint and test shortcuts in the background, one project at a time, and records the results like any other run, so the morning light rests on fresh evidence. A run that fails, times out or never ran cannot turn a light green; it never edits files. It is off by default because it runs unattended. While it is off, the sidebar shows one line, "Prove overnight: run lint and tests at night"; click it to turn the feature on, or click the x to hide the line for good. Settings: `releaseBoard.overnight.enabled` (off), `.startTime` (`02:00`), `.windowHours` (3) and `.stepTimeoutMinutes` (30). Known limits: it runs only while VS Code is open, and only for projects that name a lint or test shortcut under `health`.
- **Release Board: Since you last looked.** When the board changed since it was last shown, a strip at the top of the board says so, for example "Since you last looked (Fri 18:40)", then one line per project such as "App: 2 new blockers, 1 blocker cleared, went from UNVERIFIED to NO-GO", with the document titles underneath. The same lines lead the Release Board section in the sidebar (with a small check button to mark them as seen) and sit in the status bar button's tooltip. Nothing shows when nothing changed. It clears itself after the board tab has been on screen for 8 seconds, so there is nothing to dismiss; a tab hidden or closed sooner does not count as a look. The very first look only records a starting point. The record is kept in extension storage for the workspace, never in a document, and holds blocker titles only (at most 200 per project). A blocker that is still open but no longer stops the release (for example after changing the profile) counts as cleared. A document that could not be read is never reported as cleared, and a document renamed or moved (same title gone and new) is not reported. Records keep at most 50 projects. It reads and compares only: it never changes a light.
- Settings for Since you last looked: `saropaWorkspace.releaseBoard.sinceLast.enabled` (on) and `saropaWorkspace.releaseBoard.sinceLast.maxListed` (5, from 1 to 20). New command: **Release Board: Mark Changes as Seen**.
- **Release Board: Hand to chat.** Every row that stops the release, every Path to GO step and every Sittings step has a small **Hand to chat** button. It copies a ready prompt to the clipboard: the blocker, the file, and the evidence (state, severity, what waits on it, and for the full level the group and the project's lint and test evidence). Nothing is sent anywhere and no network is used. Settings: `releaseBoard.handToChat.enabled` (on), `.detail` (`short`, `standard` or `full`; default `standard`) and `.openChat` (`never` by default; `offer` adds an Open chats button after copying when Chat Explorer knows chats for that document). Steps with no single file (lint and test evidence, folders with no rule) carry the project's facts and no file.
- **Release Board: visible without a click.** A "Release Board" section now sits at the top of the Saropa Workspace sidebar: one row per project with a colored light (red NO-GO, amber UNVERIFIED, green GO), a line such as "NO-GO · 3 blockers" and a tooltip with the reasons. Open a project to see its first blockers; click one to open the document, or click the project to open the full board. It shows the last result at once and keeps itself up to date with a quiet background scan (when documents change, when lint or test results are recorded, when settings change); while the board tab is showing the tab does the scanning, and a hidden or closed tab does not stop it. A failed scan keeps the previous result and shows a Retry link; a half-edited rules file never blanks the sidebar. A NO-GO row always says why: documents, failing lint or tests, or a held red. Rows say "(updating…)" while a stored result is being refreshed and "(last scan failed)" after a failed scan, and the status bar tooltip says the same. A scan that hangs is given up after 120 seconds. Known limits: the background scan watches projects inside the open workspace folders only; a project outside them is rescanned when the board tab is opened. With no projects it says so and links to the rules file; while the first scan runs it says "Reading the project folders...". The title bar has Refresh and Open buttons.
- **The board opens by itself at window start.** Once per window start, after the first scan, the board opens as an editor tab in a group beside the active editor (a split if there is only one), without taking focus and without covering your file, when the scan finds open documents (red, amber or purple). Close it and it stays closed until the next window start. The status bar button is now tinted with the worst light (red, amber or green) and names it in its tooltip.
- **Settings:** `releaseBoard.sidebar.enabled`, `.sidebar.blockersPerProject` (0 to 10, default 3), `.sidebar.expandProjects` (never, whenNoGo, always), `.openOnStartup` (never, whenProjectsFound, always) and `.statusBar.showLight`.
- **Release Board: Sittings.** The "I have..." button opens toggles for iPhone, Android phone, Mac, Windows PC, Supabase SQL Editor, App Store Connect, Play Console and a Google account with backups, plus a time box of 15, 30 or 60 minutes (or any). The board answers with one list of open steps from all projects that need only what you have. Steps that unblock other documents come first, then the more severe, then the shorter. Each line opens the document at the step. Your choice is remembered on this machine. This first version only reads: it never writes into your documents. Known limits: SQL files are not read for steps, documents that wait on an open `Needs:` link or sit in a blocked folder are left out, order uses how many documents wait on a document (not the order inside a `Needs:` chain), and at most 200 open steps are read per document.
- **Steps are tagged from a readable word list**, `needs-dictionary.json` (for example "TestFlight" means iPhone or Mac, "SQL Editor" means the Supabase SQL Editor). A table column named "Needs" is read directly. Add or change words under `needs` in `.saropa/release-board.json`. A step with no match is never hidden: an "untagged steps" line lists them.
- **Settings:** `releaseBoard.sittings.enabled`, `.defaultHave`, `.defaultTimeBox`, `.maxSteps` and `.onlyOwnerDocuments`. By default only owner-action documents (the `human` folder) are listed; `ownerKinds` and `ownerFolders` in the rules file name others.
- **Release Board: the board in the editor.** Open a source file that an open board document names and a line appears at the top: "Named by 2 open documents", followed by the document titles and their colors. Click a title to open the document. A small status bar item shows how many documents name the file, in the color of the worst one. It uses the last board result and never starts a scan; nothing shows when the board is off or has not been scanned yet. A document keeps only the first 40 source files it names, and the tooltip says so when a document names more. Four new settings: `releaseBoard.editorLinks.enabled`, `.codeLens`, `.statusBar` and `.minSeverity` (any, medium, high or critical) to narrow it down if it feels noisy. Documents that are waiting on another document are collapsed on the board and are not listed here, and documents whose text was not read are left out when a minimum severity is set.
- **Release Board: Path to GO.** Click a project row to open a numbered list of what stands between that project and a green light, in the order that clears it fastest: the documents that stop the release (the one that frees the most waiting documents first; for a document that waits on others, the document at the end of its own line of prerequisites), then missing or failing lint and test evidence, then folders with no rule, then documents that could not be read, then accepting the scan. A project with no steps is GO, and a GO project has no steps; the list is worked out from the same facts as the light, so it never disagrees with it. A step that is done ticks off and stays struck through for a few minutes. Buttons: **Open** a document, **Run lint now** and **Run tests now** (start the shortcut the project names, in the background only, and the result is recorded as before), **Open the rules file** at a folder with no rule, and **Review and accept** for an unaccepted scan.
- Settings for Path to GO: `saropaWorkspace.releaseBoard.pathToGo.enabled` (on), `saropaWorkspace.releaseBoard.pathToGo.maxSteps` (8, from 3 to 20) and `saropaWorkspace.releaseBoard.pathToGo.showRunButtons` (on; turn off if the board should never start a run).
- **Release Board: Tidy sweep.** A "Ready to tidy" box now sits near the top of the board whenever a document has every step done and has not changed for 7 days or more. Each line shows the project, the document title (click to open it), how many steps are done and how long it has been untouched. The button **Move to archive** asks first, naming the exact source and destination, and moves that one document into `docs/history/<year>/<year.month>/<year.month.day>/` of its project. Nothing moves without the click and the confirmation, there is no "move all", and nothing is ever written inside a document. Red and purple (in progress) documents, pinned documents, documents that stop a release, documents waiting on an open `Needs:` link and documents with no checklist are never listed. A document with unsaved edits, or edited since the scan or while the confirmation was open, is not moved, and an open tab follows the moved file. Known limit: "all steps done" is taken at face value, so an amber document that keeps a finished checklist while a device check is pending elsewhere in its text will be listed; raise the days or leave it in place.
- **Settings:** `releaseBoard.tidy.enabled` (on), `.tidy.afterDays` (7, from 1 to 365) and `.tidy.archiveFolder` (`docs/history`).
- **Release Board: Release train.** When more than one project is found, a row at the top of the board and of the sidebar groups the projects that ship together (a project and the projects it depends on, named by id, display name or folder name; when no dependency matches a project, all projects form one train). It shows one light, the worst of its projects, so it is never greener than any of them, and the order to ship in: a project comes after the projects it depends on. A hover says which projects hold the light back. The train is named by the version of the project that ships last, read from its `package.json` or `pubspec.yaml`, or by its folder name when no version can be read. It only reads: nothing is written into a document. Known limit: a circular dependency is flagged and only the projects inside the circle keep the board's order.
- **Settings:** `releaseBoard.train.enabled` (on) and `.train.naming` (`version` or `folder`; default `version`).

---

## [2.0.0]

The Release Board arrives: an off-by-default screen that reads your bugs, docs and plans folders across projects, shows what blocks a release in red, amber and green, links documents that wait on each other, and only says GO when lint and tests are fresh and clean. [log](https://github.com/saropa/saropa-workspace/blob/v2.0.0/CHANGELOG.md)

### Added

- **Release Board: Scan** command (turn on `saropaWorkspace.releaseBoard.enabled` first). It scans every open workspace folder, sorts each document into red, amber, purple, blue, green or reference by the folder it sits in, and prints the counts for the open states in the "Saropa Release Board" output. Rules are a JSON file you can override with `.saropa/release-board.json`; folder names are settings, not code.
- **Release Board: Open** shows the first screen in an editor tab: one light per project (NO-GO when anything sits in a red folder, otherwise UNVERIFIED with the reason, never GO until lint and test evidence exists), then what to resolve now, what is in progress and what to work on. Click a row to open the document. Finished, deferred and reference documents are never listed or counted.
- **Release Board: severity and profiles.** Each open document gets a severity (extreme, critical, high, medium, low) from a phrase dictionary and a Pro marker. A profile picker on the board (Rush, Deliberate, Zero defects; also the `saropaWorkspace.releaseBoard.profile` setting) decides which severities stop a release, and a project turns NO-GO when an open document of a stopping severity exists. Pin documents as critical in the rules file.
- **Release Board: Open Rules File** creates and opens `.saropa/release-board.json`; **Preview a Rule Pattern** shows how many documents a pattern matches. Documents no rule placed are listed on the board, and a click opens the rules file.
- **Release Board: code health and the GO light.** Each project can name the shortcuts that are its test run and its lint run (`health.tests`, `health.lint` in the rules file); the board records their last background run, reads the test tally when the output has one, and reads the Saropa Lints file `reports/.saropa_lints/violations.json` when it is recent and covers enough files. A lint error or failing test makes a project NO-GO. GO shows only when the baseline is accepted, nothing blocks, no document is unplaced, every open document was read, and both lint and tests have fresh, clean results (or are marked not applicable). Two small marks on each project row show lint and test state.
- **Release Board: faster and calmer.** Folders are walked and files read in parallel, and only the file types the board uses are looked at, so a scan of the three Saropa repositories over a slow (2 ms per call) file system takes about 1.1 s cold and 0.15 s warm instead of tens of seconds. The tab opens at once with grey placeholders, shows the last result dimmed under a progress bar, paints the sorted board before document text is read, and fills in marks and severity after. A save to a document rescans the visible tab; scans that overlap are merged into one; an unchanged board is not repainted.
- **Release Board: hand marks and suggested links.** *Release Board: Mark This Document* sets a Markdown file in progress (purple) or pins it as critical; *Export Marks to the Repository* writes `.saropa/release-board-marks.json` so a team shares them. When one open document names another open document of the same project by file name, the board suggests a dashed link; Accept makes it a real wait, Reject stops the suggestion.
- Each open item on the Release Board shows its real title (the document's first heading, or the first descriptive comment of an SQL file) and small marks: a progress ring for checklist steps done, size bars, a code letter, and a dot for each other project it mentions. Hover for the exact figures.
- A safety check holds the board when a folder is renamed or a rule stops matching, instead of silently recoloring documents. The first scan asks you to accept it as the baseline, and the baseline is kept per workspace.
- **Release Board: Claude sessions per document.** When Saropa Chat Explorer is installed, each open document shows a small number (up to the first 200): how many Claude sessions read or edited it. Hover for the count. Without Chat Explorer nothing shows. Needs a Chat Explorer release newer than 0.36.
- **Release Board: pull requests waiting for your review.** Turn on `saropaWorkspace.releaseBoard.reviewRequests` to list them as a separate box under the documents. It uses the GitHub sign-in VS Code already has, never opens a sign-in prompt, and never changes a project's light.
- **Release Board: groups from other extensions.** An extension can add its own box of items to the board through the new Saropa Workspace API (`addBoardGroup`). Items are plain text with an optional https link; a box never changes a project's light.

### Fixed

- Release Board: the Status line is now recognized only when it has a colon (`Status: done`), so table rows and prose such as "Status of the work" no longer turn a document green.
- Two unit tests for package-manager detection failed on Linux because the test stub did not resolve `..` in paths.

---

## [1.11.0]

The Launcher panel has been restructured from six competing panes fighting for space into one flexible, resizable layout, with Mobile Remote Control folded in as a category alongside your shortcuts, recipes, watches, files, scripts, and notes. [log](https://github.com/saropa/saropa-workspace/blob/v1.11.0/CHANGELOG.md)

### Added

- **Launcher panel restructure**: the Launcher's left side is now a single flat category list — All, plus one entry per category (Shortcuts, Recipes, Watches, Files, Scripts, Notes, and the new Mobile Remote Control) — each showing its own item count. Selecting a category filters the card grid to just that content; selecting All shows everything, grouped. Typing into the search box now always resets the selection to All, so a search is never silently scoped to whatever category happened to be selected.
- New resizable, collapsible left and right panels. The left one is the category list described above; the right one lists your recent adb run history (most-recent first, with per-command run counts) with a Run again button on each row — off by default, toggle it from the panel's title bar. Both remember their width and collapsed state across reloads.

### Changed

- Sort and settings actions moved out of the Launcher's old in-content header and into native title-bar icons (the same chrome VS Code's Shortcuts view already uses), alongside a new show/hide icon for the right panel.
- Trimmed the Launcher's custom header down to the project name, version, and search: the per-pane stat toggle chips and the settings gear are gone now that the left panel's category list and the native title-bar icons cover the same ground.

### Fixed

- Fixed a remaining incomplete-escaping gap in Windows command-line quoting flagged by CodeQL: a value ending in `\` (e.g. `C:\Program Files\`) could combine with the closing quote `quoteArg()` appends into an escaped quote instead of a closing one, letting anything appended after it run as a separate command. Backslash runs directly before an embedded quote or at the end of the value are now doubled on win32, matching how `CommandLineToArgvW` actually parses them.

---

## [1.10.0]

A new Mobile Remote Control panel puts adb at your fingertips — search, run, and pin device commands without leaving VS Code — alongside a faster "Saropa: Go" way to jump to anything, and the Customize panel now lets you preview any color across the whole icon grid before committing. [log](https://github.com/saropa/saropa-workspace/blob/v1.10.0/CHANGELOG.md)

### Added

- **Mobile Remote Control**: a new searchable, grouped panel of 40 adb commands (connection, app control, files, device info, input/UI, power/reboot, permissions, deep links, shell) — open it with `Saropa Workspace: Open Remote Control` from the command palette. Commands auto-fill from the current Android/Flutter project (application id per build flavor, deep-link scheme/host, declared permissions) instead of asking every time, and anything not resolvable from the project prompts you interactively.
- Every command shows a dry-run preview of the exact, fully-substituted command line before it runs, with a warning-severity confirmation for destructive commands (uninstall, clear data, force-stop, factory-reset-style resets, and similar) — never skippable.
- Recently and frequently run commands surface first; any command can be pinned into your existing Shortcuts.
- The panel shows whether `adb` is available and how many devices are connected, with install guidance when `adb` is missing instead of a raw error at run time.
- **"Saropa: Go"** (`ctrl+alt+g` / `cmd+alt+g`): one fuzzy-searchable command spanning shortcuts, recipes, scripts, notes, watches, and adb commands, with recently-used items on top. Type `>` followed by a category name (e.g. `>adb`) to narrow to just that section.
- **Control Center**: a new view in the Shortcuts sidebar listing every section (Shortcuts, Recipes, Watches, Project Files, Scripts, Notes, Dashboard, Schedule, Planner, Mobile Remote Control) in one place, so a section without its own permanent tree view is still easy to find.
- Customize panel: hovering (or keyboard-focusing) a color swatch now tints every icon in the grid above with that color as a live preview, reverting to your actual selection the moment you move away — lets you browse the icon/color variety without it looking like a color is permanently fixed to an icon, and never touches the saved selection until you actually click.

### Fixed

- Fixed incomplete shell-argument and Markdown-table-cell escaping (a literal backslash could combine with the escaping added for a quote/pipe character to break out of the intended quoting) flagged by CodeQL in the external-launcher `cd` quoting, the CI status report, and the workspace bloat scan report.

### Internal

- The publish script now recovers from a rebase left mid-flight by an earlier interrupted run (`resolve_stuck_rebase()`), instead of requiring the operator to run `git rebase --skip`/`--abort` by hand. This now runs unconditionally, before the first `package.json` read, because a stuck rebase leaves conflict markers in `CHANGELOG.md`/`package.json` that previously broke every mode's version read (even read-only ones like `audit`), not just the `full` mode's own git-sync step.
- A rebase conflict is now diagnosed instead of reported generically: if it is confined to `CHANGELOG.md`/`extension/package.json` and matches the script's own `chore: release vX.Y.Z` commit shape, and that version is already superseded by what is on `origin/main`, the script explains this and offers to skip the redundant commit (auto-confirmed in `--headless` mode, prompted interactively otherwise). Anything else still surfaces the real conflicting files for the operator to resolve by hand.
- A cut-but-unpublished version heading (`## [x.y.z] (unreleased)`, and separator/case variants like `- unreleased` or `-Unreleased`) is now recognized by the version-resolution tooling and stripped automatically once `git_commit_release()` runs — the first point after the actual marketplace publish has succeeded — so the release commit itself records that the version is genuinely out, not just cut.
- Added the "🎨 Customize" section to the root README, with a screenshot of the panel.

---

## [1.9.1]

You can now watch a GitHub repo the same way you watch a folder — get a toast when a new issue or pull request opens, right from the Watches view. [log](https://github.com/saropa/saropa-workspace/blob/v1.9.1/CHANGELOG.md)

### Added

- Watches can now target a GitHub repository, not just a folder or file. `Watch GitHub Repo for New Issues/PRs...` (from the Watches view toolbar or the command palette) links an `owner/repo`, signs you in to GitHub on first use if needed, and polls it on an interval (`saropaWorkspace.github.pollIntervalMinutes`, default 5) for newly-opened issues and pull requests. A repo watch shows up as a row in the same Watches view as folder watches — same unseen-count badge, same enable/disable/global/remove actions, same "click to open and clear the count" gesture, just pointed at a repo's GitHub page instead of a file. Draft PRs are included; edits/comments on an existing issue do not re-alert, only newly-opened items do.
- Adding a repo watch now offers optional label and author filters — leave both blank to alert on every open issue/PR (unchanged), or narrow to items carrying one of a set of labels and/or opened by a specific GitHub user.
- The "Watch GitHub Repo" prompt now prefills `owner/repo` from the active project's `origin` git remote when it points at GitHub, so watching the project you already have open is a single confirm.
- Manage Watches now offers a "Change repository" action on repo watches, so you can retarget an existing watch's `owner/repo` without losing its label, alert scope, or filters (which a remove-and-re-add would).
- A repo watch poll now logs a one-line warning to the "Saropa Workspace" output channel when GitHub's rate limit is close to running out (10 or fewer requests remaining), so several watched repos on a short poll interval give you a heads-up before fetches start silently failing instead of after.

### Changed

- `FolderWatch` gained an optional `kind` field (`"folder"` | `"repo"`); absent `kind` reads as `"folder"`, so every existing watch keeps behaving exactly as it did.
- The Launcher ("Quick Open") watch cards now render repo watches with the correct github glyph, kind text, and full `owner/repo` label instead of folder-watch defaults.

### Fixed

- Manage Watches: a disabled or global repo watch now shows the correct icon (eye-closed / globe) instead of always showing the github glyph regardless of state.
- Adding a repo watch with different casing (`Facebook/react` vs `facebook/REACT`) no longer creates a duplicate — GitHub slugs are case-insensitive.
- Pasting a slug with trailing whitespace into the "Watch GitHub Repo" input no longer triggers a false "invalid" validation error.
- Removing, disabling, or scoping out a repo watch now actually cleans up its cached items from memory — an earlier pass wired the cleanup into the same path folder watches use, but a repo watch never travels that path (it has no live `FileSystemWatcher` to disarm), so the cleanup silently never ran for any repo watch.
- The `/issues` and `/pulls` GitHub API calls now run in parallel instead of sequentially, halving per-repo scan latency.
- A repo watch's `owner/repo` target no longer runs through the folder-containment check meant for filesystem paths — it could accidentally alert (or fail to alert) in a project whose folder name happened to collide with the slug.
- A GitHub sign-in failure that isn't a plain decline (no auth provider registered, a network error mid-handshake) is now logged to the "Saropa Workspace" output channel instead of silently falling through to an unauthenticated fetch, which made a private repo's "never shows anything" behavior undiagnosable.
- A repo-watch poll that throws outside the per-watch scan (rather than being caught and logged there already) is now caught and logged too, so a single unexpected failure can no longer silently stop the polling timer from rescheduling itself.
- The toast's "Open" action and a repo-watch row's click-to-open now open the actual newest issue/PR — they previously picked by array position on a lexicographically-sorted composite key ("issue:9" sorted after "issue:80" as strings), which could open an older item instead of the newest one.
- A repo watch added with no project folder open (e.g. from the Command Palette in an empty window) no longer alerts nowhere forever — it now defaults to global so it has a home, since a repo slug (unlike a folder watch) has no "containing project" to fall back to.
- All repo watches now poll concurrently instead of one at a time, so N watched repos cost one poll tick's latency instead of N.
- The case-insensitive duplicate-slug check for repo watches (`Facebook/react` vs `facebook/REACT`) is now also enforced at the storage layer, not just in the "Watch GitHub Repo" command — a future add path that stores a watch directly can no longer bypass it.
- Adding two repo watches back to back (or a fast enable/disable toggle) could fire a duplicate pair of concurrent seed fetches for the same still-unseeded repo watch; now guarded.

---

## [1.9.0]

Publish-script hardening and automation — the release tool now recovers from a diverged `origin/main` on its own, runs unattended for agents and CI, and can report its results as machine-readable JSON. Nothing user-visible in the extension itself changed. [log](https://github.com/saropa/saropa-workspace/blob/v1.9.0/CHANGELOG.md)

### Changed

- The publish script now validates `--json-file` paths at startup — a missing parent directory is caught before the run begins rather than failing silently at the end after all steps have completed.
- The publish script now supports `--json-schema` to emit the JSON result schema and exit, so agents can validate their parsing logic without running a real publish.
- Added subprocess-level tests for `--json-file` and `--json-schema`.
- The publish script's stash/rebase/pop sequence now sleeps for a configurable number of seconds (default 3, `--rebase-debounce`) between the rebase completing and the stash pop, giving VS Code's file watcher time to settle before the working tree returns to its final state. Previously the intermediate rebase states caused false-positive churn in the file explorer (e.g. archived bug files briefly appearing as new). A rebase or stash-pop failure now leaves the working tree untouched and prints the exact recovery command (`git rebase --continue`/`--abort`, or `git stash drop`) instead of a bare failure message, and a `git fetch` failure is surfaced as a warning rather than silently comparing against a stale `origin/main`. This step also now writes a `.saropa-sync.json` coordination marker (git-ignored) naming the current stage while a sync is in progress, for a future watcher-side integration to consume; nothing reads it yet.
- The publish script now supports `--headless` mode for agent and CI use. All interactive prompts (mode menu, version prompt, PAT entry, failure handling, local install) are bypassed when `--headless --mode <mode>` is passed. Version defaults to the auto-computed value (override with `--version`), PATs must be pre-set as env vars, and step failures follow the `--on-failure` policy (`abort` | `ignore` | `retry`). The retry policy now gives each step its own single-retry budget (a step that retried and then succeeded no longer causes the next step to escalate straight to abort on its first failure), and `--on-failure=ignore` can no longer skip past a failed Git sync or a failed release commit/tag/push — those leave the repository in a state that is never safe to build on top of, so they always abort.
- The publish script now supports `--json` for machine-readable output. When passed, the logo, headers, and subprocess stdout/stderr are suppressed and a single JSON object is emitted to stdout at exit containing the mode, version, exit code, step timing (name, duration, pass/fail per step), and (for full publishes) store URLs. Useful for agents and CI dashboards that need to parse results programmatically.
- The `publish-existing` mode now records a full structured result (version, timing, exit code) for `--json` output. Previously it fell back to a minimal dict without timing data.
- The publish script now supports `--json-file <path>` to write the JSON result to a file at exit. Unlike `--json`, this does not suppress terminal output, so an agent or CI job can watch colored logs in real time while still capturing machine-readable results. Can be combined with `--json` for both stdout and file output.
- Added automated tests for the publish pipeline covering `StepTimer.to_dict()`, `_record_result` structure, `_run_publish_existing` result recording, and headless abort-policy behavior.

---

## [1.8.0]

Leaner UI, smarter activation, and a batch of reliability fixes — the toolbar is decluttered, the right-click menu is faster, case-insensitive filesystems finally work everywhere, and background runs no longer hoard memory. [log](https://github.com/saropa/saropa-workspace/blob/v1.8.0/CHANGELOG.md)

### Changed

- `Add to Project Shortcuts` is now a top-level entry on the Explorer right-click menu instead of being nested inside the `Workspace Shortcut` submenu, cutting the common "pin this file" action from three clicks to one. The submenu still holds it alongside the less-common actions (Add to Global Shortcuts, etc.) for parity with the editor context menu.
- The Shortcuts view title bar shows only Filter and Refresh inline now (down from up to six icons at once), matching VS Code's guidance to keep two to three actions in the title bar. `Run Any Shortcut`, `Open Schedule`, and the branch-visibility toggle moved into the `...` overflow menu; nothing was removed, only relocated.
- Extension activation is now prioritized by need: workspaces with a shortcuts file (`.saropa/saropa-workspace.json` or the legacy `.vscode/saropa-workspace.json`) activate first via `workspaceContains`; workspaces without one activate later via `onStartupFinished`, after higher-priority extensions have loaded. Combined with auto-generated `onView`/`onCommand` events, this gives VS Code maximum flexibility to order extension loading without breaking global scheduled shortcuts or custom config-dir setups.
- A background run's in-memory output capture (used for the completion toast, lint/test badge parsing, extract-and-copy, and "Diff Last Two Runs") is now capped at 1MB — the first 512KB plus the last 512KB, with a marker over the dropped middle — instead of growing without bound for the life of the run. A long-lived watch task or dev server that prints megabytes of output over hours no longer grows the extension host's memory unbounded; the Output channel itself still shows the full, untruncated stream live.

### Fixed

- Folder-relative path derivation (used when adding a shortcut, tagging a recipe, focus mode, and monorepo package-manager detection) no longer fails when a workspace folder's URI and a resolved file's URI disagree on casing — case-insensitive filesystems on Windows (NTFS) and macOS (HFS+/APFS) allow that, and the previous exact-case comparison would treat the file as outside its folder. Case sensitivity is now detected at runtime by probing the filesystem (not assumed from `process.platform`), so case-sensitive APFS volumes on macOS and case-insensitive ext4 on Linux are handled correctly. The path text shown or stored always keeps its original casing.
- Changing the configured shortcuts folder now recreates its file watchers at most once per burst of settings-change events, and only when the resolved folder actually changed — a settings-sync round-trip or a same-value write no longer tears down and rebuilds the watchers (briefly dropping watch coverage) for nothing.
- Ecosystem-aware auto-pin seeding at first activation no longer triggers one extra full rescan on top of the rescans its own config writes already trigger.
- The one-time "AI context default changed" notice no longer fires on fresh installs — only on upgrades where the old default actually applied.
- The Settings panel's revert-on-failed-save now restores the exact value a control held before that save attempt (a snapshot taken up front), rather than re-reading the configuration at failure time — the two could disagree if another change to the same setting landed while the failed save was in flight. The revert message is also skipped entirely if the panel was closed before the save finished, instead of posting into a webview that no longer exists.
- Removing a shortcut by any path (expiry sweep, file deletion, or set deletion — not just the explicit "unpin" command) now cleans up all per-shortcut tracking data: remembered prompt values, captured run output, lint/test badges, and routine briefs. Previously these maps leaked entries for the removed shortcut's id, and prompted values (persisted in workspace state) survived reloads indefinitely.

---

## [1.7.0]

Hardening pass on the bug-sweep fixes — stale defaults, missing guards, keybinding collisions — plus ecosystem-aware auto-pins and a proper "run selected shortcut" command. [log](https://github.com/saropa/saropa-workspace/blob/v1.7.0/CHANGELOG.md)

### Fixed

- Added the `Run Selected Shortcut` command (resolves the Shortcuts view's current selection and runs it directly), bound to `Ctrl+Alt+R` when the Shortcuts view is focused. `Run Shortcut…` (the QuickPick over every shortcut) is now bound to `Ctrl+Shift+R` globally, so both commands are reachable.
- Pin-running keybindings (`Run Top Pin 1-5`, `Run Any Pinned Script`, `Focus Pins View`) no longer fire while typing in the editor or terminal — they now require neither to have focus.
- `Run Top Pin 1-5` moved from `Ctrl+Alt+1..5` to `Ctrl+Shift+1..5` to avoid colliding with `AltGr+1..5` on European keyboard layouts.
- The AI-context recipe check in `aiContextRecipes.ts` now falls back to disabled when the setting is unset, matching the manifest default, instead of assuming it is on.
- Glob-pattern matching in the workspace hygiene scan now uses the shared `globToRegex` helper instead of a second, inline implementation that could drift from it.
- Byte-size formatting no longer shows `NaN` or `Infinity` for malformed or out-of-range inputs; it now falls back to a safe default.
- Removed the hardcoded `flutter.dance` default from the shortcut store's project-file groups — non-Flutter projects no longer see it.
- Package-manager detection now walks up parent directories to find the nearest lockfile, so it correctly identifies the package manager for projects inside a monorepo.

### Added

- `runSelectedShortcut` command to run whichever shortcut is currently selected in the tree.
- Ecosystem-aware auto-pin seeding at first activation, recognizing Flutter, Django, Cargo, and Go projects in addition to the existing defaults.
- A one-time notice on upgrade informing users that the `aiContext.enabled` default is changing to off.

---

## [1.6.13]

Thirteen bug fixes in one pass — package-manager detection, accessibility, i18n, sensible defaults, and cleanup of duplicated code across the board. [log](https://github.com/saropa/saropa-workspace/blob/v1.6.13/CHANGELOG.md)

### Fixed

- A corrupt legacy `.vscode/saropa-workspace.json` no longer crashes activation — the migration step that reads it now skips a file it cannot parse (logging why) and continues checking the other known config locations, instead of throwing.
- "Run nearest script" now detects the project's actual package manager (pnpm, yarn, bun, or npm) from its lockfile instead of always running `npm run`, so the launched command matches what the project actually uses.
- The Launcher panel no longer rescans the project file list on every single file save in the workspace — rapid saves now coalesce into one rescan, cutting needless disk activity while you work.
- Changing the configured shortcuts folder at runtime now re-registers the config-file watcher for the new location instead of only watching the folders known at startup, so hand edits to the new folder's `saropa-workspace.json` trigger a refresh without a reload.
- Removing a shortcut now also clears its watch-cooldown and repeat-invocation-guard timestamps, instead of leaving them in memory for the rest of the session — long-running windows with frequent shortcut churn no longer accumulate stale entries.
- The Suite daily report now writes through the workspace filesystem API instead of Node's raw `fs`, so it saves correctly under Remote SSH, WSL, Containers, and Live Share. Locking a file now shows an explanatory message on a remote or virtual filesystem, where the OS read-only attribute cannot be toggled from here, instead of silently failing.
- Shortcuts tree rows now announce their live state (running, stopping, waiting on a dependency, paused, missing, not yet opened) to screen readers, the separator row announces as "Separator" instead of forty dashes, and the Launcher panel's right-click menu now identifies itself as a menu with proper item roles to assistive technology.
- Default auto-pin patterns and project file groups no longer assume a Dart/Flutter project — auto-pins now look for `package.json`, `README.md`, `Makefile`, and `.env.example`, and the project files "Project" group drops the Dart-only entries; the Flutter-only `Android`/`iOS`/`Web` groups are removed. Non-Dart projects now get useful results out of the box.
- The AI-context feature (scanning `.claude`, `.cline/tasks`, and similar chat-transcript folders) now defaults to off, so the extension never reads potentially sensitive session history without the user explicitly turning it on.
- The Shortcut Expiry submenu no longer carries the "(Time-Bomb)" label — it reads "Shortcut Expiry".
- File-size badges, the note size shown after saving, and the size-limit shown when setting a metric threshold now report a decimal for two- and three-digit KB/MB/GB values (e.g. "20.0 KB" instead of "20 KB") — four near-identical byte-formatting functions were consolidated into one, and this one rounds consistently with the process monitor and project-stats report, which already formatted this way.

### Added

- Default keybindings for the top 5 pinned shortcuts (`Ctrl+Alt+1`-`Ctrl+Alt+5`, `Cmd+Alt+1`-`Cmd+Alt+5` on macOS), adding the active file as a shortcut (`Ctrl+Alt+A`), focusing the Shortcuts view (`Ctrl+Alt+S`), and running any shortcut via quick pick (`Ctrl+Alt+R`) — previously only Peek (`Alt+P`) had a default binding.

---

## [1.6.12]

Closes the remaining path where a stray Enter could relaunch a script, and adds a backstop against any repeat launch of the same shortcut. [log](https://github.com/saropa/saropa-workspace/blob/v1.6.12/CHANGELOG.md)

### Fixed

- Macro shell steps now also focus their terminal on launch (the same fix as 1.6.11, extended to `actionRunner.ts`'s shell-step terminal)
- A repeat launch of the same shortcut within half a second of the first is now ignored, guarding against any other focus-stealing path producing the same symptom

---

## [1.6.11]

Stray Enter no longer relaunches your script. [log](https://github.com/saropa/saropa-workspace/blob/v1.6.11/CHANGELOG.md)

### Fixed

- Terminal now receives focus when a script launches, preventing an accidental Enter in the tree view from re-triggering the shortcut

---

## [1.6.10]

Pinned Windows scripts and executable files can now be run directly without extra interpreter setup. [log](https://github.com/saropa/saropa-workspace/blob/v1.6.10/CHANGELOG.md)

### Fixed

- **Batch files and other Windows executables are recognized as runnable** — a freshly pinned `.bat`, `.cmd`, `.exe`, or `.com` file with no configured interpreter and no shebang is now offered as a run target instead of falling back to open-the-file, since the shell executes these directly without an interpreter prefix.
- **Configure Run panel's empty-command hint no longer says "opens the file"** for those same batch/executable file types — it now says the file runs directly, matching what actually happens when the command box is left blank.

---

## [1.6.9]

Fixes a bug where running a script "in an external window" would show the launched toast but never actually open a window. [log](https://github.com/saropa/saropa-workspace/blob/v1.6.9/CHANGELOG.md)

### Fixed

- **External window launches now actually open the window** — the outer PowerShell wrapper no longer runs detached. VS Code's host process runs child processes inside a Windows Job Object that denies breakaway, so a detached wrapper's internal `Start-Process` call silently failed to create the target window (exit code 0, no error) while reporting success. The wrapper's own console is now hidden instead, so only the real external window is visible.

---

## [1.6.8]

This release adds standard dialog keyboard shortcuts, auto-generated names, and content-based tag suggestions to the Customize panel. The Launcher now includes a recent-workspaces quick-pick when no folder is open. Bug fixes address webview disposable leaks, unclosed stderr streams during failed process spawns, and silently swallowed PowerShell errors. [log](https://github.com/saropa/saropa-workspace/blob/v1.6.8/CHANGELOG.md)

### Improved

- **Customize panel: name suggestion** — the name field pre-populates with a title-cased guess from the filename (strips extension, replaces underscores/hyphens with spaces), so the friendly name is one Save away instead of typed from scratch.
- **Customize panel: content-based tag suggestions** — "From file" chips suggest tags derived from the file's word frequency (excluding grammar and common programming keywords), weighted toward longer, more meaningful words.
- **Customize panel: color swatch selection** — the selected color swatch now shows a visible focus ring, making the active tint unmistakable in all themes.
- **Launcher: "No folder open" is now a clickable link** — clicking it opens a recent-workspaces quick-pick (up to 5 entries, most recent first) with a "Browse…" fallback that opens a file picker filtered to JSON config files. Selecting an entry opens the containing folder as the workspace. On first use (no history), the file picker opens directly.
- **Tree tooltip: tint color name** — hovering a shortcut with a custom tint now shows the color name (e.g. "Tint: Red") in the tooltip, confirming which color was applied without opening Customize.
- **Customize panel: keyboard shortcuts** — `Ctrl+Enter` (`Cmd+Enter` on macOS) saves, `Escape` cancels, matching VS Code's standard dialog conventions.

### Fixed

- **Custom color tinting now renders correctly** — user-selected tint colors from the Customize panel (the 20-swatch palette) now display their actual color in the launcher panel instead of falling back to gray when the webview cannot resolve extension-contributed CSS variables. Switching themes now refreshes tints immediately.
- **External window launches now surface errors** — if the outer PowerShell process fails to open a new window (e.g. `Start-Process` errors), the failure is now captured and shown as an error toast instead of silently swallowed after a false "launched" success toast.
- **Launcher: view-scoped disposable leak** — webview event listeners are now properly disposed when the launcher panel view is hidden and re-shown, preventing accumulated dead listeners across resolve cycles.
- **External launcher: stderr cleanup on spawn error** — the piped stderr stream is now destroyed when the child process emits an error event without a subsequent exit, preventing a resource leak on ENOENT/EACCES failures.
- **Customize panel: swatch selector hardened** — the CSS selector for color swatch lookup now escapes the color id, preventing a DOMException from corrupted config values.
- **Launcher: note path validation** — opening a note from the launcher now validates the path against the note store before opening, matching the same validation pattern files and watches use.

---

## [1.6.7]

Upgrades the daily routine experience with the visual Saropa Morning Brief and smarter standup digests that highlight actionable project growth over automated noise. Background runs are now quieter by default, and new settings allow power users to disable start-up notifications entirely. [log](https://github.com/saropa/saropa-workspace/blob/v1.6.7/CHANGELOG.md)

### Added

- New "Show run toasts" setting (`showRunToasts`, on by default) — turn it off to suppress the "Running…" and "Launched…" start toasts across all run locations, for power users who rely on the output channel instead. Error and completion toasts from background runs are unaffected
- Saropa Morning Brief — a briefing screen that opens after a routine run with a verdict band ("All clear" / "Needs attention"), per-member cards with status glyphs and headlines, and one-click report access; the markdown summary remains on disk and one click away via the "Open full summary" footer button. The `Open Saropa Morning Brief` command opens the most recent brief at any time
- Share dropdown in the Morning Brief footer groups export actions (Copy as Markdown, Open in browser, Save as HTML) behind a single "Share" button; the primary "Open full summary" button remains top-level for quick report access

### Changed

- Standup digest classifies commits — security findings listed first, then features, fix groups by area — and folds generated churn (machine-translation sweeps, large chore commits) into a single summary line; the raw log stays one click away inside a details block
- Project stats leads with the day-over-day delta ("+3,412 lines, +12 files since the last report") instead of repeating the same static census every morning; the dominant-language share clause appears only when it moved by at least 0.5 percentage points
- A clean scheduled morning routine no longer opens the summary window; the completion toast and status-bar flash link it. Manual runs and any run needing attention still open it

### Fixed

- Running a script in an external window no longer shows two toasts ("Running…" and "Launched…in a new external window"); only the location-specific toast appears

### Internal

- Added JSDoc documentation to all 30 previously undocumented exports across 7 modules (ciStatus, overnightDelta, promptTokens, scheduleStatusBar, scheduleStatusBarActions, setParamsPanel, shortcutsTreeProvider)
- Split the 5 longest functions into named helpers: `setupSecondaryViews` (211 → ~20 lines), `writeRoutineSummary` (155 → ~40 lines), `handleLauncherMessage` (155 → ~50 lines), `buildAllItems` (90 → ~10 lines), and the `ShortcutTreeItem` constructor annotation branch
- Extracted `syncViewCount` and `CountProvider` into a shared `views/viewCount.ts` module, replacing 5 identical closures across `wiringViews.ts` (4) and `wiringWatchers.ts` (1); the view parameter uses a narrow structural type so any `TreeView<T>` is accepted regardless of `T`
- Morning Brief panel uses a webview-initiated ready handshake instead of a `setTimeout(50)` race; on tab restore the recreated script posts `ready` and the host responds with data, eliminating the timing race
- Error messages surfaced from brief export actions use `errorMessage()` to extract `.message` from Error objects, avoiding raw stack traces in user-facing toasts
- All brief file writes (temp files and save-dialog paths) use `fs/promises` consistently instead of mixing `vscode.workspace.fs` with Node FS
- Project stats marker embeds a version field (`v: 1`) so future format changes can be detected; `parseStatsMarker` rejects markers with `v` above the current version

---

## [1.6.6]

Quickly share notes in plain text, Markdown links, or rich HTML, and enjoy a cleaner, keyboard-navigable Launcher context menu with organized submenus. [log](https://github.com/saropa/saropa-workspace/blob/v1.6.6/CHANGELOG.md)

### Added

- "Copy Note Content" inline button and context menu action — reads the full note file and copies it to the clipboard, with a toast naming the file. Files over 5 MB or with binary content are refused with a specific warning
- "Copy as Markdown Link" context menu action on notes — copies `[filename](relative-path)` for referencing notes in other documents
- "Copy as HTML" context menu action on notes — converts Markdown to HTML before copying, so pasting into rich-text editors (Slack, email, Google Docs) preserves formatting (headings, bold, italic, code blocks, links, lists, blockquotes, horizontal rules)
- Notes stat in the Launcher panel stat bar now shows even when the note count is zero, so the Notes pane toggle is always reachable

### Hardened

- Copy Note Content eliminates a time-of-check/time-of-use race by reading the file once and checking `byteLength` on the buffer, instead of running `stat` before `readFile`
- Binary detection now catches UTF-16 LE and BE byte-order marks before the null-byte scan, preventing garbled clipboard content from non-UTF-8 text files
- Copy as Markdown Link falls back to the bare filename when the note is stored outside the workspace (global notes), instead of embedding an absolute path that is non-portable
- Launcher webview context menu now groups Configure & Schedule, Appearance, and File Actions into hover-expandable submenus so the menu fits on screen; Open, Run, Rename, and Remove stay at the top level for quick access; full keyboard navigation (Up/Down to move, Right to open submenu, Left/Escape to close it)

---

## [1.6.5]

Manage all your extension preferences in one place with a dedicated Settings panel, and give your shortcut names a cleaner look with optional title-casing. [log](https://github.com/saropa/saropa-workspace/blob/v1.6.5/CHANGELOG.md)


### Added

- **Settings panel** — a new "Open Settings" screen (`Saropa Settings`) surfaces every extension preference in one place, organized into sections (General, Display, Terminal, Suggestions, Recipes, Sound, Process Monitor, Hygiene, Project Files, Advanced), each setting with a live control and an info icon showing its description. A search bar at the top filters settings by name or description. Number inputs enforce the schema-defined minimum per setting. Accessible from the command palette, the Shortcuts view overflow menu, and a gear icon in the Launcher tab header.
- **Title-case display names** — a new `displayNames.titleCase` setting (off by default) strips the file extension, replaces underscores and hyphens with spaces, and capitalizes each word wherever a shortcut name appears. For example, `setup_arb_translate.py` becomes `Setup Arb Translate`. Only affects shortcuts without a custom label.
- **Centralized display-name resolution** — all surfaces (tree row, launcher card, panel titles, toasts) resolve shortcut names through one function (`shortcutDisplayName`) so the title-case preference applies uniformly.

---

## [1.6.4]

The Launcher panel now has a Notes pane, sortable pane headers, and a smarter schedule status-bar indicator with configurable lead time. [log](https://github.com/saropa/saropa-workspace/blob/v1.6.4/CHANGELOG.md)

### Added

- Notes pane in the Launcher panel — shows project and global notes as cards with filename, relative time, and a content preview in the expanded drawer
- Notes stat chip in the header toggles the Notes section on and off
- Recipes stat chip in the Launcher header — shows the recipe count and toggles the Recipes section on and off, matching the other pane toggle chips
- Pane header click cycles the sort order: Grouped → A–Z → Z–A, with a sort indicator icon and label
- "Just ran" flash on the schedule status-bar indicator — after a scheduled run completes, the indicator shows a check mark and the completion time for 2 minutes, one click away from the report
- New `scheduleStatusBarLeadMinutes` setting controls how far in advance the status-bar indicator appears (default 30 minutes, set to 0 for run-time only, 1440 for always-visible)

### Changed

- Schedule status-bar indicator is now compact (time only, name in tooltip) and only appears within the configured lead-time window
- Recipes pane icon changed from clock to lightbulb to distinguish it from the scheduled-run count

### Removed

- Chevron collapse controls from Launcher pane headers — replaced by the sort-cycling click and the header stat chip toggles

---

## [1.6.3]

The Launcher panel gets a usability overhaul with new section visibility toggle chips, a convenient one-click reset button to restore hidden panes, and a smoother startup experience with a new loading indicator. [log](https://github.com/saropa/saropa-workspace/blob/v1.6.3/CHANGELOG.md)

### Added

- An eye-icon reset button appears in the header when any section is toggled off — one click restores all sections to visible

### Changed

- Launcher panel shows a loading indicator on startup instead of a blank header until data arrives
- Launcher header stat chips are now section visibility toggles (on/off) instead of pane filters — each chip independently shows or hides its section, with dimmed styling when off
- The "scheduled" count is now an informational label (not a toggle), since scheduled cards live inside My shortcuts
- Removed the folded-sections strip; pane visibility is controlled entirely from the header stat chips

---

# Changelog Archive

The archive for older versions is [CHANGELOG_HISTORY.md](./CHANGELOG_HISTORY.md).
