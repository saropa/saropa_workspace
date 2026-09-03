# Plan: third pin scope — the user's private per-project pins

## Goal

Add a third storage tier for pins (and pin groups) so a user can keep pins that
are **specific to a project but private to themselves** — not committed, not
shared with the team, not visible in other projects.

The three tiers, by who sees them and where they live:

| Tier | Who sees it | Spans | Storage today / planned |
|---|---|---|---|
| **Global** | only this user, only this PC | all projects | `globalState` (machine-local; `setKeysForSync` is never called, so it does not sync across machines) — unchanged |
| **Project** | the whole team (via the repo) | one project | `.vscode/saropa-workspace.json`, committed — unchanged |
| **User-project** (new) | only this user | one project | `.vscode/saropa-workspace.local.json`, git-ignored — NEW |

## Correcting the "3 files" assumption

Global pins are **not** a per-project file and must not become one: they span
every project the user opens, so they live in VS Code `globalState` (a per-user,
per-machine store). Only one **new** file is introduced — the git-ignored
user-project file. The on-disk layout is therefore **two files + globalState**,
not three files.

If a global pin file is ever wanted (for portability/inspection), that is a
separate change against `context.globalStorageUri` with no per-project meaning;
it is out of scope here and is not required for this feature.

## Naming (decision needed — recommendation given)

The user flagged naming as open. One recommendation per axis; override any.

1. **Scope enum value** (the `PinScope` union literal, internal):
   recommend `"userProject"`. Explicit, mirrors the user's own term, camelCase
   like a discriminant. Rejected: `"local"` (collides with local-vs-remote
   filesystem language already used by `parseGlobalPath`), `"private"`/`"personal"`
   (vaguer about the per-project scoping).
2. **Git-ignored file name**: recommend `.vscode/saropa-workspace.local.json`.
   `.local.json` is the widely-understood "personal, do-not-commit override"
   convention and sits as an obvious sibling of the committed
   `saropa-workspace.json`. Rejected: `.user.json` (reads like VS Code's
   `*.code-workspace` user settings), `.private.json` (longer, no convention
   behind it).
3. **Tree section label** (user-facing, l10n): recommend **"My pins"** for the
   new section; keep "Global" and "Project" as-is. Rejected: "Personal"
   (ambiguous with Global, which is also personal-but-machine-wide), "Local"
   (filesystem connotation).

## The real work: scope is a binary baked into ~37 branches

`PinScope = "project" | "global"` is consumed as a two-way ternary
(`scope === "global" ? globalThing : projectThing`) in ~37 non-test sites, ~16 of
them in the model/persistence layer (`pinStore*.ts`). A third value would fall
into the `project` else-branch **silently** at every one of those sites — wrong
list, wrong file, wrong tree section, with no type error.

The core of this plan is **replacing the binary ternary with scope-keyed
dispatch** so the third tier is added in one place, not thirty-seven. This is the
load-bearing refactor; the new file IO is small by comparison.

## Work items

### 1. Widen the model (single source of truth)
- `model/pin.ts`: `PinScope = "project" | "global" | "userProject"`.
- Add a `USER_PROJECT_FILE_RELATIVE = ".vscode/saropa-workspace.local.json"`
  constant beside `PROJECT_FILE_RELATIVE` (single source for the literal).
- The on-disk shape (`ProjectPinsFile`) is reused verbatim for the user-project
  file — same `version`/`pins`/`groups`/sets/migration logic, so no second schema
  and no second migration path.

### 2. Replace binary scope branches with dispatch
- Introduce a small scope-resolution helper (in `pinStoreShared.ts` or a new
  `model/pinScopes.ts`) that maps a `PinScope` to its in-memory pin list, group
  list, and persistence read/write functions. Example surface: `pinsFor(scope)`,
  `groupsFor(scope)`, `persist(scope, ...)`.
