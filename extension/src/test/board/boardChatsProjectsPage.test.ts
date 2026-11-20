// The chat controls and the project controls of the board page, run for real: CHATS_SCRIPT and PROJECTS_SCRIPT execute
// in the fake DOM against the markup their own renderers draw. The existing activeNow and umbrellaView tests cover
// the model and substrings of the markup; these cover what the page does with a click (the message it posts, the
// state it saves), that the notice bar removes itself on the virtual clock and not before, and that names from
// project folders, which the owner does not control, never become markup.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CHATS_SCRIPT, activePill, noticeBar, pollPill } from "../../board/boardHtmlChats";
import { PROJECTS_SCRIPT, isUmbrella, label, openBadge, rollupBar, rollupCounts, skippedBlock } from "../../board/boardHtmlProjects";
import { pl } from "../../board/boardHtmlUtil";
import type { BoardModel, BoardProject } from "../../board/boardModel";
import type { FakeElement, Page } from "../_stub/fakeDom";
import { EVIL, REV, isHidden, openBoardPage, t } from "./boardWebviewFixture";

const NOTICE_MS = 6000;

function chatPage(paused: boolean | undefined, notice: string | undefined): Page {
  const page = openBoardPage(`${noticeBar(notice)}${pollPill(paused, t)}`);
  page.run(CHATS_SCRIPT, "board-chats.js");
  return page;
}

test("the pause and play pill posts one chat-poll message with the revision and nothing else", () => {
  const page = chatPage(false, undefined);
  page.click(page.one("[data-chat-poll]"));
  assert.deepEqual(page.takePosted(), [{ type: "chatPoll", rev: REV }]);
});

test("the pill is absent when the feature is off, and the script runs without it", () => {
  const page = chatPage(undefined, undefined);
  assert.equal(page.all("[data-chat-poll]").length, 0);
  assert.deepEqual(page.posted, []);
});

test("the pill's name, glyph and tooltip follow the paused state", () => {
  const running = chatPage(false, undefined).one("[data-chat-poll]");
  const paused = chatPage(true, undefined).one("[data-chat-poll]");
  assert.equal(running.getAttribute("aria-label"), pl(t, "chatPause"));
  assert.equal(paused.getAttribute("aria-label"), pl(t, "chatResume"));
  assert.equal(running.getAttribute("title"), pl(t, "chatPause"));
  assert.notEqual(running.textContent, paused.textContent, "the glyph changes with the state");
  assert.ok((running.getAttribute("aria-label") ?? "").length > 0, "an icon-only button needs a name");
});

test("the notice bar removes itself after six seconds of page time and not a moment before", () => {
  const page = chatPage(undefined, "Two chats ended");
  assert.equal(page.all("#notice").length, 1);
  page.timers.advance(NOTICE_MS - 1);
  assert.equal(page.all("#notice").length, 1, "still shown just before the limit");
  page.timers.advance(1);
  assert.equal(page.all("#notice").length, 0);
});

test("a page with no notice sets no timer", () => {
  const page = chatPage(false, undefined);
  assert.equal(page.timers.pending, 0);
});

test("the notice is a status region whose text and tooltip are the same escaped message", () => {
  const page = openBoardPage(noticeBar(EVIL));
  const bar = page.one("#notice");
  assert.equal(bar.getAttribute("role"), "status");
  assert.equal(bar.textContent, EVIL);
  assert.equal(bar.getAttribute("title"), EVIL);
  assert.equal(page.all("img").length, 0);
  assert.equal(noticeBar(""), "", "an empty message draws no bar");
});

test("the active pill is drawn only for an active project and carries its tooltip", () => {
  assert.equal(activePill(false, t), "");
  const pill = openBoardPage(activePill(true, t)).one(".active");
  assert.equal(pill.textContent, pl(t, "chatActive"));
  assert.equal(pill.getAttribute("title"), pl(t, "chatActiveTip"));
});

