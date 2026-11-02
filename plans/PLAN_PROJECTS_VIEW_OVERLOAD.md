# Plan: Release Board opens as an overwhelming flat list

Status: research done 2026-11-02. Nothing below is decided. Owner decisions are listed in section 7, each with a recommendation.
Related: [PLAN_RELEASE_BOARD_REDESIGN.md](PLAN_RELEASE_BOARD_REDESIGN.md) (decisions 18, 20, 21, 24, 44, 47 and section 18.3.2), [PLAN_RELEASE_BOARD_v2.md](PLAN_RELEASE_BOARD_v2.md).

## Decisions (owner, 2026-11-02)

- Option B chosen; build step 1 now (release freeze lifted; 2.7.0 shipped).
- Header: one scope-and-mode pill (restores decisions 20 and 24); remove the pills that do nothing on the Gantt and the extra "Have: 7 of 8" line.
- Bar minutes: computed from all open steps of the document, so an empty bar means no estimate.
- Unified stays, sorted blockers first. "Up next" fixed at 5 rows, amber past 3 in progress, no setting (step 2, not built yet). Changed-row outlines limited when more than 10 rows changed (step 2).
- Blocks-release flag (owner, 2026-11-02): red is split from severity; the existing hand pin is the "blocks next release" flag (renamed in wording only, no second flag). A: "Not now" stores nothing, the strip shows again on next open. B: the prompt triggers when a project has more than 5 items that are red today (red folders plus severity). C: in answered projects, unflagged red-folder items show an amber diamond with their status word. D: re-ask only for new extreme or critical items in an answered project. Never-answered projects keep today's rules. The two bugs the design names are fixed (5000th pin dropped on read; local mark cannot switch off a shared-file pin).
- Ordering questions (owner, 2026-11-02, "fix everything"): built as designed in "Design: ordering questions" with its recommendations. E: an answer means order only, not a hard dependency (handoff and path-to-go never read it). F: Skip is stored (not asked again until "Order the blockers..."). G: questions are pairs: A, B or Skip. H: folder answers order sections and Up next only, no item edges. Answers live in a new `order` field of the marks file, never in documents; severity is the starting order and the question order.

## Step 1 build notes (2026-11-02)

Built: two-line titles in a 45% (min 200 px) title column, shrinking project name, chain slot `display:none` until hover, focus or drag; Unified sorted red, purple, amber then work order; `BoardItem.openMinutes` (sum of all open steps of the document) feeds the bars; one `scope · mode` pill with one menu; Future tab `200+` plus a note (`FutureData.cut`).

Deviations from the Option A text:
- Group by, time and devices (and the removable filter line) are not in the View options kebab. They are drawn at the top of the Board tab (`boardPills`), which keeps their menus working with no new message paths. Moving them into the kebab is not done.
- Narrow breakpoint left at 480 px: the 45% column plus two-line wrap already fits the 650 px panel. Pressed-button contrast fix for Split/Unified not done (not in the step 1 scope list).
- Bar minutes use the document's kept open steps (the first 200); steps past that are not counted.
- Not done: headless render at 420, 650 and 1200 px (no browser in this environment).

## 1. What the owner saw (2026-11-02)

The board opens on the Gantt tab. Top: five chips (`All 3`, `Deliberate` or `Rush`, `Project`, `Any`, `Have: 7 of 8`), tabs Gantt / Board / Future `200`, a pause button, `Changes 3`, a kebab. Under it a second `Have: 7 of 8 ✕` chip, then `?` and `Split | Unified`. Then one section, "All projects 59", holding 59 rows in one flat list. Each row: a red dot or amber diamond, a title cut to about 12 to 15 characters ("Owner server and …", "Plan: cod…"), the project name, a kebab, and a small empty dashed box. Three rows show a real bar (4h 10m, 2h 30m, 20m). About a third of the rows have a dotted blue outline.

Complaints: (1) titles cut so short they cannot be read; (2) a flat list of 59 equal rows reads as "do 59 things at once"; (3) the whole page is overwhelming, so the owner closed it.

Verdict: all three are real and come from the code, not from the data. The design already decided (decisions 20, 24, 44, 47 and section 18.3.2) most of what would fix them, but the Gantt tab, which is the default view, never received it. Grouping, row limits and auto-collapse were built for the Board tab only; Gantt group sub-headers were deferred twice (Org 1/2 notes, cleanup item 7).

## 2. Root causes, with evidence

### 2.1 Titles cut short (complaint 1)

- The left column of every Gantt row is capped at 270 px: `grid-template-columns:minmax(160px,270px) 1fr` (`extension/src/board/boardHtmlGantt.ts:18` and `:25`). The other column, the bar track, takes all remaining width, even when it holds only a 3.5em dashed box.
- Six things share those 270 px (`boardHtmlGantt.ts:28`, `:81`): 20 px padding, the status shape, the title, the project name (unified layout only, `white-space:nowrap`, `:15` `.gpn`), the Waits-on slot `⛓` and the row kebab, plus move arrows on hand-ordered groups. The project name never shrinks, so the title gets what is left: about 60 to 110 px. "saropa-supabase" and "saropa_workspace" leave the least ("Plan: Hub…", "Board an…").
- The Waits-on slot is invisible (`opacity:0`) but still takes its width (`extension/src/board/boardHtmlDrag.ts:17`).
- The title is one line with an ellipsis (`.gl .tt{…overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`, `boardHtmlGantt.ts:28`).
- Wrapping is switched on only below 480 px (`boardHtmlGantt.ts:39`). The owner's narrow panel is about 650 px wide, so it gets the cut titles too.
- Tooltips are fine: the link title is the full title plus the path (`docLink`, `extension/src/board/boardHtmlUtil.ts:203-205`); the row tooltip carries the full title too. The rule "tooltips are always full text" already holds and must stay.
- Already flagged and not fixed: redesign plan section 19, defect 7 ("file names are cut off at 420 px… names wrap or truncate with a tooltip"); the fix chose truncation.

### 2.2 Flat list (complaint 2)

- `Unified` puts every project into one section named "All projects" (`extension/src/board/ganttModel.ts:140-146`, `unify`). Rows are sorted only by `start` (work-order position). With few `Needs:` links almost every row has rank 0, so `start` is 0 for all of them and the order falls back to project order: in the narrow screenshot nine amber rows of saropa_workspace sit above the red blockers of saropa-supabase and web. Blockers are not on top.
- `Split` (the setting default, `extension/package.json:2528-2534`) gives one section per project, but every section is open and shows up to 150 rows (`GANTT_ROWS = 150`, `boardHtmlGantt.ts:85`). There is no row limit and no auto-collapse on the Gantt; only folds the user made by hand are remembered (`boardHtmlGantt.ts:52-53`).
- The Gantt ignores the Group by setting. Plan note: "The Gantt always groups by project. The Group by setting applies to the Board tab only" (redesign plan, Gantt phase 7 notes). The automatic groups (folders, file names, tags) exist and are shown on the Board tab only.
- The adaptive layout the owner decided (decisions 44 and 47, section 18.3.2: at 50 to 199 documents, group headers, 5 rows per open group, at most 3 groups open, those with the most blockers) is implemented in `extension/src/board/org/layout.ts:46-63` and used by the Board tab (`extension/src/board/boardHtmlGroups.ts:117`, `extension/src/board/boardOrg.ts:63`), never by the Gantt.
- The Board tab already follows the calm rules: project cards start collapsed (`extension/src/board/boardHtmlRows.ts:384-386`), lists show 5 rows and "Show N more" (`boardHtmlRows.ts:17`, `:295-296`). The owner never sees it, because Gantt is the default tab (decision 21, `extension/src/board/boardHtmlAssets.ts:110`).
- Nothing on screen says what to do first. All 59 rows look equal: same shape weight, same empty bar, same kebab.

