# Plan: Release Board redesign (calm, editable, visual)

Status: design only. Nothing here is decided until the owner answers the "Owner decisions needed" list.
Mockup: [PLAN_RELEASE_BOARD_REDESIGN_mockup.html](PLAN_RELEASE_BOARD_REDESIGN_mockup.html) (open it in a browser; tabs Gantt, the default (decisions 18 and 21), Board and Future; menus open on click, two are shown open; "Hand off…" in any row menu or the Project actions menu opens the hand-off drawer of section 16).
Base plan: [PLAN_RELEASE_BOARD_v2.md](PLAN_RELEASE_BOARD_v2.md). Leftovers: [deferred/20261027_release_board_leftovers.md](deferred/20261027_release_board_leftovers.md).

## 1. Owner feedback (2026-10-30)

1. Too busy to use. Wants more pills, fewer brackets, combined decorations, sections that collapse by themselves, menus instead of chips.
2. Too much red. Red only for real blockers; a calm palette.
3. Setting a status or raising/lowering an item's importance is very hard.
4. Assigning dependencies between items is very hard.
5. Grouping items, and seeing groups, is very hard.
6. Wants a visual workflow (flow) layout.
7. Wants a timeline.
8. Scope is unclear: the board does not say if it shows the open project, all chosen projects, or both combined. Rush, Deliberate and Zero defects do not say what they apply to.

## 2. Settled decisions this plan keeps

From `PLAN_RELEASE_BOARD_v2.md`, the style guide and shipped code. The redesign changes how they look, not what they mean.

- One light per project: GO, NO-GO, UNVERIFIED. GO needs evidence. Words unchanged.
- The folder is the status. Color meanings: red address now, amber next, purple in progress, blue deferred (Future tab), green done, grey no rule.
- Profiles Rush, Deliberate, Zero defects, with the same stop sets. A red folder, a failing lint, test or build blocks in every profile.
- A severity lowered by hand is never hidden (the "set by you" note stays).
- `Needs:` lines are the first source of links; links are always shown; a blocked item sorts under its blocker.
- Groups: by hand in the rules file first, then file prefix, then shared source files; hubs never merge groups.
- No AI. Every light comes from a readable rule.
- Webview is local only: strict CSP, no library, no CDN, `--vscode-*` theme variables. One color signal per card (style guide). Fold state remembered per viewer (`getState`).
- The phone view (deferred) has its own renderer and is not touched.

Two settled rules this plan would bend. Both are listed as owner decisions (1 and 2), not assumed:

- 2.0 rule "Words and numbers appear after a click, never on the first screen". Count pills on the first screen break it. (The shipped board already shows many count pills through `pillify`.)
- 2.0 rule "at most six small marks per row". The redesign tightens it to two pills per row.

## 3. Current problems, mapped to code

| # | Problem | Where | What happens today |
|---|---|---|---|
| 1 | Too many blocks, all always on | `extension/src/board/boardHtml.ts:94-113` | About 17 blocks in a fixed order: top bar, intro, set-by-you note, keyword line, accept banner, Since, Tidy, Sittings, Trains, roll-up, project rows, skipped rows, Resolve now, In progress, Work on, Unnamed crashes, Linked, Outside, No rule, blocked note. |
| 1 | Crowded top bar | `boardHtml.ts:94` | Title, Refresh, three profile buttons, Projects, Settings, menu, start-up checkbox: nine controls on one line. |
| 1 | Up to 13 glyphs per row | `boardHtmlRows.ts:119-133` (`marks`), `:148-194` (`linkMark`) | Ring, size bars, code letter, project dots, flame, link, blocks, severity, set-by-you, Pro, pin, chats, hub. The 2.0 plan said six at most. |
| 1 | Project row overload | `boardHtmlRows.ts:102-115` (`verdict`) | Name, light, link, up to four health dots, job sentences, report notes, up to 14 colored squares. |
| 1 | Brackets | `src/i18n/locales/en.json` and `boardHtmlRows.ts:253` | "Finish {title} (red folder).", "Finish {title} (pinned as critical).", `title (project)` in Path to GO, "Needs a rule: {folder} ({count} documents…)", "Future ({count})", "Since you last looked ({time})", "Hand {batch} to chat ({queued} more queued)". |
| 1 | Chips | `boardHtmlBoxes.ts:19-46` (`sittingsBox`), `:107-111` (`profilePicker`) | Five time chips, an All chip and one chip per context; three profile buttons. |
| 1 | Little auto-collapse | `boardHtmlUtil.ts:301` (`collapsible`), `boardHtmlRows.ts:13` | Every section starts open. Only lists over 25, the no-rule list over 10 and outside lists over 25 start folded. Empty sections still render with "nothing here". |
| 2 | Solid red light | `boardHtmlAssets.ts:26` (`.go.no-go`) | Solid red fill, white text, on every NO-GO project and every train member (`boardHtmlBoxes.ts:180-196`). |
| 2 | Red that does not block | `boardHtmlRows.ts:135-144` (hot flame, "never an input to the light"), `boardHtmlAssets.ts:29` (`.link.flag`, stale `Needs:`), red link diamond (`linkMark`, state not open/done) | Red appears on things that never change the light. |
| 2 | Same blocker red four times | project squares, Resolve now, Path to GO, Linked chain | One blocker repeats in red across four places. |
| 3 | Status and severity edit | `boardHtmlMenus.ts:20-23` → `views/boardPanel.ts:317-341` → `commands/boardRuleAssign.ts:203` (`changeDocStatus`), `:256` (`changeDocSeverity`) | Row menu, then a quick pick, then a modal confirm, then a rules-file write, then a full rescan. Five steps and a reload per change. The Future tab already edits inline with a select (`boardHtmlFuture.ts:53-72`), so the two tabs behave differently. |
| 4 | Dependencies | `boardHtmlBoxes.ts:154-174` (`chains`), `train.ts` | Only by typing a `Needs:` line into the document, accepting a dashed suggestion, or editing `dependsOn` in the rules file. No way to add or remove a link from the board. |
| 5 | Groups | `groups.ts`, `boardHtmlRows.ts:214-239` (`list`) | Groups are computed and shown only as a sub-heading inside a list, and only when two members fall into the same list. No group view. By-hand groups only by editing the rules file. |
| 6 | Workflow | none | Closest: Path to GO (`boardHtmlRows.ts:301-308`), train row (`boardHtmlBoxes.ts:180-196`), Linked chains. |
| 7 | Timeline | none | The model has no dates except the since-last time and file times. |
| 8 | Scope | `package.json:2540` (`releaseBoard.projectScope`, `openOnly` or `all`), `board/extraProjects.ts:15`, `boardHtmlProjects.ts:46-99` | Changed only inside the Projects quick pick. The page shows it only indirectly: the hint "Only this project is shown.", the note "Chosen projects hidden: N", and "{count} projects" only when there is more than one. The intro text says "the open workspace and the projects you chose" even when only the open project is shown. |
| 8 | Profile scope | `package.json:2515` (`releaseBoard.profile`), `boardHtmlBoxes.ts:107-111` | One setting for every project on the board. Tooltips say "Rush: only extreme and critical documents stop a release" but not that it applies to every project, nor that red folders and failing checks always block. |

## 4. Information architecture

### 4.1 Header (one line, wraps on a narrow panel)

`Saropa Release Board · Scope [This project | All projects 5] · scope and mode pill · Gantt | Board | Future · ⋮ View options · ⋮ Project actions` (decision 20). Under it, one line of removable filter pills, hidden when none are applied.

