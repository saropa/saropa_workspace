# Saropa Workspace — Composite recipes (routines) + the Workspace Hygiene recipe

Two linked additions, born from a real incident:

1. **Composite recipes ("routines")** — a *recipe of recipes*: an ordered set of
   existing recipe pins that run **in sequence** as one action, optionally on a
   schedule. The headline use is a **Morning routine** that runs several
   scheduled rituals back-to-back when you arrive.
2. **The Workspace Hygiene recipe** — a concrete new recipe (catalog class **H**)
   that scans the workspace for the directory-bloat failure that triggered this
   spec, writes a dated report, and offers a one-click guard. It is a natural
   first member of the Morning routine.

This extends the existing recipe model in [RECIPE_BOOK.md](RECIPE_BOOK.md): the
scheduled-ritual class (recipes 26–35) and the `macro` action already exist; this
adds the **routine** action kind above them and one new recipe below them.

---

## 0. Motivating incident (the details, in full)

Opening a sibling project (`saropa-log-capture`) froze VS Code: one CPU core
pinned at 100%, window unresponsive, only a force-kill recovered it.

**Root cause.** `@vscode/test-electron` downloads a **complete ~200 MB VS Code
build per version** under `.vscode-test/` and never prunes old ones. It had
reached **16.3 GB / 179,824 files across 26 version installs**. The directory is
gitignored (so it never commits) but is **not** in VS Code's default
`files.watcherExclude`, so on folder-open the file watcher and search/TS indexer
crawl the entire tree. Gitignore stops commits; it does **not** stop the watcher.

This generalizes: VS Code crawls the whole workspace on open except a short
default exclude list (`node_modules`, `.git`, a few others). **Any** directory
that grows large and is not watcher-excluded causes the same hang — test caches,
build outputs, generated blobs, report archives.

**Detection used (reproducible).** Two scans over the project roots:

- *Scan A — test-downloader projects and their guard state:* for each project,
  does `package.json` depend on `@vscode/test-(electron|cli)`, and does
  `.vscode/settings.json` carry a `**/.vscode-test/**` entry in
  `files.watcherExclude`?
- *Scan B — any directory > 1 GB that VS Code would crawl:* every immediate child
  dir except `node_modules` / `.git`, measured recursively.

**Findings (scan date 2026-06-25, across `D:\src`).**

| Project | Uses | watcherExclude guard | State |
|---|---|---|---|
| `saropa-log-capture` | `@vscode/test-electron` | yes (added) | fixed |
| `vscode-versionlens-master` | `@vscode/test-electron` | **NO** | **at risk — same failure** |

Other directories > 1 GB that are crawled on open (secondary; projects still open
today, but each adds watch/index load): `contacts\blobs` 4.4 GB,
`contacts\reports` 3.6 GB, `saropa_radiance_vector\game` 3.4 GB, `contacts\build`
2.9 GB, `saropa_kykto\build` 2.2 GB, `web.app.dotnet\Saropa` 1.6 GB,
`saropa_bangers\build` 1.3 GB, `saropa_drift_advisor\example` 1.2 GB,
`saropa_lints\build` 1.1 GB.

**Prevention (two halves).**

- *Stop the hang:* add `"files.watcherExclude": { "**/.vscode-test/**": true }`
  to each test-downloader project — proactively, even before `.vscode-test`
  exists. The watcher then never recurses the cache.
- *Stop the growth at the source:* pin the test runner to a single VS Code
  version (one install, not 26) and/or prune `.vscode-test` in a `posttest` / CI
  step so it cannot accumulate.

The full incident write-up and per-project commands live in the originating
project's bug folder: `saropa-log-capture/bugs/bug_001..003`. This spec turns the
**recurring** half — "scan a project for this class of bloat and guard it" — into
a reusable recipe, and the "run it every morning" half into a routine.

---

## 1. Composite recipes ("routines") — a recipe of recipes

### 1.1 Concept

A **routine** is a recipe whose action is an **ordered list of other recipe
pins**, run **one after another**. It is the recipe-level analog of the `macro`
action, with one crucial difference:

| | `macro` (exists) | `routine` (new) |
|---|---|---|
| Members are | inline raw steps (`open`/`shell`/`url`/`command`) | references to **other recipe pins** |
| Reuse | none — steps are authored on the one pin | full — a member is a real recipe, edited in one place |
| Each member has | no identity, no report, no badge | its own action, report artifact, status badge, and (optionally) its own schedule time |
| Editing a member | edit the macro | edit the member recipe; every routine that includes it updates |

