# Saropa Workspace — Phase 1 Plan

File and script shortcuts for VS Code. Pin files like favorites; single-click opens, double-click executes. Project-scoped and global (user) pins. Per-pin execution parameters. Optional timed/scheduled runs. Auto-pins (e.g. `pubspec.yaml`) that can be removed.

Modeled on `D:\src\saropa_lints\extension\` (TypeScript, esbuild, TreeDataProvider, command-driven, NLS `%key%` in `package.json` + runtime `l10n()` strings).

---

## 1. Scope (Phase 1 only)

In scope:
1. Pin any workspace file as a favorite (project pins + global/user pins).
2. Single-click a pin → open the file in an editor. Double-click → execute it.
3. Per-pin execution config: interpreter/command prefix (e.g. `python`), CLI args, working directory, env vars.
4. Schedule a pin to run at a time of day and/or on a repeating interval (while VS Code is open).
5. Auto-pins: a removable seed set (`pubspec.yaml`, `analysis_options.yaml`) surfaced per project.
6. Sidebar tree view (activity-bar container) with two top-level groups: Project Pins, Global Pins.
7. Add/remove/rename pins; reorder within a group.

Out of scope (later phases): pin groups/folders, drag-and-drop reorder, multi-root advanced merge UI, cross-machine sync beyond VS Code Settings Sync, run-history dashboard, output parsing.

---

## 2. Architecture

### 2.1 Tech stack
- TypeScript, bundled with esbuild to `dist/extension.js` (mirror `saropa_lints/extension/esbuild.js`).
- `engines.vscode: ^1.74.0`.
- No runtime dependencies beyond `vscode`. Scheduling and execution use the VS Code API + Node `child_process`/integrated terminal only.

### 2.2 Folder layout (`d:\src\saropa_workspace\extension\`)
```
extension/
  package.json            // manifest: views, commands, menus, configuration
  package.nls.json        // %key% strings for the manifest
  esbuild.js
  tsconfig.json
  icon.png  sidebar-icon.svg
  src/
    extension.ts          // activate(): wire providers, commands, scheduler
    model/
      pin.ts              // Pin type + PinScope enum
      pinStore.ts         // load/save project + global pins, auto-pin seeding
    views/
      pinsTreeProvider.ts // TreeDataProvider for both groups
      pinTreeItem.ts
    commands/
      pinCommands.ts      // add/remove/rename/open/run
      scheduleCommands.ts // set/clear schedule
    exec/
      runner.ts           // build + launch the command (terminal/child_process)
      doubleClick.ts      // single- vs double-click discriminator
    schedule/
      scheduler.ts        // timers, persistence, fire logic
    i18n/
      l10n.ts             // runtime string lookup
      locales/en.json
```

### 2.3 Data model
```ts
type PinScope = 'project' | 'global';

interface PinExecConfig {
  command?: string;        // interpreter/prefix, e.g. "python" | "node" | "" (run file directly)
  args?: string[];         // CLI args appended after the file path
  cwd?: string;            // working dir; default = workspace folder of the file
  env?: Record<string,string>;
  useIntegratedTerminal?: boolean; // default true
}

interface PinSchedule {
  atTime?: string;         // "HH:mm" local; fires daily at this time
  everyMs?: number;        // repeating interval; mutually combinable with atTime
  enabled: boolean;
  lastRun?: number;        // epoch ms (persisted to skip duplicate same-day fires)
}