// The control strip of the umbrella view, as the board paints it around the model-driven parts.
const CONTROLS = `
<button type="button" data-projects>Projects</button>
<button type="button" data-fclear="time">Time</button><button type="button" data-fclear="have">Have</button><button type="button" data-fclear="all">All</button>
<button type="button" data-more="since" aria-pressed="false">Since</button><div id="more-since" hidden></div>
<button type="button" data-more="other" aria-pressed="false">Other</button><div id="more-other" hidden></div>
<button type="button" data-since-go>Go</button><details id="since-box"></details>
<button type="button" data-since-dismiss>Dismiss</button>`;

function projectsPage(extra = "", state?: unknown): Page {
  const page = openBoardPage(CONTROLS + extra, { state });
  page.run(PROJECTS_SCRIPT, "board-projects.js");
  return page;
}

const sitCalls = (page: Page): unknown[] => page.evalJson("SITCALLS") as unknown[];
const lastState = (page: Page): Record<string, unknown> => page.states[page.states.length - 1] as Record<string, unknown>;
const pressed = (el: FakeElement): string | null => el.getAttribute("aria-pressed");

test("the Projects button posts a bare projects message with the revision", () => {
  const page = projectsPage();
  page.click(page.one("[data-projects]"));
  assert.deepEqual(page.takePosted(), [{ type: "projects", rev: REV }]);
});

test("clearing a filter sends only the part it clears: time resets the box, a context filter selects every context", () => {
  const page = projectsPage();
  page.click(page.one('[data-fclear="time"]'));
  page.click(page.one('[data-fclear="have"]'));
  page.click(page.one('[data-fclear="all"]'));
  assert.deepEqual(sitCalls(page), [{ box: "any" }, { have: ["a", "b"] }, { box: "any", have: ["a", "b"] }]);
});

test("a more panel opens on its button, shows exactly one panel, and the choice is saved in the page state", () => {
  const page = projectsPage();
  const since = page.one('[data-more="since"]');
  const other = page.one('[data-more="other"]');
  assert.equal(isHidden(page.byId("more-since")), true, "all closed at the start");
  page.click(since);
  assert.equal(pressed(since), "true");
  assert.equal(isHidden(page.byId("more-since")), false);
  assert.equal(isHidden(page.byId("more-other")), true);
  assert.equal(lastState(page).moreOpen, "since");
  page.click(other);
  assert.equal(pressed(since), "false", "opening another closes the first");
  assert.equal(pressed(other), "true");
  assert.equal(isHidden(page.byId("more-since")), true);
  assert.equal(lastState(page).moreOpen, "other");
});

test("pressing the open panel's button again closes it and saves the closed state", () => {
  const page = projectsPage();
  const since = page.one('[data-more="since"]');
  page.click(since);
  page.click(since);
  assert.equal(pressed(since), "false");
  assert.equal(isHidden(page.byId("more-since")), true);
  assert.equal(lastState(page).moreOpen, "");
});

test("a reloaded page reopens the panel it had open, and keeps the rest of its saved state", () => {
  const page = projectsPage("", { moreOpen: "other", scroll: 40 });
  assert.equal(pressed(page.one('[data-more="other"]')), "true");
  assert.equal(isHidden(page.byId("more-other")), false);
  assert.equal(isHidden(page.byId("more-since")), true);
  assert.equal(lastState(page).scroll, 40, "state kept by other parts of the page survives");
});

test("a panel flagged with a new auto value opens once, and is not forced open again for the same value", () => {
  const auto = `<button type="button" data-more="news" data-auto="v1" aria-pressed="false">News</button><div id="more-news" hidden></div>`;
  const first = projectsPage(auto);
  assert.equal(pressed(first.one('[data-more="news"]')), "true");
  assert.deepEqual((lastState(first).moreAuto as Record<string, string>), { news: "v1" });
  const reload = projectsPage(auto, { moreAuto: { news: "v1" }, moreOpen: "" });
  assert.equal(pressed(reload.one('[data-more="news"]')), "false", "the owner closed it; the same value does not reopen it");
  const changed = projectsPage(auto, { moreAuto: { news: "v0" }, moreOpen: "" });
  assert.equal(pressed(changed.one('[data-more="news"]')), "true", "a new value opens it again");
});

