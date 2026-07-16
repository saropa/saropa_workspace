# Saropa Suite integration — Workspace as the conductor

> **Status (2026-07-16):** Pillar B is implemented end to end —
> `saropaWorkspace.dailyReport` (on-demand preview) and the
> `saropaWorkspace.recipe.suiteDailyReport` recipe/routine form in
> `extension/src/commands/dailyReport.ts`. Log Capture shipped its
> `getDailySummary` API in v9.2.3, so that section renders live; Lints and
> Drift Advisor sections light up when their plan files are implemented.
> Pillar C's "daily report as a morning pin" is done (`ritual.suite`, the
> Morning routine's closing member). Open: Pillar A (Control Center + Suite
> Modes) and Pillar C's run→log bridge and boot-sequence modes.

## Finish Report (2026-07-16)

The Suite daily report gained its scheduled/routine form. A new
`ritual.suite` scheduled recipe ("Saropa Suite daily report", default 06:30,
seeds disabled, offered in every workspace with no detection guard) invokes
`saropaWorkspace.recipe.suiteDailyReport`, which writes the same content as the
on-demand preview — today's and yesterday's `getDailySummary` payloads from the
installed Suite extensions plus Workspace run activity — to a dated `reports/`
file and returns the path so a routine summary merges and links it. The recipe
joins `MORNING_MEMBER_ORDER` as the closing member, so the cross-tool recap
lands as the last collapsible section of the one morning document. Sibling
failure handling is unchanged: absent tool, wrong `apiVersion`, invalid shape,
thrown call, or a call past the 5-second ceiling all degrade to an omitted
section. Tests pin the new surface: `ritual.suite` seeds without project
markers as a command action, and sorts last in the morning member order
(20/20 in the scoped recipe suites; tsc and esbuild clean).

**Vision.** Saropa Workspace is the front door a developer opens first. Make it the
**conductor of the Saropa Suite**: the one surface that (a) shows what every Suite
tool did today, (b) turns Suite capabilities on and off, and (c) orchestrates them
together — one click puts the whole toolchain into the right mode for what the
developer is doing. The tools already ship the instruments; Workspace conducts.