interface Pin {
  id: string;              // stable uuid
  uri: string;             // file uri (project pins stored workspace-relative)
  label?: string;          // optional override; default = basename
  scope: PinScope;
  isAuto?: boolean;        // seeded auto-pin; removable
  exec?: PinExecConfig;
  schedule?: PinSchedule;
  order: number;
}
```

### 2.4 Storage
- **Project pins**: `${workspaceFolder}/.vscode/saropa-workspace.json` (`uri` stored relative to the folder so it survives moves/clones). One file per workspace folder; merged in multi-root.
- **Global pins**: `context.globalState` under key `saropaWorkspace.globalPins` (rides VS Code Settings Sync automatically). Global pin URIs are absolute.
- **Auto-pins**: not written to disk as data; computed on load from a configurable glob list (`saropaWorkspace.autoPins.patterns`, default `["pubspec.yaml","analysis_options.yaml"]`). Removing an auto-pin records its id in a per-project `removedAutoPins` list so it stays gone.

---

## 3. Feature design

### 3.1 Single-click open vs double-click execute
VS Code TreeView fires a single `command` on item selection; it has **no native double-click event**. Approach (`exec/doubleClick.ts`): each tree item's `command` calls one dispatcher `saropaWorkspace.activatePin`. The dispatcher times successive activations of the same pin id:
- second activation within ~400 ms → **execute**;
- otherwise (after the window) → **open**.
The 400 ms window is configurable (`saropaWorkspace.doubleClickMs`).

Because a timing heuristic can feel ambiguous, also provide explicit, discoverable paths that do not depend on it:
- inline **run** icon (`$(play)`) on each executable pin (visible on hover);
- context-menu **Open** and **Run** entries.
The double-click is the convenience layer on top, not the only way to run. (Recommended: ship both; the inline play button is the reliable primary, double-click the shortcut.)

### 3.2 Execution (`exec/runner.ts`)
Default to the **integrated terminal** (one reused terminal named "Saropa Workspace"), so the user sees output and it works for interactive scripts:
```
cd <cwd> ; <command> "<filePath>" <args...>
```
Command assembly:
- if `exec.command` is set → `command + file + args` (e.g. `python "scripts/build.py" --release`);
- if empty → run the file directly (rely on shebang/file association) or, for known extensions with no command, infer a sensible default (`.py`→`python`, `.js`/`.mjs`→`node`, `.ps1`→`pwsh -File`, `.sh`→`bash`) — inference is a fallback only, the explicit `command` always wins.
- `env` merged over the terminal env.
A per-pin `useIntegratedTerminal:false` instead runs via `child_process` and streams to an output channel (for non-interactive jobs / scheduled runs where a terminal popup is unwanted).

### 3.3 Per-pin parameters UI
Editing `exec` via a multi-step QuickPick / input flow (`Set Run Parameters` command): command prefix → args (space-split, quote-aware) → cwd → terminal toggle. No webview in Phase 1. Values persist into the pin's `exec`.

### 3.4 Scheduling (`schedule/scheduler.ts`)
- On activate, load all pins with `schedule.enabled`, arm timers.
- `atTime "HH:mm"`: compute next local occurrence; `setTimeout` to it, then re-arm for +24h; guard with `lastRun` so a fire isn't duplicated if VS Code reopens the same minute.
- `everyMs`: `setInterval`.
- Fires call `runner` with `useIntegratedTerminal:false` by default (background output channel) so scheduled jobs don't steal focus; per-pin override allowed.
- **Constraint (documented, not hidden):** timers only run while VS Code is open — this is in-process scheduling, not an OS cron. State surfaced in the tree (next-run badge) and an output-channel log line per fire.
- A toast on each scheduled fire naming the pin + outcome (per global UX rule: no silent async).

### 3.5 Auto-pins
On load, glob each workspace folder for `autoPins.patterns`, create transient `isAuto` pins under Project Pins (visually marked, e.g. dimmed + `$(star-empty)`). "Remove" on an auto-pin adds its id to `removedAutoPins`; it is not regenerated. A command restores all removed auto-pins.

---

## 4. Manifest (`package.json`) surface

- `viewsContainers.activitybar`: one container `saropaWorkspace` (sidebar icon).
- `views.saropaWorkspace`: one tree view `saropaWorkspace.pins`.
- Commands (all `saropaWorkspace.*`): `pinActiveFile`, `pinFile` (explorer context), `unpin`, `renamePin`, `openPin`, `runPin`, `activatePin` (click dispatcher), `setRunParameters`, `setSchedule`, `clearSchedule`, `togglePinScope`, `restoreAutoPins`, `refresh`.
- Menus:
  - `explorer/context`: "Saropa: Pin File" / "Pin as Global Favorite".
  - `editor/title/context`: "Saropa: Pin This File".
  - `view/item/context`: Open, Run, Set Run Parameters, Set Schedule, Rename, Unpin.
  - `view/item` inline: `$(play)` run, `$(close)` unpin.
  - `view/title`: refresh, restore auto-pins.
- Configuration (`saropaWorkspace.*`): `autoPins.patterns`, `doubleClickMs`, `defaultUseIntegratedTerminal`, `terminalName`, `interpreterDefaults` (extension→command map).

All user-facing manifest strings via `%key%` in `package.nls.json`; all runtime strings via `l10n('...')` + `locales/en.json` (translation-ready from the start; no MT run).

---

## 5. Build order (implementation steps)

1. Scaffold: `package.json`, `tsconfig.json`, `esbuild.js`, icons, `extension.ts` stub that activates and logs. Verify it loads in Extension Development Host.
2. Model + storage: `pin.ts`, `pinStore.ts` (project file + globalState read/write, no auto-pins yet). Unit-test the store.
3. Tree view: `pinsTreeProvider.ts`, `pinTreeItem.ts` — render Project/Global groups. Wire `refresh`.
4. Pin/unpin/rename commands + explorer/editor context menus.
5. Open vs run: `activatePin` dispatcher + `doubleClick.ts`; inline play button; `runner.ts` (terminal path first).
6. Run parameters QuickPick flow; persist `exec`.
7. Auto-pins: seeding, removal persistence, restore command.
8. Scheduling: `scheduler.ts`, set/clear schedule commands, next-run badges, fire toasts + output channel.
9. i18n wiring (`l10n` + `en.json`, `package.nls.json`), README, CHANGELOG.
10. Package `.vsix`; manual smoke test in dev host.

Each step verified by: TS compiles clean (IDE diagnostics), targeted unit test where logic exists (store, command builder, schedule next-occurrence, double-click discriminator), and a manual check in the Extension Development Host.

---

## 6. Open decisions (defaults chosen; override if wanted)

1. **Double-click reliability** — shipping inline play button as the reliable primary, double-click as a 400 ms-window convenience. (Default: both.)
2. **Scheduled-run output** — background output channel by default (no focus steal), per-pin terminal override. (Default: background.)
3. **Global pin URIs** — stored absolute (a global favorite is a specific machine path). (Default: absolute.)
4. **Interpreter inference** — explicit `command` always wins; inference only fills a blank for known extensions. (Default: on.)
