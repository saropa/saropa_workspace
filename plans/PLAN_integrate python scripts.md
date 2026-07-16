# Scripts — a 4th category: a bundled, taggable, configurable script library

**Goal.** Add **Scripts** as a first-class category in the sidebar, alongside the
three that exist today — **Shortcuts** (the pins view), **Recipes** (detected from
the workspace), and **Project Files**. A Script is a curated, generally useful
script that **we bundle and ship inside the extension**, surfaced in its own view.
Each script has **tags** and an **editable per-script config** with useful
defaults (for example: run in the project's source folder). A user browses the
Scripts view, edits a script's config, and runs it.

Scripts differ from the existing three:

- **Shortcuts** are files the *user* pinned.
- **Recipes** are actions *detected* from files the user already has.
- **Project Files** are notable files *scanned* from the open project.
- **Scripts** are ones *we ship* — bundled in the `.vsix`, version-controlled in
  this repo, the same on every install until the extension updates.

## Original notes (superseded by this plan)

The three seed ideas that started this — kept for provenance:

1. A script that organizes a report / output folder (pattern:
   `d:\src\contacts\reports\organize_reports.py`).
2. A script that connects a device for development (pattern:
   `d:\src\contacts\scripts\build\debug_connect.py`).
3. "A framework for including python scripts (and their modules) as recipes —
   maybe a local folder." **This plan is that framework**, built as its own Scripts
   category rather than folded into Recipes. Items 1 and 2 become two of the first
   bundled scripts, after the migration task at the end.

## Verified current state (what we build on)

Read against the code, not a summary:

- **Each top-level category is its own registered view with its own tree provider.**
  `extension/package.json` registers `saropaWorkspace.pins`,
  `saropaWorkspace.recipes`, `saropaWorkspace.watches`, and
  `saropaWorkspace.projectFiles` under the `saropaWorkspace` view container, each
  backed by a provider (`views/shortcutsTreeProvider.ts`,
  `views/recipesTreeProvider.ts`, `views/projectFilesProvider.ts`,
  `views/watchesTreeProvider.ts`). **Scripts is a 5th registered view** —
  `saropaWorkspace.scripts` — with a new `views/scriptsTreeProvider.ts`, placed
  after Recipes.
- **The run pipeline already runs a `.py` file with per-item config.** `exec/*`
  resolves the interpreter (from `saropaWorkspace.interpreterDefaults`, a `#!`
  shebang, or an explicit command), assembles `<python> "<file>" <args...>`, sets
  cwd/env, routes to the integrated terminal / a background channel / an external
  OS window, and resolves interactive `${prompt:...}` / `${pick:...}` tokens in
  args before running. A script reuses all of it — it needs its absolute on-disk
  path resolved at run time and a config object to feed the planner.
- **A per-item exec config already exists and is exactly the shape a script needs.**
  `model/shortcutExec.ts` — `ShortcutExecConfig` carries `command` (interpreter),
  `args`, `cwd`, `env`, `runLocation`, and more. The "Configure Run" panel
  (`views/configureRunPanel.ts`) already edits it. A script's editable config
  reuses this type and, where practical, that panel — not a parallel config surface.
- **`$workspaceRoot` is already a run token.** `exec/tokens.ts` resolves it, so
  "run in the project's source folder" is expressible as a default `cwd` of
  `$workspaceRoot` with no new mechanism.
- **A new folder ships in the `.vsix` with no ignore change.** `.vscodeignore`
  excludes `src/**`, `out/**`, `*.ts`, `*.map`; a new `extension/scripts/` tree is
  packaged as-is.

## Design

### 1. The bundled script library (where the scripts live)

```
extension/
  scripts/
    library/                    <- scripts live HERE, never loose at scripts/ root
      library.json              <- the manifest: every shipped script + its defaults
      organize-output/          <- one script = one self-contained folder
        __main__.py             <- entry point
        modules/                <- its own sub-files / importable modules
          scan.py
          rules.py
      device-connect/
        __main__.py
        modules/
      clean-workspace/
        __main__.py
```

Every script is **its own folder** and is **self-contained** — its entry point plus
any sub-files and modules it needs to run live together in that one folder. Two firm
rules:

- **One folder per script.** A script is never a loose `.py` file; it is always a
  folder (a Python package) so it can carry sub-files and grow without spilling.
- **Never at the root of the scripts folder.** Scripts live under
  `scripts/library/<id>/`, not directly in `extension/scripts/`. The `scripts/`
  root holds only the manifest folder structure, not individual scripts.

Imports resolve independently of cwd. When Python runs a script by its absolute path
(`python /.../scripts/library/organize-output/__main__.py`), it adds **that file's
own directory** to `sys.path[0]` — so `import modules.scan` resolves from the script
folder **even though the run's cwd is the project root** (`$workspaceRoot`, the
default). The script therefore acts on the user's project (cwd) while importing its
own bundled modules (from its folder) — no cwd change and no `PYTHONPATH` edit
needed. This tree is tracked in git here and ships in the `.vsix`.