### 2.3 Overwhelming page (complaint 3)

Header chips (`extension/src/board/boardHtmlHeader.ts:32-55`, `:68-70`) and what each does on the Gantt tab:

| Chip | What it is | Effect on the Gantt rows |
|---|---|---|
| `All 3` | Scope: open project only, or all chosen projects | Real: picks the projects |
| `Deliberate` / `Rush` | Release mode: which severities block | Real: decides which rows are red (`ganttModel.ts:179`, `stopping`) |
| `Project` | Group by | None. Board tab only |
| `Any` | Time you have (Sittings box) | Only bar lengths, indirectly (2.4) |
| `Have: 7 of 8` | Devices in hand (Sittings box) | Only bar lengths, indirectly (2.4) |
| `Have: 7 of 8 ✕` (second line) | The same filter as a removable pill (`boardHtmlHeader.ts:75-96`) | Suggests the Gantt is filtered; it is not |
| Pause button | Pauses the 30-second chat poll (decision 40) | None; it has no label |

So 3 of the 5 chips, and the extra filter line, do nothing to the list the owner is looking at. Decision 20 (controls in kebab menus, header shows only the scope switch, tabs and two kebabs) and decision 24 (one scope-and-mode pill, `⚙ All 5 · Deliberate`) say the header should be one pill. Commit `ae3311a` ("split board header settings into pill menus", 2026-10-30) moved them back out to five pills. No owner decision for that change is recorded in the plans (grep of `plans/` and the changelog finds only the changelog line).

Other noise:
- About a third of rows have a dotted blue outline (changed since the last look, decision 43). With many changes this becomes texture, not a signal.
- Most rows show an empty dashed box (2.4), which reads as "nothing is known about this".
- The selected `Unified` button is almost unreadable in the narrow screenshot (pressed-state colors, `boardHtmlGantt.ts:15` `.glay button[aria-pressed=true]`).

### 2.4 Why most bars are empty

- A bar's minutes come only from the Sittings list (`ganttModel.ts:76-83`, `minutesByDoc` reads `model.sittings.lines`).
- That list is the "steps I can do now" box: filtered by Have and the time box, and capped at 25 steps that fit plus 25 untagged steps across all projects (`extension/src/board/sittings.ts:128`; cap from `saropaWorkspace.releaseBoard.sittings.maxSteps`, default 25, `extension/src/commands/boardSittings.ts:28-33`). Documents with no checklist steps, blocked documents, documents waiting on an open link and, by default, documents not marked as the owner's (`sittings.onlyOwnerDocuments`, default true, `boardSittings.ts:34`) are left out entirely (`extension/src/board/boardModelParts.ts:330-337`).
- So "no bar" mostly means "not among the first 25 steps that fit the current filter", not "no estimate". The Have and time chips change the Gantt's bars, which nobody would guess.
- With no links, every bar starts at 0 (`ganttModel.ts:153-180`), so the axis "Start … Release" carries no information; width is relative to the longest item, so one 4h item fills the row.

### 2.5 Future shows 200

The Future list is cut at 200 documents (`MAX_FUTURE_ITEMS = 200`, `extension/src/board/futureList.ts:85`; applied at `extension/src/commands/boardFuture.ts:57`). The tab shows the cut count as if it were the total; there is no "200+" and no note that more exist. The narrow screenshot shows 26, a different scope.

## 3. What the design intended versus what shipped

| Intended (decision or section) | Shipped |
|---|---|
| Gantt rows grouped under project or group headers, following Group by; a collapsed group is one row with a count pill (decision 18, section 10) | Project only; Group by ignored; no group sub-headers (deferred) |
| Lists show five rows and "Show N more" (section 12 rule 5) | Gantt shows 150 rows per section |
| Default state: everything collapsed except the project that needs attention (decision 20) | Gantt: everything open |
| 50 to 199 documents: headers, 5 rows per group, at most 3 open groups with blockers (decisions 44, 47; 18.3.2) | Board tab only (`org/layout.ts`) |
| Header: scope switch, tabs, two kebabs; one scope-and-mode pill (decisions 20, 24) | Five pills plus a filter line |
| Bars without minutes: fixed short width with a "no dates" mark (section 19 defect 7) | Done, but most bars fall in that case for the reason in 2.4 |
| Order in a flat list: blockers first | Unified order is project order when there are no links |

No plan has a "today / up next" focus or a work-in-progress limit. The closest pieces: the Sittings box ("steps I can do now", ordered by what unblocks most, then severity, then shortest, `sittings.ts:73-83`) and the In progress list on the Board tab.

## 4. What proven tools do