Siblings live under `d:\src\` and are described in `ABOUT_SAROPA.md`:
Log Capture (`d:\src\saropa-log-capture`), Saropa Lints (`d:\src\saropa_lints`),
Drift Advisor / Drift Viewer (`d:\src\saropa_drift_advisor`), and the Saropa Suite
extension pack.

## Verified integration surfaces (read from the sibling manifests, 2026-07-16)

The Suite already exposes everything the conductor needs for **control** — public
settings any extension can flip (`workspace.getConfiguration().update()`) and
commands any extension can invoke (`vscode.commands.executeCommand`):

| Tool (extension id) | On/off + mode controls that exist today |
|---|---|
| Log Capture (`saropa.saropa-log-capture`) | `saropaLogCapture.enabled` setting; `toggleCapture` / `start` / `stop` / `pause`; `troubleMode.toggle`; `generateReport`; `showSignals`; `exportSignalsSummary`; `applyPreset` |
| Saropa Lints (`saropa.saropa-lints`) | `saropaLints.enabled` setting; `saropaLints.enable` / `disable`; `runAnalysis`; `openProjectHealthDashboard`; `openConsolidatedDashboard` |
| Drift Advisor (`saropa.drift-viewer`) | `driftViewer.enabled`, `driftViewer.enableMonitoringAndLogging` settings; `monitoring.kill` / `monitoring.resume`; `pauseDiscovery` / `resumeDiscovery`; `captureSnapshot`; `showAnomalies` |

The Suite also has a documented **deep-link protocol** of never-renamed command ids
for jumping into a sibling (`saropaLogCapture.openSignal`,
`saropaLogCapture.openSqlHistoryForFingerprint`, `driftViewer.*`, `saropaLints.*` —
see `saropa-log-capture/src/commands-suite.ts`).

What does **not** exist yet: a data-returning API for the daily report
(`getDailySummary`) — that is the one sibling addition this plan files (Pillar B).
"On/off" here means each tool's own `*.enabled` setting and pause/stop commands —
feature-level control, not uninstalling the extension.

## Pillar A — Suite Control Center (control, ships first, no sibling changes)

A **Saropa Suite** section in the Workspace sidebar (or a hub QuickPick matching the
existing `hubQuickPick.ts` pattern): one row per Suite tool showing installed/absent
and enabled/paused state, with inline toggles.

- Detection: `vscode.extensions.getExtension(id)` — absent tools render as a dimmed
  row with a Marketplace install link, never an error.
- State: read each tool's `*.enabled` (and Log Capture's capture state / Drift's
  monitoring state where a setting exposes it) via `workspace.getConfiguration()`.
- Toggles: flip the sibling's setting or invoke its toggle command. Every toggle
  emits a toast naming the tool and the new state ("Saropa Lints: analysis paused").
- Deep links: each row's secondary actions open the tool's own dashboards
  (`showSignals`, `openProjectHealthDashboard`, `openInPanel`).

**Suite Modes (the WOW).** One command sets the whole Suite into a named mode:

- **Debugging** — Log Capture capturing + Trouble Mode on; Lints paused (no analysis
  churn mid-session); Drift monitoring on.
- **Review** — Lints full analysis + health dashboard; Log Capture idle; Drift idle.
- **Quiet / Focus** — everything paused except Workspace itself (pairs with the
  existing `focusMode.ts`).
- **Full power** — everything on.

Modes are just named bundles of the settings/commands above — declarative data, not
new machinery. Current mode shows in the status bar; switching announces what
changed. Mode definitions live with the existing store patterns so a project can
override them in `.vscode/saropa-workspace.json` later (deferred until asked).

## Pillar B — Consolidated daily report (data)

A **"Saropa Workspace: Daily Report"** command (`saropaWorkspace.dailyReport`)
rendered as a read-only Markdown virtual document, reusing the Run Analytics
provider pattern (`extension/src/commands/runAnalytics.ts`, scheme-based
`TextDocumentContentProvider`, no webview, no temp file, refresh-in-place).

Sections, in order:

1. **Executive summary** — two-to-three plain-language sentences for the day across
   the whole Suite (runs, pass/fail, sessions captured, signals, lint health),
   mirroring Log Capture's proven summary block.
2. **Trouble** — failures only (failed runs, errored sessions, high-impact signals),
   borrowing Trouble Mode's hide-the-nominal principle. Empty → one line saying so.
3. **Workspace activity** — the day's run records from local telemetry, date-scoped.
4. **Per-tool sections** — yesterday's/today's dev sessions from Log Capture, lint
   health from Saropa Lints, query/anomaly summary from Drift Advisor — each with
   deep links into the tool.

**Data channel: the extension-exports API.** Each sibling exposes one method from
its `activate()` return value:

```ts
// vscode.extensions.getExtension('saropa.saropa-log-capture')?.exports
interface SaropaSuiteApi {
  apiVersion: 1;
  getDailySummary(date: string /* YYYY-MM-DD */): Promise<DailySummary | undefined>;
}
interface DailySummary {
  tool: string;               // 'saropa-log-capture' | 'saropa-lints' | 'drift-viewer'
  date: string;
  headline: string;           // one plain-language sentence for the executive summary
  counts: Record<string, number>; // sessions, errors, warnings, signals, violations…
  trouble: Array<{ label: string; detail?: string; command?: string; args?: unknown }>;
  openCommand?: string;       // deep-link command id for "Open in <tool>"
}
```

Each tool already computes this for its own UI (Log Capture's executive summary and
signal counts, Lints' health score, Drift's anomaly counts) — the API is a thin
wrapper, not new logic. The API is the contract: versioned (`apiVersion`), no file
scraping, no dependence on sibling internals. Tool absent or API missing
(older version) → section omitted, report still valid. A solo Workspace install
produces a workspace-only report.

**Sibling work is filed, not done here.** One plan file per sibling repo (their
`plans/` folder) specifying this exact API shape — writing plans into a sibling is
allowed; editing its code is not. Workspace's consumer side ships behind the
absent-tool fallback, so ordering does not block.

## Pillar C — Orchestration moments (conductor behaviors)

Small, high-leverage links between existing features — each one is a thin bridge,
not a subsystem:

- **Run a shortcut → offer its log.** After a script pin runs, if Log Capture is
  installed and captured the session, the completion toast gains an "Open log"
  action (deep-link into the session). Extends the existing run-completion feedback.
- **Boot sequence conducts.** The existing `bootSequence.ts` can apply a project's
  preferred Suite Mode on workspace open (project-scoped, stored alongside pins in
  `.vscode/saropa-workspace.json`) — opt-in, off by default.
- **Daily report as a morning pin.** The report command is pinnable like anything
  else; the existing scheduler model can later emit it on a cron (deferred; do not
  claim shipped until wired).

## Constraints

- **Local-only, read-only data.** Nothing transmitted; honors
  `saropaWorkspace.telemetry.enabled` for the workspace-activity section (off →
  standard "turn it on" note; sibling sections unaffected).
- **No sibling code edits from this repo** — sibling API work is filed as plans in
  their repos. Control uses only their public settings/commands.
- **No new dependencies, no new webview** (blast-radius gate). Reuse the virtual-
  document provider, tree, QuickPick hub, toast, and scheduler patterns that exist.
- **Every string externalized** (`suite.*`, `dailyReport.*` in
  `src/i18n/locales/en.json`; `%…%` + `package.nls.json` for manifest). `Saropa `
  title prefix per the style guide. American English.
- **Visible feedback everywhere**: every toggle/mode switch names the tool and the
  resulting state; no silent async.

## Acceptance criteria

- Control Center lists all four Suite tools with live installed/enabled state;
  toggles flip the sibling's setting/command and toast the named result; absent
  tools show an install link, no errors.
- Suite Modes: switching to Debugging/Review/Quiet/Full applies the documented
  setting+command bundle and reports what changed; current mode visible in the
  status bar.
- `saropaWorkspace.dailyReport` renders executive summary → Trouble → workspace
  activity → per-tool sections; sibling sections appear iff the tool's
  `getDailySummary` API responds; workspace-only fallback renders cleanly.
- One API plan file exists in each sibling repo specifying the `SaropaSuiteApi`
  shape above.
- All strings externalized; telemetry-off degrades only the workspace-activity
  section.

## Sequencing

1. **Pillar A** (Control Center + Suite Modes) — no sibling dependency, ships alone.
2. **Pillar B consumer + sibling plan files** — report ships with workspace-only
   content immediately; sibling sections light up as each tool adopts the API.
3. **Pillar C** — run→log bridge first (highest value, smallest surface), then
   boot-sequence modes; scheduled report deferred.