### 2. The manifest — `library.json`

One manifest lists every shipped script and its **default** tags and config:

```json
{
  "version": 1,
  "scripts": [
    {
      "id": "organize-output",
      "labelKey": "scripts.organizeOutput.label",
      "descriptionKey": "scripts.organizeOutput.description",
      "icon": "file-directory",
      "tags": ["cleanup", "reports"],
      "entry": "organize-output/__main__.py",
      "config": {
        "command": "python",
        "cwd": "$workspaceRoot",
        "args": ["${prompt:Folder to organize:}"],
        "runLocation": "terminal"
      }
    }
  ]
}
```

- **`id`** — stable; everything else keys off it (see config storage + update safety).
- **`labelKey` / `descriptionKey`** — i18n keys, not literals; values go in
  `src/i18n/locales/en.json` so the library is translation-ready (project rule).
- **`icon`** — a `ThemeIcon` id.
- **`tags`** — the script's **default** tags (see the tags section).
- **`entry`** — path relative to `scripts/library/`, resolved to absolute under
  `context.extensionPath` at run time.
- **`config`** — the script's **default** `ShortcutExecConfig`. `cwd:
  "$workspaceRoot"` is the "run in the project's source folder" default; the whole
  block is user-overridable.
- **`requires`** (optional) — external command-line tools the script needs, each
  `{ "type": "command", "name": "adb", "reason": "…", "optional": true|false }`.
  This is the single source of truth for the tool preflight: the Scripts view will
  check it before offering Run (a missing required tool → a "needs adb" state
  instead of a runtime failure), and a script may read its own entry at startup to
  self-check when run directly. A missing **required** tool blocks/aborts; a missing
  **optional** tool is a warning only. Shipped today: `device-connect` declares
  `adb` (required) plus `flutter` and `scrcpy` (optional); `organize-output` needs
  none (`[]`).

### 3. The Script model entity

A new `model/script.ts` type — a first-class entity, not a recipe:

```ts
interface Script {
  readonly id: string;              // stable library id
  readonly labelKey: string;
  readonly descriptionKey: string;
  readonly icon: string;
  readonly entry: string;           // relative to scripts/library/
  tags: string[];                   // effective tags (defaults + user edits)
  config: ShortcutExecConfig;       // effective config (defaults + user edits)
}
```

It reuses `ShortcutExecConfig` rather than inventing a parallel config, so the run
pipeline and the Configure Run panel apply unchanged.

### 4. Config + tags storage — defaults ship, edits are per-user

The bundled folder is **read-only** (it lives in the versioned install directory).
So a script's *defaults* come from `library.json`, and a user's *edits* (tags and
config) are stored in the extension's `globalState`, keyed by the stable
`library:<id>`. The effective Script is `manifest defaults` overlaid with `user
overrides`. This is the one non-obvious design point and it has two payoffs:

- **Edits survive extension updates** — `globalState` is keyed by id, not by the
  install path, which changes every version.
- **A "Reset to defaults" action** is trivial: drop the override for that id.

### 5. Tags — how the Scripts view is organized

Tags are the Scripts view's grouping/filtering axis, the way categories group the
Recipes and Project Files views. Concretely:

- The view groups scripts under their tags (a script with multiple tags appears
  under each, or under a primary tag — decide during build; grouping-by-first-tag
  is the simpler first cut).
- A filter box narrows the view to a tag or a text match, reusing the existing
  `views/shortcutFilter.ts` pattern.
- Tags are editable per script (add/remove), stored as the user override above.
  Manifest tags are the starting set.

### 6. Running a script — reuse the pipeline, default cwd to the project

No new run path. The Scripts view builds a run target from the effective Script:
resolve `entry` to its absolute bundled path, feed the effective
`ShortcutExecConfig` to `planRun`, and launch. The default `cwd` of `$workspaceRoot`
means a script runs against the open project's root ("the source folder of the
project") unless the user sets a different cwd. Single-click opens the script's
detail (what it does, what it runs, its tags); Run / double-click executes it.

### 7. Update-safety — reference by id, never by absolute path

`context.extensionPath` points at a **per-version** install directory that changes
on every extension update. Every stored reference to a script — a config override,
a tag edit, an optional pin, a scheduled run — must key on `library:<id>` and
re-resolve the absolute path at run time. Persisting a resolved absolute path would
break after the next update.

### 8. Interpreter absence — fail loud and useful

A user may have no `python` on PATH:

- Reuse `saropaWorkspace.interpreterDefaults` so the user can point `.py` at their
  interpreter once, globally.
- When a run's interpreter cannot be found, emit a visible error toast naming the
  missing interpreter and the setting to fix it (no silent async) — not a bare
  non-zero exit in the channel.
- The script detail states the interpreter it needs, so the requirement is visible
  before running.

### 9. Packaging

- **`.vscodeignore`** — no change needed to ship `scripts/`; add a one-line comment
  noting `scripts/library/**` is intentionally packaged so a future ignore edit does
  not strip it.
- **`scripts/publish.py`** — add a validation step: parse `library.json`, assert
  every `entry` exists on disk and every `labelKey` / `descriptionKey` resolves in
  `en.json`, and fail the package if not. Python needs no compile step, so files
  ship as-is; validation is the only addition.
- **Version control** — `extension/scripts/library/**` is tracked here; scripts
  version and ship with the extension release.

## Constraints

- **No AI / no internal surfaces on public content (hard rule).** Every shipped
  script, its folder name, its label, its description, and its tags must be a
  general developer utility with no reference to AI, Claude, Anthropic, or any
  assistant, and no Saropa-internal specifics.
- **Explicit run only.** A script never auto-executes and never scans the disk on
  its own. It is browsed and run as a visible, user-initiated act.
- **Translation-ready at write time.** Manifest labels/descriptions are i18n keys in
  `en.json`; any new view/command titles use `%…%` + `package.nls.json`. American
  English source. Do not run any translation pipeline.
- **Reuse, do not fork.** Reuse `ShortcutExecConfig`, the run pipeline, the
  Configure Run panel, and the filter pattern. New: the Scripts view + provider, the
  `Script` model, the manifest loader, and tag handling. No new run path, no new
  dependency, no new webview (blast-radius gate).
- **Safety is visible.** Shipping executable scripts means the detail surface must
  make plain what a script does and what it runs, before the user runs it.

## Acceptance criteria

- The sidebar shows a **Scripts** view alongside Shortcuts, Recipes, and Project
  Files, listing every script in `library.json`, grouped by tag. It appears even
  with no workspace open (the library is bundled, not workspace-derived).
- Single-click opens a script's detail; Run / double-click executes it through the
  resolved interpreter with cwd defaulting to `$workspaceRoot`.
- A script with sibling modules under `modules/` runs correctly (imports resolve)
  from the bundled location.
- Editing a script's tags or config persists across reloads **and across an
  extension version update** (stored by `library:<id>`, not an absolute path); a
  "Reset to defaults" action restores the manifest values.
- With no interpreter available, a run produces a visible error naming the missing
  interpreter and the `interpreterDefaults` setting — not a silent failure.
- The `.vsix` contains `scripts/library/**`; `publish.py` fails the package if a
  manifest `entry` is missing or an l10n key is unresolved.
- No shipped script, folder, label, description, or tag references AI or any
  assistant; all user-facing strings are externalized; American English.

## Build order

1. **The category, empty of real scripts.** Register the `saropaWorkspace.scripts`
   view + `scriptsTreeProvider.ts`; add the `Script` model, the `library.json`
   loader, and the defaults-plus-overrides resolution (config + tags in
   `globalState` by `library:<id>`). Prove end to end with one stub script (a
   `print` in `__main__.py`): it appears in the view, runs, its config edit
   persists across reload.
2. **Tags + config editing.** Tag grouping in the view, a tag/text filter, per-script
   tag add/remove, and wiring the Configure Run panel to a script's config with the
   "Reset to defaults" action.
3. **Interpreter-absence handling + the detail surface** (what the script does, what
   it runs, its interpreter and tags).
4. **First real scripts** — organize-output and device-connect are **migrated**
   (see the migration section below); clean-workspace remains a future example.
5. **`publish.py` validation step** and the `.vscodeignore` note.

## Migration task — DONE (both seed scripts migrated into the library)

Both seed scripts are migrated into `extension/scripts/library/`, each a
self-contained folder registered in `library.json` with i18n keys in `en.json`.
They stand alone as bundled scripts today; they surface in the UI once the Scripts
view (steps 1–3) is built.

**organize-output** (`organize-output/` — `__main__.py` + `modules/organizer.py`,
`modules/dates.py`). Generalized from the Contacts reports organizer: it takes the
target folder as an argument (default cwd, not a hardcoded `reports/` path), and the
Contacts-only special cases are gone (the legacy singular `report/` folder, the
launcher self-protection). Kept: filename-date routing with a creation-time
fallback, the active-write quiet window, already-organized skip, unique-name
collision handling, and empty-folder pruning. Added `--dry-run`. The default config
**prompts for the folder** rather than defaulting to the whole project root, so a
run cannot silently sweep every loose source file. Verified end to end.

**device-connect** (`device-connect/` — `__main__.py` + the vendored
`debug_connect/` package). This one carried **no** Contacts paths — it was already
generic Flutter/Android tooling — so its migration was not path-generalization but:
1. **Vendored self-contained** (the six-module package copied in; its imports are
   relative, so it is location-independent).
2. **Consent-gated install** — the launcher's former silent pip auto-installer is
   replaced by a check that names the missing packages (`rich`, `plyer`,
   `zeroconf`) and asks before installing; declining aborts the run.
3. **De-hardcoded scrcpy** — the machine-specific `D:\tools\scrcpy` path is replaced
   by a cross-platform resolver (scrcpy on PATH first; on Windows, a per-user
   managed copy via `$SCRCPY_HOME` / `%LOCALAPPDATA%`; other OSes are told to
   install it from their package manager).
4. **Genericized branding** — the "Saropa" product name removed from the script's
   user-facing strings and docs (public-surface rule).

Verified: every file byte-compiles; the manifest is valid and both entries resolve;
device-connect imports self-contained from a foreign cwd and renders its menu; the
install prompt aborts on decline and installs on accept. **Not verifiable here (no
Android device):** actual adb/Flutter connection, health/power readings, scrcpy
launch, and the Windows scrcpy auto-download branch.

## Finish Report (2026-07-16)

### Objective summary

Two seed scripts were migrated into the bundled library at
`extension/scripts/library/`, each a self-contained folder registered in
`library.json` with i18n keys in `src/i18n/locales/en.json`. The scripts stand
alone as bundled artifacts; they are not yet surfaced in the UI, which depends on
the unbuilt Scripts view (plan steps 1–3). No other project was modified.

### What changed

- **organize-output** — a general-purpose rewrite of a project-internal reports
  organizer. `__main__.py` takes the target folder as an argument (default cwd),
  `modules/organizer.py` performs the dated-subfolder move + empty-folder prune,
  `modules/dates.py` isolates filename-date parsing. The former project-specific
  coupling (a hardcoded `reports/` root, a legacy singular `report/` folder, and
  launcher self-protection) was removed. A `--dry-run` mode was added that performs
  no move, log write, or prune.
- **device-connect** — the six-module `debug_connect` package was vendored
  self-contained (its imports are relative, so it is location-independent). A new
  `__main__.py` launcher replaces the original silent pip auto-installer with a
  consent gate: missing third-party packages (`rich`, `plyer`, `zeroconf`) are
  named and installed only on an explicit yes; declining exits without installing.
  A hardcoded `D:\tools\scrcpy` path in `media.py` was replaced by
  `_resolve_scrcpy_exe`, which prefers scrcpy on PATH, falls back to a per-user
  managed location on Windows (`$SCRCPY_HOME` / `%LOCALAPPDATA%`), and directs
  other platforms to their package manager. Product-name branding was removed from
  the script's user-facing strings and bundled docs.

### Review fixes applied (from the delegated review pass)

- `organizer.py`: added a check-to-move race guard so a destination that appears
  between the unique-name resolution and `shutil.move` is skipped rather than
  overwritten (POSIX `shutil.move` overwrites silently); gated the audit-log write
  on `moved > 0` so a run against an already-tidy folder writes no new dated log
  folder; corrected a comment that wrongly implied an earlier active-write check.
- `media.py`: rewrote the `update_scrcpy` docstring that still referenced the
  removed hardcoded path.
- `library.json`: clarified the folder prompt to state that a blank answer targets
  the project root (the intended safety default, which avoids sweeping the whole
  project when no folder is named).

### Verification

`py_compile` (with `SyntaxWarning` escalated to error) passes for every script
file. `library.json` parses and both `entry` paths resolve. organize-output was
exercised end to end: filename-dated files route to the correct dated subfolders,
undated files fall back to creation date, hidden and already-organized files are
skipped, empty folders are pruned, and a second run against the now-tidy folder
moves nothing and writes no new log. device-connect imports self-contained from a
foreign working directory and renders its menu; the dependency prompt aborts on
decline and proceeds to install on accept. No automated tests exist for these
scripts (the repository has no Python test harness); verification was by execution
and inspection.

### Not done (intentional)

The Scripts view, model, manifest loader, tag handling, and per-script config
storage (plan steps 1–3) are not built — these scripts are inert until that lands.
No public CHANGELOG/README entry was added, since the scripts are not yet
user-reachable. A third example script (`clean-workspace`) named in the plan was
not created. The `.vscodeignore` note and the `publish.py` manifest-validation step
(plan step 5) are not done.

## Finish Report addendum — hardening + tool-requirements preflight (2026-07-16)

Follow-up pass hardening the handoff-reflection risks and adding the manifest
`requires` preflight (handoff item 4).

### Hardening

- **Unsupported-interpreter guard.** Both launchers now check `sys.version_info` and
  exit with a clear named message on Python older than 3.8, instead of failing with
  a downstream error. (Python 2 cannot parse the files at all; the `python3` shebang
  and the manifest interpreter are the mitigation there.)
- **Blank folder argument.** organize-output now treats a blank / whitespace-only
  folder argument as the current directory (the project root), so an empty
  `${prompt}` answer organizes the project root rather than erroring on a folder
  literally named " ". Verified.
- **OEM-specific power list.** The Motorola force-stop list in `power.py` was renamed
  `_OEM_BLOAT` and documented: on a non-Motorola device those packages are absent
  and `am force-stop` of a missing package is a silent no-op, so the list is harmless
  elsewhere. The confirmation line no longer claims "Moto bloat stopped" on every
  device. A scan of the other vendored modules (`core`, `discovery`, `health`) found
  no further hardcoded machine paths — only the standard adb port `5555` and an
  example IP in a prompt string.

### Tool-requirements preflight (handoff item 4)

`library.json` entries gained an optional `requires` array of external-tool
declarations (`{ type: "command", name, reason, optional? }`) — the single source
of truth for tool checks. `device-connect` declares `adb` (required) plus `flutter`
and `scrcpy` (optional); `organize-output` declares none.

The `device-connect` launcher reads its own manifest entry at startup (stdlib only,
so it runs before the Python-package check) and checks each declared tool against
PATH: a missing **required** tool aborts with a clear named message and its reason
before any menu opens or any install is offered; a missing **optional** tool prints
a warning and continues. If the manifest is absent/unreadable (a direct run outside
the extension), the preflight is skipped rather than blocking. Verified: with no
tools on PATH the run aborts naming `adb`; with the tools present it passes to the
menu; the optional-tool warnings fire independently.

The view-side half of item 4 — the Scripts view reading `requires` to disable Run
and show a "needs adb" badge — lands with the view (plan steps 1–3); the manifest
schema is the forward-compatible contract it will consume.
