# UI Style Guide

The rules every user-facing surface in Saropa Workspace must follow. This guide
sits beside [`principles.md`](./principles.md) (the standing design constraints)
and is the concrete checklist for any change that adds or alters a screen, a
command, a menu item, a toast, a webview, or a user-visible string.

A change that breaks a rule here is not done. When a change exposes a situation
this guide does not yet cover, the gap is itself the work: add the rule (see
[Maintaining this guide](#maintaining-this-guide)) in the same change.

Scope: this governs what the user sees. It does not restate the TypeScript,
testing, or git conventions in [`.claude/rules/`](../../.claude/rules/) — those
still apply.

---

## 1. Branding and naming

### 1.1 Screens carry the Saropa name

Every **full-screen surface** — a webview that opens as an editor tab, OR a
webview *view* docked in the Panel / side bar — has a title whose first word is
**Saropa**. For an editor-tab panel this applies to all three places the title
appears, driven by one i18n key:

- the editor tab title (the `createWebviewPanel` title argument),
- the HTML `<title>`,
- the in-panel `<h1>` heading.

For a docked webview view the title surfaces are the **view-container title**
(the Panel/side-bar tab label, an NLS `%key%` in `viewsContainers`) and the HTML
`<title>`; the same Saropa-first rule holds.

Current screens, for reference:

| i18n key | Screen title |
| --- | --- |
| `monitor.panel.title` | **Saropa Dashboard** |
| `planner.title` | **Saropa Schedule & Workflow Planner** |
| `schedulePanel.title` | **Saropa Scheduled Runs** |
| `scheduleEditor.title` | **Saropa Workspace Scheduler: {name}** |
| `views.launcher.container.title` / `launcher.title` | **Saropa Workspace** |
| `settings.title` | **Saropa Settings** |
| `brief.title` | **Saropa Morning Brief** |

The three schedule-related screens are deliberately distinct: the **Scheduler**
(`scheduleEditor.title`) *sets* one shortcut's timing; **Scheduled Runs**
(`schedulePanel.title`) *watches* every scheduled shortcut — next run, last
outcome, overdue state, and a link to its latest report; the **Planner**
(`planner.title`) visualizes schedules and workflows on a timeline. Name a new
schedule surface so it does not read as a synonym of these.

A per-item screen title may carry an interpolated `{name}` after the Saropa
prefix (e.g. **Saropa Workspace Scheduler: `regen-types`**) so the tab names the item it
edits — the Saropa-first rule still holds.

When you add a new webview panel or view, its title key starts with `Saropa `.
Do not hardcode the prefix at the call sites — set it once in the catalog value
and reference the key everywhere (single source of truth).

### 1.1a Panel view: a second window onto the tree, not a copy

The **Saropa Workspace** panel (a webview view in the bottom Panel) mirrors the same
shortcut + recipe data the sidebar tree shows, so a shortcut is reachable
without opening the activity-bar icon. Conventions for any surface of this kind:

- **It is a second view onto the store, never a second copy of the data.** It
  reads through the same `ShortcutStore` accessors and repaints on the same
  `store.onDidChange` the tree uses, so the two never diverge. The sidebar tree
  stays the canonical *arrange/manage* surface (drag-reorder, context menus); the
  Panel surface is a *fast launcher* (search + run).
- **Use a webview, not a second TreeView, when the Panel's width matters.** A
  native TreeView is always a single vertical column with no embedded search
  field. The Panel is wide and short, so the launcher lays cards out in a
  responsive grid (`repeat(auto-fill, minmax(...))`) that reflows to use the
  width, with an always-visible search box at the top.
- **Split the user's own entries from auto-detected ones into two reflowing
  panes.** The launcher renders **My shortcuts** and **Recipes** as two panes on a
  `repeat(auto-fit, minmax(340px, 1fr))` track: side by side when the Panel is
  wide, stacked (mine first) when narrow. The user's own shortcuts must never be
  visually mixed with the detected recipes — they are different kinds of thing
  (one you curated, one the extension guessed), so they get different columns.
- **Pane visibility is controlled from the header stat chips; groups are collapsible with chevrons.** Two independent levels of disclosure: a whole pane (My shortcuts / Recipes / Watches / Project files / Scripts / Notes) is shown or hidden via its header stat chip toggle (`.meta-item.toggle`). Each group inside a grouped pane folds via its own header (chevron + the group's own glyph/tint + a count) over its card grid. Hidden-pane state is stored in `store.hidden` (keyed by pane id); group collapse is stored in `store.collapsed` (keyed by group id). Both persist across reloads via `getState`/`setState`. An eye-icon reset button (`.meta-reset`) appears in the header whenever any pane is hidden; clicking it restores all panes. While a search query is active, a collapsed group reveals its matching cards (`.root.searching` re-displays `.group-body`, declared after the collapsed rules to win at equal specificity), so a result is never hidden behind a fold (developer feedback 2026-06-28).
- **Clicking a pane head cycles the sort order, not collapse.** The `.pane-head` is a `<button>` with icon + title + count + a sort indicator (icon + label, right-aligned via `margin-left: auto`). Clicking it cycles `store.sort[paneId]` through `grouped` → `asc` → `desc` → `grouped` and re-renders. In `asc`/`desc` mode, a grouped pane flattens all its items and sorts alphabetically by label; in `grouped` mode, the host-supplied group structure is preserved. The sort state persists across reloads. The sort indicator shows `list-unordered` for grouped, `arrow-down` for A→Z, `arrow-up` for Z→A, with a localized text label beside it (developer feedback 2026-07-29).
- **Notes are a launcher pane, mirroring the sidebar Notes tree.** The Notes pane shows each note as a card (filename without extension as label, relative time as sub, first 5 lines / 512 bytes as the expanded drawer description). Notes group by scope (Project Notes / Global Notes) when both scopes have entries, and render flat otherwise — the same "group only when it earns it" rule as the Files pane. Clicking a note card posts `openNote` with the fsPath; the host validates the file still exists before opening it. The notes stat chip (codicon `note`) toggles the pane.
- **Every card carries a colored icon, reusing the tree's token map.** A launcher
  card shows the SAME glyph + tint the sidebar row would (`fileTypeIcon` / `kindIcon`
  / `kindColor` in the vscode-free `fileTypeTokens` module, plus the user's custom
  icon/color when set), so a `.py` shortcut reads as the same blue snake in both
  surfaces. Drawing real codicon glyphs in the webview ships the icon font the same
  way the Customize panel does (esbuild copies `codicon.css` + `codicon.ttf` to
  `dist/`; the view loads it via `asWebviewUri` under a CSP that allows the
  webview's own origin for `style-src`/`font-src`, with `localResourceRoots` set to
  `dist/`).
- **The kind pill is neutral gray; card color lives on the stripe and icon only.**
  The SHELL / MACRO / COMMAND / ROUTINE pill (`.chip`) renders in
  `--vscode-descriptionForeground`, NOT the card's `--card-tint`. The card already
  carries its identity color twice — the left accent stripe and the glyph — so
  tinting the pill a third time made the board read as over-colored (developer
  feedback 2026-06-27). One color signal per card is the rule: stripe + icon carry
  the tint; structural labels stay neutral.
- **A primary click expands the card; it does not open or run.** The launcher
  diverges from the product's single-click-opens model on purpose: a click toggles
  an inline drawer (full name, full path, description, and action buttons)
  so browsing is non-destructive. One-click execution still exists — the head button
  acts without expanding. (Reconciled with the developer 2026-06-27: the launcher is
  a browse-and-choose surface, where an accidental open/run on a click is the worse
  failure; the tree keeps single-click-opens.)
- **The head button carries the card's primary action, chosen by whether the card
  is executable — not merely by whether it is a file.** The head's blue button leads
  with **Run** for an *executable* card — a script file (one whose extension maps to
  an interpreter in the exec catalog, or that carries an explicit run command) or a
  non-file action — and with **Open** for a plain document/data file shortcut
  (`.json`, `.md`, a file with no interpreter), whose only meaningful action is to be
  opened. The decision is computed in the data layer as `headAction` (`run` | `open`
  | absent) by `fileExecutable`, so the run-vs-open choice is unit-tested and the
  webview only renders it. The button is icon-only in the compact grid and grows its
  text label (`.run-label`) only when the card expands, so the head stays narrow among
  its row-mates but names its action once opened — and it stays visible in both states.
  The drawer omits whatever action the head already carries, so a card never shows a
  duplicate: a script reads **Run** on the head and **Open** in the drawer; a document
  reads **Open** on the head and carries **no Run at all** (running a `.json` is
  meaningless); a non-file action reads **Run** on the head and nothing redundant
  below. (Developer feedback 2026-06-28: a `.py` script must not lead with Open, and a
  `.json` config must not offer Run — superseding the earlier "every file leads with
  Open, Run is its secondary" rule, which treated file-vs-action as the only axis.) A
  surfaced project file also leads with an **Open** head button, so its go-to-file icon
  shows while the card is collapsed — the same affordance a document shortcut in My
  shortcuts carries (developer feedback 2026-07-09: the collapsed file card must show the
  Open icon that My-shortcuts files show). An absent `headAction` means no head button —
  only the Watches pane keeps that deliberate expand-then-act model, because a watch's
  Open also clears its unseen counter, so a bare-click Open there would silently lose
  state; opening a project file is non-destructive and needs no such guard. The drawer's actions are right-aligned
  (`.drawer-actions { justify-content: flex-end }`) at the card's trailing edge, away
  from the leading name/path column, with a little extra vertical space around the
  drawer so the actions are easier to hit. Every drawer action button renders as
  the primary blue style (`.btn.primary`), matching the head's Run/Open button — a
  secondary gray `.btn` read as a flat label rather than a button, so the drawer's
  actions (Open, Copy path, Pin, Schedule) all carry the blue affordance. (Developer
  feedback 2026-06-28: the gray drawer buttons looked like labels, not buttons.)
- **All launcher card buttons share one label size, defined once as
  `--launcher-btn-font` on `:root` (currently `0.88em`).** The head Run/Open
  button (`.run`) and the drawer's action buttons (`.btn`) set
  `font-family: inherit; font-size: var(--launcher-btn-font)` — without the
  explicit declaration a native `<button>` keeps the UA's own font at 1em, so the
  head label rendered larger than the drawer labels on the same card. The literal
  size lives ONLY in the variable (a unit test pins this), so a retune is one edit
  and the styles cannot drift; any NEW card action button must read the variable,
  never hardcode a size. Pane heads, group heads, header filter chips, and the
  context menu are navigation/header surfaces with deliberate sizes of their own —
  they are not card action buttons and do not use the variable. (Developer
  feedback 2026-07-16: every button font in the launcher matches the reduced size
  the expanded/drawer buttons use.)
- **The expanded head button shares the drawer buttons' padding, defined once as
  `--launcher-btn-pad` on `:root` (currently `4px 9px 3px`).** Collapsed, the head
  Run/Open button is icon-only and keeps its compact box; once the card expands and
  the text label appears, the head sits directly above the drawer's `.btn` row, so
  `.card.expanded .run` adopts `padding: var(--launcher-btn-pad)` to match. The
  padding is asymmetric — 1px more on top — because the buttons pair a codicon with
  smaller-than-em label text whose cap-height rides above the icon's optical center.
  The literal lives ONLY in the variable (a unit test pins this); any new card
  action button reads the variable. (Developer feedback 2026-07-17: standardize the
  expanded head button's internal padding to match the drawer buttons.)
- **The expanded head button matches the drawer buttons' full box, not just the
  padding.** `.card.expanded .run` also carries a transparent 1px border (`.btn`
  has a real 1px border, so without it the head rendered 2px shorter despite
  identical padding), and both the drawer icons and the expanded head icon read
  one `--launcher-btn-icon` size (currently `16px`, the codicon font's default,
  pinned explicitly so the pairing cannot drift). The collapsed head keeps its
  compact 13px icon and `2px 7px` box — those are single-use literals for the
  dense grid, deliberately not variables. (Developer feedback 2026-07-17:
  collapse the remaining visual delta between the two button styles.)
- **The card's secondary line is suppressed when it only echoes the name.** A
  root-level file shortcut carries its bare filename as both the label and the path
  (e.g. `CHANGELOG.md`), so rendering the path under the title produced a duplicated
  subtitle that read as a glitch (developer feedback 2026-06-28). `makeCard` skips the
  `.card-sub` element entirely when `it.sub === it.label`; a sub line appears only when
  it adds information the title does not already carry (a nested path, a freshness
  line, a version).
- **The webview context menu supports one level of submenus.** A
  `LauncherMenuEntry` with a `children` array renders as a hover-expandable flyout
  instead of a leaf action. The flyout opens to the right (or left if it would
  overflow the viewport) and dismisses on mouse-leave with a 200 ms grace period.
  Top-level items without `children` remain flat leaf actions. Submenus group
  related actions (Configure & Schedule, Appearance, File Actions) so the menu
  fits on screen; high-frequency items (Open, Run, Rename, Remove) stay at the
  top level. Keyboard navigation is fully wired: Up/Down moves focus within the
  menu or flyout, Right opens a submenu trigger's flyout, Left or Escape inside
  a flyout closes it and returns focus to the trigger, and Escape at the top
  level closes the entire menu. Only one flyout is open at a time (a shared
  `activeSub` reference). The menu routes a choice back to the host as a
  `command` message;
  the host re-resolves the shortcut by id and `executeCommand`s it. Only commands
  that accept a raw `Shortcut` via `asShortcut` may be listed (verify before
  adding — `copyPath`/`removeProjectPin` need a real tree item and must NOT be
  used; use `copyPinLink`/`unpin`), and the host gates the incoming id against an
  allowlist so the webview can never drive an arbitrary command.
- **Cards size to their own content — never stretch a row to match.** The card
  grid sets `align-items: start` so each card is as tall as its content. Without it
  the grid's default stretch made every card in a row match the tallest, so
  expanding one card's drawer stretched all its row-mates (developer feedback
  2026-06-27). An expanded card must grow downward alone.
- **The header is a two-part bar: a project block leads, the search group trails.**
  The Panel is very wide, so a search box alone left dead space beside it. `.head-bar`
  is a `space-between` flex row: the **project block** (`.project`) on the leading edge
  and the compact **search group** (`.search`) on the trailing edge, wrapping (search
  below) when the Panel is narrow. The search stays capped (`flex: 0 1 260px;
  max-width: 260px`) so it never grows to fill the bar — the project block takes the
  freed width instead. The narrower cap (was 420px) leaves room for the project summary
  to read on one line. (Superseded the earlier "search on the leading edge" rule;
  developer feedback 2026-06-28.)
- **The project block names the current project and summarizes the board on ONE line,
  computed asynchronously.** `.project` is a single horizontal row (`flex-direction: row;
  align-items: baseline`): the open folder's name (`.project-name`) then, inline beside
  it, the meta line (`.project-meta`) of the declared **version** plus per-pane **counts**
  (shortcuts / scheduled / watches / files, each an icon + value, zero buckets omitted).
  The name can ellipsize and the meta clips (both `min-width: 0`, meta `overflow: hidden;
  flex-wrap: nowrap`) before either pushes the search box off the bar. The name paints
  synchronously from the host's initial HTML so the header is never blank; the version and
  counts ride the first `data` message — the version read from the same single
  project-files disk scan that builds the file cards (no second scan), the counts tallied
  from the built items — and `renderHeader` writes them in when they arrive. The version is
  the headline fact, so it reads in the regular foreground while the counts stay in the
  dimmed description color. The host derives the version from the scanned manifests in a
  fixed precedence (`package.json`, `pubspec.yaml`, `Cargo.toml`, `pyproject.toml`, then
  `CHANGELOG.md`), scoped to the primary folder, and omits the chip entirely when nothing
  declares one. The folder name is HTML-escaped before it is baked into the initial markup
  (the one host-interpolated value); every later update goes through `textContent`. (One-line
  layout: developer feedback 2026-06-28, superseding the earlier name-over-meta stack.)
- **A header stat chip is an independent pane toggle; the scheduled count is informational.** Each count chip that carries a `LauncherStat.pane` renders as a `<button class="meta-item toggle">`; clicking it toggles that pane between visible and hidden (`.off` class dims it to 40% opacity). Multiple panes can be hidden simultaneously, and the state persists across reloads in `store.hidden`. A stat without `pane` (the version chip, the scheduled count) renders as a non-interactive `<span>`. The **recipes** chip shows the full recipe count with a lightbulb icon; a separate **scheduled** chip (clock icon, no pane toggle) counts shortcuts with an enabled schedule, since scheduled cards live inside the "mine" pane and a toggle would duplicate it. The eye-icon reset button appears when any pane is hidden; clicking it restores all.
- **The card grid is indented under its group heading.** `.group-body` carries a
  left padding (20px) so cards sit past the header's chevron + glyph, making the
  group-to-cards containment visible rather than flush with the pane edge.
- **The board breathes — cards and group headings are not packed tight.** The card
  grid gap (10px), card vertical padding (8px), group `margin-top` (14px) and
  group-head padding (7px) give each card and each section title room. A dense,
  cramped board was developer feedback (2026-06-27); spacing is a deliberate value,
  not a default to shrink.
- **A recipe card surfaces its adopt actions on the card, not only in the menu.**
  The recipes pane is where a user decides to keep or automate a recommendation, so
  a recipe's expanded drawer carries **Pin** (`promoteRecipe` — adopt into My
  shortcuts) and **Schedule** (`scheduleRecipe` — adopt, then open the schedule
  editor on the new stored shortcut) as visible buttons, gated on `it.pane ===
  'recipes'`; both are also in the right-click menu. A detected recipe stores
  nothing, so Schedule necessarily adopts first — `promoteRecipeReturningId` hands
  back the new id so the editor opens on the stored copy, pre-filled from the
  recipe's own schedule when it carries one (developer feedback 2026-06-28). Both
  command ids are on the launcher's `MENU_COMMANDS` allowlist.
- **A mirrored pane is flat ONLY while it has a single category; it groups the
  moment a second appears.** Beyond My shortcuts and Recipes, the launcher mirrors
  the Watches and Project files sidebar views. Watches is always a single flat list,
  so its pane renders cards directly under the pane head with no collapsible group —
  wrapping a lone category in one group would just double the header ("WATCHES" over a
  lone "Watches" group). The Project files pane follows the SAME "group only when it
  earns it" rule the tree does (§3): it renders flat when only one area (Project /
  Android / iOS / Web) has matches, and switches to collapsible per-area groups —
  glyph + count headers, identical to the mine/recipes groups — once a second area is
  present. `paneModel` decides this per paint from the file groups' count; the host
  emits the file cards in catalog order (Project first, then the platform areas) and
  name-sorted within an area, and each card carries its category as `section` + a
  `files:<category>` `groupId` so collapse state is stable. `.pane-flat` adds a little
  top margin so a flat pane's first row clears the pane-head divider. The reflowing
  `repeat(auto-fit, minmax(340px, 1fr))` track is unchanged — flat and grouped panes
  sit on the same grid, in fixed order (mine, recipes, watches, files).
- **A mirrored pane reads from its OWN source and stays openable-not-runnable.** A
  watch/file card is built from the same source the sidebar tree reads (the
  `FolderWatchStore`; the project-files provider's `listSurfacedFiles`), wears the
  same state visuals (the Watches row's eye / bell + unseen count; the Project Files
  row's version + freshness + "· shortcut" tag, via the shared `fileTypeIcon` map),
  and carries no Run and no right-click menu. Crucially it is NOT single-click-open:
  it follows the launcher's expand-then-act rule (a primary click opens the drawer,
  whose **Open** is the action), because opening a watch clears its unseen counter —
  an accidental bare-click open would silently mark it seen. The host routes these
  opens by their own validated target (`openWatch` by watch id; `vscode.open` by an
  fsPath re-checked against the live surfaced-file set), never through the store, so
  the untrusted webview can neither drive an arbitrary watch nor open an arbitrary
  path. The header search count reads "{n} shortcuts" by default — it counts only the
  mine + recipes cards, never the mirrored panes — and switches to "{shown} of {total}"
  scoped to the focused set while a text search or a stat filter narrows the board.
- **Filter client-side.** The host posts the full item set on each change; the
  webview filters on every keystroke with no host round-trip. Empty groups and
  empty panes are hidden (a group renders only when it has a visible card; a pane
  only when it has a visible group or, for a flat pane, a visible card).
- Same webview hardening as the editor-tab panels: strict CSP with a per-load
  nonce, no remote content (the codicon font is the one sanctioned LOCAL resource),
  theme via `--vscode-*` variables, and every host-rendered string externalized
  through `l10n`. The injected client script builds its DOM with `textContent`
  only (never `innerHTML`), so an untrusted label/path/description cannot inject
  markup.

### 1.2 Menu items, buttons, and commands are NOT prefixed for branding

The thing that *opens* a screen, and any button or context-menu action, keeps
its plain wording. Two reasons it is already branded without a manual prefix:

- Command-palette entries inherit the category `%extension.displayName%`
  ("Saropa Workspace"), so the palette renders them as
  *Saropa Workspace: Run Pin…* automatically.
- Context-menu and view-toolbar actions live under the **Saropa Workspace**
  view, so their origin is already clear.

So `command.openPlanner.title` stays "Open Schedule & Workflow Planner" — the
verb and the screen name, no extra prefix. The screen it opens is the surface
that must read "Saropa Schedule & Workflow Planner". Do not add "Saropa:" to a
menu item or button to brand it; only screens get the prefix.

(A few command titles do contain "Saropa" because the word is part of the action
itself — "Copy as Saropa Link", "Pin File" under an explicit `Saropa:` for a
palette-only command. That is naming the feature, not the branding-prefix rule.)

### 1.3 Product name spelling

The product is **Saropa Workspace**, capital S, capital W. Sibling tools are
**Saropa Lints**, **Saropa Drift Advisor**, **Saropa Log Capture** — named in
full on first mention in any surface.

### 1.4 The feature is a Shortcut, never a Pin

The thing a user creates — a saved file or script that single-click opens and
double-click runs — is a **Shortcut** (plural **Shortcuts**). This replaced the
earlier name "Pin". Every user-visible surface, every code identifier, every
comment, and every doc uses Shortcut. The old word survives only in the
backward-compatibility exceptions listed below.

Copy rules:

- **Noun:** a *shortcut* / *shortcuts*. The view is **Shortcuts**; the groups are
  **Project Shortcuts** and **Global Shortcuts**; a curated collection is a
  **Shortcut Set**.
- **Do not verb "shortcut".** There is no "shortcutted". Use a plain verb for the
  action: *Add* (create one), *Remove* (delete one), *Save*. So "Pinned {name}"
  became **"Added {name}"**, "Unpin" became **"Remove"**, "Pin it" became
  **"Add shortcut"**.
- **A recipe is an auto-detected shortcut.** Because "shortcut" is now the noun
  for the user's own entries, describe a recipe as an *auto-detected* (or
  *ready-made*) shortcut so the two read as one family, not two competing words.

**VS Code's native "pinned tab" keeps the word "pin".** The tab-suggestion
feature watches editor tabs the user pinned with VS Code's own right-click → Pin
and offers to add them as Saropa shortcuts. There, "pinned tab" / "pin the tab"
is VS Code's terminology and stays literal; only the Saropa entity in the same
sentence becomes "shortcut" (e.g. "Add it to your Saropa shortcuts").

**Backward-compatibility exceptions — these keep the legacy `pin` spelling on
purpose, because v1.5.0 users have data and keybindings bound to them. Renaming
them would silently break shipped installs.** Do not "finish the rename" by
touching any of these:

- The on-disk project-file JSON field **`pins`** (and `removedAutoPins`) in
  `.vscode/saropa-workspace.json`, and the `pins` array of a stored set.
- The globalState keys **`saropaWorkspace.globalPins`** and
  **`saropaWorkspace.globalGroups`**.
- All **`saropaWorkspace.*` command and view IDs** (e.g. `saropaWorkspace.runPin`,
  the `saropaWorkspace.pins` view id). Their user-visible *titles* are renamed to
  Shortcut wording; the IDs themselves are a contract with user keybindings.
- The serialized **`pinId`** field (on a routine member and a trigger) and the
  **`"pin"`** trigger-kind discriminant value.
- The **i18n catalog key names** in `en.json` and `package.nls.json` (e.g. the
  key `pin.added`, the NLS key `command.pinFile.title`). These are internal,
  non-visible string identifiers referenced from code and the manifest; like the
  command IDs, they are kept to avoid silent runtime breakage. Only the catalog
  *values* (the text users read) are rewritten to Shortcut wording.

The compiler is the safety net for the field names: because the TypeScript
interfaces still declare `pins` / `pinId` / `removedAutoPins`, any accidental
rename of a `.pins` access becomes a type error rather than a silent wire-format
break.

### 1.5 A URL shortcut opens on single click, like a file

A **url** shortcut (a website the user pinned — the project's GitHub page, a
staging dashboard, a docs site) opens directly on a single click, exactly like a
file shortcut, rather than taking the info-modal-then-run path every other non-file
action kind uses. The single-click-opens gesture is the product's headline, and a
website is safe and instant to open — unlike the heavy, side-effecting shell /
command / macro / routine recipes, where a single click deliberately shows what the
action does and offers to run it. So the interaction rule keys on cost, not on
file-vs-action: url and file open on a single click; every side-effecting action
kind shows info first and runs only on the play button / double-click.

A url shortcut is authored by hand via **Add Website (URL)…** (project or global
scope), reusing the same "Add" verb and the "Added {name}" confirmation as every
other create gesture (§1.4). It is stored as a `url` action shortcut with an empty
path — the same shape a recipe or import produces — so it round-trips through
persist / promote unchanged.

### 1.5a Discovering, not scraping: offer what the project already declares

A "find things for the user" command reads the project's **structured, well-known
files** — the git remote in `.git/config`, `package.json` / `pubspec.yaml` /
`pyproject.toml`, `mkdocs.yml` — never a recursive text scrape of the source tree.
**Add Website Shortcuts from Project…** follows this: it reuses the URL-opener
recipe derivation (the same source of truth the Recipes engine uses) so the
candidate list is exactly what the project proves is real — no XML schemas, no
`localhost`, no test-fixture URLs. A structured-source read is short and relevant;
a regex over file contents is noise. When a future command discovers anything from
the project, derive it from the files the recipe detectors already parse rather than
inventing a scraper.

Conventions this bulk-discovery gesture sets, for any command of the same shape:

- **The name says discovery + scope.** A single hand-authored add is
  **Add Website (URL)…**; the bulk discover-and-pick is **Add Website Shortcuts from
  Project…** — the "from Project" phrasing tells the user the source is their own
  repo, distinct from typing one address.
- **Multi-select QuickPick, pre-checked.** A curated candidate set (high-value by
  construction) opens with every row checked, so the user confirms with Enter or
  unchecks the few they do not want — the fast path adds them all. Use
  `canPickMany: true`; each row names the item (the label), shows the URL as its
  description, and the detection provenance as its detail.
- **Never re-offer what exists.** Filter out candidates already saved (matched by
  href), so re-running the command surfaces only what is new. Distinguish "nothing
  found" from "all already added" in the feedback so an empty picker never reads as
  a failure.
- **Discovered project data lands in project scope.** Addresses derived from the
  repo belong to the repo (committed, shared with the team); the user can move one
  to global afterward. The completion toast names the count added and the scope
  ("Added {count} website shortcut(s) to Project Shortcuts.").

### 1.6 Display names resolve through one function

Every surface that shows a shortcut's name — tree row, launcher card, panel
title, toast — resolves through `shortcutDisplayName(shortcut)` from
`model/shortcutDisplayName.ts`. Do not inline `shortcut.label ?? basename` at
call sites; call the function. It respects the user's `displayNames.titleCase`
preference (strip extension, replace underscores/hyphens with spaces, capitalize
each word) uniformly. When `label` is set (a custom rename), it returns it
as-is; title-case only applies to the file-basename fallback.

**Excluded sites:** Action shortcuts (url/shell/command/macro) and scheduled
routines sometimes fall back to `shortcut.id` rather than a file basename because
their `path` may not be a meaningful filename. These sites use
`shortcut.label ?? shortcut.id` intentionally — do not migrate them to
`shortcutDisplayName()` without extending the function to handle the id-fallback
case. Affected files: `actionRunner.ts`, `routineRunner.ts`,
`plannerPanelMessages.ts`, `scheduleStatusBarActions.ts`.

---

## 2. Internationalization (translation-ready at write time)

Every string an end user can read is externalized at the moment it is written —
never hardcoded, never deferred. There are two catalogs and you pick by where
the string lives:

| String lives in… | Mechanism | Catalog file |
| --- | --- | --- |
| `package.json` (command titles, view names, setting descriptions) | `%key%` NLS placeholder | `extension/package.nls.json` |
| Code shown at runtime (toasts, panel text, QuickPick labels) | `l10n('key', { token })` | `extension/src/i18n/locales/en.json` |

Rules:

- **No inline English** in code or the manifest. A hardcoded display string ships
  English in every locale — that is a localization bug at write time.
- **Interpolate, never concatenate.** Use `{token}` placeholders inside the
  catalog value (`"Linked {name}."`), not `'Linked ' + name + '.'`. Word order
  differs across languages; a concatenated string cannot be reordered.
- **Adding keys is routine.** Needing a new string is never a reason to drop,
  shrink, or ask-permission-for a feature. Add the key as part of the change, the
  way you would write a code comment. Do not narrate it.
- **American English source** (see §6). There is no machine-translation pipeline
  in this repo; you only author the English source values.

Exempt (leave literal): log/console/debug strings, command/route/event IDs,
config keys, URLs, CSS, pure symbols and numbers.

**Synthetic group folder labels are inline in their routing table.** The short
category labels for the synthetic tree folders defined in
`model/shortcutStoreShared.ts` — the recipe groups (`RECIPE_GROUPS`,
`RECIPE_SUBGROUPS`, `RECOMMENDED_GROUP_DEF`) and the built-in default project
groups (`DEFAULT_GROUPS`: Build / Run / Deploy / Test / Docs / Data / Code) — are
written inline in American English alongside the folder's stable id, glyph, and
tint, not through `l10n`. The same convention covers the **Project Files category
groups** (`DEFAULT_PROJECT_FILE_GROUPS` in `model/projectFiles.ts`: Project /
Android / iOS / Web): each category's label + glyph sit inline beside its file
list. They are one-word structural folder names that live in a const routing table
rather than at a call site, and keeping the label beside the id/icon/color keeps
the table a single source of truth. This is the established convention for every
synthetic group; match it rather than externalizing one table in isolation.
Everything else a user reads from these features — the "added to {group}" toast,
the setting description — stays externalized per the table above.

**Webview client-script strings are currently inline.** A webview's injected
client script (e.g. `PLANNER_SCRIPT` in `plannerScript.ts`) runs in the browser
context and cannot call `l10n`, which imports the catalog and runs in the
extension host. So display strings authored *inside* that script — view-tab
labels, button captions, empty states, in-canvas hints — are written inline in
American English, matching the rest of the script. Strings rendered host-side
(the panel title, `showInformationMessage` toasts) still go through `l10n`.
Localizing the client script requires a host→webview string bridge (inject a
keyed string map into the page at render time, look it up in the script); until
that bridge exists, keep client-script strings inline and consistent with their
neighbors rather than half-externalizing.

**Prefer host-rendered labels for static form markup.** When a webview's layout is
a fixed form (not a generated canvas), render the markup and ALL its visible labels
host-side via `l10n` in the panel's `renderShell` (see `scheduleEditorPanel.ts`),
and keep the injected client script free of display strings — it only reads the
host-posted initial state, wires controls, and writes host-computed text (e.g. a
preview line) into place. This keeps the whole surface translation-ready today
without the string bridge. Reserve inline client-script strings for surfaces that
build their DOM dynamically in the script (the planner canvas), where host
rendering is not practical.

---

## 3. Native-first surfaces

Default to VS Code's own surfaces; a webview must earn its place. (Full rationale
in [`principles.md`](./principles.md).)

- **Reach for native first:** tree view, QuickPick, input box, `ThemeIcon`
  product icons, markdown preview, the integrated terminal. They are theme-aware,
  accessible, and free.
- **A custom webview is the exception** — justified only when a native surface
  genuinely cannot do the job (a live chart, a sparkline trend, a sortable
  multi-column grid).
- **A many-field configuration may offer a webview FORM as the default editor,
  with the native QuickPick kept as a `(Quick)` fallback.** A hub-and-spoke
  QuickPick (pick a field, edit it, return, repeat) hides every value behind a
  step and buries conditional fields; once a configuration has more than a handful
  of fields, a single-screen form that shows them all at once is the better default
  (the Schedule editor and the Configure Run editor both do this). Keep the
  QuickPick command registered under a `…Quick` id and a `Configure X (Quick)…`
  title for keyboard-only use, and share ONE seed + ONE persistence/normalize path
  between the two so a config saved from either is byte-for-byte identical. The form
  obeys every webview rule above (nonce CSP, no remote resource, `--vscode-*`
  theming) and the asset CSS/JS lives in a sibling `*Assets.ts` so the panel module
  stays the host/logic side.
- **In a form, a conditionally-applicable control is shown DISABLED with an inline
  reason, never hidden.** A field that only applies under another setting (the
  administrator toggle, which applies only to a new external window) must stay
  visible and merely disable until its precondition holds, with a one-line hint
  naming what to set first. Hiding it makes the option undiscoverable — a user
  hunting for "run elevated" cannot find a row that does not exist. (This is the
  defect the Configure Run form was built to fix: the QuickPick hid the elevation
  field until the location was External.) A QuickPick, which cannot disable a row,
  is the one place where conditionally appending the row is acceptable.
- **A free-text field that names a tool/path the host can detect carries
  one-click choices and shows what blank resolves to.** When a form field expects
  a value the extension can discover on the machine (an interpreter binary, an
  installed runtime, an executable path), do not leave the user a bare text box to
  guess into: detect the real options host-side and render them as selectable chips
  above the box, and when the field is empty show an inline hint naming what the
  blank value falls back to (e.g. "Empty runs with `python`, the default for this
  file type"). The text box stays for power users; the chips + hint make the common
  case no-typing and the empty case unambiguous. (This is why the Configure Run
  command box lists detected interpreters as chips with a default-resolution hint;
  the matching keyboard path is the **Run With…** QuickPick.) Detection is IO, so it
  is posted to the client AFTER init — the client holds no display strings, so the
  chip pseudo-labels (default / browse) and the hint text are host-localized and
  passed in the message, exactly like the env-row template.
- **An interactive run token that asks for a folder uses `${pickFolder:Label}`
  (a native `showOpenDialog` folder browse, defaulting to the workspace root),
  never a bare `${prompt:Label}` free-text box.** A hand-typed path gives no clue
  what the expected value looks like (absolute? relative to what?) and is exactly
  how a bundled script (`organize-output`) once got misconfigured to a wrong
  target. `${prompt:...}` stays for a genuine free-text value (a branch name, a
  version string); `${pick:a,b,c}` for a fixed option set; `${pickFolder:...}` is
  the third interactive token kind, resolved and remembered the same way as the
  other two (see `promptTokens.ts`).
- **A parameterized shortcut or bundled script gets a "Set Params…" editor
  independent of Run.** Once a run gesture resolves an interactive token from
  memory instead of prompting fresh (see the bundled-script rerun rule below),
  the only way to change an already-answered value was to run the shortcut
  again and answer differently, or clear extension storage by hand — so
  `setParamsPanel.ts` opens a small webview (reusing `CONFIGURE_RUN_STYLE`
  for visual consistency with Configure Run) listing every detected token as
  an editable field — a text box for `prompt`, a dropdown for `pick`, a text
  box + Browse button for `pickFolder` — and writes straight to
  `promptMemory` on Save, without running anything. Offered on every
  parameterized-capable row (a pin's context menu, a Scripts-tree row, a
  Launcher card) rather than gated behind a contextValue/menu flag that would
  need to track "has interactive tokens" — a row with nothing to configure
  gets a named "nothing to set" toast instead of an empty form (see
  `SetParamsPanel.show`), which is cheaper and less fragile than threading a
  new contextValue suffix through the existing run/paused/scheduled state
  machine (`shortcutRowContext.ts`). Each answered field also carries a
  "Reset to unanswered" action (`promptMemory.forgetToken`, a per-token
  variant of the existing per-shortcut `forget`) that clears just that one
  token's memory and redraws the form from it — distinct from Cancel, which
  discards the whole in-progress edit, and from Save, which fixes a NEW
  value; Reset is for "the next run should ask me again," with no value to
  supply. Save is blocked only while a `pickFolder` field is blank (an empty
  path is meaningless to the script it feeds); a blank `prompt` field is a
  legitimate, savable answer (e.g. deliberately clearing an optional flag),
  and `pick` always carries a selection by construction — so validation is
  per-kind, not a blanket "no field may be empty" rule.
- **Field data for a webview form is never embedded in the initial HTML
  string — post it after a `ready` handshake instead.** A label or a
  remembered value (a folder path, free text) is attacker- or
  environment-influenced text; concatenating it into an inline `<script>`
  risks both a malformed JSON payload (HTML-escaping a JSON string before
  `JSON.parse` corrupts its own quote characters) and a literal `</script>`
  breaking out of the tag. `SetParamsPanel`/`ConfigureRunPanel` both follow
  the same protocol: the shell renders with no per-item data, the client
  posts `{type:"ready"}` on load, and the host responds with a `postMessage`
  carrying the real values — so no per-item string is ever concatenated into
  executable JS.
- **A bundled library script resolves its interactive tokens from memory by
  default, not fresh each run.** `runLibraryScript` (`scriptRunner.ts`) is set
  up once — the first run prompts and remembers, every run after that reuses
  the answer silently — unlike a user shortcut, whose default Run always
  prompts fresh and offers a separate "Run with Last Parameters" command as
  the opt-in bypass. The asymmetry is deliberate: a bundled script's
  parameters (organize-output's target folder) are configuration, not a
  per-run choice the way a pin's environment/branch argument often is.
- **Every webview is local-only:** a strict Content-Security-Policy with a
  per-load nonce, no external script or CDN, no network of any kind.
- **Theme the webview with `--vscode-*` CSS variables** so it tracks the active
  color theme. Never hardcode a hex where a VS Code theme variable exists.
- **To draw codicon glyphs in a webview, ship the icon font — VS Code does NOT
  expose its built-in codicon font to webviews.** `esbuild.js` copies
  `@vscode/codicons`' `codicon.css` + `codicon.ttf` into `dist/`; the panel loads
  the stylesheet via `webview.asWebviewUri` under a CSP that allows the webview's
  own resource origin for `style-src` and `font-src` (`${webview.cspSource}`) and
  sets `localResourceRoots` to `dist/`. This is the sanctioned exception to "no
  bundled resource": a LOCAL font, still no network, no CDN. The full icon set is
  generated into `views/iconCatalog.ts` from the codicons metadata, so every
  offered id is a real product icon by construction (no manual verification), and
  its search keywords come from the upstream metadata as a non-displayed search aid
  (not l10n — they are matched, never shown as translated prose).
- **Render a color choice as a real swatch from the manifest hex — a QuickPick row
  cannot tint its glyph.** A `ThemeColor` shown in a QuickPick paints every row the
  same foreground color, so a color picker MUST be a webview that draws each swatch
  from its registered `contributes.colors` hex, resolved for the active theme
  (`activeColorTheme.kind` -> the matching `defaults` key). Read the hex from the
  extension's OWN `packageJSON.contributes.colors` (one source of truth with the
  registered `ThemeColor` the tree uses); never restate the palette hex in code.
- **A type-to-search QuickPick whose labels are codes or jargon carries a synonym
  list.** When a row's label is a terse identifier (a codicon id, an enum value,
  a short code) the user won't always know the exact word, so put a keyword list
  in the item's `description` and enable `matchOnDescription: true` — the synonyms
  are then both visible beside the label and matched as the user types. Keep the
  synonyms in the catalog (e.g. `appearance.iconKeyword.<id>`), not inline, so
  they stay externalized. One synonym may name several rows; that overlap is
  intended, not a bug.
- **A user-selectable color comes from a registered, named theme color, never a
  raw hex passed to `ThemeColor`.** `ThemeColor` only accepts a registered color
  id, so an arbitrary RGB tint must be declared once in `package.json`
  (`contributes.colors`, e.g. `saropaWorkspace.tint.<name>`) with explicit dark /
  light / high-contrast hex, then referenced by id everywhere. The palette offered
  to the user (shortcut and group icon tints) is the named set in
  `COLOR_CHOICES` — extend that list and add a matching `appearance.color.<name>`
  label rather than introducing an inline hex or a one-off chart color. This keeps
  every tint theme-aware and the hex in one place (the manifest).
- **Every `ThemeIcon` id must be a real product icon — verify, never assume.** A
  codicon id that does not exist (e.g. `trophy`, `award` — neither is a product
  icon) renders as nothing: `$(id)` resolves to blank in a QuickPick and the tree
  shows an empty slot, with no error. Before adding an id to the icon picker, a
  group definition, or any `new ThemeIcon(...)`, confirm it against the product-icon
  reference. The picker is unit-tested for synonym coverage but not for id validity,
  so the check is the author's.
- **Default row glyphs and tints live in one token map, keyed by role.** A tree
  row's resting icon/color is resolved in `views/shortcutRowTokens.ts` — the single
  source of truth for the row visual language. A file shortcut with no user-chosen
  icon gets a file-type glyph + tint from `fileTypeIcon` (keyed by extension or
  exact name), grouped by role so the palette is learnable (source code blue,
  config purple, data green, docs/media neutral). Add a new file type to that map
  rather than inventing a glyph at a call site; an unmapped type falls back to the
  generic shortcut glyph, never to a blank.
- **A tree introduces a grouping level only when it earns one — never a header
  over a single group.** When a view can group its rows (the Project Files view by
  category, a multi-folder workspace by folder), render the group headers ONLY when
  more than one group actually has rows; with a single group, list the rows flat
  under the view. A lone "Project" header over the only files present is pure
  indirection — an extra expand for no disambiguation. Project Files applies this
  twice: category headers (Project / Android / iOS / Web) appear only when a second
  category has matches, and they nest under the folder headers that already appear
  only when a second workspace folder is open. The grouping rule is the call site's,
  not the data's — the pure `groupFilesByCategory` always returns every non-empty
  bucket in catalog order, and the provider decides flat-vs-grouped from the bucket
  count. A category's glyph comes from the catalog (`glyphForCategory`); a
  user-defined category falls back to the generic `folder` glyph rather than a blank.
- **A context menu past roughly a dozen items folds into labeled submenus, not one
  long flyout.** A `view/item/context` dropdown that grows past a screen-height of
  items is unscannable. Keep the few most-used actions (Open, Run) at the top
  level and group the rest into themed submenus declared in `contributes.submenus`
  (e.g. the shortcut menu's **Output & Logs**, **Configure & Schedule**,
  **Appearance & Tags**, **File Actions**). Each moved command keeps its original
  `when` clause so per-item-type visibility is preserved, and an empty submenu is
  auto-hidden by VS Code. Submenu labels are externalized through
  `package.nls.json` (`submenu.<id>.label`) and are noun phrases, unbranded, like
  the existing submenus.
- **A submenu's `icon` shows; a dropdown row's command `icon` does NOT.** VS Code
  renders a command's `icon` only as an inline (hover-toolbar) action and on the
  submenu's own `▸` row — it is ignored on ordinary `view/item/context` dropdown
  rows, which are text-only by design. So set an icon on each submenu definition,
  but do not expect (or ask for) per-row icons inside the flyout; declutter the
  flyout with grouping and submenus instead.
- **Shortcut context-menu groups follow a numbered scheme.** VS Code renders
  `view/item/context` groups in lexicographic order of the `group` string;
  items within a group sort by their `@n` suffix. The shortcut right-click menu
  uses these top-level groups — only primary actions are flat; everything else
  is inside a submenu:

  | Group | Purpose | Pins | Recipes |
  |---|---|---|---|
  | `1_run` | Primary actions: Open, Run, Stop, Force Kill | ✓ | ✓ |
  | `2_menu` | Submenus: Output & Logs ▸, Configure & Schedule ▸, Appearance & Tags ▸ | ✓ | ✓ |
  | `3_scope` | Submenus: Workspace Shortcut ▸ (pin scope), File Actions ▸, Manage & Create ▸ | ✓ | Manage only (no scope/file) |

  The **Manage & Create** submenu (`organizeSubmenu`) contains: Rename,
  Promote Recipe, New Routine from Selection, Use as Template, Copy Path,
  Copy Pin Link, Add Comment, Add Separator — each with its own `when` clause
  for per-viewItem visibility. The **Configure & Schedule** submenu also
  contains Re-run with Last Parameters.

  Recipe items intentionally see fewer submenus — they are read-only previews
  that can be promoted to full pins but do not support file operations,
  annotations, or scope changes. An empty submenu is auto-hidden by VS Code.

---

## 4. Feedback and acknowledgment

### 4.1 No silent async

Every action that runs file, terminal, network, or state work emits a visible
outcome. Silence after a click reads as a frozen app. Acceptable acknowledgments:

- a toast (`window.showInformationMessage` / `showWarningMessage` /
  `showErrorMessage`), the default;
- a new surface opening (a panel, a QuickPick, an input box);
- a visible state change in the tree (a row re-icons, a count updates, the list
  reorders).

A silent return to the same surface is **not** acknowledgment.

Background and scheduled runs always surface an outcome — a toast and/or the
output channel. Terminal and external-window runs that cannot be tracked to an
exit code report only on start, and that limitation is stated, not hidden.

The **`showRunToasts`** setting (`true` by default) lets a power user suppress
run-start toasts globally. When the setting is off, the output channel is the
only start acknowledgment. **Only informational start toasts are suppressible**
— error toasts (`showErrorMessage`), warning toasts (e.g. the elevated-env-drop
warning in `externalLauncher`), and background-run completion toasts are never
gated on this setting, because they report a state the user must see regardless
of preference. When adding a new run-start toast, gate it on `showRunToasts`;
when adding an error/warning/completion toast, do not.

### 4.1a Transient confirmations auto-dismiss; action alerts persist

A toast that only *confirms* something already happened ("Watching `bugs` for new
and changed files", "Stopped watching `bugs`") must clear itself — it has served
its purpose the moment it is read. A buttonless `showInformationMessage` carries
no timeout and can linger in the toast stack until the user dismisses it by hand,
which reads as a stuck notification. Route a transient confirmation through a
progress notification that resolves after a short delay so it auto-dismisses:

```ts
vscode.window.withProgress(
  { location: vscode.ProgressLocation.Notification, title: message },
  () => new Promise<void>((resolve) => setTimeout(resolve, 4000))
);
```

A toast that the user is expected to **act on** keeps its plain
`showInformationMessage(message, action)` form and persists until dismissed — the
action button is the whole point, and auto-dismissing it would drop the offer. Rule
of thumb: a notification with an action button stays; a pure acknowledgment goes.
The folder-watch confirmations use the auto-dismiss helper; the engine's "files
changed — Open" alert keeps the persistent action form.

### 4.2 Name the item acted on, carry the concrete value

A confirmation the user cannot tie to a specific item is noise. Surfaces name the
exact pin, file, count, or value they acted on — never a generic message.

- Good: *"Linked `regen-types`. It will auto-run when `schema.graphql` changes."*
- Bad: *"Pin linked."*

Pair the message with the matching semantic icon for the action or entity where a
surface supports one. When choosing between a terse-but-vague message and a
slightly longer specific one, pick specific.

### 4.3 Surface failures, never swallow them

A rejected promise behind a command emits a visible error
(`window.showErrorMessage` or an output-channel line for background work). Never
catch-and-ignore. Where the failure output names a fix, offer it as a toast
action rather than making the user copy it out.

### 4.4 Offer the helpful next step, gated to once

When state implies a likely next action the user has not taken, offer it via a
toast-with-action or a one-tap dialog — and gate it on a per-feature
"done / offered / dismissed" flag so it never reappears unsolicited. The gate is
the rule; never nag.

### 4.5 Standing counters live on the row, never on the activity-bar icon

A persistent count surface represents "things you have not looked at yet" (e.g. the
Watches view's unseen new-files count). It belongs in the tree, on the row it describes.

- **Never set `TreeView.badge`. No activity-bar container badge, ever.** VS Code
  aggregates the badge of *every* view in a container onto the single container icon, so
  the number arrives stripped of its view, its label, and any way to tell what it counts
  — the user sees a bare "1" on the icon and nothing names it. Worse, clicking that icon
  only opens the container; it does not consume whatever the number counted, so the count
  survives the one gesture that most looks like it should clear it. Both badges this
  product shipped (untapped shortcuts, unseen watched files) failed exactly this way and
  were removed. Repeated fixes to *counting* logic cannot repair it — the defect is the
  surface, not the arithmetic.
- **Put the count in the row's `description`, where the row names it.** "Deploy 1"
  is self-explanatory; a "1" on an icon is not. Suppress a zero (`undefined`, not `"0"`)
  so an idle row carries no count at all.
- **Acting on the item clears its counter.** Clicking a row (or otherwise consuming what
  it counted) resets that item's count, and the provider repaints on the same event, so
  the count clears the instant the user acts.
- **For binary state (unseen vs seen), mark the row rather than counting it.** Carry a
  marker on each affected row — the untapped-shortcuts dot (`●`) prepended to the row
  **label** (not the description), with a hover line naming what clears it. Lead the
  label: a glyph in the dimmed `descriptionForeground` color, beside an already-gray
  detail, is too faint to spot, which defeats the marker.
- **A tree row's path detail shows the directory, not the full path.** The label already carries the filename, so repeating it in the dimmed `description` wastes the narrow sidebar width that inline action buttons need. Show only the parent directory (e.g. `lib/l10n` not `lib/l10n/app_en.arb`). A root-level file with no parent directory shows no path detail at all. A shortcut with a custom label (one that does not match its filename) shows the full path instead, since the label no longer reveals which file it targets. The launcher card's `.card-sub` follows the same suppress-when-redundant rule (§1.1a).

### 4.6 Discovery is passive — never a popup; confirm an explicit action with one toast

Surfacing a feature the user has not found yet (the Recommended shelf, a "start
here" hint) must live **in the tree**, never in a notification or modal. A popup
that nudges steals focus and reads as nagging; the user opens a passive surface
when curious. Two rules:

- **A discovery hint is an in-tree row, gated by a one-way latch.** The one-time
  Recommended-shelf welcome ("New here? These are worth turning on.") is an inert
  comment row inside the group, shown only until a persisted `globalState` flag is
  set the first time the user expands the group or adopts a recommendation — and the
  flag never unsets, so the hint appears at most once. No notification surface is
  involved at any point.
- **A toast is for confirming an explicit action, not for nudging.** The single
  permitted notification on a discovery surface is the one that confirms a state
  change the user just requested — e.g. the Recommended shelf's one-tap enable emits
  *"Dawn lint sweep enabled — runs daily at 05:00."* It names the item and carries
  the concrete value (§4.2); it never fires unprompted.

### 4.7 Window-independent state alerts per project, never every window

State stored in window-independent `globalState` (a folder/file watch, anything
synced across windows) is visible in *every* open window at once. A surface driven
by such state that raises **alerts** — a toast, a badge that demands attention —
must not fire in every window just because the state is shared, and a view that
*lists* such state must not show another project's items in this window. The rule is
**the project owns its own state; a window only sees what fires in it**:

- **A thing belongs to the project that contains its target, and that project always
  sees it.** A watch alerts (and is listed) in the project that contains the folder
  or file it watches — automatic, no opt-in needed. The folder-watch engine gates
  scanning/arming, and the Watches view gates *listing*, on
  `watchAlertsIn(watch, currentFolderPaths)`. This is the fix for the "you blasted
  every project I am running" report (2026-06-28): a per-project `bugs` watch was
  popping its alerts in unrelated windows.
- **Never show another project's state here — filter it out, do not flag it.** A
  view lists only the items that fire in the open project; items belonging to other
  projects are simply absent. Do NOT list them with a "not alerting here" note — a
  row a window cannot act on reads as broken data (the user report this rule comes
  from). Any per-project count is scoped the same way (e.g. `totalUnseen(folderPaths)`)
  and shown on the owning view's rows (§4.5), never on the activity-bar icon, so one
  project's pending count never surfaces in another's window.
- **A deliberately cross-project item is marked "global".** The ONLY thing shown
  outside its owning project is one the user explicitly made global. Mark it
  distinctly so it is never mistaken for local: the Watches row uses a **globe**
  glyph (not the local eye/bell) and a **"global"** note, and the tooltip says it
  alerts in every project. The make-global / make-local toggle and per-project opt-in
  for outside-the-project targets live in **Manage Folder Watches**, not on the row;
  the row `contextValue` carries only the enabled state (`watch<Enabled|Disabled>`).

### 4.8 Generated report documents are readable Markdown, and a summary links its parts

A scheduled recipe or routine writes a Markdown file under `reports/`. That file is
a user-facing surface — it is opened and read — so it follows document conventions,
not raw-dump conventions:

- **Captured command output goes in a fenced code block.** Raw stdout/stderr (a
  `git log --stat`, a `git status`, a grep) rendered as Markdown prose is mangled
  ("unreadable slop", user report 2026-07-09). Wrap it in a fence so a preview shows
  it as monospace preformatted text. The fence length is one backtick longer than the
  longest backtick run in the body, so output that itself contains a fence can never
  break out. The single writer is `buildCommandReport` in `exec/actionRunner.ts`.
- **State an empty result, do not leave a blank fence.** No captured output reads as
  an explicit *"No output."* line — a deliberate outcome, not an empty file.
- **The report header is Markdown, not plain lines.** An H1 title, then a metadata
  block with the generation time and the exact command code-formatted (copy-paste
  safe): `**Command** \`git log …\``.
- **A summary/routine report IS the content, not an index of execution mechanics.**
  When a run produces several member reports, the summary merges each report's body
  in as a collapsible `<details>` section (H1 dropped, inner headings demoted,
  fenced blocks left untouched) so the one document the routine opens is the
  standup / stats / PR content the user wants to read — not a table of statuses,
  durations, and links ("no user wants that document", user report 2026-07-16).
  Sections open collapsed so a multi-member report scans as one-line headers; a
  FAILED member's section is pre-expanded (`<details open>`) so the section that
  matters needs no hunting. Non-Markdown member content (a `.log`, `.txt`) is
  fenced as preformatted text, never merged as prose. Each section still carries a
  link to its source file *relative to the summary file* (forward slashes — a
  Windows backslash is not a valid link separator), so the parts stay reachable
  wherever the `reports/` tree is opened.
- **A report generator that captures bulk output places it inside `<details>` below its classified findings; the headline stays above the first fence.** The standup digest classifies commits (security, features, fix groups, churn) and renders those above the fold; the full raw log lives inside a `<details>` block with a fenced code block. This keeps `extractHeadline` working (it reads only the header above the first fence) and keeps the summary's first screen scannable. A short fence (a 3-line PR list) is content, not noise — do not collapse it.
- **A freshness/diagnostic report shows only the actionable items.** A dependency
  report lists only the packages behind latest, not every dependency; the up-to-date
  ones are omitted so the report is the work, not a table to scan.
- **Execution state appears only when something went wrong, and it explains
  itself.** A clean run shows pure content — no per-member statuses, durations, or
  "dispatched" jargon. A failed or missing member gets one attention line at the
  top naming the member and what to do (e.g. missing → "removed or renamed —
  edit the routine to re-link or remove this member"). Never claim "all clear"
  wording anywhere unless every member confirmed ok, and never show a raw status
  word without its explanation (both from user reports 2026-07-16).

### 4.8a A report states its finding before its evidence, and says whether it needs you

A report whose first screen is a command line and a fenced dump gets skimmed once and
ignored afterwards, however good the data underneath is (user report 2026-07-20: "this
report is unreadable noise. it will be ignored"). Two conventions fix that, and every
report writer follows them.

- **One line, at the top, stating what the report found.** `**Headline:** …` when the
  finding only informs; `**Attention:** …` when it asks the reader to do something.
  A report writes at most one of the two, above the command block. The distinction is
  made by whoever understands the output — the summarizer — never inferred later from
  wording. `summarizeReportBody` in `exec/actionRunner.ts` derives it from the shape of
  the captured OUTPUT, never from the command string, so the same digest reached
  through a hand-written shortcut is summarized identically and no flag-order change
  can silently stop it working.
- **No filler headline.** Output that cannot be summarized meaningfully gets no
  headline at all. "412 lines of output" is not a finding, and a fake headline is
  worse than none because it trains the reader to skip the line that matters.
- **An empty result is a finding.** Nothing found reads as *"Nothing to report."*, never
  as a missing line the reader has to infer from a blank block.
- **A routine summary opens with a verdict, and sorts by urgency.** The first heading
  is `Needs attention (N)` or `All clear`, counting failed/missing members plus every
  member reporting `**Attention:**`. Then, in order: the failed/missing blockquotes,
  the attention findings, and — under an `Also ran` heading — everything that merely
  informs. A quiet morning produces a short document; a bad one grows to fit the
  problem. **The report must not render identically whether or not something is
  wrong**: that is precisely what taught the reader to stop opening it.
- **A check that could not run must never read as a passing check.** "No failures
  found" and "I was unable to look" are different answers, and collapsing them is the
  worst failure a health check can have — it reports a broken build as a green one. A
  report whose tool was missing, unauthenticated, or timed out says so *as an
  attention finding* (`Build status unavailable — the gh CLI did not answer.`) and
  names the command that would diagnose it. In code this means an unavailable tool
  returns a distinct value (`undefined`, a flag) from an empty result, never `""`.
- **Report the change, not the level, for anything measured repeatedly.** A number
  that reads the same every morning carries no information and trains the reader to
  skip the line. Derive the comparison rather than storing it where possible: for
  anything computed from repository contents, diff against the revision that was
  current at the start of the window (`git rev-list -1 --before=…`), which is exact,
  needs no state carried between runs, and survives a fresh clone or a new machine —
  unlike a stored snapshot, which is only as good as the last time the job happened
  to run (developer question 2026-07-20).
- **Captured output is untrusted as report structure.** A report's own conventions
  (`**Attention:**`, `**Headline:**`) are read only from the header — the part before
  its first fenced block — never from the whole file. A commit subject, lint message,
  or log line that happens to begin with `**Attention:**` would otherwise be lifted
  into the routine's verdict and misattributed to the member that merely quoted it.
  Bounding the scan also turns "the headline is written above the output" from a
  convention every generator happens to follow into one the reader enforces.
- **Parse a tool's machine interface, never its presentation output.** Where a CLI
  offers structured output (`gh --json`, `--format json`, `--porcelain`), request it.
  Table and column layouts are presentation, free to change between versions, and a
  positional read of them is silently wrong rather than loudly broken: a version of
  the build-status check that parsed `gh run list`'s table read the branch column as
  the workflow and attributed every failure to "main" (2026-07-20). Parse JSON
  defensively — a missing or wrong-typed field becomes an empty string, and
  unparseable output becomes no data, never a healthy-looking default.
- **Say when it broke, not only that it is broken.** Where the history to locate a
  regression has already been fetched, name the commit the failure started at and the
  last known-good one. Distinguish "broken since `<sha>`" from "nothing in the fetched
  history ever passed" — the second points at the pipeline rather than at a change,
  and reads as far worse news than a long streak.
- **Answer the urgent question first.** Members are ordered by what outranks what, not
  by what is cheapest to compute — build status before measurements, because a report
  that discusses line counts while the default branch is red has its priorities
  inverted.

### 4.9 A multi-step run opens one document, and always opens it

A run that produces several reports raises exactly one editor: the summary that links
the rest. Members open nothing (`withReportOpenSuppressed` in `exec/reportOpen.ts`
gates every auto-open; a member calls `openReport`, never `showTextDocument`).

- **One window per run, not one per step.** A five-member morning routine that opened
  each member's report buried the user in tabs and hid the summary (user report
  2026-07-10). Any new report writer routes its open through `openReport` so a routine
  can suppress it.
- **The summary auto-opens for every manual run and for any run needing attention; a clean scheduled run surfaces through the completion toast and the status-bar just-ran flash instead, both of which link the report.** The original rule (open on every run, 2026-07-10) fixed report findability. Findability is now provided by two surfaces that do not cost a window: `surfaceRunResult` in `views/scheduleFeedback.ts` offers "Open report" in the toast, and the status-bar just-ran flash (2-minute window, `views/scheduleStatusBar.ts`) links the report through its action menu. A daily unconditional open produced alarm fatigue (user report 2026-08-05), so the summary writes the file, records `recordLastReport`, and logs to the channel, but does NOT call `openReport` when all three conditions hold: `source === "scheduled"`, no member failed, and `attentionCount === 0`.
- **The opening surface is the Morning Brief panel (`views/briefPanel.ts`), not a raw markdown preview.** The brief renders a verdict band, per-member cards with status glyphs and headlines, and "Open report" buttons that re-validate paths via `validateReportPath` before opening. The markdown summary remains the durable artifact and is reachable via the "Open full summary" footer button. If panel creation throws (webview-hostile environment), the routine falls back to `openReport(reportPath)` so Phase 1/2 behavior degrades gracefully. The `Open Saropa Morning Brief` command (`saropaWorkspace.openMorningBrief`) opens the most recent brief at any time.

### 4.10 A status-bar indicator's click is an action menu, and one action hides it

An always-visible status-bar item raises four questions — what is it, where is what it
produced, how do I change it, how do I get rid of it — and its click must answer all
four (user report 2026-07-10). Revealing a tree row answers none.

- **Click opens a QuickPick of actions**, led by the artifact the item exists for (the
  last report), then the screen that lists them durably, then run / reveal / edit /
  turn off.
- **Hiding the indicator is one of the actions**, backed by a `saropaWorkspace.*`
  boolean setting so the choice survives a reload. The toast says where to turn it
  back on, and says that hiding the indicator does not stop the scheduled run.
- **Every status-bar item sets `StatusBarItem.name`.** Without it, VS Code's own
  right-click "Hide" menu labels the entry with the extension's display name, so two
  entries from one extension are indistinguishable.

### 4.11 Status-bar indicators are compact and time-gated

A status-bar item's horizontal space is shared with every other extension. Minimize its footprint and its presence:

- **Show only the essential datum in the text** — for a scheduled-run indicator, the time alone (`$(clock) 07:00`). The shortcut name, explanation, and actions belong in the tooltip and the click menu (§4.10), not in the item text.
- **Time-gate visibility.** An indicator that advertises a future event hides itself until the event is imminent (configurable via `scheduleStatusBarLeadMinutes`, default 30). Outside that window the item is absent, not merely dimmed — absent means zero space consumed.
- **Flash a "just ran" state after a completed run.** When a scheduled run finishes, the indicator switches to a brief confirmation (`$(check) ran {time}`) for 2 minutes, then hides. This closes the gap between "run happened" and "where is the report" — one click from the flash reaches the report. The flash takes priority over the next-run indicator.
- **The tooltip carries the full context** that the compact text omits (the name, the action hint).

### 4.12 Suite data crosses the extension boundary through a versioned API, and absence degrades silently

A surface that shows another Saropa extension's data (the Suite Daily Report is the
model — `commands/dailyReport.ts`) consumes it ONLY through the sibling's
`activate()` exports API, never by reading its files or storage:

- **The exports API is the contract.** Call
  `vscode.extensions.getExtension(id)?.exports` (activating on demand — an idle
  sibling has no exports yet), gate on `apiVersion`, and declare a local structural
  copy of the payload type rather than importing from the sibling's repo.
- **Validate the payload at runtime.** Data that crossed an extension boundary is
  treated like parsed JSON: shape-checked before use, so a sibling version drift
  renders as an omitted section, not a broken document.
- **Absence is a normal state, not an error.** A tool that is not installed, fails
  to activate, or predates the API contributes nothing — the surface renders
  without it and, when NO sibling contributed, says so in one line. Never a toast,
  never an error surface, for a missing optional sibling.

---

## 5. Voice and tone

The app speaks **to** the user, never as a company and never in the user's voice.

- **Second person** for instructions and toggle labels: *"Add a birthday"*,
  *"Show suggestions to fix mistakes"*.
- **Third person about the product** for behavior: *"Saropa Workspace seeds
  demo pins on first install."*
- **Banned both ways:** corporate plural (*"We'll find…"*, *"our picks"*) **and**
  user-voice singular (*"Remind me…"*, *"my pins"*). A toggle is a second-person
  command (*"Show suggestions…"*), not *"Prompt me…"*.
- **Tell the user what to do next** when the action needs follow-through:
  *"Restart your dev server to apply the new values."*

---

## 6. American English (hard rule)

All output — code, comments, commits, docs, and every user-facing string — uses
American English: color, favorite, behavior, center, gray, organize, license,
catalog, dialog. The `scripts/hooks/spelling_guard.py` PostToolUse hook enforces
this at write time and blocks the commit on a British spelling; do not rely on
it as a substitute for writing it right.

---

## 7. Design quality bar

- **Use the design system — never hardcode what a token defines.** Pull color,
  spacing, and type from VS Code theme variables (`--vscode-*`) in webviews and
  from `ThemeIcon` / `ThemeColor` in native surfaces. A raw hex or magic px where
  a token exists is a defect.
- **Consistency with the surrounding editor beats novelty.** Match VS Code's
  spacing density, corner treatment, and iconography. A surface that ignores the
  editor's visual language reads as broken even when it is technically correct.
- **No embellishment for novelty** — no shimmer, rainbow color, or "premium"
  treatment that was not asked for. Write the simplest version that does the job.
- **Verify before declaring done:** the tokens resolve, dark and light themes
  both render, nothing overflows at narrow and wide widths, and contrast meets
  WCAG AA.

---

## Maintaining this guide

This guide is a living document, not a fixed plan. Two triggers add to it:

1. **A change introduces a new pattern** (a new screen type, a new feedback
   surface, a new naming decision). Capture the decision here in the same change,
   so the next author inherits it instead of re-deciding.
2. **A developer asks for something that an existing rule would break, or that no
   rule yet covers.** Before building, check this guide. If a rule is broken, say
   so and reconcile it with the request before writing code. If no rule covers
   it, decide the right convention, apply it, and write it down here.

When a rule changes, update the affected surfaces to match — do not leave the
guide describing a state the code no longer reflects.
