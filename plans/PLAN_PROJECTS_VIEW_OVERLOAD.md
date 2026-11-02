# Plan: Release Board opens as an overwhelming flat list

Status: research done 2026-11-02. Nothing below is decided. Owner decisions are listed in section 7, each with a recommendation.
Related: [PLAN_RELEASE_BOARD_REDESIGN.md](PLAN_RELEASE_BOARD_REDESIGN.md) (decisions 18, 20, 21, 24, 44, 47 and section 18.3.2), [PLAN_RELEASE_BOARD_v2.md](PLAN_RELEASE_BOARD_v2.md).

## Decisions (owner, 2026-11-02)

- Option B chosen; build step 1 now (release freeze lifted; 2.7.0 shipped).
- Header: one scope-and-mode pill (restores decisions 20 and 24); remove the pills that do nothing on the Gantt and the extra "Have: 7 of 8" line.
- Bar minutes: computed from all open steps of the document, so an empty bar means no estimate.
- Unified stays, sorted blockers first. "Up next" fixed at 5 rows, amber past 3 in progress, no setting (step 2, not built yet). Changed-row outlines limited when more than 10 rows changed (step 2).

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