A routine is the right shape when the members are **already recipes you want to
keep individually** (the dawn lint, the sunrise stats, the hygiene scan) and you
also want to fire them as a block. A macro stays right for a one-off inline
sequence that is not worth three separate pins (e.g. copy `.env.example` → open
`.env`).

### 1.2 Model changes (extend the existing inventory, no parallel structures)

Add `"routine"` to the `PinKind` union and one field to `PinAction`
(`extension/src/model/pin.ts`):

```ts
export type PinKind = "file" | "shell" | "url" | "command" | "macro" | "routine";

export interface RoutineMember {
  // Which recipe to run, by its stable recipeId (resolved to the live pin in the
  // same folder at run time, so an edited/promoted member is still found).
  recipeId: string;
  // Optional display override for the routine's progress line; defaults to the
  // member pin's label.
  label?: string;
}

export interface PinAction {
  // ...existing fields...
  // routine: ordered members run in sequence (see runRoutine).
  members?: RoutineMember[];
}
```

No new top-level `Pin` field — a routine is a `PinAction` like every other
recipe, so it round-trips through promote/persist unchanged. `members` reference
recipes **by `recipeId`** (not pin id) so the link survives the recipe →
promoted-pin transition and reloads, matching how sticky removal already keys on
`recipeId`.

Routines do **not** nest (a routine member that is itself a routine is skipped
with a logged note), the same one-level rule `macro` already enforces — it keeps
sequencing and failure semantics bounded and prevents cycles.

### 1.3 Execution semantics (`runRoutine`)

Add `runRoutine(pin)` to `extension/src/exec/runner.ts`, dispatched from
`runAction` for `kind === "routine"`, mirroring `runMacro` but over recipe pins:

1. Resolve each `members[i].recipeId` to the live pin in the same folder.
   A missing member is logged and skipped (never aborts the routine).
2. Run members **strictly in sequence** — `await` each member's `runAction`
   before starting the next. This matters because most morning members are shell
   recipes that write a `reports/*` artifact; overlapping them would interleave
   output and spike CPU (the exact thing the hygiene member guards against).
3. **Failure policy: continue-on-failure**, like `runMacro`. A member that throws
   or exits non-zero is recorded and the routine proceeds; one broken member
   never blocks the rest. (A future `stopOnFailure` flag is noted in Open
   decisions, not built now.)
4. Write a **routine summary** `reports/<stamp>_<routine>.md`: one row per member
   — name, outcome (ok / failed / skipped), duration, and a link to that member's
   own report artifact when it produced one. Auto-open the summary when any
   member failed or any member's own `autoOpen`/threshold fired; otherwise stay
   quiet (badge only).
5. The routine pin's **status badge** aggregates the worst member outcome
   (reusing the per-pin badge from recipes 26/32), so a red routine means "one of
   this morning's checks needs you."

Interactive members (a member whose run needs `${prompt}`/`${pick}`) are skipped
in an **unattended** routine fire (same rule the scheduler already applies to
scheduled pins) and run normally when the routine is triggered by hand.

### 1.4 Scheduling — the routine carries the schedule, not the members

A routine reuses the existing `PinSchedule` fields. The **Morning routine** ships
as a scheduled recipe with `daily("08:00")`, **disabled by default** (like all
scheduled rituals — created as a suggestion, enabled by the explicit act of
promotion). When enabled it fires once and runs its members in sequence.

Members keep their own suggested times for when they are run **standalone**, but
inside a routine the routine's single fire drives them — there is one timer for
the block, not one per member. This avoids five separate 05:00–09:00 timers when
the user actually wants "run the morning set when I sit down."

### 1.5 Detection / auto-offer

The recipe detector offers a **Morning routine** when it has already detected
**two or more** morning-appropriate scheduled rituals in the folder (so it never
proposes an empty or single-member routine). It pre-populates the member list, in
run order, from whichever of these were detected:

1. **Workspace hygiene scan** (class H, §2) — fast, runs first so a bloated tree
   is caught before the heavier members.
