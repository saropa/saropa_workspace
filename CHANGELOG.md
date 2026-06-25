# Changelog

All notable changes to Saropa Workspace are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- MAINTENANCE NOTES -- IMPORTANT --

    The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

    **Overview** — Each release (and [Unreleased]) opens with one plain-language line for humans—user-facing only, casual wording—then end it with: [log](https://github.com/saropa/saropa-workspace/blob/vX.Y.Z/CHANGELOG.md)
    substituting X.Y.Z.

    **Tagged changelog** — Published versions use git tag **`vx.y.z`**; compare to [current `main`](https://github.com/saropa/saropa_workspace/blob/main/CHANGELOG.md).

    **Published version**: See field "version": "x.y.z" in [package.json](./package.json)

    NOTE: try to keep this file to approx 500 lines
    
cspell:disable
-->

---

## [Unreleased]

Pop-out window fixes: running as administrator now actually opens the elevated window, and the run-settings editor no longer throws away your edits on a stray click. The activity-bar icon now badges how many pins you haven't used yet, and choosing a pin icon is a single grouped, searchable list with many more icons.

### Added

- **A pin whose file was deleted is now flagged, and clicking it offers a fix.** When a pinned file no longer exists on disk, the pin shows a warning icon and a "file not found" hover instead of looking normal. Clicking it (to open or run) no longer hits a cryptic "cannot open file" error — instead a message names the pin and lets you **Unpin** it or **Show in Folder** to find a moved file. Pins are never removed automatically, since a missing file is often temporary (a branch switch or a regenerated build artifact).
- **A badge on the activity-bar icon counts pins you haven't used yet.** The Saropa Workspace icon shows the number of pinned items you have not yet opened or run, so newly added pins are easy to notice. Opening or running a pin clears it from the count, and the badge disappears once you've used everything (it never shows a zero).

### Fixed

- **Faster startup.** The activity-bar view no longer runs two whole-workspace file searches every time the window opens. Auto-pin patterns that name an exact file (the defaults `pubspec.yaml` and `analysis_options.yaml`) are now resolved with a direct file check instead of a project-wide search, so a project that has neither no longer pays a search cost on launch.
- **Running a script as administrator now opens the elevated window.** Previously, choosing the external window with **Administrator privileges** did nothing — no UAC prompt and no window — because the launcher was started in a mode that silently canceled the elevation request. The elevated window now opens (with the usual Windows UAC prompt).
- **The run-settings editor no longer discards your edits on a misclick.** The settings menu and every step within it now stay open when you click elsewhere, so an accidental click outside the picker no longer closes the editor and loses everything. Only pressing Escape cancels.

### Changed

- **Turning on administrator privileges is now a single flow.** Choosing the external window now immediately asks whether to run as administrator, instead of returning to the settings menu where the toggle only appears after the fact. The toggle still lives on the settings menu, so it remains adjustable later.
- **Choosing a pin's icon is now one grouped, searchable list with many more icons.** The icon picker replaces the old flat list with scannable categories — Files & code, Run & build, Source control & cloud, Data & terminal, Status & alerts, Shapes & color, and Objects & places — and you can type the icon name to filter instead of scrolling.

---

## [1.0.1]

Run a script in its own pop-out terminal window — optionally as administrator.

[log](https://github.com/saropa/saropa_workspace/blob/v1.0.1/CHANGELOG.md)

### Changed

- **The "Workspace Pin" menu now shows only the valid action.** Right-clicking a file (in the Explorer, the editor, an editor tab, or a pin row) shows **Add to Project Pins** only when it is not already a project pin, and **Remove from Project Pins** only when it is — and likewise for global pins. The menu reflects the exact file acted on, not whichever editor is focused.

### Added

- **Auto-pins can be dragged into folders.** Auto-detected pins (the ones from `autoPins.patterns`, like `pubspec.yaml` and `analysis_options.yaml`, plus the "Workspace config" example pin) can now be dragged into and out of project folders, the same as explicit pins. Their folder is remembered across reloads; deleting a folder moves its auto-pins back to the top level.
- **New external window** run location. In **Configure Run -> Run in**, a pin can now launch in a separate OS terminal window outside VS Code (alongside the existing integrated-terminal and background-channel choices). The window stays open after the script finishes so its output is readable.
- **Administrator privileges** for an external window. When **Run in** is set to the new external window, an **Administrator privileges** toggle requests an elevated window (Windows UAC prompt; `pkexec`/`sudo` best-effort on Linux and macOS). Per-pin environment variables are not passed into an elevated window,  which is surfaced when a run drops them.

---

## [1.0.0]

Initial release featuring customizable file pinning, automated project recipes, and structured local script execution.

[log](https://github.com/saropa/saropa_workspace/blob/v1.0.0/CHANGELOG.md)

### Added

- **Initial Release of Saropa Workspace** core functionality, providing seamless script and file pinning within VS Code workspace environments.
- **Dedicated Recipes View:** A standalone **Recipes** section in the sidebar, separate from the Pins view. Auto-detected shortcuts (open on GitHub, run scripts, Saropa Suite tools) live in their own view so they never bury manual pins, with **Restore Recipes** accessible in the view's title bar. Per-recipe actions include run, stop, show output, promote to pin, and copy path.
- **Submenu Pin Management:** Per-scope **Remove from Project Pins** / **Remove from Global Pins** actions are cleanly located inside the **Workspace Pin** submenu on a pin's context menu.
- **Extension Branding:** Brand-new extension and activity-bar icon designed as a clean, flat referee-whistle silhouette on the warm Saropa Suite tile, matching the Suite and Log Capture icons. 
- **Comprehensive Documentation:** Full README detailing all shipped capabilities—recipes, pin groups with drag-and-drop, the Run Pin palette and overrides, keybindings, smart pin suggestions, run-target inference, the next-run status bar, stop/force-kill, and last-run status. A forward-looking `ROADMAP.md` focuses exclusively on future phases.
- **Project Files Pinning:** Pin and unpin directly from the **Project Files** view via an inline pin/unpin toggle. Each row shows a "pinned" tag when the file is already pinned in the project, updating dynamically as pins change.
- **Workspace Pin Context Submenu:** Explicit add/remove actions for both scopes—Add/Remove to Project Pins and Add/Remove to Global Pins—available from the Explorer, editor tabs, editor body, file-pin rows in the Pins view, and Project Files rows. Right-clicking an editor tab targets that specific file, while the in-body menu and command palette act on the active editor.
- **Recent Group and Local Run Telemetry:** A **Recent** group at the top of the sidebar lists recently run pins across both scopes, displaying execution recency and a "(scheduled)" tag for unattended triggers. Single-click opens details while double-click or the play button re-runs. Powered by on-device, private local history that can be toggled off via `saropaWorkspace.telemetry.enabled` or cleared using **Reset Run History**.
- **Automated Recipe Detection:** Smart detection of project files to generate auto-detected pins. Organized into logical subfolders (**GitHub**, **Build & Run**, **Workspace**, **Scheduled**, and **Saropa Suite**) with distinct color-coded icons. Actions supported include **url** (open link), **shell** (run command line), **command** (invoke VS Code command), and **macro** (ordered sequence). Detection is cached per folder for maximized load performance.
- **Scheduled Rituals:** Time-triggered recipes that run unattended and capture output to a dated file under `reports/`. Designed for tasks like dawn lint sweeps (featuring first-class Dart/Flutter support via `saropa_lints`), sunrise stats, standup digests, and security audits. Seeded as disabled by default until explicitly promoted to a pin.
- **Saropa Suite Integration:** Automated detection of sibling Saropa tools to populate dedicated subfolders in the Recipes section:
  - *Saropa Lints:* Run analysis, open Code Health dashboard, manage rule packs, open Package Vibrancy, and export OWASP reports.
  - *Saropa Drift Advisor:* Open browser viewer, SQL Notebook, offline Dart schema scans, schema diagrams, and portable reports.
  - *Saropa Log Capture:* Open capture logs, search logs, export session Flow Maps, and show the Signals panel.
- **Project Files View:** A read-only sidebar view listing key project files (README, CHANGELOG, manifests like `package.json`, licenses). Displays relative last-modified times and declared versions parsed from manifests or changelogs. Sorted alphabetically by filename.
- **Copy Path Action:** Right-click context action to copy a file's absolute path to the clipboard, supported across pins, recipes, and Project Files lists. Copies action targets for non-file recipes.
- **Storage and Data Model:** Project pins persist to `.vscode/saropa-workspace.json` (auto-created empty if missing), while global pins save to the extension's synced `globalState`. Includes a synthesized **Workspace config** example pin in empty environments.
- **Configurable Auto-Pins:** Glob pattern-based auto-pin seeding with sticky removal state and on-demand restoration.
- **Execution Environments:** Support for script execution via the integrated terminal or a background output channel, featuring per-pin prefixes, arguments, environment variables, and custom working directories.
- **Favorites Import:** One-time per-workspace prompt to import existing pins from `.favorites.json` (kdcro101 format) or scan sibling directories using the **Scan Sibling Projects for Favorites...** command.
- **Run-Parameters & Schedule Editors:** Interactive QuickPick and input box management flows ("Configure Run...", "Configure Schedule...") to adjust pin parameters, terminal modes, and recurrence timers without hand-editing JSON.
- **Background Execution Management:** Live tracking of background and scheduled tasks with a spinning status indicator and immediate process tree termination capabilities (including Windows child processes).
- **Placeholder & Interactive Tokens:** Support for runtime-expanded tokens (`$workspaceRoot`, `$dir`, `$file`) alongside interactive tokens like `${prompt:Label}` and `${pick:a,b,c}` for dynamic execution parameters.
- **Pin Groups with Drag-and-Drop:** Ability to create named folders within Project and Global scopes, supporting arbitrary reordering and drag-and-drop mechanics.
- **Run-Target Inference:** Auto-detects targets when pinning files like `package.json` (npm, pnpm, yarn, bun), `Makefile` (`make <target>`), or shebang scripts to instantly seed exact execution configurations.
- **Global Run Palette:** Global command `Saropa Workspace: Run Pin...` provides a searchable quick pick of all workspace and global pins, indexed by recency.
- **Smart Pin Suggestions:** Proactively offers to pin frequently opened files once they clear a configurable threshold (default: 6 opens), manageable via `saropaWorkspace.suggestions.enabled`.
- **Status Bar Integration:** A specialized status-bar item showcasing upcoming scheduled executions. Clicking the item highlights and expands the respective pin in the tree.
- **Custom Presentation Overrides:** "Set Icon & Color..." context options to assign curated product icons and theme-aware colors to distinct pins for easy visual categorization.
- **Run Pin with Overrides:** Execute pins with one-off argument, directory, or environment variable modifications without altering the underlying saved configurations.
- **High-Performance Pinning Architecture:** Instant pinning operations powered by cached folder-level glob scanning to avoid full workspace rescans during modifications.
- **Robust Submenu Targeting:** Workspace Pin submenu handles row-level Explorer and Project File interactions without triggering duplication warnings.
- **Context-Aware Tab Pinning:** Tab context menu bindings accurately track right-clicked file URIs rather than falling back to the active editor.
- **Accidental Execution Safeguards:** Single-clicking heavy or shell-based recipes opens a descriptive modal workflow rather than triggering side-effects immediately.
- **Process Termination Visibility:** Stopping an active background run updates the UI state with a distinct **stopping...** badge until process exit validation.
- **Fail-Safe Terminations:** Graceful background stops automatically escalate to a forced kill sequence if unresponsive, alongside an explicit **Force Kill** user action.
- **Asynchronous Multi-Root Loading:** Out-of-band, parallel filesystem probing ensures workspace rendering is never blocked by recipe discovery routines across multi-root structures.
- **Header Context Isolation:** Tree-view structural group headers (Project Pins / Global Pins) explicitly ignore individual pin actions like Rename or Unpin.
- **Smart Double-Click Router:** Double-clicking non-runnable assets (e.g., Markdown, images) safely opens them within the native editor workspace with an explanatory notice rather than piping raw paths to a shell instance.