- Convert the ~16 model-layer `scope === "global" ? … : …` sites and the
  remaining command/view sites to go through the helper. Each converted site is a
  behavior-preserving change for the existing two scopes (verify by test).
- `pinStoreBase.ts`: add cached `userProjectPins` / `userProjectGroups` fields and
  their accessors, mirroring the project ones. The owning-folder maps
  (`projectPinFolder`, `projectGroupFolder`) extend to cover user-project pins
  (same folder-relative resolution — `resolveUri` treats user-project exactly like
  project: relative to the owning folder).

### 3. File IO for the user-project file
- Reuse `readProjectFile` / `writeProjectFile` parameterized by which relative
  path to use, OR add thin `readUserProjectFile` / `writeUserProjectFile` wrappers.
  Prefer parameterization (one code path, no drift).
- `ensureProjectFile`: do NOT auto-create the user-project file on refresh — it is
  created lazily on first user-project pin add, so a clean repo gains no stray
  git-ignored file. (Decision: lazy create; the committed project file keeps its
  current eager-create behavior.)
- Refresh (`pinStoreRefresh.ts`): read the user-project file per folder alongside
  the project file and populate the new cached lists.

### 4. Tree / views
- `views/pinsTreeProvider.ts` + `pinTreeNodes.ts`: add the "My pins" section root
  between or after the existing Global/Project sections (placement decision: after
  Project, since it is the narrowest sharing scope). Route nodes by the new scope.
- Context-menu / command enablement (`package.json` `when` clauses) that branch on
  `scope == project|global` gain the new scope where a user-project pin should
  support the same action (open, run, configure, move-between-scopes).

### 5. Move-between-scopes
- The existing "move pin to other scope" command (`MoveTarget` in
  `pinStoreShared.ts`) becomes three-way. A pin moved project → user-project
  changes file; global → user-project changes from absolute fsPath to
  folder-relative path (reuse the same path-conversion already used for
  global↔project moves).

### 6. Git-ignore + docs
- Add `.vscode/saropa-workspace.local.json` to the project's own `.gitignore`
  (already done in this repo for dogfooding) AND document the convention in the
  README so adopters ignore it in their repos.
- The extension itself cannot edit a consumer's `.gitignore`; surface a one-time
  toast on first user-project pin creation offering to add the ignore line (UX:
  name the file, name what it does). Decision: offer-to-ignore, gated once per
  workspace (per the global "offer sensible next steps, gated to once" rule).

### 7. Tests (node --test, host-independent)
- Scope dispatch helper: every scope maps to the right list/file/persistence fn.
- Read/write round-trip of the user-project file (reuse the ProjectPinsFile
  fixtures).
- Move-between-scopes across all three pairings, asserting path conversion
  (relative ↔ absolute) and that the source file/list no longer holds the pin.
- A regression test pinning the invariant that a `userProject` pin never lands in
  the committed project file.

### 8. i18n + changelog
- New l10n keys: the "My pins" section label, the offer-to-ignore toast, any new
  command titles (`package.nls.json` for manifest, `locales/en.json` for runtime).
- CHANGELOG `[Unreleased]`: one user-facing line for the new private per-project
  pin tier.

## Risks / decisions captured
- **Silent else-branch fallthrough** is the dominant risk; the dispatch-helper
  refactor (item 2) is what neutralizes it. Do item 2 before item 4/5 so the views
  build on a scope-complete store.
- **Reusing `ProjectPinsFile`** for both files avoids a second schema + migration.
- **Lazy file creation** keeps clean repos free of a stray git-ignored file.
- **Global stays in globalState** — not converted to a file (out of scope).

## Open questions for the user
1. Confirm the three names (scope value `userProject`, file
   `.vscode/saropa-workspace.local.json`, label "My pins") or override.
2. Tree placement of the new section — after Project (recommended) or after
   Global?
3. Offer-to-add-`.gitignore` toast on first user-project pin — wanted, or leave
   ignore management entirely to the user?
