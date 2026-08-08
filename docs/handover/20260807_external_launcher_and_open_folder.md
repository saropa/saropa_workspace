# Handover — external launcher and open folder
2026-08-07 · saropa_workspace / main · session 2836ca9b

## Unfinished tasks
1. [in_progress] "No folder open" link opens file browser for config JSONs — the current `vscode.openFolder` call does not work (no folder picker appears or it doesn't let the user select a `.saropa/saropa-workspace.json`). Change it to a **file selection dialog** filtered to `*.json`, and remember the last-selected file across sessions. The user wants to pick the config file directly (e.g. `D:\src\saropa_lints\.saropa\saropa-workspace.json`), and the extension should open the containing workspace folder from that selection.
2. [pending] Test external window error capture — the `externalLauncher.ts` changes (stderr pipe, error/exit listeners) are built and compile-clean but unverified in the dev host. After the open-folder fix, press F5, open saropa_lints via the new file picker, and click the play button on the `generate_translations.py` pin. If the window still doesn't appear, the output channel should now show the actual error.

## Completed tasks
1. External launcher error capture — added `error` and `exit` event listeners to the spawned child process in `externalLauncher.ts`. Windows launcher now pipes stderr (`stdio: ["ignore", "ignore", "pipe"]`) so `Start-Process` failures surface as error toasts and output-channel lines instead of being silently swallowed. All three platform launchers (`launchExternalWindows`, `launchExternalMac`, `launchExternalLinux`) now return `ChildProcess`. Type-checks and bundles clean.
2. "No folder open" clickable link (partial) — wired up the launcher panel header so "No folder open" renders as a link (`--vscode-textLink-foreground`, underline, cursor:pointer). Added `noProject` flag to `LauncherHeader`, class toggle in `renderHeader`, click handler posting `openFolder`, message handler routing to `vscode.openFolder`. The link appears and is styled, but the `vscode.openFolder` command does not produce a usable result — the user cannot select a config file from it.

## Session narrative

### User requests
1. User reported: `d:\src\saropa_lints\extension\scripts\generate_translations.py` does not launch in a window. Pointed to `D:\src\saropa_lints\.saropa\saropa-workspace.json` as the config.
2. Clarified: "1. note: image.png renamed to image_translations.png" and "2. there is no double-click it is single click to expand/contract. the play button is supposed to launch but it just shows the toast and nothing else."
3. After I proposed adding error capture: user said the script "runs fine from powershell manually" — the issue is specifically with the extension's external launcher.
4. User needed F5 dev host but got "No folder open". Asked: "can you make that a hyperlink to browse for the config file?"
5. After implementation: **"does not work and cannot select D:\src\saropa_lints\.saropa\saropa-workspace.json"** — the `vscode.openFolder` approach failed. User's exact request: **"change it to a file selection for jsons. remember the current / last file"**
6. User then requested `/handover`.

### Investigation & analysis
- Traced the full execution path for a pin with `runLocation: "external"` and no `command` set:
  - `shortcutExecution.ts:runShortcutCommand` → `runner.ts:runShortcut` → `runPlanning.ts:planRun` → `externalLauncher.ts:runInExternal` → `launchExternalWindows`
  - Interpreter resolves via shebang (`#!/usr/bin/env python3` → `python3` → normalized to `python` on Windows)
  - `python` IS on PATH (`D:\Tools\Python\Python314\python.exe`)
  - The command line would be: `python "D:\src\saropa_lints\extension\scripts\generate_translations.py"`
  - External launch spawns detached PowerShell → `Start-Process -FilePath 'pwsh.exe' -ArgumentList '-NoExit','-NoProfile','-EncodedCommand','<base64>'`
- The root cause of the "no window" bug is still unknown. The spawn is fire-and-forget with `stdio: "ignore"` and no event listeners, so failures were silently swallowed. The error capture fix should reveal the actual cause on next test.
- `pwsh.exe` is at `C:\Program Files\PowerShell\7\pwsh.exe`, `powershell.exe` at standard location. Both available.

### Changes made
1. `extension/src/exec/externalLauncher.ts`
   - Added `import type { ChildProcess } from "child_process"`
   - `runInExternal`: captures returned `ChildProcess`, attaches `child.on("error", ...)` and `child.on("exit", ...)` listeners. Exit listener reads accumulated stderr and shows error toast on non-zero exit.
   - `launchExternalWindows`: return type `void` → `ChildProcess`, `stdio` changed from `"ignore"` to `["ignore", "ignore", "pipe"]`, returns `child`
   - `launchExternalMac`: return type `void` → `ChildProcess`, returns `child`
   - `launchExternalLinux`: return type `void` → `ChildProcess`, returns `child`

2. `extension/src/views/launcherViewData.ts`
   - Added `noProject: boolean` to `LauncherHeader` interface
   - `buildHeader` sets `noProject: !primary && !vscode.workspace.name`

3. `extension/src/views/launcherViewShell.ts`
   - Computes `noProject` boolean
   - Adds `no-project` CSS class to `#projName` div when true

4. `extension/src/views/launcherAssets.ts`
   - Added `.project-name.no-project` styles: cursor pointer, underline, `--vscode-textLink-foreground` color, hover active color

5. `extension/src/views/launcher/launcherScriptCore.ts`
   - `renderHeader` toggles `no-project` class based on `h.noProject`
   - Click handler on `projName`: when `.no-project` class present, posts `{ type: 'openFolder' }`

6. `extension/src/views/launcherViewMessages.ts`
   - Added `openFolder` message type handler routing to `vscode.commands.executeCommand("vscode.openFolder")`

7. `CHANGELOG.md`
   - Added launcher link and external error capture entries under `[Unreleased]`

8. `plans/guides/STYLEGUIDE.md`
   - Added §4.13: "An empty-state label that names its own fix is a link to that fix"

### Decisions & trade-offs
- Piped stderr only on Windows (Mac/Linux keep `stdio: "ignore"`) to avoid SIGPIPE risk on Unix where a terminal emulator writing to a closed pipe could be killed.
- The success toast still fires immediately (synchronous), with any async error toast arriving as a follow-up. Could delay the success toast but chose not to — the error toast is more prominent (`showErrorMessage` vs `showInformationMessage`).
- Used existing `run.externalFailed` i18n key for all error cases (spawn error, exit error) since it already takes `{name, error}` tokens.

### Rejected / dismissed / deferred
- **`vscode.openFolder` as the open-folder mechanism** — rejected by user. It doesn't allow selecting a config JSON file, and may not produce a folder picker at all in some contexts. Must be replaced with `vscode.window.showOpenDialog` filtered to `*.json`, with the selected file's parent folder opened as the workspace.
- **Adding verbose spawn logging** — deferred. The error/exit listeners should surface the root cause; if they don't, verbose logging can be added later.
- **Changing the pin config** to add an explicit `command` — not the issue. The interpreter resolves correctly via shebang; the problem is in the spawn/Start-Process chain.

### User feedback & corrections
- "false. it runs fine from powershell manually" — pushed back on my suggestion that interpreter resolution or PATH might be the issue.
- "there is no double-click it is single click to expand/contract. the play button is supposed to launch" — corrected my assumption about double-click triggering runs.
- "does not work and cannot select D:\src\saropa_lints\.saropa\saropa-workspace.json" — the `vscode.openFolder` approach failed.
- "change it to a file selection for jsons. remember the current / last file" — explicit direction for the next implementation.

## Key files & paths
- `extension/src/exec/externalLauncher.ts` — external window launcher, error capture added
- `extension/src/exec/runner.ts` — run entry point, dispatches to external/terminal/background
- `extension/src/exec/runPlanning.ts` — resolves interpreter, cwd, command line
- `extension/src/exec/commandPlan.ts` — interpreter precedence, `buildWindowsStartup`, `encodeForPowerShell`
- `extension/src/views/launcherViewShell.ts` — launcher webview initial HTML
- `extension/src/views/launcherViewData.ts` — `LauncherHeader` interface, `buildHeader`
- `extension/src/views/launcherAssets.ts` — launcher CSS
- `extension/src/views/launcher/launcherScriptCore.ts` — launcher client script
- `extension/src/views/launcherViewMessages.ts` — webview → host message handler
- `D:\src\saropa_lints\.saropa\saropa-workspace.json` — the pin config for the test target
- `D:\src\saropa_lints\extension\scripts\generate_translations.py` — the script that should launch

## How to verify
1. `cd extension && npx tsc -p ./ --noEmit` — must be clean (verified)
2. `cd extension && node esbuild.js` — must bundle (verified)
3. F5 → dev host → use the "No folder open" link (needs fix: should open file dialog for JSONs, not `vscode.openFolder`)
4. Open `D:\src\saropa_lints` folder → click play on `generate_translations.py` pin
5. If window doesn't appear, check Saropa Workspace output channel for `external launcher failed:` or `spawn error:` lines — these are new and should reveal the root cause

## Gotchas & traps
- The `launcherScriptCore.ts` is plain JS (no TypeScript) — it's injected into the webview as a string. No type annotations allowed.
- Webview client scripts cannot call `l10n()` — display strings must be inline or host-rendered (STYLEGUIDE §2).
- `extension/CHANGELOG.md` and `extension/README.md` are generated copies — always edit the root versions. A write hook blocks edits to the extension copies.
- The `vscode.openFolder` command behavior varies: it may open a native dialog, navigate the Explorer, or do nothing depending on context (extension dev host, no folders open, etc.). The user confirmed it doesn't work for their use case.
- `globalState` is the right persistence mechanism for "last selected config file" — it survives across sessions and syncs via VS Code Settings Sync.
