# Launcher cards decide Run-vs-Open by whether the file is executable

Saropa Launcher cards chose the head button's primary action from file-vs-action
alone: every file shortcut was hardcoded runnable and led with Open. A runnable
script (`publish.py`) therefore led with Open instead of Run, and a
non-executable data file (`.vscode/saropa-workspace.json`) was given a
meaningless Run button. The card now derives Run-vs-Open from whether the file is
actually executable, so a script leads with Run and a document/data file is
open-only.

## Defect

`toItem` in `extension/src/views/launcherItems.ts` set `runnable: true` for every
file shortcut and `openable: isFile`. The webview head logic in
`launcherAssets.ts` then read `headOpens = it.openable`, so every file led with
Open and every file also received a secondary Run button in the drawer. The
"file" kind was the only axis considered; whether the file could meaningfully run
was never consulted, even though the exec catalog (`exec/interpreters.ts`)
already knows which extensions map to an interpreter.

Result, as reported by the developer (2026-06-28):

- A `.py` script led with **Open** when its main intent is to **Run**.
- A `.json` config card carried a **Run** button, though running a data file is
  meaningless.

## Change

Pure data layer (`extension/src/views/launcherItems.ts`):

- New `fileExecutable(shortcut, fileName)` predicate. A file is executable when it
  has a non-empty explicit `exec.command`, when it is a run target that names its
  work in args (`exec.includeFilePath === false` with args — npm/Make), or when
  its extension maps to an interpreter via `candidatesForExt` from the exec
  catalog. A plain document/data file (`.json`, `.md`, `.txt`, no extension)
  matches none and is open-only. This mirrors how the runner resolves what to
  execute, so the card's affordance matches what Run would actually do.
- `toItem` now sets `runnable = isFile ? fileExecutable(...) : true` (a non-file
  action always runs) and a new `headAction` field — `"run"` when runnable,
  `"open"` otherwise — so the run-vs-open decision is computed in the testable,
  vscode-free layer and the webview only renders it.
- `LauncherItem` gained the `headAction?: "run" | "open"` field; the browse-only
  watch/project-file items leave it undefined (no head button), preserving their
  expand-then-act model.

Webview asset module (`extension/src/views/launcherAssets.ts`):

- The head button is gated on `it.headAction` and leads with Run unless
  `headAction === "open"`. The drawer shows Open whenever a file's head does not
  already carry Open (`it.openable && it.headAction !== "open"`) — so a script
  gets Open as its secondary action and a browse-pane card keeps its drawer Open,
  while a document leading with Open does not repeat it. The redundant
  drawer-Run block was removed (an executable file now leads with Run on the
  head; no card leads with Open while being runnable).

## Result

- A script file (`.py`, `.sh`, `.ps1`, `.js`, or any file given a run command)
  leads with **Run** on the head and offers **Open** in the drawer.
- A document/data file (`.json`, `.md`, no interpreter) leads with **Open** and
  carries **no Run** affordance.
- A non-file action still leads with Run; the browse-only Watches and
  Project-files panes still carry no head button.

## Tests

`extension/src/test/launcherItems.test.ts` — the test that pinned the old blanket
`runnable: true` was replaced with one asserting a document leads with Open, a
`.py` script and a shell action lead with Run (each checking `headAction`). Two
new tests cover the explicit-run-command opt-in on a `.json` and the open-only
data file (`.vscode/saropa-workspace.json`). `launcherAssets.test.ts` comments
were corrected; its CSS/script assertions were unaffected. Scoped run of both
files: 50 tests pass. Touched files type-check clean (`tsc --noEmit`); the bundle
builds (`node esbuild.js`).

## Style guide

`plans/guides/STYLEGUIDE.md` section 1.1a — the head-button rule was rewritten:
the primary action is chosen by whether the card is executable (computed as
`headAction` via `fileExecutable`), not by file-vs-action. It documents that a
script leads with Run + Open in the drawer, a document leads with Open with no
Run, and an absent `headAction` means no head button — superseding the earlier
"every file leads with Open, Run is its secondary" rule.
