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

## [1.5.23]

Browse and run your bundled scripts directly from the new sidebar or Launcher panel, complete with smart warnings if you're missing a required tool and polished button styles. [log](https://github.com/saropa/saropa-workspace/blob/v1.5.23/CHANGELOG.md)

### Added

- New **Scripts** sidebar view: browse the bundled script library grouped by tag, with an inline Run button per script. The Run command synthesizes a shortcut from the manifest entry and routes through the existing run pipeline (interpreter resolution, token expansion, terminal/background routing all work unchanged). A Refresh command reloads the manifest.
- New **Scripts** section in the Saropa Launcher Panel: bundled scripts appear as tinted cards alongside shortcuts, recipes, watches, and project files, with a Run head button and a header filter chip showing the script count.
- Scripts declaring tool requirements in the library manifest (e.g. device-connect's `adb`) now get a pre-flight PATH check before running: a missing required tool shows a named diagnostic toast instead of a mid-script terminal failure. A tool marked optional never blocks the run.

### Fixed

- An expanded launcher card's head Open/Run button now renders identically to the drawer buttons below it: same internal padding, same total height (a matching border thickness), and same icon size. Collapsed cards keep the compact icon-only button. Each shared value is defined in one place alongside the shared label size, so the two button styles cannot drift apart.

## [1.5.22]

**Overview** — One report for your whole day across the Saropa tools. "View Suite Daily Report" shows what ran, what failed, and what the other installed Saropa extensions (Log Capture, Lints, Drift Advisor) saw today and yesterday — all read from your machine, nothing sent anywhere. [log](https://github.com/saropa/saropa-workspace/blob/v1.5.22/CHANGELOG.md)

### Added

- New bundled **script library**: the extension now ships a set of self-contained, ready-to-run developer scripts, each its own folder with an editable run config, tags, and a declared list of the command-line tools it needs. Two to start: **Organize output folder** (sorts a folder's loose files into dated `YYYY.MM/YYYY.MM.DD` subfolders and prunes the empty folders left behind) and **Connect a device for debugging** (connects a physical Android device to Flutter over Wi-Fi or USB, mirrors the screen with scrcpy, and reports battery/charging health — asking before installing its Python dependencies, and telling you up front if a required tool like `adb` is missing). A dedicated Scripts view to browse and run them from the sidebar is coming next.
- New **View Suite Daily Report** command: a read-only Markdown summary with an executive summary, a Trouble section (failures and high-impact items only), today's Workspace shortcut activity, and a per-tool section for each installed Saropa Suite extension that exposes the versioned `getDailySummary` exports API (today and yesterday). Tools that are absent or predate the API are simply omitted — a solo install renders a workspace-only report. Also reachable from the Diagnostics submenu.

### Changed

- The routine summary is now the day's actual content, not an execution table. The one document a routine opens merges each member report's full body in as a section (the standup digest, project stats, PR queue — readable in place, with a link to each source file), instead of a table of statuses, durations, and links. Execution state appears only when something went wrong: a failed or missing member gets one attention line at the top saying what happened and what to do. A clean run reads as pure content.
- Routine summary sections are collapsible: each member's content sits in a click-to-expand block, so a multi-member morning report opens as scannable one-line headers — and a failed member's section arrives pre-expanded. Failure details are flattened to one bounded line (the full error stays in the output channel), and a member report that is not Markdown (a .log or .txt) is shown as preformatted text instead of being mangled as prose.
- The Suite Daily Report guards against a hung sibling extension: any single sibling activation or summary call past five seconds is dropped and that tool's section is omitted, instead of the whole report hanging.
- The Suite Daily Report names a version-skewed tool instead of hiding it: an installed Suite extension reporting a newer data format than this version understands gets a one-line note under the executive summary ("update Saropa Workspace to include its section") rather than silently vanishing. Collecting the summaries also shows a status-bar progress note while siblings are polled.
- New **Saropa Suite daily report** recipe (scheduled ritual, default 06:30, seeds disabled): writes the Suite day summary as a dated report file, and joins the Morning routine as its closing member — so yesterday's debug sessions, lint health, and database anomalies merge into the same one morning document as the standup and stats.

### Fixed

- Launcher card buttons now share one label size: the Run/Open button on a card's header rendered its text larger than the Open/Copy path buttons in the expanded drawer; all launcher buttons now use the drawer's smaller size, defined in one place so the two cannot drift apart again.

## [1.5.21]

**Overview** — The "you've opened this file a lot, want a shortcut?" prompt used to fire while you were just flipping between files during normal work. Now it counts a file at most once every half hour, needs more opens before it asks, and lets you shut off a whole file type ("Ignore .dart") straight from the prompt. [log](https://github.com/saropa/saropa-workspace/blob/v1.5.21/CHANGELOG.md)

### Added

- The open-often shortcut suggestion now offers "Ignore .ext" alongside Add shortcut and Don't ask again. Choosing it adds that extension to the new `saropaWorkspace.suggestions.ignoreExtensions` setting, so files of that type are never suggested again.
- New `saropaWorkspace.suggestions.debounceMinutes` setting (default 30): a file re-focused within this window counts once, so the count tracks distinct working sessions rather than tab flipping.

### Changed

- Re-focusing the same file (search, go to definition, tab flipping) no longer inflates its open count — a per-file cooldown collapses a burst of re-focus into a single count. This stops the suggestion firing during ordinary development.
- Raised the default open-count threshold before a suggestion appears from 6 to 10 (`saropaWorkspace.suggestions.openThreshold`).

## [1.5.20]

**Overview** — A morning routine used to fling open a tab for every check it ran and keep the one summary that ties them together closed. Now it opens exactly one document: the summary, with a link to each check's report. The "next scheduled run" item in the status bar also stops being a dead end — click it to open that report, change the time, run it now, turn the schedule off, or hide the item for good. [log](https://github.com/saropa/saropa-workspace/blob/v1.5.20/CHANGELOG.md)

### Added

- Clicking the next-scheduled-run status-bar item opens an action menu: open the last report, open the Saropa Schedule screen, run it now, reveal it in the Shortcuts view, change when it runs, turn its schedule off, or hide the item. It previously only revealed the shortcut in the tree, which answered none of the questions the item raises.
- A new `saropaWorkspace.showScheduleStatusBar` setting hides the next-run indicator. Hiding it stops the indicator only; scheduled runs continue.

### Fixed

- A routine now opens exactly one document — its summary, which links every member's report — instead of one editor tab per member. Members run with their own report auto-open suppressed. The suppression covers that routine's own run only, so a report you open by hand while a scheduled routine is working still opens.
- Turning a schedule off from the status-bar menu keeps the time or cron it was set to, rather than writing back whatever the schedule held when the menu opened.
- A routine opens its summary on every run, not only when a member failed. A clean run used to finish silently, leaving no way to reach the reports it had just written.
- Both status-bar items now name themselves, so VS Code's own right-click "Hide" menu says which one it will hide. They both read as the extension's display name before.

---

## [1.5.19]

**Overview** — Running a second script while an earlier one was still busy used to type its command straight into that first script's terminal instead of opening its own. Every run now opens its own fresh terminal tab, so scripts running at the same time — or the same script run twice in a row — never collide. [log](https://github.com/saropa/saropa-workspace/blob/v1.5.19/CHANGELOG.md)

### Fixed

- Running a shortcut in the integrated terminal now opens a brand-new terminal tab every time instead of reusing one shared terminal for every run. Launching a second script while the first was still busy (a long process, a prompt waiting on input) used to send the second script's command line into the first script's terminal instead of a new one.

---

## [1.4.18]

**Overview** — In the Saropa Launcher, a project file card now shows its Open icon even while the card is collapsed, so you can open the file in one click without expanding it first — the same one-click Open the files in My shortcuts already had. [log](https://github.com/saropa/saropa-workspace/blob/v1.5.18/CHANGELOG.md)

### Changed

- Project Files launcher cards lead with an **Open** head button, so the go-to-file icon is visible in the collapsed grid instead of only after expanding the card (matches a document shortcut in My shortcuts). The Watches pane keeps its expand-then-act model, because opening a watch also clears its unseen counter.
- The launcher's drawer action buttons (Open, Copy path, Pin, Schedule) are 1px taller so their label text sits centered against the button's icon.

### Internal

- Reorganized the extension's largest source files (the launcher, dashboard, and planner webviews; the shortcut store; the run-configuration and folder-watch commands; activation wiring) into smaller, single-purpose modules, broke up the longest functions into named helpers, and added explanatory comments to every previously undocumented exported symbol. No behavior change.

---

## [1.5.18]

**Overview** — The number badge on the sidebar icon (the count of shortcuts you had not opened yet) is gone. Opening the sidebar does not "use" a shortcut, so the number would not clear when you clicked the icon, and on its own it never said what it was counting. The small dot next to a shortcut you have not opened or run yet stays — it marks the exact rows without needing an aggregate number. Daily reports also read far better now: command output is shown in proper code blocks instead of running together, the morning routine's summary links straight to each report it ran, and a pubspec project gets a dependency-freshness report that lists only the packages that are actually out of date. [log](https://github.com/saropa/saropa-workspace/blob/v1.5.17/CHANGELOG.md)

### Added

- Pubspec dependency-freshness report that lists only the packages behind their latest version — up-to-date dependencies are omitted, so the report is just the items you can act on. Built by parsing `dart pub outdated --json`, it opens only when something is stale and flags discontinued packages inline.
- The morning routine now includes the tech-debt/TODO harvest and the dependency-freshness check as members, so the daily report covers lint issues, TODO markers, and out-of-date packages — not only the git and PR digest.

### Changed

- Running a shortcut in an external window (the "new OS window" location) now opens a PowerShell window instead of a plain `cmd.exe` one, and the command is seeded into that window's history — so after it runs you can press up-arrow to rerun it in the same window without retyping. `cmd.exe` could not do this: a command it runs at launch never enters the up-arrow history. The window still cd's to the shortcut's folder first and stays open after the command finishes. Note: because the shell is now PowerShell, a command that relied on `cmd`-only syntax (`%VAR%`, `dir`, `&` chaining) may behave differently.
- Scheduled reports (standup, end-of-day, tech-debt, branches, journal, PR queue) now render the captured command output inside a fenced code block, with a cleaner Markdown header. A `git log --stat` or `git status` dump no longer renders as mangled prose; an empty result reads as an explicit "No output." line.
- The morning-routine summary now carries a Report column that links each member's own report relative to the summary file, so the summary is the one clickable index over the day's sub-reports.

### Removed

- The activity-bar count badge on the Shortcuts view. It counted shortcuts not yet opened or run, but clicking the sidebar icon never cleared it (opening the view is not opening a shortcut) and the bare number did not convey what it referred to. Repeated fixes to the counting logic left that mismatch, so the badge is removed entirely. The per-row "untapped" dot remains as the discovery cue.

---

## [1.5.16]

**Overview** — Right-click a script shortcut and choose "Duplicate with Argument" to make a second copy that runs the same file with a different argument — the new item is named after the original with the argument added (for example "setup_arb_translate.py -o"), and you can rename it. The sidebar count badge for unused shortcuts now clears to zero once you have opened or run every shortcut. Comment and separator rows are no longer counted, so a divider in your list can no longer leave the badge stuck on a number you could never clear. [log](https://github.com/saropa/saropa-workspace/blob/v1.5.16/CHANGELOG.md)

### Added

- "Duplicate with Argument" on a file shortcut's right-click menu (under the configure/run submenu): prompts for an argument line — pre-filled with the shortcut's current arguments — and a name that defaults to the original name with those arguments suffixed. The duplicate points at the same file and keeps the source's run configuration (interpreter, working directory, environment, run location), changing only the arguments and the name. A duplicate of a screen-share-protected shortcut stays protected. It deliberately does not inherit the source's schedule or triggers, so a run variant never double-schedules the script. The new item is inserted directly below the original.

### Fixed

- The activity-bar untapped-shortcut badge counted comment and separator rows, which have no open/run action and so could never be marked used — leaving the count stuck above zero permanently and pointing at rows that show no marker. Annotation rows are now excluded from the count, matching the leading-dot marker (which already skips them), so the badge clears exactly when every actionable shortcut has been used.

---

## [1.5.15]

**Overview** — Python shortcuts configured with the Unix `python3` name now run on Windows instead of failing with "Python was not found." [log](https://github.com/saropa/saropa-workspace/blob/main/CHANGELOG.md)

### Fixed

- **A `python3` shortcut now runs on Windows.** On Windows the bare name `python3` is only a Microsoft Store alias stub that prints "Python was not found" instead of running, so a shortcut configured with the Unix interpreter name (in its Run command or a `#!/usr/bin/env python3` shebang) never reached a real interpreter. A leading `python3` is now rewritten to `python` on Windows, preserving any trailing flags (`python3 -u` becomes `python -u`). A versioned name (`python3.12`) or an absolute interpreter path is left exactly as you wrote it.

---

## [1.5.14]

**Overview** — A brand new Schedule dashboard keeps track of your automated runs (and catches up on missed ones), plus you can now pin one-click shortcuts to your essential project websites. [log](https://github.com/saropa/saropa-workspace/blob/v1.5.14/CHANGELOG.md)

### Added

- **A Schedule screen that shows every scheduled shortcut at a glance.** A new **Open Saropa Schedule** command (and a calendar button in the Shortcuts view's title bar) opens one screen listing every shortcut with an enabled schedule, each with its next run, whether its last run succeeded, failed, is overdue, or has not run yet, and a one-click **Open report** link to the report that run wrote. A **Run now** button runs any item on the spot. The screen updates itself live as runs complete.
- **Scheduled runs now tell you how they went.** When a scheduled shortcut or a routine (a recipe of recipes, like a morning routine) finishes, it shows a toast naming the shortcut and its outcome, with an **Open report** action when it wrote one — successes are no longer silent. Failures still open their report automatically.
- **Catch up runs missed while VS Code was closed.** Each schedule now has a **Catch up missed runs** option in the Schedule editor. When on, a run that was due while the folder was closed runs once the next time you open it. When off (the default), missed runs are not run silently — they are marked **Overdue** on the Schedule screen and offered in a startup prompt with a **Run now** action, so nothing heavy fires unexpectedly.

- **Website (URL) shortcuts you can add by hand.** A new **Add Website (URL)...** command (in the Shortcuts view's add menu, in both project and global scope) lets you pin any website — the project's GitHub page, a staging dashboard, a docs site — alongside your file and script shortcuts. Enter the address (a bare `github.com/saropa` is treated as `https://`) and an optional display name. A **single click opens the site directly** in your browser, the same one-click gesture a file shortcut uses; a website is safe and instant, so it does not take the show-info-first path the heavier script and command shortcuts use. The shortcut carries a blue link icon and can be grouped, tagged, renamed, and reordered like any other.
- **Find the project's websites for you.** A new **Add Website Shortcuts from Project...** command (also in the add menu) reads the addresses your project already declares — the repository page, issues, releases and CI from the git remote, the deployed site and package/marketplace listing from `package.json` / `pubspec.yaml` / `pyproject.toml`, and the docs site from `mkdocs.yml` — and offers them in one checklist. Every address is pre-checked, so you confirm with Enter or uncheck the few you do not want; each pick becomes a project website shortcut. Addresses you already pinned are left out, so running it again only shows what is new. It reads these known files directly — it does not scan your source for links — so the list stays short and relevant.

---

## [1.5.13]

The Sunrise project stats recipe no longer hangs, and every dated report is now filed in a per-day folder named with the date. [log](https://github.com/saropa/saropa_workspace/blob/v1.5.13/CHANGELOG.md)

### Changed

- **Dated reports are now grouped into a per-day folder.** Instead of every report landing loose in `reports/`, each one is written to `reports/<date>_workspace/` — for example `reports/2026.06.29_workspace/2026.06.29_workspace_100046_project_stats.md`. The `workspace` tag sits right after the date in both the folder and the file name, so a day's standup, branches, stats, PR queue, and morning-routine reports sit together and are identifiable when several tools share one `reports/` folder. The Trends tab still finds them: report discovery now scans the per-day folders as well as any older loose reports, so existing history is not lost.

### Fixed

- **The "Sunrise project stats" recipe could hang forever on "Collecting project stats".** Its contributor summary ran `git shortlog` without a commit range; with no range, git reads commit data from standard input and, run from the extension, sat waiting on a pipe that never closed — the notification stuck and the git process idled at 0% CPU. The command now passes an explicit `HEAD` range so it walks history instead, and every git call in the recipe carries a 30-second timeout so no sub-command can stall the report again.

---

## [1.5.12]

Documentation catch-up so the README reflects the launcher and Project Files work from recent releases, plus the Watches view now lists only the watches that belong to the project you have open. [log](https://github.com/saropa/saropa_workspace/blob/v1.5.12/CHANGELOG.md)

### Changed

- **The Watches view shows only this project's watches now.** A watch belongs to the project that contains the folder or file it watches, and that project always sees it. Other projects' watches no longer appear here at all — the confusing "not alerting here" rows are gone. A watch you deliberately want everywhere can be marked **global** (Manage Folder Watches → "Make global"); a global watch shows in every project with a globe icon and a "global" note so it is never mistaken for a local one.
- **README Screenshots section now shows a screenshot.** The "Screenshots are coming" placeholder is replaced with an actual screenshot of the sidebar and launcher, served from an absolute raw GitHub URL so it renders on the VS Code Marketplace.
- **README now describes the launcher as it actually is.** The overview was rewritten for the current four-pane board (My shortcuts, Recipes, Watches, Project files) with its header — project name, version, and click-to-filter counts — per-pane icons, the search box with the count tucked inside, and cards that lead with Run or Open per file. It also drops the stale "Copy as Saropa Link" launcher-menu item that no longer appears on launcher cards.
- **README documents Project Files area grouping and the renamed setting.** The Project Files entry now notes the Project / Android / iOS / Web grouping, and the settings table replaces the removed `saropaWorkspace.projectFiles.files` with `saropaWorkspace.projectFiles.groups`.
- **The schedule editor tab is now titled "Saropa Workspace Scheduler".** The per-schedule editor, previously "Saropa Schedule: {name}", reads "Saropa Workspace Scheduler: {name}" so its tab and heading name the product in full.
- **Launcher card detail text is slightly larger.** The description shown in an expanded launcher card's drawer grew from `0.9em` to `0.97em` (with a touch more line spacing) so the detail reads more comfortably.
- **Expanded launcher card buttons are all blue now.** The drawer's Open, Copy path, Pin, and Schedule actions used the secondary gray style and read as flat labels rather than buttons. They now use the primary blue style, matching the head's Run/Open button, so every action looks tappable.

### Fixed

- **A watch on a project's own folder can no longer read "not alerting here".** Watches are stored globally and were listed in every window with out-of-project ones flagged as silent, which looked like broken data. The Watches view now filters to the watches that fire in the open project, and the activity-bar count is scoped the same way, so one project's pending files never show up in another's badge.
- **The launcher header's "scheduled" chip now filters to only scheduled items.** Clicking it had revealed every shortcut, because the chip was filed under the same "My shortcuts" pane as the shortcuts count, so it narrowed to the whole pane instead of the scheduled subset. The chip is now a cross-pane filter keyed on each card's schedule state, so clicking it shows only the shortcuts whose schedule is switched on.

---

## [1.5.11]

Each launcher pane now carries its own icon and shrinks to just its header when you fold it, the search box is simpler with the shortcut count tucked inside it, and cards drop the kind pill for a tooltip. [log](https://github.com/saropa/saropa_workspace/blob/v1.5.11/CHANGELOG.md)

### Changed

- **Each launcher section now leads with its own icon, and collapsing a section also collapses its width.** The four panes — My shortcuts, Recipes, Watches, Project files — each carry a glyph in their header matching the section's filter chip, so a pane is identifiable at a glance even when folded. Folding a section now shrinks it to just its header instead of holding a full column, freeing the row for the sections still open.
- **The launcher search box hint now reads "Search", and the shortcut count moved inside the box as a badge.** The placeholder is the single word "Search"; the running count that sat beside the box is now a compact badge overlaid on the input's trailing edge, showing the number alone.
- **Launcher cards no longer show a kind pill; the kind is now a tooltip on the card icon.** The action kind a card used to carry as a SHELL / COMMAND / MACRO / ROUTINE pill is already conveyed by the icon, its color, and the left-border tint, so the pill was redundant. Hovering the icon now names the kind ("Shell command", "Macro", "Routine", "Editor command", "Link") and the card reads less cluttered.

### Fixed

- **The launcher header's "scheduled" count no longer overstates what is automated.** It counted every detected recipe, which made it read "17 scheduled" when those recipes were merely available and switched off. It now counts only shortcuts whose schedule is actually enabled — the same signal the scheduler and the status bar use — so a board with nothing on a schedule shows no count at all.

---

## [1.5.10]

Watch alerts now tell you how many files are new and how many changed, instead of a vague "new or changed". [log](https://github.com/saropa/saropa_workspace/blob/v1.5.10/CHANGELOG.md)

### Changed

- **Watch toasts now say whether files are new or changed, not "new or changed".** A folder or file watch that detects edits now reports them precisely: a batch of pure edits reads as "{count} changed in {label}", a batch of arrivals reads as "{count} new", and a mixed batch states both counts ("{added} new, {changed} changed"). Previously any batch containing an edit was labeled the ambiguous "new or changed", so a single modified file could not be told apart from a new one.

---

## [1.5.9]

The launcher's header counts are now click-to-filter chips, the header reads as one line, and each shortcut card leads with Run or Open depending on the file. [log](https://github.com/saropa/saropa_workspace/blob/v1.5.9/CHANGELOG.md)

### Added
- **The Saropa Launcher header counts are now one-tap filters.** Each count in the header — shortcuts, scheduled, watches, project files — is a chip you can click to narrow the board to just that section; click it again to clear. The filter combines with the search box, and the active chip stays highlighted.

### Changed

- **Saropa Launcher cards now lead with the action that fits the file.** A card's blue head button leads with **Run** when the file is a script — a `.py`, `.sh`, `.ps1`, `.js` (any type with a known interpreter) or a file you gave a run command — and with **Open** when it is a plain document or data file like `.json` or `.md`, whose only sensible action is to open it. A non-file action still leads with Run. The other action, when it applies, sits in the drawer (a script offers **Open** there); the head button is icon-only in the compact grid and shows its label once you expand the card.
- **The Saropa Launcher header reads as one line and the search box is narrower.** The project name, version, and counts now sit together on a single line instead of stacking name over counts, and the search box was made narrower so the summary has room.
- **The Saropa Launcher recipes count now reflects only scheduled recipes.** The header chip previously counted every detected recipe (overstating what is automated); it now shows how many recipes you actually put on a schedule, labeled "scheduled". The Recipes pane still lists every detected recipe, and clicking the chip filters the board to it.

---

## [1.5.8]

The Project Files view now reaches into platform subfolders and groups what it finds by area. [log](https://github.com/saropa/saropa_workspace/blob/v1.5.8/CHANGELOG.md)

### Added

- **Project Files now surfaces platform config and groups files by area.** Beyond the root README / changelog / manifests, the view now finds the config files that live in subfolders — the Android Gradle files (`android/settings.gradle`, `android/gradle.properties`, `android/app/build.gradle`, the top-level `build.gradle`, plus their `.kts` Kotlin-DSL spellings and the `AndroidManifest.xml`), the iOS `Podfile` and `Info.plist`, and the web `index.html` / `manifest.json` — and shows them under collapsible **Project / Android / iOS / Web** group headers. Each file still appears only when it actually exists, so a project without an `android/` folder shows no Android group. `analysis_options.yaml` and `l10n.yaml` are now recognized in the Project group.
- **The Saropa Launcher's Project files pane groups by area too.** The bottom-Panel launcher's Project files pane now mirrors the sidebar's area grouping: its cards fold under collapsible **Project / Android / iOS / Web** headers when more than one area is present, and stay one flat list otherwise. Each group folds independently and its state persists across reloads, like the My shortcuts and Recipes groups.
- **The Saropa Launcher header now shows the current project, its version, and key counts.** The wide space beside the search box is filled with the open project's name, its declared version, and a quick tally of how many shortcuts, recipes, watches, and project files the board holds. The version and counts are figured out in the background so the name shows instantly. The version is read from the project's manifest (`package.json`, `pubspec.yaml`, `Cargo.toml`, `pyproject.toml`, or the latest changelog heading).

### Changed

- **Project Files grouping only appears when it earns its place.** Files group under area headers only when more than one area has matches; a plain repo with just a README and a manifest still reads as one flat list, with no header to expand.
- **The Project Files setting is now a category map.** `saropaWorkspace.projectFiles.files` (a flat list) is replaced by `saropaWorkspace.projectFiles.groups`, a map of category name to file paths, so you can curate which files show under which area — or add your own category. Paths may be nested (for example `android/app/build.gradle`); only the file name shows in the row. A custom category you add gets a generic folder icon.
- **A file shortcut in the Saropa Launcher now leads with Open, not Run.** A document card's blue head button opens the file (its main intent); running it moves to the drawer as the secondary action. A non-file action card still leads with Run. The head button is icon-only in the compact grid and shows its Open / Run label once you expand the card.
- **The Saropa Launcher search box moved to the right of the header.** The search group now sits on the trailing edge of the header bar to make room for the new project summary on the left; it stays a compact, width-capped cluster rather than stretching across the wide Panel.

### Fixed

- **A data file no longer shows a meaningless Run button, and a script no longer hides its Run.** A `.json` config or other non-executable file in the Saropa Launcher previously offered a Run action even though running it does nothing, while a runnable script like `publish.py` led with Open instead of Run. A card now decides Run vs Open from whether the file is actually executable, so a script leads with Run and a data file is open-only.
- **A root file no longer shows its name twice in the Saropa Launcher.** A shortcut to a file at the project root (for example `CHANGELOG.md`) carries the bare filename as both its title and its path, so the card was repeating the same text on the subtitle line. The subtitle is now hidden whenever it would only echo the title, and still shows for nested paths, freshness, or a version.

---

## [1.5.7]

The launcher now shows your watches and project files too, has more breathing room, and lets you pin or schedule a recommended recipe straight from its card. [log](https://github.com/saropa/saropa_workspace/blob/v1.5.7/CHANGELOG.md)

### Added

- **Watches and Project files now show in the Saropa Launcher.** The bottom-Panel launcher gains two new panes beside My shortcuts and Recipes: **Watches** (every folder/file watch, with the same eye / bell state and unseen-file count as the sidebar) and **Project files** (every surfaced README / changelog / manifest, with its version and how long ago it changed). They are searchable with everything else; opening a watch card opens what changed and clears its count, and opening a file card opens the file.
- **Pin and Schedule buttons on recipe cards.** A detected recipe's expanded card (and its right-click menu) now offers **Pin** — adopt it into My shortcuts — and **Schedule** — adopt it and open the schedule editor on the new shortcut, pre-filled from the recipe's own time when it carries one (for example a "daily 09:00" recommendation), so keeping or automating a recommendation takes one step instead of hunting for the action.
- **Collapsible launcher sections.** Each major section in the launcher — My shortcuts, Recipes, Watches, and Project files — now has a clickable heading that folds the whole section away, so you can keep only the sections you are using on screen. The fold state persists across reloads, the panes still reflow side by side or stacked as the Panel resizes, and a search reveals matches inside a folded section.
- **Copy path button on file cards.** Any file-backed card's expanded drawer — a file shortcut, a file recipe, or a Project files entry — now has a **Copy path** button that copies the file's full path to the clipboard and confirms with a message naming the file, so you can grab a file's location without opening it.

### Changed

- **More space around launcher cards and group headings.** The card grid has a larger gap, cards carry more vertical padding, and each group heading has more room above and around it so the board no longer reads as one dense block.
- **Wider launcher cards.** Each card is about 30% wider so longer names and paths fit on one line before clipping.
- **Launcher card menus no longer offer Copy as Saropa Link.** The right-click menu on a launcher card drops the rarely used share-link action, leaving the focused run/open/configure actions. The action still exists on the Shortcuts sidebar, and shared links still import.

### Fixed

- **Watches no longer alert in every open project.** A folder/file watch is stored once and shared across windows, so a watch set up in one project (for example the "watch this project's `bugs` folder" offer) used to pop its alerts in every other project you had open. A watch now alerts only in the project it belongs to: the project it was created in, plus any you explicitly opt in. Each watch row in the Watches view shows whether it alerts in the current project, with **Alert in this project** / **Stop alerting in this project** actions (also on its right-click menu and in Manage Folder Watches) to turn it on or off per project.
- **Folder-watch confirmations now clear themselves.** The "Watching `bugs` for new and changed files" message (and the matching added / removed / no-watches confirmations) used to linger on screen until dismissed by hand. These one-time acknowledgments now disappear on their own a few seconds after they appear. The "files changed — Open" alert is unchanged: it carries an action and stays until you act on it.
- **No redundant `cd` when a terminal run stays in the same folder.** A terminal shortcut used to send a `cd` to its working directory before every run. The shared terminal now opens already rooted in that folder, and consecutive runs that share a working directory skip the `cd` entirely — so running several scripts from the same project root no longer clutters the terminal with repeated directory changes.

---

## [1.5.6]

The expanded launcher card is tidier: one Run button instead of two, its Open/Run buttons right-aligned, and a little more breathing room. [log](https://github.com/saropa/saropa_workspace/blob/v1.5.6/CHANGELOG.md)

### Changed

- **Expanded launcher cards no longer show a duplicate Run button.** When a card is expanded, the compact play button in the card head is hidden so the only Run is the full labeled button in the drawer.
- **Expanded-card Open/Run buttons are right-aligned** at the card's trailing edge, with slightly more vertical space around the drawer so the actions are easier to hit.
- **Expanding a card no longer stretches its neighbors.** Cards in a row now keep their natural height, so opening one card's drawer grows only that card instead of stretching every card beside it.
- **Launcher cards have more horizontal padding** so the content sits less cramped against the edges.
- **The launcher search bar no longer stretches across the whole panel** — it is capped to a compact width on the leading edge.
- **Launcher cards are indented under their group heading** so the group-to-cards hierarchy reads at a glance.

---

## [1.5.5]

The kind labels on launcher cards (SHELL, MACRO, COMMAND, ROUTINE) are now a calm gray pill instead of a colored one, so the board reads less busy. [log](https://github.com/saropa/saropa_workspace/blob/v1.5.5/CHANGELOG.md)

### Changed

- **Launcher kind pills are now neutral gray, not colored.** The SHELL / MACRO / COMMAND / ROUTINE label on each launcher card no longer borrows the card's accent color; it renders in a muted gray. The card still signals its kind through the colored left stripe and icon, so the board stays scannable without the pills adding a second layer of color.

## [1.5.4]

The bottom-panel launcher is now a color, two-pane board — your shortcuts on one side, recipes on the other — with collapsible groups, click-to-expand cards, and a right-click menu; and the side bar marks the shortcuts behind the icon count so you can see which ones you haven't used yet. [log](https://github.com/saropa/saropa_workspace/blob/v1.5.4/CHANGELOG.md)

### Added

- **The Saropa Launcher is now a two-pane board with color, icons, and a right-click menu.** The bottom-panel launcher now splits into **My shortcuts** on the left and **Recipes** on the right, sitting side by side when the panel is wide and stacking when it is narrow, so your own entries are never mixed in with the detected ones. Every card now carries a colored icon matching its file type or action — the same glyphs the side bar uses — with a tinted accent stripe, so the board reads at a glance. Each group header is collapsible (its folded state is remembered), shows its own icon and a count, and searching reveals matches even inside a folded group. Click a card to expand it in place for the full name, full path, and description, with Open and Run buttons; the ▶ button still runs in one click. Right-click any card for a menu that mirrors the side bar — Run, Configure Run, Schedule, Customize, file actions, Copy as Saropa Link, Rename, Remove (and Add to Shortcuts on a recipe).
- **See which shortcuts the activity-bar count points at.** The number on the Saropa Workspace side-bar icon counts shortcuts you've added but never opened or run. Those rows now carry a leading dot (●) in the side bar, so the count is no longer a mystery — you can see exactly which shortcuts it refers to. Open, run, or peek a shortcut and its dot clears and the count drops together. Hover a marked row for a one-line explanation of what clears it.

### Fixed

- **Run as administrator now actually opens the elevated window on Windows.** Running a shortcut in a new external window with administrator privileges showed the "Launched … (approve the elevation prompt)" message but no UAC prompt and no window ever appeared. The launcher was starting PowerShell detached, which stripped the desktop the Windows UAC consent needs, so the elevation was dropped silently. Elevated launches now keep that desktop and the administrator window opens as expected.

## [1.5.3]

Pinned scripts now run through the right interpreter on Windows instead of opening in the editor, and your shortcuts now have a home in the bottom panel with a search box. [log](https://github.com/saropa/saropa_workspace/blob/v1.5.3/CHANGELOG.md)

### Added

- **Saropa Launcher — reach your shortcuts from the bottom panel, with a search box.** A new **Saropa Launcher** tab sits in the bottom panel beside Terminal and Output, so you can find and run any shortcut without opening the Saropa icon in the side bar. It shows the same shortcuts as the sidebar plus the detected recipes, laid out as a grid that uses the panel's width — more columns when the panel is wide, fewer when it is narrow — instead of one tall column. Type in the always-visible search box to filter shortcuts and recipes live; empty groups stay hidden. Click a file shortcut to open it, an action to run it, or the ▶ button to run any of them. The sidebar Shortcuts view is unchanged — this is a second way in, not a replacement.
- **Run With… — choose an interpreter from what is actually installed.** Right-click a script shortcut and pick **Run With…** to see the runtimes detected on this machine for that file type — the `py` launcher, versioned Python installs found even when they are not on `PATH` (e.g. `D:\Tools\Python\Python314\python.exe`), `node`, `pwsh`, and more — each showing its resolved path. Pick one (or **Browse…** for an executable) and the shortcut runs with it and remembers the choice. The same choices appear as one-click chips in **Configure Run**, where the command box now also shows what an empty prefix resolves to, so "default" is never a mystery. No settings JSON required.
- **A new Customize screen sets a shortcut's name, icon, color, and tags in one place.** Right-click a shortcut and choose **Customize...** to open a single screen with the name field, a searchable grid of hundreds of icons shown as real glyphs, real color swatches you can actually see, and a tag editor — with a live preview of how the row will look. The old step-by-step pickers (**Set Icon & Color...**, **Rename**, tagging) are still there for quick keyboard edits.
- **Color swatches now show their real color.** The color list used to show the same gray dot for every choice because a menu row can't paint a color; the new Customize screen shows each color as an actual swatch, tuned to the current theme, so you pick by sight.
- **Hundreds more icons, with real search.** The Customize screen offers the full icon set grouped into categories (files, source control, run and debug, devices, people, and more), and you can type to filter by name or keyword to find the right glyph fast.
- **Configure Run is now a single form with every option on one screen.** Right-click a shortcut and choose **Configure Run...** to set the command prefix, arguments, working directory, environment variables, where it runs, output extraction, dependency, audio cues, run-on-save, overlapping runs, and the cross-process lock — all visible and editable at once, with a live preview of the exact command that will run. The old step-by-step menu is still there as **Configure Run (Quick)...** for a fast keyboard-only edit.
- **Run as administrator is now easy to find.** The administrator toggle used to appear only after you set the run location to a new external window, so "run this elevated" was hard to discover. In the new form the toggle is always shown — disabled, with a one-line note telling you to set **Run in** to a new external window first — so you can see the option exists and what it needs.

### Fixed

- **A pinned shebang script (e.g. a `#!/usr/bin/env python3` file) now runs through its interpreter on Windows instead of being opened by its file association.** Windows has no shebang honoring, so a "run directly" pin handed the bare script path to the shell, which opened the `.py` rather than executing it. The runner now resolves a real interpreter on Windows — the configured default for the file type (`python` for `.py`), falling back to the script's own shebang — while Unix keeps running such scripts directly via the shebang. To pin a specific runtime, set its extension in **Interpreter defaults** to an absolute path, e.g. `".py": "D:/Tools/Python/Python314/python.exe"`.

## [1.5.2]

Tell Saropa to keep an eye on a folder or a file and get a heads-up the moment something new lands — even files written while the window was closed. [log](https://github.com/saropa/saropa_workspace/blob/v1.5.2/CHANGELOG.md)

### Added

- **Watch a folder for new files, or a file for changes — and hear about it on startup, not just live.** Right-click a folder in the Explorer and choose **Watch Folder for New Files...** (or a file → **Watch File for Changes...**), or run either from the command palette. You pick whether to be told about only new files or new-and-changed files, and can narrow a folder watch to a glob (e.g. `*.md`). Saropa remembers the folder's file list between sessions, so the next time you open the window it tells you about anything written while you were away — for example, a new bug report dropped into `bugs/` by another tool or teammate. A toast names the new files and offers to open the first one. Manage, pause, or remove your watches from **Manage Folder Watches...**.
- **A Watches view with a new-files counter on the sidebar.** Your watches now appear in a **Watches** section in the Saropa Workspace sidebar, each row showing how many new or changed files have landed since you last looked, with the running total as a badge on the activity-bar icon. Click a watch to open what changed and clear its count — the badge updates to match. Enable, disable, or remove a watch right from its row.
- **Saropa offers to watch your `bugs/` folder.** When a project has a `bugs/` folder, Saropa offers once to watch it for new files, so a new report dropped in by a tool or teammate shows up without you setting the watch up by hand. Dismiss it and it won't ask again; add it later from the Watches view if you change your mind.
- **Pick from 20 named icon colors instead of 7.** When you set a shortcut's or group's icon with **Set Icon & Color...**, the color list now offers a full spectrum — Red, Coral, Orange, Amber, Gold, Lime, Chartreuse, Green, Emerald, Teal, Cyan, Blue, Indigo, Violet, Purple, Magenta, Pink, Brown, Slate, and Gray, spread evenly around the color wheel so adjacent swatches stay easy to tell apart. Each color is tuned for light, dark, and high-contrast themes, so the tint you pick looks right whichever theme you use. Shortcuts you colored before this update keep their existing tint.
- **File shortcuts now show a colored, type-aware icon at a glance.** A `.yaml`, `.json`, `.py`, `.dart`, `.ts`, `.md`, `.sql`, shell script, image, lockfile, and many more common file types each get their own glyph and tint, so a list of shortcuts reads by file type instead of every row showing the same generic pin. A type the map doesn't cover keeps the plain shortcut glyph, and any icon you set yourself always wins.
- **Set a group's icon and color.** Right-click any group you made and choose **Set Group Icon & Color...** to give it the same icon-and-tint picker shortcuts already have, so you can tell your folders apart at a glance.
- **A "Recommended" shelf at the top of the Recipes view.** A collapsed-by-default section highlights the handful of recipes most worth adopting for this project — led by the scheduled rituals (dawn lint sweep, dependency freshness, standup digest, and the like) that otherwise sit switched off and undiscovered. It's a quiet shelf you open when curious; nothing pops up.
- **Turn a scheduled ritual on in one click from the Recommended shelf.** Each recommended scheduled ritual now has an inline check button: one click both adopts it and switches its schedule on, with a single toast confirming what you turned on and when — for example, "Dawn lint sweep enabled — runs daily at 05:00." No more two-step promote-then-enable.
- **A one-time "start here" hint on the Recommended shelf.** The first time you open the Recommended group you'll see a quiet welcome row — "New here? These are worth turning on." — that points at the rituals worth enabling. It disappears for good once you've opened the shelf or adopted anything, and it's a tree row, never a popup.
- **The Recommended shelf demotes recipes you already use.** Once you've run a featured recipe, it steps aside so the shelf keeps surfacing what you haven't tried yet. Disabled scheduled rituals stay put until you actually switch their schedule on — running one by hand doesn't count as turning it on.
- **Show the full menu on the Recommended shelf (opt-in).** A new setting, **Recommend: Aggressive**, lifts the eight-row cap and features every disabled ritual plus every recipe you haven't adopted yet, for when you want the whole list rather than the short highlight. Off by default.
- **The "Flutter dance" recipe, plus a Flutter section.** Flutter projects get a one-click **Flutter dance** that runs `flutter clean` then `flutter pub get`, stopping if a step fails — the standard cure for stale build output and dependency drift. It and the other flutter commands (run, analyze, build, clean, upgrade) now cluster under a **Flutter** subfolder in Build & Run.
- **Promoting a recipe files it into a folder of the same name.** Turn a detected recipe into an editable shortcut and it lands in a group named after where it came from — a GitHub recipe in a "GitHub" group, a Flutter recipe in a "Flutter" group — created for you if it doesn't exist yet, instead of loose at the top of the list.
- **The shortcut right-click menu is grouped into submenus instead of one long list.** A shortcut's context menu was a single flyout of around 35 items; the run actions (Open, Run, Run with Last Parameters, Stop) stay at the top, and the rest now fold into four labeled submenus — **Output & Logs** (Peek, Show Output, Toggle Log Follow, Diff, Simulate), **Configure & Schedule** (Configure Run, Schedule, Triggers, watch-on-change, Pause), **Appearance & Tags** (Set Icon & Color, Live Metric, Tag, branch link, Expiry, Mask), and **File Actions** (New File, Duplicate, Rename on Disk, Copy To, Lock, Delete). Every action is still one hover away, and the menu reads top-to-bottom at a glance.
- **Project Shortcuts starts with ready-made groups, and new files sort themselves in.** Project Shortcuts now shows seven built-in groups — **Build**, **Run**, **Deploy**, **Test**, **Docs**, **Data**, and **Code** — each with its own colored icon, shown even while empty so you have somewhere to drop things from the start. When you add a file, Saropa files it into the matching group by its name and type: a `publish` script lands in **Deploy**, a `.test.ts` in **Test**, a `.md` in **Docs**, a `.csv` or `.json` in **Data**, a `.ts` or `.dart` in **Code**, and so on — a name like "publish" wins over the file type, and a file that fits nothing stays at the top level. The "Added" toast names the group it went to. These groups aren't written into your shared config file, so they don't clutter the repo, and you can still drag shortcuts between them. Turn the whole thing off with the **Default Groups: Enabled** setting.
- **Promoting or scheduling a recipe drops it into the right default group.** When you promote a recipe — or turn a scheduled ritual on — it now lands in its built-in group rather than a folder named after where it came from: the test recipe in **Test**, a build task in **Build**, a deploy step in **Deploy**, the docs opener in **Docs**. Recipes without a home group still file into a folder named after their section as before.

### Fixed

- **The trophy icon now shows in the icon picker.** It previously rendered as a blank entry because the underlying glyph name wasn't a real product icon; the achievement glyph it was meant to be now appears, and typing "trophy", "award", or "achievement" finds it.

---

For older versions (1.5.1 and older), see [CHANGELOG_ARCHIVE.md](./CHANGELOG_ARCHIVE.md).