2. **Dawn lint sweep** (#26).
3. **Sunrise project stats** (#27).
4. **Standup digest** (#28).
5. **PR review queue** (#34).

The user edits membership and order freely afterward — a routine is just a pin
with an ordered `members` list. Any set of recipe pins can be hand-composed into
a routine via a **"New routine from selection"** command (multi-select pins →
create a routine pin referencing them); auto-offer is only the convenient default.

### 1.6 UX

- Routine lands in **Recipes › Scheduled** (same group as its members), rendered
  with a distinct icon (`run-all` / `checklist`) so it reads as a block, not a
  single task.
- Running it streams a progress line per member — `Routine "Morning" — 2/5:
  Dawn lint sweep…` — into the shared output channel; the summary report opens at
  the end per the rule above.
- **Run now** works exactly as for any scheduled pin (run-ahead-of-schedule to
  test it or get a fresh answer).
- A routine's tree row can expand to show its members read-only (reveal/jump to
  each member pin), reusing the group-expansion the tree already does.

---

## 2. The Workspace Hygiene recipe (catalog class H)

A new recipe class **H — Workspace hygiene**, the concrete recipe this incident
produced. Like every recipe it acts on the **open workspace folder(s)** by
default (recipes are per-folder; never a blind whole-disk crawl), with an
optional configured set of extra roots for a cross-project morning sweep (§2.4).

| # | Recipe | Fires | Detected from | What it does |
|---|--------|-------|---------------|--------------|
| 63 | **Workspace bloat scan** | daily 04:45 (disabled until promoted) | always applicable | scans the workspace for directories VS Code crawls on open that have grown past a threshold, plus test-downloader caches missing a watcher guard; writes `reports/<stamp>_workspace_hygiene.md`; **auto-opens and badges the pin only when something crosses a threshold** (silent when clean) |

### 2.1 What it scans (scoped, cheap, no full content read)

Per scan root (default: each open workspace folder):

- **Oversized crawlable dirs** — each immediate child directory except
  `node_modules` / `.git`, measured recursively; flag any over a configurable
  size or file-count ceiling (defaults: **1 GB** or **50,000 files**). This is a
  size/stat walk, not a content read.
- **Unguarded test-downloader cache** — if `package.json` depends on
  `@vscode/test-(electron|cli)`, check whether `.vscode/settings.json` excludes
  `**/.vscode-test/**` from `files.watcherExclude`. Missing guard = a finding even
  when `.vscode-test` is currently small or absent (it *will* grow).
- **Bloat-prone names not watcher-excluded** — `.vscode-test`, `.vscode-test-web`,
  `build`, `dist`, `out`, `coverage`, `reports`, `.gradle`, `Pods`,
  `.dart_tool`, `target`, `bin`/`obj` — flag the ones present, large, and absent
  from the project's `files.watcherExclude`.

### 2.2 Report + thresholds

`reports/<stamp>_workspace_hygiene.md` contains: the flagged directories with
size / file count, the test-downloader guard verdict, and for each finding the
**exact remediation** (the `files.watcherExclude` line to add; the prune/pin
advice for `.vscode-test`). The pin badges red and the report auto-opens **only**
when a finding crosses a ceiling; a clean scan is silent (badge green, report
written for the trend, not opened) — the no-noise rule the scheduled rituals
already follow.

### 2.3 Remediation actions (current project only; never silent cross-project edits)

Two follow-on actions offered from the report / pin context menu:

- **Guard this project** — add `"files.watcherExclude": { "**/.vscode-test/**":
  true }` (and any flagged bloat-prone dir) to the **current** workspace's
  `.vscode/settings.json`. Scoped to the open project; merges into existing
  `files.watcherExclude` rather than overwriting it.
- **Prune `.vscode-test`** — a confirm-gated delete of the cache in the current
  workspace, naming the size reclaimed in the prompt.

For findings in **other** roots (the §2.4 cross-project mode), the recipe
**reports** the remediation but does not apply it — editing another project is
out of scope for an automated action; the report carries the ready-to-run command
for the user. (This mirrors the workspace's standing rule that a fix tracing to
another project is handed back, not applied.)

### 2.4 Cross-project ("morning sweep") mode

A setting `saropaWorkspace.hygiene.roots` (default: the open workspace folders)
may list additional parent roots (e.g. `D:\src`) so the scan covers every sibling
project — the actual shape of the incident, where one bloated sibling froze the
editor. In this mode the recipe reports per project and applies guards only to the
open workspace (per §2.3). This is opt-in: the default recipe stays per-workspace.

### 2.5 Why this is a recipe, not a one-off script

The investigation that produced this spec was manual (two PowerShell scans, eyeball
the results, hand-edit a settings file). As a recipe it is: detected once, run on
demand or on a schedule, self-reporting, idempotent, and composable into the
Morning routine — so the bloat is caught the next morning automatically instead of
the next time the editor freezes.

---

## 3. The Morning routine (the worked example)

```text
Recipes › Scheduled
└─ Morning routine        routine, daily 08:00 (disabled until promoted)
   ├─ 1. Workspace bloat scan      (#63)  — catch a frozen-tree project first
   ├─ 2. Dawn lint sweep           (#26)
   ├─ 3. Sunrise project stats     (#27)
   ├─ 4. Standup digest            (#28)
   └─ 5. PR review queue           (#34)
```

One enabled timer. At 08:00 it runs the five members in order, each writing its
own `reports/*` artifact, then writes a one-screen `reports/<stamp>_morning.md`
summary linking them and badges itself red if any member needs attention. "Run
now" triggers the whole block on demand.

---

## 4. What each capability needs (maps to the roadmap / RECIPE_BOOK)

| Capability | Unlocks | Home |
|---|---|---|
| **`routine` action kind** + `RoutineMember[]` + `runRoutine` (sequential, continue-on-failure, summary report) | the Morning routine, any user-composed routine | extends Command sequences / macros (the `macro` kind already shipped) |
| **Routine summary report** (per-member outcome + links + worst-badge) | every routine | reuses report-generating + auto-open + badge machinery (recipes 26/32) |
| **Routine schedule** (one timer drives the block) | Morning routine | reuses the existing `PinSchedule` + scheduler (no new fields) |
| **"New routine from selection"** command | hand-composed routines | new tree/command, reuses multi-select already in the tree |
| **Workspace Hygiene recipe (#63)** — size/stat walk + test-downloader guard check | catching the bloat class | new detector (class H); reuses report/auto-open/badge |
| **Guard / Prune remediation actions** | one-click fix in the open project | new command pins; the guard merges into `files.watcherExclude` |
| **`saropaWorkspace.hygiene.roots`** setting | cross-project morning sweep | new config; default = open workspace folders |

The routine kind also retro-improves the existing catalog: the **Suite macro**
(#59) and the **boot sequence** (#20) could be expressed as routines once their
members exist as standalone recipes, collapsing duplicated inline steps.

---

## 5. Recommended build order

1. **`routine` action kind + `runRoutine`** — sequential execution over recipe
   members, continue-on-failure, with the per-member progress line. Prove it with
   a hand-built two-member routine before any detection.
2. **Routine summary report + badge aggregation** — reuse the recipes-26/32
   report/auto-open/badge code; this is what makes a routine readable.
3. **Workspace Hygiene recipe (#63)** — the size/stat walk + test-downloader guard
   check + report. Standalone first (per-workspace), no remediation yet.
4. **Remediation actions** — Guard this project / Prune `.vscode-test`, current
   workspace only.
5. **Morning-routine auto-offer** — detect ≥2 morning rituals, pre-populate the
   member list, land it in Recipes › Scheduled disabled.
6. **`hygiene.roots` cross-project mode** — opt-in sweep; report-only for other
   roots.

Slices 1–2 are the reusable engine; 3–4 are the concrete payoff; 5–6 are the
"every morning, automatically" finish.

---

## 6. Open decisions (call before building, not during)

1. **`stopOnFailure` for routines?** Default is continue-on-failure (matches
   `macro`). A per-routine `stopOnFailure` flag (abort the block on the first
   failed member) is plausible for a routine where later members depend on earlier
   ones. *Recommendation:* ship continue-only; add the flag if a real dependent
   sequence appears. Not built now.
2. **Member references by `recipeId` vs pin id.** Spec uses `recipeId` so the link
   survives promote/reload (consistent with sticky removal). A hand-composed
   routine over **non-recipe** stored pins would need a pin-id fallback.
   *Recommendation:* support both — `recipeId` for detected members, pin id for
   hand-picked ones — resolved in `runRoutine`. Confirm before coding the model
   field shape.
3. **Hygiene default schedule time.** 04:45 (ahead of the 05:00 dawn lint) when
   standalone; inside the Morning routine the routine's 08:00 drives it. Confirm
   04:45 vs folding it entirely into the routine.
4. **Bloat ceilings.** Defaults 1 GB / 50,000 files per flagged dir. Confirm or
   tune.