test("the Since go button switches to the board tab, opens the Since panel and its box", () => {
  const page = projectsPage();
  page.click(page.one("[data-since-go]"));
  assert.deepEqual(page.evalJson("SHOWTAB"), ["board"]);
  assert.equal(pressed(page.one('[data-more="since"]')), "true");
  assert.equal((page.byId("since-box") as unknown as { open: boolean }).open, true);
});

test("the Since dismiss button posts a bare dismiss message with the revision", () => {
  const page = projectsPage();
  page.click(page.one("[data-since-dismiss]"));
  assert.deepEqual(page.takePosted(), [{ type: "sinceDismiss", rev: REV }]);
});

const project = (light: string, extra: Record<string, unknown> = {}): BoardProject => ({ light, ...extra }) as unknown as BoardProject;
const model = (projects: BoardProject[], skipped?: Array<{ name: string; reason: string }>): BoardModel => ({ projects, skipped }) as unknown as BoardModel;

test("roll-up counts put every unknown light with the unverified ones", () => {
  assert.deepEqual(rollupCounts([project("no-go"), project("go"), project("go"), project("maybe"), project("")]), { noGo: 1, go: 2, unverified: 2 });
  assert.deepEqual(rollupCounts([]), { noGo: 0, go: 0, unverified: 0 });
});

test("a board is an umbrella view from a second project or from one unreadable folder, never from a single project", () => {
  assert.equal(isUmbrella(model([project("go")])), false);
  assert.equal(isUmbrella(model([project("go"), project("go")])), true);
  assert.equal(isUmbrella(model([project("go")], [{ name: "x", reason: "missing" }])), true);
  assert.equal(isUmbrella(model([])), false);
});

test("the roll-up bar is a status region that counts projects by light, leaves empty lights out, and counts unreadable folders apart", () => {
  const page = openBoardPage(rollupBar(model([project("no-go"), project("go"), project("go")], [{ name: "x", reason: "missing" }]), t));
  const bar = page.one(".roll");
  assert.equal(bar.getAttribute("role"), "status");
  // Read the class lists rather than selecting ".go.go": every light carries the class "go", so that selector matches them all.
  assert.deepEqual(page.all(".roll .go").map((e) => e.className), ["go no-go", "go go", "go skipped"], "an empty light (unverified) is not drawn; unreadable folders are counted apart");
  assert.equal(rollupBar(model([project("go")]), t), "", "a single project has no roll-up");
});

test("the open mark shows only on the open workspace's projects, and only when the board also holds an added one", () => {
  const open = project("go", { extra: false });
  const added = project("go", { extra: true });
  assert.equal(openBadge(open, model([open]), t), "", "no added project, no marks");
  assert.equal(openBadge(added, model([open, added]), t), "", "an added project is not marked");
  const mark = openBadge(open, model([open, added]), t);
  assert.equal(openBadge(open, model([open, added]), t).includes("otag"), true);
  const page = openBoardPage(mark);
  assert.equal(page.one(".otag").textContent, label(t, "open"));
  assert.equal(page.one(".otag").getAttribute("title"), label(t, "openTip"));
});

test("an unreadable folder's name is text everywhere it appears, one grey row each", () => {
  const page = openBoardPage(skippedBlock(model([], [{ name: EVIL, reason: "missing" }, { name: "Second", reason: "big" }]), t, 12));
  assert.equal(page.all(".skip").length, 2);
  assert.equal(page.one(".skip .pn").textContent, EVIL);
  assert.equal(page.all("img").length, 0);
  assert.equal(page.all("script").length, 0);
  assert.equal(skippedBlock(model([]), t, 12), "", "no unreadable folders, no rows");
});

test("a label missing from the table shows its own key, so a gap is visible rather than blank", () => {
  assert.equal(label(t, "no-such-label-key"), "no-such-label-key");
  assert.equal(label({ ...t, projectLabels: undefined }, "open"), "open");
});