- **Scope switcher**, always visible, labeled "Scope". Two choices: "This project" (the folders open in this window) and "All projects N" (open plus chosen). It writes the existing `projectScope` setting; no new setting. "Projects…" (add or remove chosen folders) moves into the ⋮ menu.
- **Release profile menu** (decision 20: this is now the Mode section of the View options kebab, no header button), shown as a list showing the current profile. Each menu entry has one line saying what blocks. The menu footer says what it applies to: "Applies to all 5 projects on this board. Red folders and failing lint, tests or build block in every profile."
- **Scope and mode pill** (decision 24; replaces the former explanation line): one pill, for example `⚙ All 5 · Deliberate`. Its tooltip carries the full detail, rewritten for the current state: "Showing all 5 projects. Deliberate: extreme, critical and high items block a release, in all 5 projects. Red folders and failing lint, tests or build block in every mode." With "This project": "Showing Saropa Contacts only. 4 chosen projects hidden."
- **View tabs**: Gantt first and the default view when the board opens (decision 21; one list replacing the separate Flow and Timeline views, decision 18), Board (today's page, calmer), Future (existing tab). Settings, Rules, Keywords, start-up checkbox move into ⋮.
- **Filter pills line** (decision 20): replaces the summary line and the Group by control. Group by moves into the View options kebab; the light counts live in the scope and mode pill tooltip and the project card pills.

### 4.2 "Combined" without a third scope

The owner names three cases: the open project, all chosen projects, and all combined. Scope picks which projects; Group by picks the layout:

- Group by **Project**: one card per project, its lists inside the card.
- Group by **None**: one merged list across projects (today's Resolve now / Work on lists). This is "combined".
- Group by **Group**, **Status**, **Severity**: see section 9.

### 4.3 Board view order

1. Project cards (collapsed except per section 12), each with a pill summary.
2. Steps I can do now: one collapsed section; its filters become two menus, "Time: Any ▾" and "Have: All ▾".
3. "More" strip: one line of pills, one per side section with something to show (Since you last looked, Linked, Tidy, No rule, Outside, Unnamed crashes). A pill opens its panel below; one open at a time.

Accept banner and safety hold stay at the top; they need action.

## 5. Color and severity system

**What earns red: only what makes a light NO-GO under the current profile.** That is an item that stops the release (red folder, a stopping severity, pinned as critical), or a failing lint, tests or build. Nothing else is red.

| Color | Used for | Never used for |
|---|---|---|
| Red | Blocks the release now | Errors in named files that do not change the light, stale `Needs:`, severity alone |
| Amber | Review next; a warning; a link waiting on open work; a stale `Needs:` (dashed) | |
| Purple | In progress | |
| Blue | Deferred (Future tab only); focus and links (theme) | |
| Green | GO, done, passing | |
| Grey / neutral badge | Counts, size, progress, project tags, no rule, unknown | |

Rules:

- **One red mark per row at most.** The status pill carries it. Severity is a word in that pill, not a separate red triangle.
- **A NO-GO light is a tinted pill** (red text and border on a faint red background), not a solid block. Options in decision 3.
- **A blocker is red in one place per view**: its own row. The project card shows a red count pill; Path to GO and Linked show the item neutrally with a link to it.
- **Shape as well as color**: ● blocks, ◆ review, ◐ in progress, ○ no rule, ✓ done. Works in high contrast and for color-blind users.
- Status colors come from `--vscode-charts-*` with today's hex values as fallbacks, so the board follows the theme.
- The same rule applies to the sidebar tree, status-bar light and editor links (`editorLinks.ts`, `sidebar.ts`), so the surfaces agree.

### Severity scale

Extreme, critical, high, medium, low (unchanged). Shown as a word inside the status pill. Whether it blocks depends on the profile; the pill turns red only when it does.

## 6. Pills and combined decorations

A row has at most: **status pill**, title, **facts pill**, project tag (only when rows from several projects are mixed), ⋮ (on hover or focus).

- **Status pill**: `◆ Review · High ▾`. Shape and color give the status; the word gives the severity; ✎ marks a value set by hand. Clicking opens the row menu (section 7).
- **Facts pill**: neutral. Progress ring and "3/7", link "⛓ 1", Pro, chats. Full detail in the tooltip. Size bars, code letter and project dots move to the tooltip and the opened row.
- **No brackets on screen.** A bracketed part becomes a pill or moves to the tooltip: "Finish {title} (red folder)." becomes `{title}` plus a `Red folder` pill. The strings change in `en.json` only; translations follow the owner's own pipeline.
- **Menus instead of chips**: the profile buttons, time chips and context chips become menus.

## 7. Inline status and severity editing

Click the status pill (or press Enter on a focused row) to open one menu:

- **Status**: the same choices as today's quick pick, as a radio list with shapes.
- **Severity**: `▲ Raise` and `▼ Lower` (one level each), the five levels as a radio list, and "Back to automatic". Keyboard: `+` and `-` on a focused row raise and lower.
- **Live effect line** before anything is saved: "Lowering to Medium: this no longer blocks under Deliberate. Saropa Contacts stays NO-GO (1 other blocker)."
- **Other entries**: Waits on…, Blocks…, Move to group…, Open, Hand to chat, Rules file.

Saving:

- The change applies at once, with an **Undo** bar for 10 seconds. No quick pick and no modal for a single-document change. The modal stays for folder rules (No-rule section), which touch many documents.
- The write keeps every rules-file check that exists today (unsaved copy, symbolic link, UTF-8, second read just before the write) in `commands/boardRuleAssign.ts`.
- The row updates at once in a pending style. The host rescans from the cache (incremental by size and time) and confirms. Where the save goes: decision 6.
- The set-by-you note and the ✎ mark stay, so a lowered severity is never hidden.
- Severity on the board and Importance on the Future tab stay separate scales but use the same menu look (decision 13).

## 8. Dependency assignment

Row menu → **Waits on…** opens a picker in place:

- A search box, then open items in the current scope, grouped by project, each with its status shape. Suggested links (shared pull request or file, today's dashed suggestions) at the top.
- Choosing one shows a preview of the write, for example "Adds `Needs: docs/plans/PLAN_share_keys.md` to Launch test checklist", then Add.
- **Blocks…** is the reverse: the line goes into the other document.
- Existing links are listed at the top of the picker with ✕ to remove.
- A link that would make a circle is refused with a one-line reason.
- A project waiting on a project: the project card menu has "Project waits on…", which writes `dependsOn` in the rules file (existing data).
- Storage: decision 7.

## 9. Grouping

- **Group by** menu: Project (default with All projects), Group, Status, Severity, None.
- **Group card**: name, worst status shape, a pill summary ("5 open · 2 block"), progress ring, and "auto" or "by you". Collapsed unless it holds a blocker.
- Row menu → **Move to group…**: existing groups, "New group…" (inline name field), "Remove from group". Writes the by-hand group to the rules file, which `groups.ts` already reads first. "Remove" from an automatic group writes an exclusion (the 2.0 plan's "a document can be pulled out of a group").
- A hub keeps its own mark and links to the groups it names.

## 10. Gantt view (decision 18; replaces the Flow and Timeline views)

One Gantt-style list. The board has no due dates and must not invent them (no AI, honest evidence).

- **Rows** are items, grouped under project or group headers (follows Group by). A collapsed group is one row with a count pill.
- **Bar and axis**: each bar sits on a work-order axis (dependency order, then Path to GO order), width from the step minutes the Sittings data already has; items without minutes get one standard width and a dashed edge. The axis is coarse: work order and milestones, never days (decision 19a). A target date shows only where the owner set one by hand (flag at the group end, amber within 3 days while NO-GO, stored in the rules file next to `dependsOn`). No invented dates.
- **Dependency arrows** are drawn only for the hovered or selected row (its waits-on and blocks), because the list passes about 30 items and drawing every arrow is a tangle.
- **GO / NO-GO light** closes each group (with the target flag, if set).
- **History**: finished items stay in the list, dimmed, so progress is visible. This replaces only the vanishing since-you-left idea; decision 16 stays.
- **Since you left** (decisions 16 and 43): an item changed since the last visit gets a static dotted blue border on its row. Never flashing, no animation; it stays until Dismiss.
- **Key** (decision 23): one small `?` pill on the Gantt toolbar; its tooltip explains status shapes and colors, bar colors, dashed edge, arrows, the light, the dimmed rows and the drag targets. No visible legend or status bands row; the status bands appear only while a row is being dragged, as drop targets (decision 19).
- Clicking a status pill opens the same status menu. Rows with no link are ordinary rows; no separate "Not linked" tray.
- Drag and drop to organize: see decision 19.

## 11. Timeline view

Merged into section 10 (decision 18). The earlier options (decision 10) are superseded. Optional target dates survive as the group-end flag. A past-30-days History mode is dropped in favour of dimmed finished items.

## 12. Auto-collapse rules

1. **Project cards** start collapsed. With "This project", the one card is open. With "All projects", only the open window's project opens, and only when it is NO-GO.
2. **A card the user opened or closed stays that way** (remembered per viewer, as today) until that project's light changes.
3. **An empty section is not drawn.** No "nothing here" line. Exception: the accept banner and the safety hold, which are never empty when shown.
4. **Side sections** (Since, Linked, Tidy, No rule, Outside, Unnamed crashes) sit in the "More" strip, closed. A section opens by itself once when it gains a blocker since the last look.
5. **Lists** show five rows and a "Show N more" pill.
6. **Group cards** are collapsed unless they hold a blocker.
7. **Steps I can do now** is collapsed when no step fits the filters, with the count pill in its heading.

## 13. Delivery order

One pull request per phase. Sizes: S up to a day, M two to three days, L about a week. Every phase updates the board HTML tests (`extension/src/test/board/`), adds a changelog line, and is checked with the headless render the 2.0 plan describes, in dark, light and narrow width.

| Phase | Content | Size | Writes user files? |
|---|---|---|---|
| 1 | Calm palette, one-red rule, header reduced to scope, tabs and two kebabs, per-row kebabs shown on hover or focus, filter pills line (decision 20), combined row pills, brackets out of strings, count pills with no parentheses (decision 15). Tooltips on every pill, icon, mode, scope and light, and detailed row hover cards (decision 17) | M | No |
| 2 | Header: scope switcher, Mode (release profile) in the View options kebab with the scope and mode pill (decision 24), view tabs, chips to menus, change-log entry (decision 16) | M | Settings only (existing keys) |
| 3 | Auto-collapse rules, project cards with pill summaries, "More" strip, Group by Project / None, "Since you last looked" stays until dismissed with the change log (decision 16) | M | No |
| 4 | Status pill menu: status and severity inline, raise/lower, live effect line, undo, no modal | M | Rules file (existing path). Needs an Opus diff review |
| 5 | Dependency picker: Waits on, Blocks, remove, circle check | L | Documents or rules file (decision 7) |
| 6 | Group by Group / Status / Severity, Move to group, New group | M | Rules file |
| 7 | Gantt view: grouped rows, work-order bars, arrows for the hovered or selected row, light at group end, dimmed finished items, `?` key pill (decision 23), optional target dates (replaces the former Flow and Timeline phases). Gantt becomes the first tab and the default view (decision 21) | L | Rules file (dates) |
| 8 | Drag and drop on the Gantt (decision 19): reorder, regroup, create a dependency, change status. Needs phases 4, 5, 6 and 7 first | M | Rules file and `Needs:` lines (same paths as phases 4 to 6). Needs an Opus diff review |
| 9 | Visual polish from the first headless render (section 19). Runs only after every current branch is merged, because it touches the same board files | M (estimate) | No |

Decision 44 (scale and auto-organization) spans phase 6 and the AI Organize pass (section 16.4). Its build is Org 1 to Org 4 (section 18.9), in this order (decision 52): phase 6 merges now; then Org 1 and Org 2; then the reorder change (decision 53); then Org 3 (editor); then Org 4 after phase 5 merges.

### Phase 1 delivered notes

- The row hover card has why it blocks, what it waits on, and set by hand.
- Not built, deferred to phase 2: the "changed by a rule" and "new `Needs:` line" provenance lines.
- The dashboard and schedule panels still use red for non-blockers. This is outside phase 1 scope; review it when those surfaces are touched.
- Phase 2 dotted blue border marks only documents that became blockers since the last visit. Items cleared, or whose status or severity changed, are not marked: the change log covers what the digest tracks. Widening the marks is a phase 4 follow-up, once status and severity changes are recorded.
- The `routine.summary.needsAttention` and `brief.needsAttention` strings keep their parentheses: they are outside the Release Board.

Phases 1 to 3 give the relief the owner asked for first, with no new writes.

AI hand-off phases (Handoff phase 1 to 4): section 16.6. Timing: decision 35.

Phase 1 count-paren scope (decision 15), found by grep of `extension/src` and `extension/src/i18n/locales/en.json`:
- Tab label, the Future tab: `extension/src/board/boardHtmlFuture.ts:39-40` builds it from `releaseBoard.future.tab`, which is `"Future ({count})"` at `extension/src/i18n/locales/en.json:2381`. Fix the string to `Future {count}` so `pillify` renders the number as a pill beside the label.
- Section headings and other counts with parentheses, all in `extension/src/i18n/locales/en.json`: line 1369 (`routine.summary.needsAttention`), line 1621 (`brief.needsAttention`), line 1980 (`releaseBoard.polish.squares`, a sentence, not a pill), line 2415 (`releaseBoard.future.outsideHeading`), line 2443 (`releaseBoard.future.handAll`).
- Other locale files were not checked. They hold translated wording, so the owner's translation pipeline updates them.
- Board tab markup: the Board tab (`boardHtmlFuture.ts:40`) has no count.
- Mockup `plans/PLAN_RELEASE_BOARD_REDESIGN_mockup.html`: no parentheses or square brackets wrap a count in visible text. The Future tab uses a space and a pill (line 264).

## 14. Risks

- **Bent settled rules**: count pills on the first screen and the per-row mark limit (decisions 1 and 2).
- **No modal on status and severity**: a misclick changes a light. Mitigation: undo bar, ✎ mark, set-by-you note, live effect line before the click.
- **Writing into user documents** (`Needs:` lines): unsaved editors, symbolic links, encodings, merge noise in git. Reuse the rules-file safety helpers (`hasUnsavedCopy`, `isLink`, `sameRead` in `commands/boardRuleAssign.ts`).
- **Gantt without a library**: many items make a tangle of arrows. Arrows only for the hovered or selected row, groups collapse, simple rows and absolute-positioned bars only.
- **Surfaces drift**: sidebar, status bar and editor links keep old colors unless phase 1 covers them.
- **Accessibility**: menus need `role="menu"`, arrow keys, Escape, focus return; color is never the only signal.
- **Test churn**: HTML tests (for example `boardPolish.test.ts`, `severityUser.test.ts`) assert today's markup and will change in each phase.
- **New strings**: every phase adds English keys; translations are the owner's pipeline and lag until run.
- **Narrow panels**: the header must wrap cleanly; the 2.0 plan requires a phone-width pass.

## 15. Owner decisions (confirmed 2026-10-30)

Each is decided with the recommended option, marked DECIDED below.

1. **DECIDED: (a).** **Count pills on the first screen.** (a) Allow count pills in project summaries and section headings only; row figures stay in tooltips. (b) Keep the 2.0 rule: no numbers until a click. (c) Pills everywhere. **Recommend (a)**: it is what the owner asked for and what the shipped board already half does, while rows stay quiet.
2. **DECIDED: (a).** **What red means.** (a) Red only for "blocks the release under the current profile"; an amber-folder item with a stopping severity shows a red pill. (b) Keep red per folder and severity as today, just smaller. **Recommend (a)**: it is the owner's "red only for real blockers", and it matches the 2.0 meaning "address now".
3. **DECIDED: (a).** **Look of the NO-GO light.** (a) Tinted pill: red text and border, faint red fill. (b) Solid red as today. (c) Red dot plus the word. **Recommend (a)**: still unmistakable, a fraction of the red area.
4. **DECIDED: (a), together with item 2 ("what red means"): amber.** **Red that does not block.** Turn the hot flame (errors in named files), the stale `Needs:` flag and the red link diamond amber. (a) All three. (b) Leave as today. **Recommend (a)**: none of them changes the light.
5. **DECIDED: (a).** **Scope control.** (a) Two choices, This project / All projects, plus Group by for "combined". (b) Three choices: This project / Each project / Combined. (c) (a) plus a picker for any subset of projects. **Recommend (a)**: one setting that exists already, and "combined" is a layout, not a scope.
6. **DECIDED: (a).** **Saving a status or severity set inline.** (a) Rules file as today, no modal, undo bar. (b) Rules file with today's modal confirm. (c) Local marks cache only, like In progress and pin. **Recommend (a)**: fast, still shared with the team through the repo, still reversible.
7. **DECIDED: (a).** **Where a new dependency is stored.** (a) A `Needs:` line written into the waiting document. (b) A links list in the rules file. (c) Local cache. **Recommend (a)**: it is the 2.0 plan's first source, readable by people and agents, and kept in git.
8. **DECIDED: (a).** **Default layout with All projects.** (a) Group by Project, each project's lists inside its card. (b) Group by None, today's merged lists. **Recommend (a)**: it answers "which project is this" without a tag on every row.
9. **SUPERSEDED by 18.** (was DECIDED: (a).) **Type of workflow view.** (a) Dependency flow, left to right, ending at each project's light. (b) Status columns with drag to change status. **Recommend (a)**: links are a core 2.0 idea and have no visual today; status columns are already one Group by choice away.
10. **SUPERSEDED by 18.** (was DECIDED: (a).) **Type of timeline.** (a) Order lanes per project, no invented dates, plus an optional target date per project set by hand. (b) Calendar with estimated dates per item. (c) History of the past 30 days only. **Recommend (a)**: useful now, honest, and needs only one new value per project.
11. **DECIDED: (a).** **Release profile applies to.** (a) Whole board, as today, and say so in the menu. (b) Per project, with a board default. (c) Per train. **Recommend (a) now**: it is how the code works; (b) is still the open 2.0 question ("per project or per release") and can come later without changing the menu.
12. **DECIDED: (a).** **Auto-collapse rules** in section 12, including "an empty section is not drawn" (today the No-rule section always shows). (a) Adopt as written. (b) Adopt without rule 3. **Recommend (a)**: empty sections are a large share of the noise.
13. **DECIDED: (a).** **Severity and Importance.** (a) Keep two scales (board Severity, Future Importance) with the same menu look. (b) Merge into one scale. **Recommend (a)**: they answer different questions (does it block, is it worth building), and merging would rewrite the Future tab.
14. **DECIDED: (a).** **Phase order.** (a) As in section 13: calm and clear first (1-3), then editing (4-6), then the Gantt view and its drag and drop (7-8). (b) New views first. **Recommend (a)**: the first three phases remove most of the pain with no new writes.
15. **DECIDED (2026-10-30, owner): no parentheses or brackets around a pill or count.** A count pill sits beside its label with a space, e.g. `Future [25 pill]`, never `Future (25)`. Applies to tab labels, section headings and every other count.
16. **DECIDED (2026-10-30, owner): "Since you last looked" stays until dismissed, and a change log stays reachable.** Owner called it "since you left". The text in code is "Since you last looked" (`extension/src/i18n/locales/en.json:2366-2367`). Today the strip clears by itself after 8 seconds on screen: `DWELL_MS = 8000` at `extension/src/views/boardSinceLast.ts:17`, timer set at `:101-109`, cleared by the timer at `:102-108`. The only manual clear is the sidebar "mark as seen" command, `markSeenNow` at `:121`. Requirement: (1) the strip stays until the owner clicks Dismiss, with no timer; (2) a persistent change log of what changed since the last visit (items done, status changes, new blockers) is reachable from the header. (3) Items changed since the last visit get a dotted blue border in the Gantt and board rows (decision 43). **Recommend**: keep the log until the owner dismisses it, so one dismiss clears both.
17. **DECIDED (2026-10-30, owner): more tooltips.** Every pill, icon, mode, scope and light gets a tooltip saying what it is and what a click does. Rows get detailed hover cards: why it blocks, what it waits on, and who or what changed it (set by hand, changed by a rule, or a new `Needs:` line). **Recommend**: build the cards in phase 1, since they cost no writes and show the owner what each mark means before the layout changes.
18. **DECIDED (2026-10-30, owner): one Gantt-style list replaces the separate Flow and Timeline views.** Rows are items grouped under project or group headers. Bar on a work-order axis, with a target date only where the owner set one; no invented dates. Dependency arrows are drawn only for the hovered or selected row (crowding past about 30 items). Each group ends with its GO/NO-GO light. Supersedes decisions 9 (flow view) and 10 (timeline lanes). The axis stays coarse (work order and milestones, never days). Finished items stay in the list, dimmed, so progress is visible; this replaces only the vanishing since-you-left idea and decision 16 stays. Section 10; phase 7.
19. **DECIDED (2026-10-30, owner): drag and drop to organize the Gantt.** Drag a row to reorder it; drop it onto a group header to regroup it; drop it onto another row's "Waits on" slot to create a dependency (a `Needs:` line, decision 7); drag between status bands to change status. Every drop saves at once with the Undo bar, as in decision 6. Scope: **phase 8** (after phases 4 to 7). The mockup demonstrates reorder and regroup and highlights the other drop zones.
20. **DECIDED (2026-10-30, owner): controls live in kebab menus; the board stays quiet.** The owner found the mockup extremely busy. Header shows only the scope switch, the tabs, one kebab for view options (mode, group by, sort, show history, density, severity filter) and one kebab for project actions (scan again, projects, rules file, keywords, settings, start-up). Row actions (status, severity, waits on, hand to chat, open) sit in a per-row kebab shown on hover or focus. Applied filters appear as one line of removable pills under the header (for example Severity: High, Group: Project, Hide done) with Clear all; with none applied the line is hidden. No always-visible chip rows, no per-row icon clusters, no brackets. Default state: everything collapsed except the project that needs attention, one pill per project summary. Scope: phase 1 (header, row kebabs, filter pills line) and phase 2 (Mode in the kebab).
21. **DECIDED (2026-10-30, owner): the Gantt view is the first tab and the default view when the board opens.** Tab order: Gantt, Board, Future. Note, not part of the decision: the Gantt ships in phase 7, so before then the board can only open on Board.
22. **DECIDED (2026-10-30, owner): minimal on every screen, the hand-off drawer included.** No explanatory sentences, legends, captions or help text on screen. Anything that explains sits behind a tooltip on a `?` pill or an icon. Visible UI is state as pills and icons, and actions in kebabs. Detail on demand only. Note, not part of the decision: the mockup treats open menus, pickers and hover cards as detail on demand, so their one-line descriptions stay.
23. **DECIDED (2026-10-30, owner): the Gantt status bands legend row is replaced by one small `?` pill on the Gantt toolbar**, whose tooltip is the key. The visible legend row goes. Note, not part of the decision: decision 19 still needs status drop targets, so the mockup shows the bands only while a row is being dragged.
24. **DECIDED (2026-10-30, owner): the scope sentence goes.** "Showing all 5 projects. Deliberate: extreme, critical and high items block a release, in all 5." becomes one scope and mode pill, `⚙ All 5 · Deliberate`, whose tooltip carries the full detail: which projects are shown, what the mode blocks, that it applies to all N projects, and that red folders and failing checks block in every mode.

25. **DECIDED (2026-10-30, owner): AI hand-off entry points.** Hand off lives in the row, group and project menus plus Project actions entries; no header button. (Section 16.8 item 1, option a.)
26. **DECIDED (2026-10-30, owner): default hand-off format.** Markdown by default, JSON on a toggle; the saved file holds both. (16.8 item 2, option a.)
27. **DECIDED (2026-10-30, owner): hand-off files.** `.saropa/handoff/` per project, never committed, last 20 kept. (16.8 item 3, option a.)
28. **DECIDED (2026-10-30, owner): "Open in agent" action.** Run in terminal from one editable command (default Claude Code); the clipboard is always kept. (16.8 item 4, option a.)
29. **DECIDED (2026-10-30, owner): choosing specific items.** A checkbox on row hover; an "N chosen" pill with Hand off in the filter line. (16.8 item 5, option a.)
30. **DECIDED (2026-10-30, owner), CHANGED from the recommendation: the hand-off is a document.** The board always writes the full hand-off document to a file, never cut, with no token limit. What is copied or sent to the AI is a short command that refers the AI to that file (for example "Read <path> and action it."). The 25,000-token clipboard budget is dropped. The on-screen preview can still show the document, and an option copies the full document text. Supersedes 16.8 item 6 (a). Section 16 and the mockup are updated to match.
31. **DECIDED (2026-10-30, owner): how an AI result comes back.** Paste into the drawer, plus the board watches the hand-off folder for result files. (16.8 item 7, option a.)
32. **DECIDED (2026-10-30, owner): marking accepted AI changes.** Treated as set by the user, with "from AI proposal" in the history line. (16.8 item 8, option a.)
33. **DECIDED (2026-10-30, owner): what an AI may change.** Status, severity, group and `Needs:` links only. (16.8 item 9, option a.)
34. **DECIDED (2026-10-30, owner): retire the old Hand to chat.** Remove the row button, cut the six settings to two, and turn Future "Hand all" into one hand-off. (16.8 item 10, option a.)
35. **DECIDED (2026-10-30, owner): hand-off phase timing.** Handoff phases 1 and 2 are built right after phases 1 to 3 (calm-down); handoff phases 3 and 4 after phases 4 to 6 (editing). (16.8 item 11, option a.)
36. **DECIDED (2026-10-30, owner): direct agent connection deferred, not built now.** An MCP server or VS Code tool so an agent reads the board and submits changes itself. See `plans/deferred/DEFERRED_AGENT_DIRECT_CONNECTION.md`. (16.8 item 12, option a.)
37. **DECIDED (2026-10-30, owner): use the claude-chat-explorer in-process API, as an optional enhancement.** (17.4 item 1.)
38. **DECIDED (2026-10-30, owner): first feature is one "active now" pill on project cards and rows.** (17.4 item 2, option a.)
39. **DECIDED (2026-10-30, owner): delivery as its own small phase after phase 3.** (17.4 item 3, option b.)
40. **DECIDED (2026-10-30, owner), CHANGED from the recommendation: freshness is polling every 30 seconds, with a pause/play button.** A small icon pill stops and resumes polling. Degrade gracefully if the API is unavailable. When it is not available, show a brief notice in a top bar that auto-hides. This overrides "silent when absent" for this one case; the notice stays brief and minimal (decision 22). (17.4 item 4.)
41. **DECIDED (2026-10-30, owner), CHANGED from the recommendation: an optional call plus an off setting.** A new setting turns the integration off. No `extensionDependencies`. (17.4 item 5.)
42. **DECIDED (2026-10-30, owner): handoff status line not now.** Revisit after handoff phase 3. (17.4 item 6, option a.)
43. **DECIDED (2026-10-30, owner): "since you left" marks.** Items changed since the last visit get a dotted blue border in the Gantt and board rows (decision 16's scope). Static: never flashing, no animation; it stays until dismissed. The mockup shows no such row markers, so it is unchanged.
44. **DECIDED (2026-10-30, owner), requirement: scale and auto-organization.** The board must work from a few documents to hundreds, with many levels of folders feeding it; showing everything overwhelms and gets ignored, hiding everything is useless. Requirements: (1) auto-grouping by folder, filename and keyword heuristics; (2) groups auto-collapse, with row limits that adapt to document count; (3) auto-naming of groups (readable names from folder or keywords); (4) auto-assigned emoji per group or item from keywords; (5) auto-assigned colour per group; (6) auto-assigned dependencies and links from keywords and filenames (for example phase 2 waits on phase 1), shown as proposals the user accepts or rejects, never applied silently; (7) every automatic result can be overridden by hand and the override persists; (8) the heuristics must be deterministic, explainable (tooltip says why), and configurable by keyword dictionary. Status: requirement recorded; design pending (needs an Opus design pass: heuristics, keyword dictionaries, thresholds, overrides storage, how it relates to phase 6 grouping and the AI Organize pass).
45. **DECIDED (2026-10-30, owner), requirement: everything automatic is configurable through the UI.** The tags and keywords that drive grouping, naming, emoji, colour and link inference are visible in row and group hover cards and detail panels (which tags matched and why). The user can add, edit, rename, remove and re-order their own tags and dictionary entries from those panels and from one "Tags and rules" editor view: a list of tags with keyword patterns, emoji, colour and effect, a test-match preview against the current documents, import and export, and reset to default. Per-item and per-group overrides (rename, emoji, colour, group, link) are edited in place and persist. JSON and settings files stay as the storage and an advanced path, but no feature may require hand-editing them. Minimal chrome: a kebab entry and `?` tooltips (decisions 20 and 22). Design: section 18.
46. **DECIDED (2026-10-30, owner): tags, dictionary and overrides live in the rules file under one new key.** (18.10 question 1, option a.) The `organize` key in `.saropa/release-board.json`, shared through git.
47. **DECIDED (2026-10-30, owner): open groups at scale.** (18.10 question 2, option a.) From 50 documents, at most the 3 groups with the most blockers are open; every other group stays closed with its red count pill. This bends section 12 rule 6 (every group holding a blocker opens), and 18.3.2 applies it.
48. **DECIDED (2026-10-30, owner): where emoji show.** (18.10 question 3, option a.) Group headers and hover cards only, never on rows. Rows keep the two-pill limit (section 6).
49. **DECIDED (2026-10-30, owner), CHANGED from the recommendation: the board reads front matter.** (18.10 question 4.) Front matter is a settings block at the top of a document, read for tags and links. Precedence: user override > rules file > front matter > inference. Cost: a second source to parse in every scan. Each use must be explained in the "why" tooltip (18.4). The owner named tags and links only; the front matter key names are fixed in the Org 1 brief, and `group` is not confirmed.
50. **DECIDED (2026-10-30, owner): moving an overridden file.** (18.10 question 5, option a.) When exactly one file in the project matches, the override moves to it, with a change-log line and Undo. Otherwise it is listed in the Tidy panel.
51. **DECIDED (2026-10-30, owner): one editor.** (18.10 question 6, option a.) The Tags and rules editor absorbs the severity keyword editor as its Severity tab.
52. **DECIDED (2026-10-30, owner), build order CHANGED from the recommendation.** (18.10 question 7, option a, with the order changed.) Build order: merge phase 6 now; then Org 1 and Org 2; then Org 3 (editor); then Org 4 after phase 5. Sequence sorting of rows stays as in option a.
53. **DECIDED (2026-10-30, owner): reorder (decision 19's reorder drop).** Manual order applies only inside groups on the Board tab; the Gantt keeps dependency (work-order) order. Stored as an order list per project in the rules file (keyed by project and path, like the group lists), written with Undo through the shared write path. Keyboard path Alt+Up/Alt+Down; insertion-gap drop zones between rows. Built as a small separate change after the auto-organization wiring. Phase 8 shipped without reorder (no order store existed).

## 16. AI hand-off (design, 2026-10-30; owner answers recorded as decisions 25 to 36)

Deferred follow-up: `plans/deferred/DEFERRED_AGENT_DIRECT_CONNECTION.md` (decision 36).

Owner requirement (2026-10-30): working with Claude and other AI chats is critical. The owner must be able to copy detailed Markdown or JSON for one item, chosen items, a group, a project or the whole board. The shipped "Hand to chat" is ugly and works poorly. Target loop: (1) an AI reads the project documents and proposes an organization (status, severity, groups, dependencies); (2) the owner rearranges and sets severity, priority and status on the board; (3) the board hands the work to an AI to carry out, and the AI's result comes back to the board.

Fit with settled rules: the board itself never calls an AI and no light is computed by an AI (section 2, "No AI"). The AI only proposes; nothing changes until the owner accepts, and an accepted change is written as an ordinary by-hand rule or `Needs:` line, so every light still comes from a readable rule. Saving follows decision 6 (at once, Undo bar) and decision 7 (`Needs:` lines). The UI follows decision 20 (kebabs, filter pills, no new header buttons).

### 16.1 Current problems of Hand to chat

| # | Problem | Where |
|---|---|---|
| 1 | One thing at a time. A prompt covers one item, step or Sittings line; there is no selection, group, project or board scope. | `extension/src/board/handToChat.ts:5`, `extension/src/views/boardPanelActions.ts:150-185` |
| 2 | No preview. The text goes straight to the clipboard; the owner never sees what was sent. | `extension/src/commands/boardHandToChat.ts:94` |
| 3 | Plain text only. No Markdown structure, no JSON for tools. | `extension/src/board/handToChat.ts:167-180` (`formatPrompt`) |
| 4 | One fixed instruction for every job: "Please help me clear this…". No fix, plan, review or triage choice. | `extension/src/board/handToChat.ts:178` |
| 5 | Detail level is a global setting (short, standard, full), not chosen per hand-off. | `extension/src/commands/boardHandToChat.ts:33`, `extension/package.json:2594` |
| 6 | Thin item facts. No line number for items (only Sittings lines carry `:line`), checklist as a count only, no open step text, no history, no acceptance criteria. | `extension/src/board/handToChat.ts:80-117`, `:110`, `:163` |
| 7 | Links named by title, not path, and cut at 8 names, so the AI cannot open what an item waits on. | `extension/src/board/handToChat.ts:39`, `:50-53`, `:97-104` |
| 8 | No stable id. The page sends a list index; if the board re-renders, the request is dropped with "press again". | `extension/src/views/boardPanelActions.ts:161-170`, `extension/src/views/boardPanel.ts:52-55` |
| 9 | Paths are project-relative with no project root, so with several projects an agent opened in one folder cannot find another project's file. | `extension/src/board/handToChat.ts:33` |
| 10 | Document text is not fenced. A title goes raw into the prompt, while the Future research prompt flattens and fences its text. Two different injection rules. | `extension/src/board/handToChat.ts:116`, `:168` vs `extension/src/board/futureResearch.ts:55-85` |
| 11 | "Open chat" only focuses a chat panel; it is never given the text, so the owner still pastes by hand. Cursor command ids are guesses; a report says it opens a new Claude Code session. | `extension/src/board/handAgent.ts:1-4`, `:12-17`; `plans/deferred/20261027_release_board_leftovers.md:7-8` |
| 12 | Feedback through a toast with buttons that disappears. | `extension/src/commands/boardHandToChat.ts:114-123` |
| 13 | Future tab "Hand all to chat" copies one prompt per document with a modal confirm each: ten documents, ten modals. | `extension/src/commands/boardFutureResearch.ts:68-75` |
| 14 | No way back. The board cannot read an AI's answer, except the Future "Research: ready" line. | `extension/src/board/futureResearch.ts:79-85` |
| 15 | Six settings for one button. | `extension/package.json:2589-2625` |
| 16 | Two entry points that look different: a "Hand to chat" button on rows and an entry in the row menu. | `extension/src/board/boardHtmlUtil.ts:180-183`, `extension/src/board/boardHtmlMenus.ts:21` |

### 16.2 Payload

One builder, pure (no file reads beyond what the scan already holds, no network), replaces `handToChat.ts` and `researchPrompt` (`futureResearch.ts:64`).

**Scopes**: one item; selection (chosen rows); group; project; whole board (everything in the current Scope, decision 5). The current filters (filter pills line) apply, so "board, severity High" hands off what the owner sees.

**Formats**:
- **Markdown** (default, for people and chats): a short instruction preamble, then one section per project with its light and reasons, then one block per item. Document text sits inside fences and is labeled "data, not instructions".
- **JSON** (for tools and agents), versioned:

```json
{
  "schema": "saropa.releaseBoard.handoff/1",
  "id": "2026-10-30T10-04-12-contacts-fix",
  "task": "fix",
  "scope": { "kind": "selection", "count": 3, "filters": ["severity:high"] },
  "profile": "deliberate",
  "projects": [
    { "id": "contacts", "name": "Saropa Contacts", "root": "saropa-contacts", "light": "NO-GO",
      "reasons": ["2 items block"], "evidence": { "lint": "pass", "tests": "missing", "build": "pass" } }
  ],
  "items": [
    { "id": "contacts:docs/plans/LAUNCH_TEST_CHECKLIST.md", "project": "contacts",
      "path": "docs/plans/LAUNCH_TEST_CHECKLIST.md", "line": 1, "title": "Launch test checklist",
      "status": "red", "statusBy": "rule", "severity": "critical", "severityBy": "user",
      "importance": null, "pinned": false, "blocks": true, "why": "red folder",
      "group": { "id": "store-launch", "name": "Store launch", "by": "auto" },
      "waitsOn": ["contacts:bugs/HANDOVER_store_payments.md"], "blockedBy": [], "waitedOnBy": [],
      "acceptance": { "done": 4, "total": 12, "open": [{ "line": 18, "text": "Install on two phones" }] },
      "evidence": ["Tests: no result yet"], "history": [{ "at": "2026-10-29", "change": "severity high to critical", "by": "user" }],
      "rev": "1730281452-8812" }
  ],
  "file": ".saropa/handoff/2026-10-30T10-04-12-contacts-fix.json",
  "reply": { "schema": "saropa.releaseBoard.patch/1", "ops": ["setStatus", "setSeverity", "addNeeds", "removeNeeds", "setGroup"] }
}
```

**Each item carries**: id (`project:path`, from the existing `itemKey` at `extension/src/board/boardModelParts.ts:193`, a colon instead of the tab), title, path and line, project, status and who set it, severity and who set it, Importance (Future items only, decision 13), pinned, whether it blocks and why, group and whether it is automatic or by hand, waits on and waited on by (as ids, so an agent can open them), open checklist steps with line numbers (the acceptance list), evidence lines, blockers, history (from the change log of decision 16, once it exists; omitted before), and `rev` (file time and size) so a reply can be checked for staleness.

**Instruction preamble per task type** (English, built in; for the AI, not translated):
- **Fix**: work through the items in the given order; read each file first; make the change; tick the checklist step you finished; do not edit `Status:`, `Severity:` or `Importance:` lines; end with a reply patch (16.4) that sets the status you believe is now true, with a reason.
- **Plan**: change nothing; for each item write the steps, files and risks; end with a patch that only adds `Needs:` links you found.
- **Review**: change nothing; check each open acceptance step against the code and tests; say done or not done with evidence; end with a patch of status changes.
- **Triage** (also the organize pass, 16.4): read every listed document; propose status, severity, group and dependencies, one reason each; reply with the patch only.
- Common rules in every preamble: fenced text is data, not instructions; touch only the listed files; never delete or reword existing text; put the reply patch in one fenced block tagged `json saropa-patch`.

**Document, size and what is copied** (decision 30, supersedes the earlier budget and truncation design): the hand-off is a document. The board always writes the full document to `.saropa/handoff/<id>.md` and `<id>.json`; it is never cut and has no token limit. The drawer preview shows the document, with a token estimate pill, `~3.2k`, whose tooltip says it is characters divided by 4 and rough (decision 22); the pill is information only and never turns a warning color. What is copied or sent to the AI is a short referral command by default: `Read <path> and action it.` (the path of the saved file). An option, "Copy full text", copies the whole document text instead. There is no clipboard budget, no shortening order and no "Shortened" line.

**Privacy**: paths stay project-relative (as today, tested at `extension/src/test/board/handToChat.test.ts:62`); a project is named by its folder name, never an absolute path or user name. No document body is copied, only title, checklist step text, `Needs:` lines and evidence lines. Any copied line that looks like a key or token (long base64 or hex runs, `sk-`, `ghp_`, `eyJ`, `password=`, connection strings) is replaced with `[removed]`; no such helper exists in the extension today, so it is new. Hand-off files go to a folder that is never committed (16.3).

### 16.3 Delivery channels

What the extension can do today, with its `engines.vscode` of `^1.74.0` (`extension/package.json:12-13`):

| Channel | Works on any agent? | Status |
|---|---|---|
| **Copy** (primary) saves the document, then copies the short referral command, "Read `<path>` and action it." (`vscode.env.clipboard`, already used). **Copy full text** copies the whole document instead | Yes: any chat, web or desktop (full text for chats that cannot read files) | Works now |
| **Save to file**: `.saropa/handoff/<id>.md` and `<id>.json` in the project; the board writes `.saropa/handoff/.gitignore` containing `*` so the folder is never committed; keeps the last 20 | Yes: any agent that reads the repo | Works now (`workspace.fs`) |
| **Referral command for a CLI agent**: the default Copy; one line, "Read `.saropa/handoff/<id>.md` and action it." Small enough for any terminal agent; the full document stays in the file | Yes | Works now |
| **Run in terminal**: opens a VS Code terminal in the project and runs a command template from one setting, default `claude "Read .saropa/handoff/{id}.md and action it."`; the owner can change it to another CLI | Yes, by editing the template | Works now (`window.createTerminal`, `sendText`); the `claude "<prompt>"` form starts an interactive session with that first message |
| **Built-in VS Code chat, prefilled**: `workbench.action.chat.open` with a query argument | Copilot Chat only | Whether the owner's VS Code accepts a query argument for this command is unknown; it depends on the installed VS Code version. Fallback: open it and keep the text on the clipboard, as today |
| **Claude Code VS Code panel, prefilled** | Claude Code only | Whether any Claude Code extension command accepts prompt text is unknown. Fallback: focus it (`claude-vscode.focus`, as today) with the text on the clipboard |
| **Cursor chat** | Cursor only | Command ids unverified (`plans/deferred/20261027_release_board_leftovers.md:7`). Same fallback |
| **Agent tool server** (an MCP server or VS Code language-model tool that lets an agent read the board and submit a patch itself) | Most agents speak MCP | Not built. The VS Code tool API needs a newer engine than `^1.74.0`. Deferred, decision 36 (`plans/deferred/DEFERRED_AGENT_DIRECT_CONNECTION.md`) |

Recommendation: Copy (the referral command), Copy full text and Save to file are the core; they need no vendor. Run in terminal is the one "open in agent" action, vendor-neutral through its template. Panel prefill is best effort with the clipboard fallback. The six Hand to chat settings shrink to two: the terminal command template and the copy mode (referral command by default, or full text), since the budget setting is gone (decisions 30 and 34).

### 16.4 The way back: organize pass and applying a result

**Reply patch** (`saropa.releaseBoard.patch/1`): what an AI returns. Allowed operations only:

```json
{
  "schema": "saropa.releaseBoard.patch/1",
  "basedOn": "2026-10-30T10-04-12-contacts-triage",
  "changes": [
    { "op": "setStatus",   "item": "contacts:bugs/HANDOVER_store_payments.md", "to": "purple", "reason": "Work started in pull request 1931" },
    { "op": "setSeverity", "item": "contacts:docs/plans/DARK_MODE.md", "to": "low", "reason": "Cosmetic only" },
    { "op": "addNeeds",    "item": "contacts:docs/plans/LAUNCH_TEST_CHECKLIST.md", "on": "supabase:docs/plans/share_keys.md", "reason": "Launch needs the keys script" },
    { "op": "removeNeeds", "item": "...", "on": "...", "reason": "..." },
    { "op": "setGroup",    "item": "...", "group": "Store launch", "reason": "..." }
  ]
}
```

Each operation maps to a write path the redesign already plans: status and severity to the rules file (phase 4, decision 6), Needs to a `Needs:` line (phase 5, decision 7), group to the rules file (phase 6). Nothing else is accepted: no document text edits, no Importance, no light. Unknown items, unknown operations, a circle of links and a newer schema version are refused line by line with a reason.

**How a reply gets in**: (1) paste: the drawer's "Bring back" tab takes pasted text, finds the `saropa-patch` block (or bare JSON) and parses it; (2) file: an agent writes `.saropa/handoff/<id>.result.json`; the board watches that folder and shows a pill "AI result ready, 7 changes" in the filter pills line. Option (2) is owner decision 7.

**Review before anything changes**: a list of proposed changes, one row each: checkbox (on by default), item, from → to; the AI's reason is the row tooltip (decision 22). A change whose item changed since the hand-off (`rev` differs) is unchecked and marked "changed since". An effect pill, `Blocks 2 → 1`, whose tooltip carries the sentence ("Applying 7 changes: items that block in Saropa Contacts go from 2 to 1 under Deliberate"). Refused lines show as a grey `refused` pill with the reason in the tooltip. Buttons: Apply chosen, Reject all. Apply saves at once with one Undo for the whole batch (decision 6); the applied patch stays in `.saropa/handoff/` so it can be reverted later from the change log (decision 16).

**Provenance**: an accepted change is by hand (✎, set-by-you note) because the owner accepted it; the history line adds "from AI proposal `<id>`" (decision 8).

**Organize pass** (step 1 of the target loop): Project actions ⋮ → "Organize with AI…" opens the drawer at task Triage, scope Project or Board. The payload lists every document the scan found (open and no-rule) with today's computed status, severity, groups and links, and asks for a patch. The reply comes back through the same review list. The board never runs the AI; the owner sends the hand-off through any channel in 16.3.

**Future tab research**: the "Hand all to chat" loop (`boardFutureResearch.ts:68-75`) becomes one hand-off of task Research (the existing rules of `futureResearch.ts:64-85`) for all flagged documents; all of them turn "in progress" after one confirm.

### 16.5 UI

- **Entry points, no new header button** (decision 20): row ⋮ → "Hand off…" (replaces "Hand to chat"); group card ⋮ and project card ⋮ → "Hand off this group / project…"; Project actions ⋮ → "Hand off board…", "Organize with AI…", "Bring back AI result…". The separate row button (`boardHtmlUtil.ts:180-183`) goes.
- **Selection**: a checkbox appears on a row on hover or focus, beside the row ⋮ (same reveal rule as the kebab). With one or more chosen, the filter pills line shows "3 chosen · Hand off · Clear". Decision 5.
- **Hand-off drawer** (right side; full width under 640px): two tabs, Hand off and Bring back.
  - Hand off: scope pills (Item, Chosen 3, Group, Project, Board; only the ones that apply), task pills (Fix, Plan, Review, Triage), format toggle (Markdown | JSON), token estimate pill (information only), each explained in its tooltip; the full document in a scrolling preview; buttons **Copy** (primary, copies the short referral command after saving the file), Copy full text, Save to file, Run in terminal. After an action a one-word status (Copied, Saved, Started) shows, with detail in its tooltip; no toast.
  - Bring back: a paste box, Read reply, a `?` pill for the accepted formats, the effect pill, the review list of 16.4, then Apply chosen / Reject all. No help sentences on screen (decision 22).
- Esc closes; focus returns to the control that opened it; the drawer is `role="dialog"` with a label.

The mockup demonstrates the drawer with invented data: open it from any row menu "Hand off…" or Project actions → "Hand off board…" or "Bring back AI result…".

### 16.6 Phases and sizes

Sizes as in section 13. Each phase is one pull request with tests and a changelog line.

| Phase | Content | Size | Needs | Writes user files? |
|---|---|---|---|---|
| Handoff phase 1 | Payload builder (scopes, Markdown and JSON schema 1, task preambles, privacy filter), hand-off document written in full to a file, hand-off drawer with preview, Copy (referral command), Copy full text, Save to file; replaces Hand to chat entry points | M | Phase 1 (row kebabs) | Only `.saropa/handoff/` |
| Handoff phase 2 | Run in terminal with the command template, best-effort panel prefill, selection checkboxes, Future research as one hand-off, settings reduced to two | S | Handoff phase 1 | No |
| Handoff phase 3 | Bring back: patch schema, paste, folder watch, review list, apply through the phase 4 to 6 writers, one Undo | L | Phases 4, 5, 6 | Rules file and `Needs:` lines. Needs an Opus diff review |
| Handoff phase 4 | Organize with AI: triage payload over all scanned documents, including no-rule ones, through the Handoff phase 3 review list | S | Handoff phase 3 | Same as Handoff phase 3 |

Handoff phase 2 note (2026-10-30): Path to GO steps and Sittings lines cannot be handed off yet (no step or line scope; needs a new scope kind, the paths passed to the hand-off host, and a button on each step). Not built; raise as a follow-up item. Multi-project scopes write one document per project, each in its own `.saropa/handoff/`, and the copied line lists every path.

Placement: decided, decision 35: handoff phases 1 and 2 right after phase 3; handoff phases 3 and 4 after phase 6.

### 16.7 Risks

- **Prompt injection**: a document title or step can say "ignore the rules". Fence all document text, label it data, and the board only accepts the patch allowlist, so a hostile reply can at worst propose a change the owner sees and rejects.
- **Bad or stale patches**: ids that no longer exist, files changed since the hand-off. `rev` check, unchecked by default, line-by-line refusal reasons.
- **Bulk change by mistake**: one Apply can move many lights. Review list with live effect line, one Undo, the patch kept for later reversal.
- **"No AI" rule perception**: accepted proposals look like by-hand changes. The history line names the proposal (decision 8).
- **Token estimate is rough** (about ±25 percent across models). Labeled "about"; it is information only, since the document is never cut. A very large document may exceed what a chat can read; the referral command to a file-reading agent avoids this, and Copy full text is the owner's choice.
- **Vendor command drift**: chat panel command ids change between versions. The core channels (clipboard, file, terminal template) do not depend on them.
- **Secrets**: the filter is pattern-based and can miss one. Only titles, steps and evidence lines are copied, never document bodies; hand-off files are never committed.
- **Test churn**: `extension/src/test/board/handToChat.test.ts`, `boardHandToChat.test.ts`, `futureResearch.test.ts`, `boardFutureResearch.test.ts`, `boardPolish.test.ts:229` change.
- **New English strings** for the drawer; translations follow the owner's pipeline. The preambles are for the AI and stay English, outside the locale files.

### 16.8 Owner decisions needed (AI hand-off)

Owner answers of 2026-10-30 are recorded as decisions 25 to 36 in section 15. The original options and recommendations stay below.

1. **DECIDED (a), decision 25.**
   **Entry points.** (a) Row, group and project kebabs plus three entries in Project actions; no header button. (b) Also a "Hand off" button in the header. **Recommend (a)**: decision 20 keeps the header to scope, tabs and two kebabs.
2. **DECIDED (a), decision 26.**
   **Default format.** (a) Markdown, JSON on the toggle; the saved file always holds both. (b) Markdown with the JSON appended. (c) JSON. **Recommend (a)**: readable in any chat; agents that read files get the JSON from the saved file.
3. **DECIDED (a), decision 27.**
   **Hand-off files.** (a) `.saropa/handoff/` in each project, never committed, last 20 kept. (b) Committed to git. (c) No files, clipboard only. **Recommend (a)**: lets terminal agents read the full text and reply by file, without noise in git.
4. **DECIDED (a), decision 28.**
   **"Open in agent" action.** (a) Run in terminal with one editable command template (default Claude Code CLI), panel prefill best effort, clipboard always. (b) Keep today's list of chat-panel focus commands. **Recommend (a)**: the only path that hands the text over without a paste and works for any CLI agent.
5. **DECIDED (a), decision 29.**
   **Choosing specific items.** (a) Checkbox on row hover or focus, with "N chosen · Hand off · Clear" in the filter pills line. (b) No multi-select; only item, group, project and board scopes. **Recommend (a)**: the owner asked for specific line items.
6. **DECIDED differently, decision 30: the full document is always written to a file and never cut; what is copied is a short referral command. The 25,000-token budget is dropped. The text below is the superseded question.**
   **Clipboard budget default.** (a) About 25,000 tokens, changeable in the drawer (8k, 25k, 100k, no limit). (b) No limit. (c) 8,000. **Recommend (a)**: fits current chat windows with room for the answer; the saved file is never cut.
7. **DECIDED (a), decision 31.**
   **How an AI result comes back.** (a) Paste in the drawer, plus the board watching `.saropa/handoff/` for result files. (b) Paste only. **Recommend (a)**: terminal agents can write the file themselves, so the loop closes without copying.
8. **DECIDED (a), decision 32.**
   **Marking accepted AI changes.** (a) By hand (✎), with "from AI proposal" in the history line. (b) A separate "by AI" mark on the row. **Recommend (a)**: the owner accepted it, the row stays quiet, and the history still says where it came from.
9. **DECIDED (a), decision 33.**
   **What an AI may change.** (a) Status, severity, group and `Needs:` links only. (b) Also Importance, titles and document text. **Recommend (a)**: every allowed change has a planned, safe write path and an undo.
10. **DECIDED (a), decision 34. The two settings left are the terminal command template and the copy mode (decision 30).**
   **Retire the old Hand to chat.** (a) Replace it: remove the row button, reduce six settings to two (budget, terminal template), turn Future "Hand all" into one hand-off. (b) Keep it beside the new drawer. **Recommend (a)**: two ways to do one job is the clutter the owner asked to remove.
11. **DECIDED (a), decision 35.**
   **Phase placement.** (a) Handoff phases 1 and 2 right after phase 3; handoff phases 3 and 4 after phase 6. (b) All after phase 8. **Recommend (a)**: the owner called this critical, and handoff phase 1 needs no new writes to user files.
12. **DECIDED (a), decision 36: deferred, see `plans/deferred/DEFERRED_AGENT_DIRECT_CONNECTION.md`.**
   **Agent tool server** (MCP or VS Code language-model tool, so an agent reads the board and submits a patch itself). (a) Not now; revisit after handoff phase 3. (b) Build with handoff phase 3. **Recommend (a)**: it needs a newer VS Code engine and a long-running server, and copy, file and terminal already cover every agent.

## 17. Current work data (claude-chat-explorer API)

Source: `/Users/craighathaway/Documents/src/claude-chat-explorer/docs/API.md` (read 2026-10-30; owner note: useful for showing current work on the board). Decisions are in 17.4 (DECIDED 2026-10-30); the rest is reference.

### 17.1 What the API exposes

| Aspect | Fact |
|---|---|
| What it is | A TypeScript object returned by the Chat Explorer extension's `activate()`, not a server. Extension id `saropa.claude-chat-explorer`. |
| Transport | In-process call inside the same VS Code extension host: `vscode.extensions.getExtension(id)?.activate()`. No HTTP, no port, no socket. |
| Auth | None. Read-only. Local only; "nothing leaves the machine". |
| Started by | VS Code, when the user has Chat Explorer installed and enabled. The board does not start anything. |
| Version | `apiVersion` 1; new methods are additive, so test `typeof api.method === 'function'`. |
| `listChats()` | Every indexed top-level chat: `id`, `title`, `project`, `folder`, `first`/`last` (ms), `messages`, `model`, `context` (window fill), `tokens`, `cost` (usd, lines added/removed), `branches`, `prs`, `commits`, `files` (read or edited), `created` (worktrees, branches), `pinned`, `archived`, `tags`, `state` (live dot, for example `"waiting"`; absent when idle). Waits up to 60 s for the index. |
| `getChat(id)` | One chat, same fields. |
| `listWork()` | Every branch and PR any chat knows: `key` (branch, or `#123`), `chatIds`, summed `tokens`. |
| `tokensForWork(key)` / `tokensForChat(id)` | Token totals per branch, PR or chat. |
| `chatsForFile(absPath)` | Chats that read or edited a file, with `edited` flag, last used, branch. Cached 30 s. |
| `getAccountUsage()` | Account email and 5-hour and 7-day token sums. Slow (about 7 s cold). Not useful for the board. |

Note on "The board does not start anything": calling Chat Explorer's `activate()` starts it when it is installed but dormant. This is the one exception. It is acceptable because the `saropaWorkspace.releaseBoard.chatActivity` setting turns the whole integration off, and the call is skipped then.

### 17.2 Board features it could feed

| Board feature | What the API gives | Phase |
|---|---|---|
| "Active now" pill per item or project | `chatsForFile(document path)` with `last` within a recent window; or `listChats()` matched on `folder` for the project | Phase 1 pill style exists; data hookup fits the phase after phase 3 (decision 39) |
| Which AI chat is working on which item | `chatsForFile` gives title, branch and `edited`; `listWork()` joins branch or PR to chats | Row hover card (phase 1 style); fully useful from the phase after phase 3 (decision 39) |
| Waiting-for-you signal | `state === 'waiting'` on a chat | After phase 3, own phase (decision 39), project card pill |
| Cost or effort per item or branch | `tokensForWork(branch)`, `cost.usd`, lines added and removed | Optional pill; any phase after 3 |
| Handoff results coming back (decisions 30, 31) | Shows that a chat that received the hand-off is still running or waiting. It does not carry the result; results still arrive through the `.saropa/handoff/` folder watch | Handoff phase 3 (status line in the drawer only) |
| "Since you left" change log (decision 16) | Chats started or edited items since the last visit (`first`, `last`, `files`, `commits`). Useful as extra change-log lines; the log must work without it | After phase 3 (decision 39) |
| Gantt history (decision 18) | `first`/`last` per chat give real activity times per item. The Gantt axis is work order, not days, and must not invent dates | Phase 7 at most; not needed for the first Gantt |

### 17.3 Constraints and unknowns

- The API is an extension export, so it exists only while Chat Explorer is installed and active in the same VS Code window; it is not a remote or always-on service.
- `getExtension(id)` returns undefined when Chat Explorer is absent; the API doc says to handle that and carry on.
- Calls can wait up to 60 s for the first index build and can reject on worker failure or timeout; `chatsForFile` instead returns `indexing: true` with an empty answer.
- The API has no push or event; the board would have to poll or refresh on its own events, and `chatsForFile` caches for 30 s.
- Matching a chat to a board item is indirect: by document path (`files`), by branch or PR, or by project folder. The board has no stored chat-to-item link today.
- `tokensForWork` uses a simple branch match, so its totals can differ from Chat Explorer's own Open Work page.
- `state` is documented only by example (`"waiting"`); the full list of states is unknown.
- It is unknown whether `chatsForFile` and `folder` match when a workspace is a multi-root or symlinked path.
- It is unknown whether the board extension may declare Chat Explorer as an optional dependency; no `extensionDependencies` is needed for an optional call, and a hard dependency would force an install, which is not wanted.
- The API reads another project's data store; the board would depend on that project's API contract (`apiVersion` 1) and its release schedule.
- Decision 22 applies: when the API is absent, slow or failing, every Chat Explorer feature disappears silently. No error text, no placeholder, no "install Chat Explorer" banner on the board; any hint sits in a tooltip or a kebab entry only. Decision 40 overrides this for the one-time notice when the API is unavailable (a brief top-bar notice that auto-hides).
- The board's honest-evidence rule (section 10: no invented dates, no AI guesses) applies: a chat touching a document is shown as "a chat edited this", never as proof that an item is done.
- Chat titles and file paths from chats are private; they must stay on screen only and never enter hand-off documents unless the owner chooses.

### 17.4 Owner decisions (DECIDED 2026-10-30)

1. **DECIDED: (a).** **Use the API at all?** (a) Yes, as an optional enhancement behind a feature check, silent when absent. (b) No, keep the board self-contained. (c) Later, after phase 8. **Recommend (a)**: it is read-only, local, and costs nothing when Chat Explorer is missing; the board stays complete without it.
2. **DECIDED: (a).** **First feature.** (a) One "active now" pill on project cards and rows, from `chatsForFile` and `listChats`. (b) Also chat title in the row hover card. (c) Also cost and token pills. **Recommend (a)**: smallest visible value; the hover card line can follow once the pill proves useful, and cost is not a board concern.
3. **DECIDED: (b).** **Where it lands in the delivery order.** (a) Phase 3, with project card pill summaries. (b) A separate small phase after phase 3. (c) After phase 8. **Recommend (b)**: one change per pull request; it keeps phase 3 free of an external dependency.
4. **DECIDED (2026-10-30, owner), CHANGED from the recommendation: freshness is polling every 30 seconds, with a pause/play button (decision 40).** The recommendation was (a), refresh on open and on the refresh action.
5. **DECIDED (2026-10-30, owner), CHANGED from the recommendation: optional call plus an off setting (decision 41).** No `extensionDependencies`. The recommendation was (a), no setting.
6. **DECIDED: (a).** **Handoff status line.** (a) Not now; revisit after handoff phase 3. (b) Show the receiving chat's state in the drawer. **Recommend (a)**: the result arrives by the folder watch, and linking a hand-off to a chat id is a separate design.

### Gantt phase 7 delivered notes

- Gantt rows have no kebab menu or handoff checkboxes yet. They arrive with the phase 8 / phase 4 integration; per-row handoff goes through the Board tab for now.
- Hand-set target dates are deferred.
- The Gantt always groups by project. The Group by setting applies to the Board tab only.
- The Since panel and Dismiss live on the Board tab.

### Phase 5 delivered notes

- "Project waits on…" on the project card (a `dependsOn` write) is deferred.
- Suggested links at the top of the picker are deferred to the auto-organization link-proposal phase (Org 4).
- The picker is a VS Code quick pick with a modal preview. Phase 8 drag-to-create must save at once, without the modal.
- Waits on and Blocks are hidden for documents whose Needs lines the board does not read (SQL). A link held only by an accepted mark has no remove entry (no mark-removal path yet).

## 18. Auto-organization (design, 2026-10-30; decisions 44 and 45)

Status: decided 2026-10-30 (decisions 46 to 52, recorded in 18.10). Not built yet; build order in section 13.

Goal: the board is useful from 5 documents to 2,000 across deep folder trees. Everything automatic is deterministic (same files, same result, whatever the scan order), explained by a tooltip, configurable from the UI (decision 45) and overridable by hand. Settled rules kept: no AI in the board (section 2), red only for blockers (decision 2), one colour signal per card, two pills per row, links are proposals until accepted (decision 44.6), new links are `Needs:` lines (decision 7), saves apply at once with Undo (decision 6), minimal chrome (decisions 20 and 22).

### 18.1 What exists today, and the gaps

| Area | Where | Today | Gap |
|---|---|---|---|
| Grouping | `board/groups.ts:169-186` (`buildGroups`) | Three passes: by-hand groups from the rules file (`:75-83`, globs in `types.ts:121`), same project and same first file-name word once a date is removed (`:50-53`, `:86-100`), two or more shared source files, at most 12 per group (`:105-140`). Hubs (20,000 words or 30 document names, `:176`) never merge by files. Exclusions: `ungrouped` (`types.ts:123`). | No folder signal at all. Common first words (PLAN, BUG, SPEC: list at `:41`) are dropped, not skipped to the next word, so most documents stay ungrouped. No minimum or maximum size apart from 2 and 12, no nesting. One flat level. |
| Group names | `groups.ts:55`, `:162` | Manual name, "`Prefix` documents" or "Related documents". `titleCase` capitalises only the first letter. | Generic names; no folder names; no dedup. |
| Group identity | `groups.ts:146-163` | The id is the union-find root key, i.e. one member's path. | Changes when membership changes, so fold memory, overrides and colours cannot attach to it. |
| Pool | `boardModel.ts:347-353` | Groups are built over open items only. | Groups dissolve as items finish (a group of 2 loses one member and vanishes), so the layout jumps. |
| Group display | `boardHtmlRows.ts:250-279`; Gantt `ganttModel.ts:110-148` | A sub-heading inside a list, only when two members share the list. The Gantt groups by project only (Gantt phase 7 notes). Group by setting: `project` or `none` (`package.json:2521`, `views/boardPanel.ts:120`). | No group level on the Gantt; phase 6 has not been built. |
| Row limits | `boardHtmlRows.ts:14-16`, `:275-279` | Fixed: 5 rows shown, list folded over 25. Hidden rows are still emitted in the HTML. | Not adaptive; at 2,000 documents the page carries every hidden row. |
| Links | `docFacts.ts:109` (`parseNeeds`), `links.ts:92-118` (`resolveLinks`), `links.ts:176-202` (chains) | `Needs:` lines resolve by path, then file name. Accepted suggestions and rejections live in the marks (`marks.ts:13-20`; shared copy `.saropa/release-board-marks.json`, `commands/boardMarks.ts:12`). | Accepted suggestions are stored in the marks, not as `Needs:` lines (decision 7 changes this from phase 5). |
| Suggested links | `board/inferred.ts:30-56`; wired at `boardModel.ts:215-226` | A document naming exactly one other open document of its project by file name (from `docRefNames`, first 60, `docFacts.ts:257-258`). At most 50 (`inferred.ts:21`). Shown dashed. | One signal only. No order (phase 1 then 2), no phrases ("blocked by"), no confidence, no "why". |
| Title | `docFacts.ts:239`, `boardModelParts.ts:257` | First heading, 80 characters at most, or the file name. | Fine as a signal. |
| Front matter | none | Not read. | |
| Keyword dictionaries | `board/severity.json` (severity phrases), `board/needs-dictionary.json` (Sittings contexts); rules file `severity` and `needs` partial replacements (`types.ts:125`, `:130`; merge pattern `needs.ts:30`); severity keyword editor (`keywordEditorHtml.ts:62`, preview `commands/boardKeywordPreview.ts`, settings `package.json:2609-2621`) | A UI editor exists for severity phrases only, with preview and Restore defaults. | No dictionary for themes, emoji, colours, link words or naming. |
| Writes | `commands/boardRuleAssign.ts:89` (`writeRule`), `:154` (`applyTextChange`), `:210` (`undoRulesWrite`) | Safe rules-file writes (unsaved copy, symbolic link, UTF-8, re-read) with an undo snapshot. | Reused as is. |
| Scan cache | `board/scanner.ts:41-69`, `docFacts.ts:7` (`FACTS_VERSION`), `scanner.ts:115` (2 MB cap) | Facts cached per file by size and modified time. | New signals ride in the same cache; bump `FACTS_VERSION`. |

### 18.2 Signals

Read once per document in the scan, cached with its facts (new `org` field on `DocFacts`).

| Signal | How it is read | Used for | Strength |
|---|---|---|---|
| Folder path | Project-relative folder segments. Status segments (done, finished, complete, completed, archive, archived, history, old, deferred, future, backlog, later, wip, in-progress, active, current, blocked, todo, open, closed, inbox) and date segments (`2026`, `2026-10`, `2026-10-30`, `20261030`, `2026_q4`, month names) are removed: the folder is the status (section 2), and a status or date never forms a group. Container words (docs, doc, documentation, notes, misc, files, content, src, md) are kept in the id but skipped for names. | Grouping (first), names, themes | Strong |
| File-name tokens | Split on `_ - . space` and camelCase. Leading date removed (`20261030_`, `2026-10-30-`). **Kind** token: plan, spec, bug, issue, handover, owner, adr, rfc, research, design, impl, test, release, notes, draft, report, guide. **Sequence** token: `phase-?N`, `part-?N`, `part-?[a-z]`, `pt-?N`, `vN`, `step-?N`, `stage-?N`, `mN` (milestone), leading `NN_`. **Stem**: what remains, lower case. | Grouping (stem, sequence family), links (sequence, same stem), names | Strong |
| Title words | First heading, stop words removed, simple suffix strip (s, es, ing, ed). | Themes, links by title, names of tag groups | Medium |
| Front matter | YAML block at the top of a document: tags and links (decision 49). Key names are fixed in the Org 1 brief. Read after the rules file, before inference; parsed in the scan and cached with the facts. | Tags and links | Medium (set by the author) |
| `Needs:` links | Existing resolved links. | Order inside a group; a loose document whose open links all point into one group joins it. Never merges two groups. | Strong, explicit |
| Body phrases | "blocked by X", "depends on X", "waits on X", "after X", "requires X", "prerequisite: X", "X blocks this", "this blocks X", where X is a file name, a path, a Markdown link or an exact title. Negated forms ("no longer depends on", "not blocked by") are skipped. Code fences are already blanked (`docFacts.ts:235`). | Link proposals | Strong when X resolves to one document |
| Status words | Existing Status line (`types.ts:58-62`) and the folder rule. | Never for grouping (Group by Status does that). Only to strip status segments from names. | |
| Shared source files | Existing third pass. | Grouping fallback | Weak |

### 18.3 Algorithms and thresholds

All pure functions in `extension/src/board/` (no `vscode`), so they run under the node test runner. Every result carries a `why` record: `{ source, detail, tokens, confidence }`.

**N** below is the number of documents counted: per project for grouping, per board scope for collapse and row limits. Bands change upward when N passes a boundary and downward only when N falls 10 percent below it, so the layout does not flip while documents move.

#### 18.3.1 Auto-grouping

Pool: open and finished (green) documents of the project, not reference, not Future (blue), not `ungrouped`. Finished members keep a group stable as its items finish; group cards and the Board tab count only open items.

1. **Explicit layer** (claims first, in this order): a by-hand assignment written from the board (18.6), a rules-file group (`groups` globs), then nothing else. Explicit groups are never resized, split or merged.
2. **Folder layer**: build the tree of logical folders (status and date segments removed). Compress single-child chains (`docs/plans` with only `payments/` beneath it is one node). Walk bottom up: a folder whose subtree holds between MIN and MAX documents becomes a group. A folder under MIN gives its documents to its parent. A folder over MAX becomes a parent: its child folders that qualify become sub-groups, and its own loose documents go to step 3. Group levels: 1 below 200 documents, 2 from 200 (project, group, sub-group; never deeper).
3. **Name layer**, for documents still loose inside one folder group or at the project root, in order:
   1. **Sequence family**: same folder, same stem, differing only in the sequence token (`share_keys_phase1..4`, `api_v1`/`api_v2`, `part-a`/`part-b`). Joins at 2 members whatever MIN is.
   2. **Shared stem word**: the first stem word that is not a kind word (today's prefix rule, skipping PLAN and similar instead of dropping them). MIN members.
   3. **Theme**: the tag (18.3.4) that scores highest for each document; MIN documents with the same tag form a group.
   4. **Shared source files**: today's third pass, unchanged.
   5. **Links**: a loose document whose open `Needs:` links all point into one group joins that group.
4. **Leftovers**: loose documents of a folder group stay as loose rows after its sub-groups. When more than MAX are loose at one level, they form "Other · `Folder`".
5. **Tiny groups**: never a group of one. A non-explicit group under MIN joins its parent; at project level it goes to Other.
6. **Huge groups**: a non-explicit group over MAX is split by child folder, then stem word, then tag. If it still exceeds MAX it stays whole, flagged `oversize` in its why record, and relies on the row limit.
7. **Hubs** (unchanged thresholds) join their folder's group but are excluded from steps 3.2 to 3.5, so a hub never pulls documents together.
8. **No cross-project groups** except rules-file globs that name several projects, as today.

**Stable id**: `project:source:key`, for example `contacts:folder:docs/plans/payments`, `contacts:seq:docs/plans/share_keys`, `contacts:tag:payments`, `contacts:manual:Store launch`. Fold state, overrides and colours attach to this id.

**MIN** = 2 below 50 documents, 3 below 200, 4 below 1,000, 5 from 1,000. **MAX** = 2 × √N, rounded, kept between 8 and 40.

#### 18.3.2 Adaptive collapse and row limits

Extends section 12. Rule 12.2 (the user's own open or close is remembered) wins over everything here, keyed by the stable group id.

| Documents in scope (example) | Group headers | MIN / MAX | Levels | Rows shown per open group or list | Open on first view | Finished rows on the Gantt | Link suggestions on the board |
|---|---|---|---|---|---|---|---|
| 0-7 (5) | none, one flat list (groups still exist for Group by and tooltips) | – | 0 | all | everything | all, dimmed | all |
| 8-49 (30) | yes | 2 / 11 | 1 | 8 | groups holding a blocker; every group when 3 or fewer | all, dimmed | high and medium, 10 at most |
| 50-199 (100) | yes | 3 / 20 | 1 | 5 | groups holding a blocker, 3 at most (decision 47) | last 2 per group; the rest as a count pill | 10, then Show more |
| 200-999 (500) | yes | 4 / 40 | 2 | 5 | as above; sub-groups closed | count pill only | 10 per page |
| 1,000+ (2,000) | yes | 5 / 40 | 2 | 3 | the 3 groups with the most blockers; every other group is one header line with its red count pill | count pill only | high only; medium in the review list |

A closed group header always shows its emoji, name, worst status shape and pill summary ("12 open · 2 block"), so nothing that blocks is hidden. Rows beyond the limit and rows of closed groups are not in the page HTML; they are sent when opened (18.7).

#### 18.3.3 Auto-naming

1. Source text: the folder segment (folder group), the stem (stem or sequence group), the tag label (tag group), the most shared source file's base name (files group: "Touches `contacts_sync.dart`").
2. Clean: remove dates, leading order numbers (`01_`), kind words at the start (`plan_`, `spec_`), version and sequence tokens; replace `_ - .` with spaces; split camelCase.
3. Case: sentence case ("Share keys"); acronyms kept from an editable list (API, UI, UX, iOS, SQL, AI, MCP, PR, CI, QA, GDPR, IAP) and any all-capital word of 2 to 5 letters.
4. A container-only name (Docs, Notes, Misc) takes the child's or the parent's name instead: "Docs · Plans".
5. Sequence family: stem plus the range, "Share keys · phases 1-4".
6. Dedup inside a project: add the nearest differing parent folder after a middle dot ("Payments · Bugs"), never brackets (decision 15); if still equal, add a number ("Payments 2").
7. 32 characters at most on screen; the full name and its source in the tooltip.

#### 18.3.4 Tags: emoji and colour from a dictionary

A **tag** is one dictionary entry: id, label, emoji, colour, patterns, where to match (folder, file name, title), and its effects (forms groups, names, emoji, colour; on by default). Shipped as `extension/src/board/organize-dictionary.json`, next to `severity.json`; a project's rules file can add, replace or disable entries under an `organize` key, using the existing partial-merge pattern (`needs.ts:30`). Users edit it from the UI (18.5); hand-editing is the advanced path only.

Matching: whole word after the suffix strip. Score per tag: folder or file-name hit 3, title hit 2; a tag applies at 3 or more; ties go to the tag listed first (the user's order in the editor). A group takes the tag that applies to at least half its members, else the tag of its name, else none.

Default tags:

| Tag | Emoji | Colour | Words |
|---|---|---|---|
| Payments | 💳 | ochre | payment, billing, purchase, subscription, refund, pricing, paywall, checkout, receipt, revenue, iap |
| Security and privacy | 🔒 | slate | security, auth, login, password, passcode, encryption, credential, privacy, gdpr, permission, token |
| Data and sync | 🔄 | sky | sync, backup, restore, migration, import, export, database, schema, supabase, sql |
| Release | 🚀 | indigo | release, launch, store, appstore, testflight, rollout, version, changelog |
| Testing | 🧪 | teal | test, testing, qa, checklist, e2e, regression, coverage |
| Bugs | 🐛 | olive | bug, crash, fix, error, issue, exception |
| Design and UI | 🎨 | orchid | ui, ux, design, layout, theme, screen, mockup, accessibility, a11y |
| Performance | ⚡ | ochre | performance, perf, speed, latency, memory, startup, cache |
| Docs | 📝 | slate | readme, guide, howto, handbook, documentation |
| Build and infra | 🛠 | pine | build, ci, pipeline, deploy, infra, docker, gradle, xcode, script |
| AI | 🤖 | indigo | ai, llm, agent, claude, prompt, model |
| Notifications | 🔔 | teal | notification, push, reminder, alert, email |
| Analytics | 📊 | sky | analytics, metrics, tracking, telemetry, dashboard |
| Languages | 🌐 | pine | i18n, l10n, translation, locale, language |
| Plans and research | 🧭 | orchid | plan, roadmap, research, spike, proposal, rfc, adr |
| Owner tasks | 👤 | olive | owner, handover, manual |

No tag: 📁 for a folder group, 🔗 for a sequence family, no colour stripe.

**Colours**: eight hues, none red; each has at least 3:1 contrast against both `#ffffff` and `#1e1e1e` (WCAG 1.4.11, checked 2026-10-30): teal `#138a7e`, sky `#1a7fb0`, indigo `#5a64c8`, orchid `#9b5bbf`, olive `#6f7d1c`, ochre `#9a6a12`, slate `#5f7184`, pine `#3d8a4a`. Red is reserved for blockers (decision 2): the picker offers only these eight, and the dictionary loader refuses a hex with a hue between 330° and 20° and refuses red emoji (🔴 ❗ 🚨 ⛔ 🛑 🔥 🐞). A group with no tag colour gets one by a stable hash of its id, moved to the next free hue among its siblings. Where colour shows: a 3 px stripe on the group header and the Gantt group band only; never on rows or pills, so the status colour stays the one colour signal per row. In high-contrast themes the stripe becomes `--vscode-contrastBorder`; emoji and name carry the identity, never colour alone.

Emoji show on group headers and in hover cards, never on rows (decision 48).

#### 18.3.5 Link inference: proposals only

| Kind | Rule | Confidence |
|---|---|---|
| Sequence | Same project, same logical folder, same stem, consecutive numbers: phase N+1 waits on phase N; v2 on v1; part-b on part-a; `02_` on `01_` only when 3 or more files in the folder use the numbering. Only neighbours, never N+2 on N. | High; a gap (phase 1, phase 3) is Medium |
| Phrase | A body phrase (18.2) whose X resolves to exactly one document. "This blocks X" and "X blocks this" set the direction. | High |
| Title phrase | The phrase names an exact (normalised) title, not a file. | Medium |
| File mention | Today's `inferred.ts`: the document names one other open document of its project. | Medium in the first 20 lines, else Low |
| Same stem, different kind | Same stem, kinds in order research < spec or design < plan < impl < test < release: the later waits on the earlier. | Low |

Never proposed: a target that is finished or reference; a link that exists (`Needs:` line or older accepted mark); a rejected pair (the `rejected` list in the marks, key from `suggestionKey`); a link that would close a circle (checked against the open graph of `links.ts:129`); a cross-project link unless written as `project:path`; more than 3 per document.

Showing: high and medium appear as today's dashed suggestion and in the shared review list (18.8); low only in the review list behind a "Low N" pill. **Accept** writes a `Needs:` line through the phase 5 writer (decision 7), with Undo. **Reject** adds the pair to the rejected list. Nothing is applied without a click. Accepted proposals carry "suggested by name order" (or the phrase) in their history line.

### 18.4 Explainability

Every automatic result has a "why" in its tooltip (decision 17), built from its why record:

- Group: "Auto group: folder docs/plans/payments, 14 documents." "Auto group: 4 file names share_keys_phase1 to 4." "Auto group: tag Payments matched 6 documents (billing, refund)."
- Name: "From folder 2026_payments_v2 (date and version removed)."
- Emoji and colour: "💳 from tag Payments: 'billing' in 3 of 5 titles." "Colour picked for this group; change it in the group menu."
- Link proposal: "Phase 2 waits on phase 1: same name, next number. High confidence."
- Front matter: "Tag Payments from this document's front matter."
- Folded: "Folded: 500 documents on the board; groups with blockers open first."
- Split or oversize: "Split from Plans: more than 40 documents." "Over 40 documents and no clean split; showing 5."

Hover cards on rows and group headers list the matched tags as pills (emoji and label), each with what matched ("title: billing"). The why records also go into the hand-off JSON (section 16.2) so an AI sees what the heuristics did.

### 18.5 UI: in-place editing and the Tags and rules editor (decision 45)

No hand-editing is ever required. JSON stays the storage and the advanced path (the editor's kebab has "Open JSON").

**In place**

- **Group header kebab**: Rename…, Emoji…, Colour… (eight swatches), Move documents… (phase 6), Merge with…, New tag from this group (prefills patterns from the words the members share), Back to automatic. The header tooltip carries the why.
- **Row kebab**: Move to group… (phase 6), Tags… (add or remove a tag on this document), Waits on… (phase 5), Back to automatic.
- **Hover card tag pills**: clicking one opens a small menu: Edit tag…, Not this document (an exclusion override), Add a word…
- **Suggested link**: Accept, Reject, Why (tooltip).
- Every in-place change saves at once with the Undo bar (decision 6), shows ✎ "set by you", and persists (18.6).

**Tags and rules editor**: one view opened from Project actions ⋮ → "Tags and rules…", and from "Edit tag…" anywhere. It absorbs today's severity keyword editor as one tab (decision 51). Tabs: Tags, Link words, Naming, Severity. Each tab has one `?` pill; no help text on screen (decision 22).

- **Tags tab**: a list, one row per tag: drag handle (order is priority on ties), emoji, label, colour swatch, pattern pills, effect pills (Group, Name, Emoji, Colour), a "matches N" count pill, ⋮ (Edit, Rename, Duplicate, Move up, Move down, Turn off, Delete, Reset to default for a shipped tag). Built-in tags carry a "default" pill; editing one stores only the difference. Above the list: a search box and a kebab with New tag, Import…, Export…, Reset all to default, Open JSON.
- **Edit panel** (opens beside the list): label, emoji field, eight colour swatches, patterns as pills (whole word by default; "starts with" and pattern match under an Advanced toggle), where to match (folder, file name, title), effect toggles. **Test match**: a live list of the current documents the tag would match, the matched word highlighted, and where each would land ("→ Payments"), plus an effect pill ("Saving moves 12 documents into Payments"), updated 200 ms after typing stops. Save applies with Undo.
- **Link words tab**: the phrase list ("blocked by", "depends on", "after" ...), the sequence tokens (phase, part, v, step, stage) and the kind order, each editable as pills, with the same test-match preview listing the proposals they would make.
- **Naming tab**: status folder words, container words, kind words stripped from names, acronyms. Same pill editing and preview of resulting names.
- **Severity tab**: today's keyword editor, unchanged in behaviour.
- **Import / Export**: a JSON file holding the `organize` part only. Import shows "adds 3, replaces 2" with a preview, then saves with Undo.
- Keyboard and screen reader: list is `role="listbox"`, reorder with Alt+Up and Alt+Down, panel is labelled, Escape returns focus.

### 18.6 Overrides: storage, precedence, moves, undo

**Storage** (decision 46): the project's rules file `.saropa/release-board.json`, under a new `organize` key, written through the existing safe writer and its undo snapshot (`commands/boardRuleAssign.ts:89`, `:154`, `:210`):

```json
"organize": {
  "tags": { "add": [], "replace": {}, "off": [], "order": [] },
  "linkWords": {}, "naming": {},
  "groups": { "contacts:folder:docs/plans/payments": { "name": "Store payments", "emoji": "💳", "colour": "ochre" } },
  "assign": [ { "project": "contacts", "path": "docs/plans/PLAN_x.md", "group": "contacts:folder:docs/plans/payments" } ],
  "untag": [ { "project": "contacts", "path": "docs/x.md", "tag": "payments" } ]
}
```

Phase 6 "Move to group" and "New group" write `assign` and the existing `groups` list; "Remove from group" writes `ungrouped` (existing key). Link accept writes `Needs:` lines; link reject writes the marks' `rejected` list (existing). Only exceptions are stored, so the file stays small at 2,000 documents.

**Precedence**: user override written from the board > rules-file entries written by hand (groups globs, dictionary changes) > front matter (decision 49) > inference. Inside the dictionary: the user's own tags > shipped tags. A user override always shows ✎.

**When a file or folder moves**: an override whose path no longer exists is stale. If exactly one new document in the project has the same file name and no override, the override moves to it, with a change-log line (decision 16) and Undo. If several or none match, it shows in the Tidy panel as "Stale override" with Keep for later or Remove. A folder group override whose id vanished moves to the new folder group that holds at least 80 percent of the same file names, else it goes to Tidy. Decided (decision 50): automatic when exactly one file matches.

**Undo**: every write has the 10-second Undo bar (decision 6). "Back to automatic" removes the override. Rejected suggestions can be restored from the Tidy panel.

### 18.7 Performance budget (2,000 documents)

| Where | Work | Budget |
|---|---|---|
| Scan, per changed file, cached | Path, file-name, title tokens; tag scores; phrase-link candidates (one combined regex over the already-read body) | Under 1 ms per document; nothing for unchanged files (cache by size and modified time; bump `FACTS_VERSION`) |
| Model build, once per scan (host) | Folder tree, stems, sequence families, tags, naming, colours, proposals, one cycle check over the open graph | Under 150 ms for 2,000 documents on a laptop; a test asserts under 500 ms |
| Editor test match | Re-match one tag over the cached signals | Under 50 ms per keystroke batch |
| Page HTML | Headers of every group; rows only of open groups up to the row limit; the rest sent when opened (one message, about 20 ms) | Under 1.5 MB; first paint under 300 ms |
| Render | Folding is CSS; Gantt arrows only for the hovered row (decision 18) | No layout work per hover beyond the arrows |

Today's "Show more" emits hidden rows (`boardHtmlRows.ts:275`); it changes to send rows on demand.

### 18.8 How it connects

- **Phase 6 (Group by Group, Move to group, New group)**: merges before this engine (decision 52), on today's grouping. Org 1 then gives its group cards stable ids, readable names, emoji and colour. Move to group and New group are the override writers of 18.6. Phase 6 notes: the progress ring on group cards and a "Group: ..." filter pill are not built; group ids are unstable (union-find roots) until the auto-organization phase.
- **Gantt (phase 7)**: groups become sub-headers under each project (one level; two from 200 documents, closed). The header carries emoji, colour stripe, worst status and count pills; each project still ends with its light. Inside a group the order is: accepted links (work order, as today), then sequence number, then title. Sequence order sorts rows only; it is not a link and changes no light (decision 52).
- **Phase 8 drag and drop**: dropping onto a group header writes the same `assign` override.
- **AI Organize pass (section 16.4)**: one proposal record for both sources, `{ source: "auto" | "ai", op, item, to, confidence, why }`, and one review list (checkbox, item, from → to, a source pill "auto" or "AI", why as tooltip, effect pill, Apply chosen, Reject all, one Undo). Heuristic link proposals use it from Org phase 4; AI patches from Handoff phase 3. The Organize payload includes the automatic groups, tags and open proposals with their why, so the AI refines instead of starting over. The AI stays within decision 33 (status, severity, group, `Needs:`); naming, emoji, colour and tags stay human-only.

### 18.9 Tests, phases, risks

**Tests**: pure functions under the node runner; path-list fixtures as TypeScript arrays in `extension/src/test/board/organize/` plus the real listing `extension/src/test/board/fixtures/saropaRepos.tsv.gz` (5,754 paths).

| Fixture | Shape | Checks |
|---|---|---|
| tiny-flat | 5 documents in `docs/` | No headers, all rows shown |
| prefix-flat | 30 in one folder, `PLAN_` / `BUG_` / `SPEC_` with shared stems | Stem groups, kind words skipped |
| sequences | `phase1..4`, `v1/v2`, `part-a/b`, `01_..03_`, a gap (phase 1, 3), two stems in one folder | Families, neighbour-only proposals, gap is medium |
| deep-tree | 500 documents, 6 levels, `done/` `archive/` `wip/` and `2025/10` at mixed depths | Status and date segments removed, 2 levels, no "Done" group |
| monorepo | 3 projects with the same folder names | No cross-project groups, names deduplicated |
| huge-folder | 400 in one folder | Split by stem then tag, Other bucket, MAX kept or flagged |
| scatter | 60 folders of 1 document | Merge up, no group of one |
| names | `2026-10-30_payments_v2`, `my-API_specs`, ALL CAPS, Unicode, emoji, 60-character names | Names as specified |
| phrases | "blocked by", "depends on `x.md`", "after [y](y.md)", "no longer depends on", inside a code fence, a circle | Proposals, negation and fence skipped, circle refused |
| overrides | Renamed file, renamed folder, deleted file, override against a rules-file glob | Rebind, Tidy entry, precedence |
| dictionary | Added tag, replaced emoji, re-ordered tags, red hex, red emoji, import | Merge, order wins ties, red refused |
| front matter | Tags and links at the top of a document; no block; a broken block | Tag and link read; rules file wins over front matter; a broken block is ignored, no crash |
| scale-2000 | Generated | Time budget; output identical after shuffling input; adding one unrelated document leaves other ids unchanged |

Properties on every fixture: one group per document at most; no non-explicit group under MIN; every result has a why. Headless renders at 5, 30, 500 and 2,000 documents in dark, light and narrow width (section 13), plus the editor at narrow width.

**Phases** (sizes as section 13; one pull request each):

| Phase | Content | Size | Needs | Writes user files? |
|---|---|---|---|---|
| Org 1 | Signals in the scan cache; folder-first grouping, stems, sequence families, tags (shipped dictionary only), names, stable ids, why tooltips and tag pills in hover cards; Gantt group sub-headers | L | Phase 4 (merged); phase 6 (merged first, decision 52) | No |
| Org 2 | Adaptive thresholds and the 18.3.2 table, open-group cap, rows sent on demand, hysteresis | M | Org 1 | No |
| Phase 6 (existing) | Group by Group / Status / Severity, Move to group, New group, plus group Rename, Emoji, Colour, Back to automatic, stale-override handling | M | Phase 4 (merged); merges before Org 1 (decision 52) | Rules file |
| Org 3 | Tags and rules editor (Tags, Link words, Naming tabs; Severity tab moved in), test match, import and export, reset, in-place tag menus | L | Phase 6 | Rules file. Opus diff review |
| Org 4 | Link proposals (sequence, phrase, title, mention, kind order), confidence, circle refusal, the shared review list | M | Phase 5 (Needs writer), Org 1 | `Needs:` lines (accept), marks (reject). Opus diff review |

Handoff phase 3 then reuses the Org 4 review list, so it follows Org 4 (decision 52).

**Risks**

- **Wrong groups feel worse than no groups.** Mitigation: folder first (the user's own structure), every group explained, Back to automatic, MIN guards.
- **Layout jumps** as documents arrive. Stable ids, finished documents kept in the pool, hysteresis on bands, remembered folds.
- **Colour confused with status.** Colour only on header stripes; status shape and colour stay the row signal; red refused.
- **Hiding a blocker** when groups fold. Closed headers always show the red count pill; the open cap affects rows only.
- **Proposal noise** at 2,000 documents. Neighbour-only sequences, 3 per document, low hidden behind a pill, rejections remembered.
- **Rules-file churn in git** from overrides. Only exceptions are stored; writes keep the existing safety checks.
- **Editor scope creep.** Four tabs, pill editing, one preview; patterns stay word-based unless Advanced is opened.
- **Test churn** in `groups.test.ts`, `inferred.test.ts`, `boardHtmlRows.test.ts`, `boardHtmlGantt.test.ts`, `keywordEditor.test.ts`.
- **New English strings** for tooltips and the editor; translations follow the owner's pipeline.

### Org 1 and 2 wiring delivered notes

Delivered: the grouping engine runs once per change of documents, rules-file groups or saved layouts (not on every repaint); one layout for the whole board (documents of all shown projects count together, and the open-group cap of 3 applies across the board, the "no group" card included); sub-groups sit inside their parent card, closed, and never take an open slot; rows of closed groups and rows past the limit are sent to the page on demand (page HTML for 2,000 documents stays under 1.5 MB); the user's open or close of a card is kept by the group's stable id alone; a group listed by hand stays one group across projects and every write uses its stored name, never the clipped or numbered name shown on the page.

Deferred to the link-proposal phase (Org 4): the front matter `needs` list is read by the scan (frontMatter.ts) but is not yet passed to the engine as link-proposal input (decision 49 b).

Follow-ups, not built: Gantt group sub-headers; tag pills in the hover card; the why records in the hand-off JSON.

### Tags editor delivered notes

Delivered (branch release-board-tags-editor, review fixes): a save of either tab keeps the editor open and re-baselines only that part; Close asks before dropping unsaved edits; a Tags save is refused when the rules file changed since the editor read it, and the editor watches the file and offers a Reload pill; values the loader drops (invalid tags, patches, lists) are named on the Tags tab and a save asks first; `where` is kept end to end; the header names the folder and the rules file, with a folder choice in a multi-folder workspace; Severity Save offers Undo; per-tag Duplicate, Rename, Reset to default, a "default" pill, search, patterns as pills (one word each), Open JSON, a matched-word highlight in the test-match preview, an import preview ("adds N, replaces N"), pill editing and a names preview on the Naming tab; group colour overrides accept the eight names only.

Not built, with reasons:
- "-> Group" landing and "Saving moves N documents" in the test-match preview: the grouping engine (organize()) is not wired into the board on this branch, so there is no layout to compare; add it with the engine wiring.
- Link words: sequence tokens and kind order, and a proposal preview: these are constants in linksSignals.ts / naming.ts with no `organize` key, and the preview needs document text the board items do not carry. Needs engine plumbing first.
- Naming: status-folder words and container words: constants in tokens.ts, same reason.
- Naming prefixes change display names only; the engine's KIND set (tokens.ts) still decides grouping words. Making grouping read the prefixes means passing them through fileTokens() in every engine call.
- The edit panel "beside the list" and drag handle: rows are edited inline; reorder uses the up and down buttons.
- Closing the tab with the window X cannot be intercepted by a webview, so the unsaved-edits prompt covers the Close button only.

### 18.10 Owner decisions needed (auto-organization)

All seven are decided (decisions 46 to 52). Each answer is marked DECIDED below, with the recommendation it was given against.

1. **DECIDED: (a).** **Where tags and overrides are saved.** (a) The project's rules file, under one `organize` key, shared through git. (b) Tags in the user's VS Code settings (follow the user to every project), overrides in the rules file. (c) A separate file `.saropa/release-board-organize.json`. **Recommend (a)**: one file that the board already writes safely with undo, and the team sees the same groups; Export and Import cover reuse in other projects.
2. **DECIDED: (a), bends section 12 rule 6.** **Open groups at scale.** Section 12 rule 6 opens every group that holds a blocker. (a) From 50 documents, open at most the 3 groups with the most blockers; the others stay closed with their red count pill showing. (b) Keep rule 6 as written. **Recommend (a)**: at 500 documents 20 open groups is the wall of rows decision 44 forbids, and the red pill keeps every blocker visible.
3. **DECIDED: (a).** **Where emoji show.** (a) Group headers and hover cards only. (b) Also a leading emoji on every row. **Recommend (a)**: rows keep the two-pill limit (section 6), and the group header already says what the rows are.
4. **DECIDED: (b), CHANGED from the recommendation (decision 49).** **Front matter.** (a) Not read now. (b) Read `group`, `tags` and `needs` from a YAML block at the top of a document. **Recommend (a)**: the owner's documents do not use front matter today, and the UI covers every override; it can be added later without changing anything else.
5. **DECIDED: (a).** **Moving an override when its file moves.** (a) Automatic when exactly one match exists, with a change-log line and Undo; otherwise listed in Tidy. (b) Always listed in Tidy for a click. **Recommend (a)**: renames are common and the match is unambiguous; the change log keeps it visible.
6. **DECIDED: (a).** **One editor or two.** (a) The Tags and rules editor absorbs today's severity keyword editor as its Severity tab. (b) Keep two separate editors. **Recommend (a)**: decision 45 asks for one editor view, and two places for keywords is the clutter decision 20 removes.
7. **DECIDED: (a), build order CHANGED from the recommendation (decision 52).** **Order inside a group and phase order.** (a) Sort rows by sequence number (display only, never a link or light change); build Org 1 and Org 2 before phase 6, Org 3 after phase 6, Org 4 after phase 5 with its review list reused by Handoff phase 3. (b) No sequence sorting; all Org phases after phase 8. **Recommend (a)**: phase 6 needs stable ids and names to be worth building, and one review list serves both heuristic and AI proposals.

## 19. Visual polish phase (from the first headless render, 2026-10-30)

Delivery row 9 (section 13). Runs after every current Release Board branch is merged, because it touches the same board files.

**Source.** Headless Chrome render of `main` at 1200 px and 420 px wide, in dark and light. Screenshots: `/private/tmp/claude-503/-Users-craighathaway-src-saropa-workspace/b4542b99-4d44-4115-a5f4-394e495e849f/scratchpad/render/png/`. File names: `{a,b,c}-{dark,light}-{1200,420}-{0-initial,1-gantt,2-board,3-future,4-rowmenu,5-viewmenu,6-optsmenu,7-scopemenu,8-handoff,9-more}.png`. Fixtures: a = 1 project and 5 documents, b = 3 projects and 40 documents, c = 5 projects and 300 documents. **The screenshots of the 300-document case (c) were not reviewed.** Only a and b were checked.

**Defects, ranked.** Each one is fixed in this phase unless the owner decides otherwise.

1. **Row menu at 420 px runs off the bottom and is clipped** (`b-*-420-4-rowmenu.png`). Fix: flip the menu above the row when there is no room below, and scroll inside the viewport when it is still too tall.
2. **Status menu shows two checked entries, "Address now" and "Done".** May be a fixture artifact. Verify first; fix only if the menu really allows two checked states.
3. **Narrow header is clumsy.** The scope switch is a full-width bar; "Changes" and two unlabeled kebabs are three grey blocks; "Add more projects" takes its own row; board content starts about 200 px down. Fix: scope as a compact control, label or merge the kebabs, move "Add more projects" into the Projects menu, and bring content up.
4. **Too many pills and counts per project card.** The summary strip repeats the card header. Each card shows NO-GO plus "2 block", "3 review", "2 in progress", and section count badges. Zero pills ("UNVERIFIED 0", "GO 0") are shown. Fix: hide zero pills and drop duplicated counts.
5. **Red is overused.** Each Resolve-now row has a red "Blocks" pill, a red NO-GO tag and a red count badge. Each Gantt project footer has a red NO-GO tag. Fix: one red mark per row or card (section 5 rule).
6. **Future tab at 420 px is a wall.** Five full-width selects and a full-width "Proposed: Marketable" button per item, about 400 px per item. The light-coloured Score select clashes with the dark theme. Fix: a compact pill or kebab menu per item, themed controls in both modes.
7. **Gantt bars without dates are full-width stripes, and file names are cut off at 420 px.** Fix: undated bars get a fixed short width with a "no dates" mark; names wrap or truncate with a tooltip.
8. **"In progress" is both a section and a purple pill on every row.** A stray loading spinner sits under the last blocker row. Fix: keep the section, drop the per-row pill; hide the spinner unless a load is running.
9. **Pale UNVERIFIED and GO pills with grey "0" badges have the weakest light-theme contrast.** Fix: raise contrast to the WCAG AA level for text on those pills in light theme.
10. **Handoff drawer is reachable only after selection mode.** Verify that the single-item Hand off path opens the drawer directly. If it does not, fix it so it does.

**Checks.** Re-render in all four combinations (dark and light, 1200 px and 420 px) and the same ten screens. Add or update board HTML tests in `extension/src/test/board/` for the menu placement, zero-pill rule and single red mark.

**Not in this phase.** Changes to the 300-document layout beyond what the defects above require; those screenshots are not reviewed yet. No new features.

### Cleanup delivered notes

Release Board cleanup branch release-board-cleanup (2026-10-30). Delivered: items 1-5 and 8. Deferred by the owner (scope freeze, not built): item 6 (a "Hand off" entry on a Path to GO step, new handoff scope kind step) and item 7 (Gantt group sub-headers under each project).
Item 8 (matched-tag pills and an "Edit tags..." action in the hover cards) is also not built: the hover cards are native title tooltips, which cannot hold pills or buttons, so it needs a new custom popover component. Left for an owner decision. The Edit tags entry already exists on the row and group menus.

### Write audit delivered notes

Branch release-board-write-safety. Delivered: audit items 1-9 (linear-time document facts and Needs editor with size and line caps; Tags editor keeps unknown keys; one per-file write queue and whole-file replacement for every rules, document, undo and patch write; Undo goes to the saved folder; hand-off save checks links and keeps an existing .gitignore; hand-off terminal command is never built from a folder name a shell reads as more than text; strong unsaved-edits check everywhere).
Deferred (not built): 10 order lists rebuilt on reorder drop junk entries silently; 11 AI patch group move differs from the board's (deletes emptied owner groups, ignores ungrouped); 12 Needs reader vs patch writer disagree on ~~~ fences, removal rewrites separators; Future tab and Tidy symlink checks; no Undo for header edits and moves; Export marks overwrite; Keyword editor Restore defaults has no Undo; new bug document path confinement; template creation link check.
Deferred after the review round (not built): rename side effects (hard links, ownership, extended attributes, ACLs, Windows busy files and sync folders); unsaved-edits check for virtual (non-file) workspaces; predictable hand-off temporary names in shared folders. The terminal hand-off refuses folder names with shell-special characters as a conservative choice (spaces are allowed; `Project (old)`, `R&D` and `Craig's` are refused with a Copy/Save pointer).