- **Work-in-progress limits (Kanban).** Cap how many items are active at once so people finish rather than start; pile-ups show where work is stuck. [Kanban Tool](https://kanbantool.com/kanban-guide/kanban-fundamentals/limit-work-in-progress), [Kanbanize](https://kanbanize.com/kanban-resources/getting-started/what-is-wip), [Superthread](https://superthread.com/docs/guides/kanban-wip) (start near one item per person).
- **A short "today" list, separate from the backlog.** Things 3's Today shows only what was chosen for today, gathered from every list ([Apple App Store story on Things](https://apps.apple.com/us/story/id1437936658)). Sunsama adds up the planned time and warns when the day is over-full ([Sunsama help: daily planning](https://help.sunsama.com/docs/daily-planning)).
- **Now / Next / Later.** Three horizons instead of a timeline when there are no real dates; only "Now" is detailed ([Aha!](https://www.aha.io/blog/introducing-the-now-next-later-roadmap), [Savio](https://www.savio.io/product-roadmap/now-next-later-roadmaps/)).
- **GTD next actions.** Each project shows one concrete next action; the rest of the project stays out of the daily list (David Allen, Getting Things Done; common knowledge, no link checked).
- **Eisenhower.** Separate urgent-and-important (do now) from important-not-urgent (schedule). Here "blocks the release" is the urgent axis and severity the important axis.
- **Progressive disclosure.** Show the essential first, details on demand; keep to two or three levels so nothing is buried ([PatternFly truncation](https://www.patternfly.org/ux-writing/truncation), [Primer truncation](https://primer.style/accessibility/patterns/truncation)).
- **Wrap before you truncate.** Primer prefers wrapping; PatternFly truncates only on overflow and always gives the full text in a tooltip; Basis warns truncation hides what users need ([Basis](https://design.basis.com/truncation), [SAP Fiori](https://www.sap.com/design-system/fiori-design-web/v1-151/foundations/writing-and-wording/ux-writing/wrapping-and-truncating-text): wrap to two lines, then truncate).
- **Timeline readability.** A Gantt without dates or links has no shape: every bar starts at 0. Tools like Linear show a timeline only for items that have dates and list the rest.

## 5. Options

All three keep: full-text tooltips (never cut), no AI, no invented dates, settled colors and lights, existing settings keys.

### Option A: Readable Gantt (fix the cuts and the chrome only)

What the owner sees on open: the same Gantt, but titles wrap to two lines and are readable; the project name sits in the section header (Split) or as a small second line under the title (Unified), never beside it; the header is one scope-and-mode pill plus the tabs and two kebabs; the `Have ✕` line appears only on the Board tab where it applies.

Code:
- `boardHtmlGantt.ts`: left column `minmax(220px, 45%)`; title `-webkit-line-clamp:2` with wrap; project name below the title; the Waits-on slot takes no width until hover, focus or drag (`boardHtmlDrag.ts:17-18`, absolute position or `display:none`); narrow breakpoint raised from 480 px to about 700 px, where the bar moves under the title; pressed-button contrast fix.
- `boardHtmlHeader.ts`, `boardHtmlMenus.ts`: back to decisions 20 and 24: one scope-and-mode pill; Group by, time and devices move into the View options kebab; filter line drawn only in the Board tab panel.
- `ganttModel.ts`: Unified order: status first (red, purple, amber), then work order, then project.
- `ganttModel.ts`, `boardModelParts.ts`: bar minutes from all open steps of the document (uncapped, unfiltered), not from the filtered Sittings list.
- `boardHtmlFuture.ts`, `commands/boardFuture.ts`: Future tab shows `200+` and a "more not listed" note when cut.
- Tests: `test/board/boardHtmlGantt.test.ts`, `boardHtmlHeader.test.ts`, `boardPolish.test.ts`, `boardTooltips.test.ts`, `ganttModel` tests; headless render at 420, 650 and 1200 px.

Effort: M (2 to 3 days). Risk: low; layout and header only, no writes. Undoes commit `ae3311a`, so it needs the owner's confirmation (section 7, question 3).
Fixes: complaint 1 fully; complaint 2 only slightly (blockers rise to the top, still 59 equal rows); complaint 3 partly (header calmer, list still long).

### Option B: Focus first, then grouped and collapsed (recommended)

What the owner sees on open, on the Gantt tab:
1. **Up next** (top, always open): at most 5 rows, picked by a fixed rule: what is in progress first, then blockers that wait on nothing, ordered by how much they unblock, then severity, then shortest (the order the Sittings box already uses, `sittings.ts:73-83`). One line per row, title on up to two lines. A pill "3 in progress" turns amber when more than 3 items are in progress (a soft work-in-progress limit; nothing is refused).
2. **Projects** (below): one section per project, closed by default, each header one line: name, light, "18 open · 9 block". At most the 3 projects with the most blockers start open (decision 47), each showing 5 rows and "Show N more" (section 12 rule 5). Inside a project, the automatic groups appear as sub-headers, closed (the deferred "Gantt group sub-headers").
3. Everything from Option A (readable titles, one header pill, real bar minutes, Future `200+`).

Code (on top of Option A):
- `ganttModel.ts`: `upNext(model, n)` pure function; group sub-sections from the existing org groups (`item.group`); apply `layoutFor` from `org/layout.ts` (row limit, open cap) instead of `GANTT_ROWS = 150` for the first view; Unified becomes "Up next + one merged list", or is retired (question 4).
- `boardHtmlGantt.ts`: Up next section; closed-by-default sections with count pills; rows past the limit sent on demand (the existing "Show more" message path, `ganttRows` at `boardHtmlGantt.ts:115-122`).
- Fold memory: the user's own open or close still wins (section 12 rule 2), keyed as today (`gcol`).
- New English strings: "Up next", "{count} in progress" tooltip, the rule tooltip ("Picked because: in progress / blocks 3 items / critical / 20 min"). Other languages through the owner's pipeline.
- Tests: pure tests for `upNext` (order, ties, cap, no item twice, empty board, all blocked), real-render test through `renderBoard` per the repository rule, headless render at 5, 59 and 300 documents in dark, light and narrow.

Effort: L (about a week, two pull requests: A first, then the focus and grouping). Risk: medium. A row in Up next must not also look like it was hidden from its project (it stays in its project too, marked); the open-group cap must never hide a blocker (closed headers always show the red count, as 18.3.2 requires); the Gantt's drag targets and move arrows must keep working inside closed and sub-grouped sections.
Fixes: complaint 1 fully; complaint 2 fully (5 things to do, the rest folded with counts); complaint 3 fully (one pill header, one short list, folded projects).

### Option C: Now / Next / Later lanes replace the Gantt as default

What the owner sees on open: a new first tab with three lanes. Now: in progress (soft cap 3). Next: the top 5 unblocked items (the Up next rule). Later: every other open item, folded by project with counts. The Gantt stays as a second tab for dependency work.

Code: a new tab module beside `boardHtmlGantt.ts` (about 300 lines), tab order and default change in `boardHtmlFuture.ts:35-40` and `boardHtmlAssets.ts:110`, plus everything in Option A.
Effort: L to XL. Risk: high. It reverses decision 21 (Gantt is the default) and part of decision 18; a fourth tab adds chrome; "Later" overlaps the Future tab's meaning (deferred work), which will confuse.
Fixes: all three, but by adding a view rather than fixing the one the owner opens.

### Recommendation

Option B. It fixes all three complaints, applies decisions the owner already made (18, 20, 24, 44, 47) to the default view instead of inventing new rules, reuses code that exists (`org/layout.ts`, the Sittings order, the Show more path), and follows proven practice: a short next-actions list with a soft work-in-progress limit over a folded backlog. Build it as two pull requests, Option A first (it is useful alone and low risk), then the focus and grouping.

## 6. Constraints found

- Repository rule: "No new feature work during a release push." v2.7.0 was released today (commit `12a7069`), so the push looks over, but the owner must confirm (question 1).
- Gantt group sub-headers were deferred by the owner under a scope freeze (cleanup notes, item 7). Option B un-defers them (question 1 covers it).
- Header pill split (`ae3311a`) has no recorded decision but is the shipped state (question 3).

## 7. Owner decisions needed

1. **Start this work now?** Option B un-defers the Gantt group sub-headers that were frozen for the release. Recommend **yes**: 2.7.0 shipped today, and the owner closed the board as unusable, which is the main view of the feature.
2. **Which option?** A (readable Gantt), B (focus first, grouped and collapsed), C (Now/Next/Later lanes as a new default tab). Recommend **B, built as A then B**: fixes all three complaints with decisions already made; C reverses decision 21.
3. **Header: one pill or five?** (a) Back to decisions 20 and 24: one scope-and-mode pill; Group by, time and devices in the View options kebab; the devices filter line only on the Board tab. (b) Keep the five pills, but hide Group by, time and devices on the Gantt tab. Recommend **(a)**: three of the five pills do nothing on the Gantt, and the decided design already says one pill.
4. **Unified layout.** (a) Keep it, sorted blockers first under Up next. (b) Remove it; Split with folded projects becomes the only Gantt layout. Recommend **(a)**: the owner chose it, and with blockers first and two-line titles it becomes a usable single list; removing a setting value needs a migration.
5. **How many in Up next, and a soft in-progress limit?** Recommend **5 rows, amber pill past 3 in progress, no setting**: a fixed small number is the point; a setting can come later if asked for.
6. **Bars with no known minutes.** (a) Compute minutes from all open steps of the document, so most rows get a real bar; rows with no steps keep the short dashed box. (b) Draw no bar at all when minutes are unknown. Recommend **(a)**: the data exists; today it is lost by the Sittings filter and cap, and the Have and time chips silently change the Gantt.
7. **Since-you-left outlines when many rows changed.** (a) Keep the outline on every changed row. (b) Above 10 changed rows, outline only the changed rows in Up next and show a count on each project header. Recommend **(b)**: a third of the list outlined is noise; the Changes button still lists everything.

## Review verdict (diff review of a7d4b59, findings only)

No blocker or data-loss finding. Escaping, ARIA and tooltip checks pass: the new header group and menu groups carry escaped labels; the `gpn` project name keeps a full-text title while it ellipsizes (title text is never truncated); titles wrap, not cut.
- Medium: no test covers the new `cut` flag or the "200+" tab count and `cutNote` (grep of `src/test` finds none). `src/board/boardHtmlFuture.ts:33`, `src/commands/boardFuture.ts:61-76`.
- Low: `boardPills` (`src/board/boardHtmlHeader.ts:~59`) reuses the `filterLine` aria-label on a second `role="group"`; two groups on the Board tab share one name. Give it its own label.
- Low: the merged pill label `scopeGroup / profileLabel` (`boardHtmlHeader.ts:41`, `boardHtmlMenus.ts:99`) is composed with a literal " / " and " · " in code; not translatable word order (acceptable, flag only).
- Low: `releaseBoard.future.cutNote` exists only in en.json (other locales go through the owner's translation pipeline; no action by agents).
- Low: `ganttModel.ts` unify sort: stable (Array.sort), ties keep input order; `GanttStatus` rank map covers red/purple/amber/green. OK. No test of tie order among equal status and start beyond ganttReadable.
- Checked clean: `pmode` has no remaining consumers in src or tests (the test asserts it is absent); `pscope` consumers updated; new `openMinutes` is read only in `ganttModel.ts`; no webview message changes.

## Owner input, round 2 (2026-11-02)

Owner points (not yet decided as design):
- Red is inflated: the app is already published, yet most rows are red. "When everything is critical, nothing is critical." The board never asks the owner what actually blocks.
- Use folders to group and collapse the list (the Gantt ignores the folder groups today; see section 3).
- Ask the owner which item comes before which, instead of dumping a long list.

Cause of red (`ganttModel.ts:169`): a row is red when its status is red or when Deliberate/Rush mode says it is "stopping". Severity comes from the document, not from the owner's current release state.

Proposal (pending owner confirmation): see chat summary, to be copied here once decided.

### Decision (owner confirmed, 2026-11-02)
Red is split from severity. Severity stays as the dot color. A new owner-set "blocks next release" flag makes an item red. Asked once per project, lazily, when the owner opens a project with many high-severity items and no flags; answers saved per project. Folder grouping and ordering questions come later and apply to flagged items.

## Design: blocks-release flag (design review, 2026-11-02, nothing built)

### Key finding: the flag already exists
The hand pin ("pinned as critical") is already an owner-set, per-document yes/no that makes an item red and NO-GO (`board/marks.ts:8-11,135`, `board/boardModel.ts:80,117`, set by the "Mark this document" command `commands/boardMarks.ts:103-118`). Recommend: the "blocks next release" flag **is** the pin, renamed in wording. No second flag. Today red has three sources: red folder status (rules: bug files, owner folders, pending SQL, `Open` table rows; `board/defaultRules.json` folder-states/doc-kinds/live-folders/pending-sql), a severity at or above the profile (`board/severity.ts:114-123`), or a pin. The new rule removes the first two as causes of red in projects the owner has answered.

### Rule
- New per-project answer state. A project is **answered** once the owner saves the prompt (even with zero picks).
- Answered project: red = open item pinned. Folder status and severity are shown (status word, severity word) but never red.
- Never-answered project: today's rule, unchanged (red folder or stopping severity or pin). See Migration.
- One source of truth: add `BoardItem.blocks: boolean`, computed once in `boardModel.ts:117` area; every consumer below reads `blocks` instead of repeating `status === "red" || stopping`. Keep `stopping` as "severity at or above the profile" for tooltips and tidy.

### (1) Consumers that must change
| Place | Today | After |
|---|---|---|
| `board/boardModel.ts:117` | `stopping = pinned or severity stops` | add `blocks` = answered ? pinned : (status red or stopping) |
| `board/boardModel.ts:89-96` | blocked-folder docs with stopping severity counted as `blockedStop` | answered: only pinned ones count (pinned already become items) |
| `board/boardModel.ts:154-157` light | NO-GO on `counts.red`, any `stopping`, `blockedStop` | answered: NO-GO on any `blocks`, health failing, held-back previous red (keep the safety hold as is) |
| `board/boardModel.ts:121-127` sort | red status first, then pinned | `blocks` first, then status, then severity |
| `board/boardHtmlMenus.ts:67-68` `blocksNow` | status red or stopping | `i.blocks` |
| `board/boardHtmlMenus.ts:62` profile counts `data-proj` | blocksNow + blockedStopping | `blocks` count (+ blockedStopping only when not answered) |
| `board/boardHtmlAssets.ts:125,127` row-menu effect line | says a severity/status change will stop or clear the release | answered rows (new `data-ab="1"` in `rowData`, `boardHtmlMenus.ts:41`) say "Does not change the release: only items you mark block it" |
| `board/boardHtmlRows.ts:134-161` pill and hover card | `k = blocks ? red : status` (a red-status unflagged item still draws red); "Red folder" line | non-blocking red status draws amber ◆ with its status word; card line "Blocks the next release (you chose)" or, for an unflagged high item, "High: would stop under Deliberate; not marked as blocking" |
| `board/ganttModel.ts:169` | red if status red or stopping | red if `blocks`; red status unflagged maps to amber |
| `board/boardHtml.ts:109,147`, `board/boardHtmlGroups.ts:49,85,109-110,146,168` | "Resolve now" list = status red; open-by-default and worst color use blocksNow | "Resolve now" = `blocks`; unflagged red-status items go to "Work on" |
| `board/sidebar.ts:144` `isBlocker` (sidebar count, causes) and `board/sinceLast.ts:86` | status red or stopping | `blocks` |
| `board/pathToGo.ts:95,130,145,151` | stoppers = status red or stopping, why "red" | stoppers = `blocks`; why "pinned" in answered projects |
| `board/handoff.ts:114-121,137,145` | why "red folder" / "pinned as critical" / "severity X stops under P"; "N items block" | answered: why "marked as blocking the next release" only; count = `blocks`. Never-answered: unchanged text |
| `board/handoffMarkdown.ts:53` | "Pinned" | "Blocks next release" |
| `views/editorLinks.ts` via `board/editorLinks.ts:56` | editor color from `it.status` (red) | red only when `blocks`, else amber/purple |
| `board/tidy.ts:151` | never offers red, stopping, pinned | unchanged (still sensible) |
| Wording, en.json only: `releaseBoard.markPin`, `why.pinned`, `panel.pinned`, `stTip.red`, `whyRed` | "pinned as critical" | "Blocks next release" (other locales go through the owner's translation pipeline) |

Meaning afterwards: release-blocker count = items you marked (answered) or today's count (not answered). Handoff says why in one phrase. Deliberate/Rush/Zero no longer change red in answered projects; they decide which severities count as candidates in the prompt and what the hover card calls "would stop". Profile switch preview must say "N projects use your marks; the profile does not change them".

### (2) Storage
- Pins: the existing marks file (local `release-board-marks.json` in workspace storage, shared `.saropa/release-board-marks.json` under it; `commands/boardMarks.ts:7-43`). Why: it already holds exactly this flag per `project/path`, has one-at-a-time writes (`updateLocalMarks`, line 48), a byte cap, a damaged-file reader, team sharing by export. Not `severityOverrides` (rules file, `board/ruleSeverity.ts:12-26`): that is severity, the thing being split away.
- New field in `MarksFile`: `answered: Record<projectId, { at: number; seen: string[] }>`; `seen` = candidate paths shown and left unpicked (for new-item detection, edge cases). Parsed in `parseMarks`, merged local-over-shared in `mergeMarks`, exported with the rest.
- Same caps on read and write (the review rule). Gap found: read keeps only `MAX_ENTRIES` (5000) marks (`marks.ts:80`) but write has no count cap (`fitMarks`, `marks.ts:50-64`, trims only `rejected`), so a 5001st pin is written and then silently dropped. Fix: one constant used by both; the write refuses past it with the existing "too big" warning. `answered` capped at `MAX_ENTRIES` projects, `seen` at 200 paths per project, both enforced in `parseMarks` and in the setter; the file still fits `MAX_BYTES`.
- Gap found: a local mark cannot switch off a shared pin (`setMark` deletes an entry with nothing set, `marks.ts:113-121`; `parseMarks` turns `false` into undefined, line 82). Unticking a shared pin in the prompt would do nothing. Fix: keep an explicit `pinned: false` locally when the key is pinned in the shared file, and parse `false` as false.

### (3) Prompt UX
- Trigger, lazy: computed per project in `buildProject` (a count over items already built, cheap for 1000+ projects). Qualifies when not answered and more than 5 items would be red today. A one-line strip is drawn **inside** that project's Board card and Gantt group (`boardHtmlGantt.ts:130` section, `boardHtmlGroups.ts` card), so it is seen only when that project is expanded. No popup, no timer.
- Strip text: "12 items are marked serious. Which of them block the next release? [Choose] [Not now]". Tooltip: "Only the items you choose turn red. The rest keep their severity."
- Choose: the page sends `{type:"blockersAsk", p:<project index>, rev}`. Host checks `rev` (existing check `views/boardPanel.ts:50`), `Number.isInteger(p)`, in range, and resolves the project id from its own model. The list is the host's own multi-select QuickPick (`canPickMany`), like the group picker (`boardPanelEdits.ts:97-99`), so no paths or titles come from the page. Items: title, severity word and project-relative path as detail; severity order, extreme first; current pins pre-ticked; title "Which of these block the next release? (none is a valid answer)".
- Save (OK) with any number of picks, zero included, writes pins and `answered` in one `updateLocalMarks` call: a single file write, so there is no half-saved state. Then the existing Undo bar (`offerUndo`, `boardPanelEdits.ts:270`) restores the previous pins and answer state in one write. A failed write shows the existing error and changes nothing.
- Escape / "Not now": nothing stored; the strip stays and shows again next time the project is opened. (Recommendation below.)
- Ask again: a project kebab item "Choose what blocks the next release…" on every project (answered or not, no 5-item gate), same QuickPick with current pins ticked; plus a row-menu checkbox "Blocks next release" (`act:"block"`, validated as a known act on an integer id, `boardPanel.ts:138`) for one item. The command-palette "Mark this document" stays.

### (4) Migration
Never-answered projects keep today's rule exactly, so nothing turns non-red silently on upgrade. The first visible change is the strip in projects with more than 5 red items. Existing pins carry over as answers' pre-ticked items. Changelog line: "Red now means 'you marked it as blocking the next release'. The board asks per project."

### (5) Edge cases
- New items after answering: they are not red. A new extreme or critical candidate (not pinned, not in `seen`) brings the strip back listing only the new ones ("2 new critical items since you chose"). New high items do not.
- Flagged item later closed: it is no longer an open item, so not red, not counted. The pin stays in the file (harmless, keeps the file small enough under the cap); if the document reopens it is red again. A renamed or moved document loses its pin (keys are paths, as today).
- Zero flags by choice: `answered` with no pins means nothing blocks; light can be GO if health passes; never re-asked except for new extreme/critical items.
- Multi-root: marks are per workspace (storage) and the shared file is read from the first folder only (`boardMarks.ts:36`), as for pins today. Project ids key the answers, so two roots do not collide. The same project opened in another workspace is asked again unless the marks are exported.
- Since-you-left: answering would list dozens of "cleared" blockers (`sinceLast.ts:134-196`). The save re-baselines that project's since-last record.
- Blocked-folder documents (collapsed waiting count): in answered projects they block only if pinned.

### (6) Build plan (2 PRs)
- **PR 1, model and drawing** (no prompt yet; behavior identical for every project until an answer exists). `answered` field, caps and the tri-state pin fix in `marks.ts`; `BoardItem.blocks`; every consumer in the table switched to `blocks`; answered-project wording; editor colors; en.json wording. Tests: parse/merge/fit of `answered` with caps equal on read and write (5000 marks refused on write, 5001st not silently lost); local `pinned:false` beats shared pin; never-answered model equals today's model for the existing fixtures (snapshot of `blocks`, light, counts); answered project: unflagged red-status and critical items not red, pinned red, zero pins gives GO with clean health; handoff why/count text; Gantt row status; sidebar count; path-to-go stoppers; row-menu effect line for `data-ab`; real `ReleaseBoardPanel` render through the entry point (review rule).
- **PR 2, prompt and toggles.** Strip render and trigger, `blockersAsk`/`block` messages with validation, QuickPick, single write, Undo, kebab "ask again", new-critical re-ask, since-last re-baseline. Tests: strip only when >5 candidates and not answered, only inside the expanded section HTML, escaped; message refused on wrong rev, non-integer, out-of-range index, unknown act; save with zero picks marks answered; Undo restores both pins and answer; failed write leaves file unchanged and no Undo; new critical brings strip back, new high does not; 1000 projects with 5 candidates each builds within budget (best-of-3, generous).

### (7) Risks and owner decisions
- Risk: an answered project stops showing a new real blocker that is only "high". Covered for extreme/critical by the re-ask; high relies on the owner. Accept.
- Risk: two rules on one board (answered vs not) can confuse. Mitigation: project tooltip says which rule applies ("Red = items you marked" / "Red = red folders and severity at Deliberate"). Accept.
- Risk: renaming "pinned as critical" changes wording users know; the command name changes too. Accept.
- Decision A: **"Not now" behavior.** (a) Nothing stored, strip shows again on next open (Recommended: the owner wants an answer, and the strip is quiet and only in opened projects). (b) Store "skipped", never show again until "ask again".
- Decision B: **What counts toward "more than 5".** (a) Items that would be red today, red folders included (Recommended: that is the inflation the owner saw; severity alone misses bug folders). (b) High severity and above only, as worded.
- Decision C: **Dot for unflagged red-folder items.** (a) Amber ◆ with its status word ("Address now") (Recommended: red stays reserved for blockers). (b) New fourth color for "serious, not blocking".
- Decision D: **Re-ask on new items.** (a) Only for new extreme or critical items (Recommended: rare, and must not be missed). (b) Never; owner uses "ask again".

### Build notes: blocks-release flag (2026-11-02, two commits on the branch, not merged)

Built as the design says: PR 1 (`blocks` on every item, `answered` and `seen` in the marks file, equal caps, tri-state pin, consumers switched) and PR 2 (strip in the Board card and the Gantt section, project-menu "Choose what blocks the next release…", row-menu checkbox, host QuickPick with one write, Undo, rev-checked and id-only messages, since-last re-baseline of the answered project).

Deviations and skipped items:
- Editor links (`board/editorLinks.ts`) change only in answered projects (red when `blocks`, amber otherwise); in never-answered projects an amber item that stops under the profile stays amber there, as before, so nothing changes silently.
- "Resolve now" and "Work on" lists, and Group by status, use one lane rule (`laneOf`): answered projects put marked items in Resolve now and unmarked red-folder items in Work on; other projects are unchanged.
- Gantt rows for unmarked red-folder items draw amber and use the amber word ("Review next"); the amber diamond with the word "Address now" is on the Board tab pill and hover card.
- Not done: the profile-switch preview line "N projects use your marks; the profile does not change them"; the project tooltip saying which rule applies; the `whyRed` / `stTip.red` / `effFixed` wording (still says "red folder or pinned" for never-answered rows). The en.json wording changed only for the pin (`markPin`, `panel.pinned`, `why.pinned`).
- A pin that comes from the rules file's `pinned` globs shows ticked in the picker but cannot be unticked there (only hand marks are written).
- Undo restores marks and the answer; it does not restore the since-last baseline.
- The row-menu checkbox only toggles the pin; it does not mark the project answered.
- Not done: headless render of the strip at narrow widths (no browser here).


### Review verdict (blocks flag) (2026-11-02, Sonnet diff review, findings only)

Verdict: pass, no data-loss or security finding; no second round needed. Full unit run: 5351 pass, 0 fail (exit 0).

Checked and fine: every consumer in the spec table changed (boardModel, menus, assets, rows, gantt, groups via `laneOf`, sidebar, pathToGo, handoff, editorLinks; tidy untouched by design). Marks file is backward compatible (old files get `answered: {}`; old readers ignore `answered` and read `pinned:false` as unset). Caps are equal on read and write (`MAX_ENTRIES`, `fitMarks` refuses over-cap). Never-answered projects keep today's `blocks`. One `updateLocalMarks` write; a refused write is detected (`answered.at !== now`) and gives no Undo. `blockersAsk` is rev-checked (boardPanel.ts rev guard), integer-checked, range-checked by model lookup; `scopeMenu ask` limited to project scope; row `block` is id-only. Strip text is escaped; `role=group` with `aria-label` is valid; all new keys are in en.json. Tests drive the real `openBoard` panel.

Findings:
- Low: `blockersAsk.ts` applyAnswer, fresh branch `[...old, ...left].slice(0, MAX_SEEN)` drops the newest unpicked paths once 200 are stored, so those critical items re-trigger the strip each time. Fix: keep the last 200 (`slice(-MAX_SEEN)`).
- Low: `boardBlockers.ts` toggleBlock: for an item pinned only by a rules-file glob, the checkbox writes `pinned:false` locally, verification passes, and the Undo bar says "no longer marked" while the item stays pinned. Known deviation; show nothing or skip the write when the pin is not a hand mark.
- Low: row-menu checkbox does not mark the project answered (known; a pin in a never-answered project with a red folder elsewhere still leaves the old rule active).
- Low: skipped spec items (profile-switch preview line, project rule tooltip, `whyRed`/`stTip.red`/`effFixed` wording) remain open and are recorded in Build notes.
- Info: `data-proj` count adds `blockedStopping` unconditionally; correct only because answered projects never count it (boardModel `!answered` guard). Keep that coupling in mind.

## Design: ordering questions (design review, 2026-11-02, nothing built)

Owner request: the Gantt needs precedence and dependencies; ask which item comes before which; severity matters, not only order; must work with 1000+ projects. Already confirmed: questions cover blocks-flagged items only; folders first, then items inside the top folder only; Skip allowed; answers are inferred transitively (A before B and B before C give A before C) and inferred rows are marked and can be overridden. "Folder" below means the board group an item is in (`BoardItem.group`, `board/groups.ts:3-9`), the unit the concurrent collapsed-groups work draws.

### (1) Existing mechanism and where answers go
- Dependencies today come from `Needs:` lines in the document text (`board/docNeeds.ts:52-71`) plus accepted link suggestions kept in the marks file (`MarksFile.needs`, `board/marks.ts:25-26`, merged in `board/boardModel.ts:201-205`). Open links become `BoardItem.waitsOn` (`boardModel.ts:218-228`). The Gantt turns `waitsOn` into ranks, one slot per rank, loops cut where they close (`board/ganttModel.ts:75-100,139-177`); `after`/`waits` are only copies for drawing and tooltips (`ganttModel.ts:173-174`).
- The row chain controls (◀ ▶, Alt+Left/Right, drop on a Waits-on slot; `board/boardHtmlDrag.ts:36-40,76-80`) write a `Needs:` line **into the document** (`views/boardPanelEdits.ts:202-205` via `changeNeeds`). `waitsOn` is also read by path-to-go (`board/pathToGo.ts:113,164`) and the handoff "Waits on" line (`board/handoff.ts:153,168`, `board/handoffMarkdown.ts:62-63`).
- The Board-tab row order is a separate per-project path list in the rules file (`board/boardOrder.ts:3-9`, cap 500); the Gantt applies it inside groups (`ganttModel.ts:102-117`).
- Recommend: answers are stored **in the marks file, never in document text** (asking must not rewrite the owner's documents). New field `order: Record<projectId, { pairs: [first, second][]; skipped: [a, b][]; folders: [first, second][] }>` (paths, folder group ids). Same file, same one-write `updateLocalMarks`, same damaged-file reader, team export, and the read/write cap rule (`marks.ts:44-52`): 500 pairs, 200 skipped, 100 folder pairs per project, `MAX_ENTRIES` projects, all enforced in `parseMarks` and in the setter. Not `MarksFile.needs`: those feed handoff and path-to-go as hard dependencies, and an order answer is a preference, not "cannot start until".
- Answers feed a new `BoardItem.after: number[]` (open items only, transitive reduction of the answered order: only the adjacent asked pairs, which are always asked pairs, never inferred ones). `ranks()` reads `waitsOn` and `after` together; handoff and path-to-go keep reading `waitsOn` only. A row-menu entry "Make this a real dependency" turns one asked pair into a `Needs:` line through the existing chain write, so the document changes only when the owner says so.

### (2) Question flow
- Trigger, lazy: computed in `buildProject` over items already built. A project qualifies when it is answered for blockers, has 2 or more flagged open items, and some pair of them has no order (asked, inferred, `Needs:`, or skipped). Strip inside the project's Board card and Gantt section, drawn by the same `askStrip` pattern (`board/boardHtmlAsk.ts:7-19`), shown only when the blockers strip is not (one strip at a time). Text: "4 blockers have no order yet. Which comes first? [Order 5] [Not now]". Tooltip: "Up to 5 quick questions. Answers only change the board's order; your documents are not edited." Never-answered projects get no ordering strip.
- Order 5: page sends `{type:"orderAsk", p:<project index>, rev}`, handled like `blockersAsk` (`views/boardPanel.ts:50` rev check, `:143` integer check, range checked by model lookup). The host builds every question from its own model; no path or title comes from the page.
- Each question is the host's own QuickPick (single pick, `ignoreFocusOut`), title "Which should be done first? (2 of 5)". Items: title A (description: severity word and folder; detail: path), title B, "Skip this pair". Folder questions read "Which folder's blockers come first?" with the folder name and its blocker count.
- The batch is at most 5 questions; each next question is chosen after the previous answer, in memory. Escape ends the batch early; the answers given so far are kept. The whole batch is one `updateLocalMarks` write, then the existing Undo bar (`offerUndo`, `views/boardPanelEdits.ts:166`) restores the project's `order` entry in one write, labelled "Undo: 4 order answers in <project>". A refused write (file too big) shows the existing error and no Undo, detected as in `commands/boardBlockers.ts:61-64`.
- Skip: the pair is stored in `skipped` and not asked again; the next question moves on. "Not now": nothing stored, strip back on next open (same as blockers decision A).
- Ask again: project menu "Order the blockers…" (no gate) clears `skipped` and runs a batch. Row menu (Gantt and Board, `act:"order"` on an integer id, validated as a known act like `block`): "Ask where this goes…" removes that item's asked pairs and re-inserts it with fresh questions. Row menu "Forget order answers for this item" removes them with Undo.

### (3) Asking few questions
- Prior order = severity (extreme first), then flagged items others wait on (`blocksCount`, `boardModelParts.ts:57`), then path. Before any answer, flagged rows of a rank are drawn in this prior order (no edges), so the Gantt is useful with zero answers.
- Insertion with a severity first guess: items are placed one at a time in prior order into the answered list. The first question for a new item compares it with the item its severity would put it right after; if the owner agrees, it is placed (1 question). If not, binary search over the side the answer points to (at most log2 of the list length more). Any pair already decided by `Needs:`, an earlier answer or transitivity is never asked. Result: about N-1 questions for N items when the owner agrees with severity, at most about N·log2 N when not (10 items: 9 to about 25, so 2 to 5 batches), against 45 pairs for all of them.
- Question order: most severe unplaced item first, so the first batch settles the top of the list, which Up next and the first Gantt slots show.
- Folders first: when flagged items span 2 or more folders, the same insertion runs over folders (prior = most severe item in the folder, then blocker count); folder answers only order the folder sections and the Up next fill, they make no item edges. Then items are asked inside the top folder only; the next folder's items are asked only once the top folder has no unordered pair (or all were skipped).

### (4) Asked versus inferred in the Gantt
- `GanttRow` gets `afterSrc: ("needs" | "asked")[]` beside `after`, and `inferred: string[]` (titles of the items this row is after only by transitivity). Tooltip lines: "After X (Needs line)", "After X (you said)", "Also after Y, Z (follows from your answers)". A row whose place comes only from inference (no asked or Needs edge of its own, but ordered through others, e.g. an item across a folder line) draws a dotted chain glyph with aria-label "Order inferred from your answers; open the row menu to change it". Override = the row menu "Ask where this goes…".
- Rows with no order at all (unasked, skipped) keep no glyph, so "no order" never looks decided.

### (5) Cycles and stale answers
- Questions never create a cycle: a pair already decided either way is not asked. A cycle can only appear when a `Needs:` line is added later or "Ask where this goes…" contradicts older answers. Rule: `Needs:` lines win over answers; among answers the newest wins. The losing answers on the loop are dropped at the next write and named in that write's Undo label. Until then `ranks()` keeps cutting the loop where it closes (`ganttModel.ts:76-99`), so nothing breaks.
- Closed item: its pairs are ignored (not deleted), so a reopened item keeps its place; transitivity through a closed item still holds (A before closed B before C still gives A before C). Unflagged item: answers still apply while both items are open; it is just not asked about. Renamed or moved document: its answers are lost (keys are paths, same as pins); pairs whose path is no longer a document are dropped on the next write (as `boardOrder.ts:5`). Folder renamed or regrouped: folder pairs keyed by group id that no longer exists are ignored and dropped on the next write; worst case one folder question is asked again.

### (6) Build plan (2 PRs)
- **PR 1, model and drawing** (no questions yet; identical board for every project with no `order` entry). `order` field with parse, merge (local over shared), caps equal on read and write; pure `board/orderAsk.ts`: closure, transitive reduction, next-question choice (severity guess then binary search), cycle resolution; `BoardItem.after`; `ranks()` reads `after`; prior order for flagged rows; `afterSrc`/`inferred` on `GanttRow` and the tooltip and glyph. Tests: parse/fit caps (501st pair refused on write, not lost on read); no `order` gives today's Gantt for the existing fixtures; A<B, B<C infers A<C and never asks it; 10 items in agreeing severity order ask 9 questions; worst case stays under N·ceil(log2 N); `Needs:` beats a contradicting answer, newest answer beats older; closed item keeps transitivity; renamed path dropped on write; handoff and path-to-go unchanged by answers; tooltip text escaped; real `ReleaseBoardPanel` render through the entry point.
- **PR 2, questions.** Strip and trigger, `orderAsk` and row `order`/`forgetOrder` acts with validation, the QuickPick batch, Skip, folder-first selection, one write per batch, Undo, project-menu ask again, "Make this a real dependency". Tests: strip only for answered projects with 2+ unordered flagged items, only inside the expanded section, escaped, not shown with the blockers strip; message refused on wrong rev, non-integer, out-of-range index, unknown act; Escape after 2 answers saves 2 in one write; Skip not asked again until ask again; Undo restores the order entry; refused write leaves the file and offers no Undo; folders asked before items, and only the top folder's items; 1000 projects with 10 flagged items each build within budget (best-of-3, generous).

### (7) Risks and owner decisions
- Risk: the Gantt's slot width is one global rank count (`ganttModel.ts:143-144`), so one project with a 15-step ordered chain narrows every bar on the board. Accept for now; a per-section slot count is a separate change.
- Risk: three sources of "after" (Needs, accepted suggestion, answer) can confuse. Mitigation: the tooltip names the source of each. Accept.
- Risk: owner disagrees with severity often, so questions run near N·log2 N. Bounded by the top-folder rule and batches of 5. Accept.
- Decision E: **What an answer means.** (a) Order only: Gantt and Up next follow it; handoff and path-to-go do not call it "waits on"; a row-menu entry makes one answer a real `Needs:` line (Recommended: a preference is not a hard dependency, and documents are never edited by a question). (b) Answers are full dependencies, stored in `MarksFile.needs`, shown everywhere `waitsOn` is.
- Decision F: **Skip.** (a) Stored; the pair is not asked again until "Order the blockers…" (Recommended: otherwise the same question leads every batch). (b) Not stored; asked again next open.
- Decision G: **Question shape.** (a) Pairs ("Which first: A or B?") with severity guess and binary search (Recommended: what the owner asked for, one easy choice per question). (b) "Which of these comes first?" over up to 5 items, picked repeatedly (fewer clicks, more reading per question).
- Decision H: **Order across folders.** (a) Folder answers order sections and Up next only, no item edges (Recommended: keeps the Gantt from turning into one long serial chain). (b) Every item of the first folder comes before every item of the next.


### Build notes: ordering questions (2026-11-02, two commits on the branch, not merged)

Built as designed: PR 1 (`order` field of the marks file with equal caps 500/200/100 on read and write, `board/orderAsk.ts` pure logic, `board/orderModel.ts` attaches `BoardItem.after`/`inferred` and `BoardProject.folderRank`/`orderAsk`, `ranks()` reads `after` with `waitsOn`, prior order for answered blockers, Up next skips an item after an open one and follows folder rank, tooltip lines "(you said)" and "follows from your answers", dotted chain mark) and PR 2 (strip, `orderAsk` message, project menu "Order the blockers...", row menu "Ask where this goes..." and "Forget order answers", pair QuickPick with Skip, batch of at most 5, one write, one Undo). Tests written, not run: `test/board/boardOrderModel.test.ts`, `test/board/boardOrderAsk.test.ts`.

Deviations and not built:
- Built later (2026-11-02): row-menu entry "Make this a real dependency" (`makeDep` act; shown only on rows with an asked answer, `data-oa`; candidates from `item.after` of the painted model; several answers ask which; one `Needs:` write and one Undo through the chain write; no preview; the answer stays and `Needs:` wins; not offered for documents whose Needs lines the board does not read). Handoff and path-to-go stay unchanged by design. Tests written, not run.
- Built later (2026-11-02): per-project Gantt slot width (`buildSplit` counts ranks per project; bar share still uses the board-wide longest bar, so proportions inside a section are unchanged). Skipped: in the Unified layout rows of different projects sit on their own project scales, so sorting by start there mixes scales; accepted, Unified already sorts blockers first.
- The dotted chain mark shows on any row that follows an open item only through others' answers (`inferred` not empty). Folder answers make no item edges (decision H), so the "ordered across a folder line" case does not arise.
- Rows with an asked pair show one tooltip line per source; Needs keeps the existing "Waits on" line, asked pairs add "After X (you said)".
- Order is asked only for answered projects with at least two blocking items; the strip text counts the items the open question is about (all of them while folders are being ordered, else the folder in turn).
- Item questions run over at most 200 flagged items per project (`MAX_ORDERED`).
- A batch that is dismissed at the first question saves nothing, including the forgotten answers of "Ask where this goes...".
- Dropped answers (lost to a Needs line, a newer answer or a removed document) are dropped on the next write and counted in that write's Undo label; Undo restores the whole entry.
- Not done: headless render of the strip at narrow widths (no browser here); no test run (machine safety).

### Build notes: blocks-flag leftovers (2026-11-02, commit 1 of the finish pass)

Done: (a) mode menu note "{count} project(s) use your marks; the mode does not change them" (shown in the scope-and-mode menu, where the mode is chosen, when a project is answered). (b) Project name tooltip adds the rule (`ruleMarks` or `ruleAuto`). (c) `whyRed` now says the red folder blocks; new `whyRedUnmarked` for an answered project; `effFixed` says "its folder is red or you marked it". `stTip.red` unchanged (it was already neutral). (d) The row checkbox, when turning a mark on in a project not yet answered, also records the answer with an empty `seen`; Undo restores both. Side effect: the other critical items of that project then count as new and the strip may ask about them. (e) A rules-file pin is listed ticked with "Pinned by the rules file, change it there" and is never written. Deviation: the VS Code list cannot disable a row, so the row can be unticked but the change is ignored. (f) Gantt unmarked red-folder rows draw amber with the word "Address now" (`GanttRow.serious`). (g) `MAX_OUTLINED = 10`: only the first ten changed rows in display order get the outline; every changed row keeps its tooltip.

### Build notes: Option B step 2 (2026-11-02, commit 2 of the finish pass)

Built: `upNext(model, 5)` in `ganttModel.ts` (in progress first; then red items that wait on nothing; each part by blocks-count, severity, shortest with an unknown length counted as 30 minutes, then project and path; nothing is padded in, so a board with no free blocker shows no Up next). The box sits above the Gantt with the tooltip "Picked because: ..." per row; the "N in progress" pill is amber past `WIP_LIMIT` = 3 (no setting). Each Up next item keeps its project row and gets a small "Up next" tag there.

Sections: `layoutFor(model.items.length)` and `openGroups` decide which sections start open and the first-view row limit (bands 2 and 3: 3 open, 5 rows; band 4: 3 open, 3 rows; band 1: 8 rows; band 0: everything open). The 150-row cap stays as the hard limit when a section has no limit. Closed sections are rendered with all their first-view rows, hidden by CSS, so drop slots and move arrows exist in them; a dragged row held over a closed section or group header opens it after 350 ms (not remembered). Header: name, light, "N open - M block" (red part only when M > 0); the old footer light and the collapsed summary line are gone. The user's own open or close is kept in the page state (`gcol` closed, `gopen` opened), so a remembered choice beats the default either way.

Group sub-headers (un-deferred): each project's open rows are ordered as finished rows, ungrouped rows, then each automatic folder group together (groups with a blocker first). Each group has a closed sub-header with "N open - M block". Group rows are hidden until opened, and a flat project (`group.flat`) shows no sub-headers. Not in the Unified layout (its single list has no per-project groups).

Deviations and limits:
- The row limit counts finished and ungrouped rows only; a project whose rows are all in groups draws up to 150 rows (all folded) before "Show more".
- Finished rows follow the layout band: all, the last two, or none; a dim line says how many are left out (`ganttFinishedCut`).
- No hysteresis on the band (the Gantt uses `layoutFor` on the item count each render); the per-project Board tab layouts keep theirs.
- No headless render at 5, 59 and 300 documents in dark, light and narrow (no browser here).
- Changed-row outline limit and everything from commit 1 stay as recorded above.

## Review verdict (Up next) (2026-11-02, Sonnet diff review, findings only)

Checked and fine: Up next rule, order, cap 5, no duplicates, rule tooltip per row (`ganttModel.ts` upNext, `boardHtmlGantt.ts` upNextBox); amber pill past 3; closed project headers show the red block count; at most 3 open via `layoutFor`/`openGroups`; 5 rows plus "Show N more"; sub-headers with red count; rows of closed sections keep their drop slot and move arrows; all interpolated values pass `escapeHtml`/`tip`/`titleAttr`; ARIA (`aria-expanded` buttons, `aria-controls` target exists, region has `aria-labelledby`); every new key in `en.json` and in `boardStringsPolish.ts`; removed key `ganttOpen` has no remaining consumer; tests go through `ganttPanel`/`buildBoard`. No new webview message was added (Show more path unchanged: rev and ids as before).

Findings:
- Medium: decision 7(b) not implemented as written. `ganttModel.ts` (MAX_OUTLINED) outlines the first 10 changed rows in list order, not the changed rows in Up next, and no changed-count appears on project headers. Fix: prefer Up next rows when over 10, and add the count to the header, or record the deviation.
- Low: `boardHtmlGantt.ts:68` drag-open: `pend` is not cleared on drop or dragend, so after a drop on a closed header the next drag over that same header never opens it. Clear `pend` on `dragend`/`drop`.
- Low: `firstRows` (`boardHtmlGantt.ts` ~130) puts group sub-headers after the plain rows; when plain rows exceed the limit, a group with a blocker sits behind "Show more". The project header still shows the red total, so no blocker is hidden, but the sub-header red count is not visible until Show more.
- Low: spec step "headless render at 5/59/300 documents" and a dark/light/narrow check are not evidenced (no browser); unchanged from step 1.

### Review verdict (ordering) (2026-11-02, read-only, nothing run)

Passes: marks `order` is additive (old files parse to `{}`; `emptyMarks`, `fitMarks`, `parseMarks`, `mergeMarks`, `answeredExtra` and all three `buildBoard` callers updated; test literal updated); caps 500/200/100 equal on read (`parseOrder`) and write (`orderOverCap` in `fitMarks`); Needs win over answers and newest answer wins (`settle`); loops cut by `ranks()` visiting guard; severity is the prior order; batch is 5 and insertion is binary; one `updateLocalMarks` write and one Undo; Escape keeps answers; `{orderAsk,p,rev}` passes the common rev check, integer check and model index lookup, ids only; strip, glyph and tooltips escape; ARIA valid; all en.json keys present; no other consumer of `waitsOn` reads `after`.

Findings:
- Medium (data loss of answers, not of documents): `orderModel.ts:12` `folderOf` returns "" for ungrouped items, and `orderAsk.ts:44` `okId` rejects empty ids on read. A folder answer naming the ungrouped folder is written, then dropped on the next read; the `same` check in `commands/boardOrder.ts:56` then fails, so the write is reported as refused (no Undo) and the question is asked again forever. Fix: key ungrouped as a non-empty id (e.g. "none") on write and read.
- Medium: `skipped` has no guard like `MAX_PAIRS`/`MAX_FOLDER_PAIRS` in `nextQuestion`; the 201st skip makes `fitMarks` refuse the whole batch (all answers of that batch lost, shown as a failed write). Stop asking (or drop oldest skips) at the cap.
- Low: "Forget order answers" and "Order again" read merged marks (`boardOrder.ts:78,100`) but write local; an entry that lives only in the shared file cannot be forgotten (local delete, shared still read).
- Low: folder pairs whose group no longer exists are not dropped on write (`tidyOrder` only settles them); spec says dropped. Folder-skips are kept without a known check.
- Low: the project-menu "Order the blockers..." entry is not hidden on group headings (`boardHtmlAssets.ts:142` hides only `ask`); the host ignores it silently.
- Low: the dotted chain mark shows for any inferred row, not only rows with no asked/Needs edge of their own (recorded deviation).
- Tests: use real entry points (`buildBoard`, `renderBoard`, openBoard with real marks files); none covers the ungrouped-folder round trip or the skipped cap. Not run.

Decision: fix the two Medium findings before merge (one round, per repo policy); Low items fixed in the same round or dropped.
