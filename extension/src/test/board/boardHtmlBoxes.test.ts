// The boxes around the project rows: sittings, tidy, crash signals, trains, linked
// documents, outside sources, the since strip and the profile picker. Each box is built
// from a real model, and each test checks that untrusted text is escaped and that the page
// carries indexes, never paths or URLs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBoard } from "../../board/boardModel";
import { BoardStrings } from "../../board/boardHtmlUtil";
import { viewMenu } from "../../board/boardHtmlMenus";
import { chains, noRuleBox, outsideBoxes, sinceBox, sinceMarks, sittingsBox, tidyBox, trainBox, unnamedBox } from "../../board/boardHtmlBoxes";
import { readFacts } from "../../board/docFacts";
import { ScanSnapshot } from "../../board/scanner";
import { Train } from "../../board/train";
import { BoardConfig, BoardStatus, Classified, emptyCounts } from "../../board/types";

const t: BoardStrings = new Proxy({} as BoardStrings, {
  get: (_o, k: string) =>
    ["sittingsMore", "sittingsTooLong", "sittingsNeedOther", "sittingsUntagged", "tidyDetail", "tidyNote", "tidyMore", "tidyTitle", "timeMinutes", "stepMinutes"].includes(k) ? `${k} {count} {days}` : `[${k}]`,
});

const cfg: BoardConfig = {
  version: 1,
  ignore: [],
  ruleSets: {},
  projects: [{ id: "app", name: "App", path: "app", roots: ["docs/bugs"], ruleSets: [] }],
};

const row = (path: string, status: BoardStatus = "amber"): Classified => ({ project: "app", path, status, kind: "", note: "" });

function snapshotOf(files: Record<string, string>, mtimeMs = 1, grey: Record<string, number> = {}): ScanSnapshot {
  const facts = Object.fromEntries(Object.entries(files).map(([p, text]) => [p, { size: text.length, mtimeMs, facts: readFacts(text, p) }]));
  const cached = Object.fromEntries(Object.keys(files).map((p) => [p, { size: 1, mtimeMs, word: "" }]));
  return { version: 1, takenAt: 1, projects: { app: { counts: emptyCounts(), folders: {}, ruleCounts: {}, greyFolders: grey, files: cached, facts } } };
}

test("the view menu ticks the chosen profile and sends it by name", () => {
  const html = viewMenu(t, "rush");
  assert.ok(html.includes('data-act="profile:rush" aria-checked="true" title="profile.rush">\u2713 [profileRush]</button>'));
  assert.ok(html.includes('data-act="profile:zero" aria-checked="false" title="profile.zero">[profileZero]</button>'));
});

test("the no-rule section always shows: a sentence when empty, a titled list with counts when not", () => {
  const empty = buildBoard(cfg, [], undefined, true);
  const none = noRuleBox(empty, t, new Map(), true);
  assert.ok(none.startsWith('<details class="box" id="norule-box" data-sec="norule" open><summary class="sh" title="noRuleHeading"><h2 title="noRuleHeading"><span class="si" aria-hidden="true">📏</span> [needsRuleHeading] <span class="pill" title="count">0</span></h2></summary>'));
  assert.ok(none.includes('<p class="note">noRuleEmpty</p>'), "one sentence instead of a bare icon");
  assert.equal(none.match(/<details/g)?.length, 1, "one section, open, with nothing hidden inside");
  const m = buildBoard(cfg, [], undefined, true, snapshotOf({}, 1, { "docs/<odd>": 4, "": 1 }));
  const html = noRuleBox(m, t, new Map([["app", "App"]]), true);
  assert.ok(html.includes('<span class="pill" title="count">5</span>'), "the heading counts all documents");
  assert.ok(html.includes("docs/&#60;odd&#62;"));
  assert.ok(html.includes('<span class="f" title="/">/</span>'), "the project root shows as a slash");
  assert.equal(html.match(/data-assign="/g)?.length, 2);
  assert.equal(html.match(/data-preview="/g)?.length, 2);
  assert.equal(html.includes("data-rules"), false, "the rules file is opened from the options menu only");
  assert.equal(html.includes("ptgOpenRules"), false);
  assert.ok(html.includes("[needsRuleNote]"));
});

test("the no-rule section offers no buttons while the board is stale", () => {
  const m = buildBoard(cfg, [], undefined, true, snapshotOf({}, 1, { docs: 2 }));
  const html = noRuleBox(m, t, new Map(), false);
  assert.equal(html.includes("data-assign"), false);
  assert.equal(html.includes("data-preview"), false);
  assert.equal(html.includes("data-rules"), false);
});

test("the no-rule section lists at most 30 folders and counts the rest", () => {
  const grey = Object.fromEntries(Array.from({ length: 33 }, (_x, i) => [`docs/f${i}`, 1]));
  const m = buildBoard(cfg, [], undefined, true, snapshotOf({}, 1, grey));
  const html = noRuleBox(m, t, new Map(), true);
  assert.equal(html.match(/data-assign="/g)?.length, 30);
  assert.ok(html.includes("[more]"));
});

test("linked documents: chains, flags and suggestions, with indexes only", () => {
  const snap = snapshotOf({
    "docs/a.md": "# A\nNeeds: docs/b.md\nNeeds: docs/ghost.md\nSee c.md\n",
    "docs/b.md": "# B\n",
    "docs/c.md": "# C <i>\n",
  });
  const m = buildBoard(cfg, [row("docs/a.md"), row("docs/b.md"), row("docs/c.md")], undefined, true, snap);
  const html = chains(m, t);
  assert.ok(html.startsWith('<details class="box" data-sec="linked" open>'));
  assert.ok(html.includes('class="chain"'));
  assert.ok(html.includes("[flagsHeading]"));
  assert.ok(html.includes("ghost.md: missing"));
  assert.ok(html.includes("[suggestHeading]"));
  assert.ok(html.includes('data-decision="accept"') && html.includes('data-decision="reject"'));
  assert.ok(html.includes("C &#60;i&#62;"));
  assert.ok(!html.includes("<i>"), "a title cannot add markup");
  assert.ok(![...html.matchAll(/data-(?!suggest)[\w-]+="([^"]*)"/g)].some((m) => m[1].includes("docs/")), "no path is a data attribute (a suggestion carries its model key)");
  assert.ok(html.includes('<a class="doc" href="#" data-id="1" title="docs/b.md">B</a>'), "a document is a link whose tooltip is its path");
});

test("without links, flags or suggestions the box is not drawn", () => {
  const m = buildBoard(cfg, [row("docs/a.md")], undefined, true);
  assert.equal(chains(m, t), "");
});

test("outside groups: an item with a link carries group and item indexes, not the URL", () => {
  const m = buildBoard(cfg, [], undefined, true, undefined, undefined, undefined, {
    outside: {
      chats: {},
      groups: [{ id: "g", label: "Reviews <3>", items: [{ title: "Fix it", detail: "repo#1", url: "https://example.com/pull/1" }, { title: "No link" }] }],
    },
  });
  const html = outsideBoxes(m, t);
  assert.ok(html.includes("Reviews &#60;3&#62;"));
  assert.ok(html.includes('data-g="0" data-i="0"'));
  const attrs = [...html.matchAll(/="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(attrs.every((a) => a !== "https://example.com/pull/1"), "no attribute holds the link");
  assert.equal(/\bhref\s*=\s*"(?!#")/i.test(html), false, "the page has no href but the in-page #");
  assert.equal(html.match(/click ext/g)?.length, 1, "only the item with a link is clickable");
});

test("no outside groups, no markup", () => {
  assert.equal(outsideBoxes(buildBoard(cfg, [], undefined, true), t), "");
});

test("the since strip lists each line with its details, escaped", () => {
  const html = sinceBox({ heading: "Since <1h>", marked: [], lines: [{ text: "App: 1 new blocker", details: ["+ Fix <x>", "- Old"] }, { text: "Db: light changed", details: [] }] }, t);
  assert.ok(html.includes('role="status"'));
  assert.ok(html.includes("Since &#60;1h&#62;"));
  assert.ok(html.includes("+ Fix &#60;x&#62;"));
  assert.equal(html.match(/<ul class="sd">/g)?.length, 1);
  assert.equal(sinceBox(undefined, t), "");
  assert.equal(sinceBox({ heading: "h", marked: [], lines: [] }, t), "");
});

test("the since strip has a Dismiss button and an id the header link can open", () => {
  const html = sinceBox({ heading: "h", marked: [], lines: [{ text: "App: 1 new blocker", details: [] }] }, t);
  assert.ok(html.includes('id="since-box"'));
  assert.ok(html.includes("data-since-dismiss") && html.includes("sinceDismiss"));
});

test("rows of documents that became blockers get one static dotted blue outline rule, and no animation", () => {
  const m = buildBoard(cfg, [row("docs/a.md", "red"), row("docs/b.md", "red")], undefined, true);
  const a = m.items.find((i) => i.path === "docs/a.md")!;
  const css = sinceMarks(m, { heading: "h", marked: [`${a.project}/${a.path}`], lines: [{ text: "x", details: [] }] });
  assert.equal(css, `.row[data-id="${a.id}"]{outline:1px dotted var(--blue);outline-offset:-1px}`);
  assert.equal(/animation|transition/.test(css), false);
  assert.equal(sinceMarks(m, undefined), "");
  assert.equal(sinceMarks(m, { heading: "h", marked: [], lines: [] }), "");
});

test("a train row shows its name, light, order and a warning for a cycle", () => {
  const train: Train = {
    key: "a|b",
    name: "App <x>",
    light: "no-go",
    members: [
      { id: "db", name: "Db", light: "go", label: "1.0.0" },
      { id: "app", name: "App", light: "no-go", label: "2.0.0" },
    ],
    heldBy: ["App"],
    cycle: true,
  };
  const html = trainBox([train], t);
  assert.ok(html.includes('class="vd train"'));
  assert.ok(html.includes("[trainTitle]"));
  assert.ok(html.includes("1.0.0") && html.includes("2.0.0"));
  assert.ok(html.indexOf("Db") < html.indexOf(">App<"), "members appear in shipping order");
  assert.ok(html.includes("[trainCycle]"));
  assert.equal(trainBox([], t), "");
  assert.equal(trainBox(undefined, t), "");
});

test("the sittings box is always visible: the steps that fit, with the time and device choices in the View options menu", () => {
  const snap = snapshotOf({ "docs/a.md": "# A\n\n- [ ] Upload the build with Xcode\n- [ ] Write the notes\n" });
  const m = buildBoard(cfg, [row("docs/a.md")], undefined, true, snap, undefined, undefined, {
    sittings: { selection: { have: ["mac"], timeBox: "any", maxSteps: 10 }, onlyOwner: false },
  });
  const html = sittingsBox(m, t);
  assert.ok(html.startsWith('<details class="box" id="sit-panel" data-sec="sittings" open><summary class="sh" title="sittingsHeading"><h2 title="sittingsHeading"><span class="si" aria-hidden="true">⏱️</span> [sittingsHeading]</h2></summary><details class="steps"'));
  assert.equal(html.includes("data-have") || html.includes("data-box"), false, "the chips are gone");
  const menu = viewMenu(t, "deliberate", m.sittings);
  assert.ok(menu.includes('data-act="have:mac"') && menu.includes('data-act="have:iphone"'));
  assert.ok(menu.includes('data-act="have:mac" aria-checked="true"') && menu.includes('data-act="have:iphone" aria-checked="false"'));
  assert.ok(menu.includes('data-act="haveall"'));
  assert.ok(menu.includes('data-act="box:any" aria-checked="true"'));
  for (const box of ["15", "30", "60", "240"]) {
    assert.ok(menu.includes(`data-act="box:${box}" aria-checked="false"`), `time box ${box}`);
  }
  assert.ok(menu.includes('data-sit="{&#34;have&#34;:[&#34;mac&#34;]'), "the selection travels on the menu");
  assert.equal(/\shidden[\s>]/.test(html), false, "nothing is hidden behind a button");
  assert.equal(html.match(/data-step="/g)?.length, 2, "one step that fits and one with no context");
  assert.ok(html.includes('<details class="steps" id="sit-steps" data-sec="sittings-steps" open>'));
  assert.ok(html.includes('id="sit-untag"'));
  assert.ok(html.includes('<a class="doc" href="#" data-step="0" title="docs/a.md">'), "a step is a link whose tooltip is the document path");
  assert.equal(html.includes('data-path'), false);
  assert.equal(html.includes("sit-open"), false, "the mystery button is gone");
});

test("by default every context is in hand and any time fits, so nothing is hidden", () => {
  const snap = snapshotOf({ "docs/a.md": "# A\n\n- [ ] Upload the build with Xcode\n- [ ] Install the APK with adb\n" });
  const m = buildBoard(cfg, [row("docs/a.md")], undefined, true, snap, undefined, undefined, {
    sittings: { selection: { timeBox: "any", maxSteps: 10 }, onlyOwner: false },
  });
  const v = m.sittings;
  assert.ok(v);
  assert.deepEqual(v.have, v.contexts.map((c) => c.id));
  assert.equal(v.doable, 2);
  assert.equal(v.needOther, 0);
  const html = sittingsBox(m, t);
  const menu = viewMenu(t, "deliberate", v);
  assert.equal(menu.match(/data-act="have:[a-z]+" aria-checked="true"/g)?.length, v.contexts.length);
  assert.ok(menu.includes('data-act="haveall"'));
});

test("with nothing in hand the box says so, and with no sittings it is not drawn", () => {
  const snap = snapshotOf({ "docs/a.md": "# A\n\n- [ ] Upload with Xcode\n" });
  const m = buildBoard(cfg, [row("docs/a.md")], undefined, true, snap, undefined, undefined, {
    sittings: { selection: { have: [], timeBox: "any", maxSteps: 10 }, onlyOwner: false },
  });
  assert.ok(sittingsBox(m, t).includes("[sittingsPick]"));
  assert.equal(sittingsBox(buildBoard(cfg, [], undefined, true), t), "");
});

test("the tidy box lists finished idle documents with a move button by index", () => {
  const old = Date.UTC(2026, 0, 1);
  const snap = snapshotOf({ "docs/done <1>.md": "# Done\n\n- [x] only step\n", "docs/open.md": "# Open\n\n- [ ] todo\n" }, old);
  const m = buildBoard(cfg, [row("docs/done <1>.md"), row("docs/open.md")], undefined, true, snap, undefined, undefined, {
    tidy: { now: Date.UTC(2026, 0, 20), afterDays: 7, archiveFolder: "docs/history" },
  });
  const html = tidyBox(m, t);
  assert.ok(html.includes('id="tidy-box"'));
  assert.equal(html.match(/data-tidy="/g)?.length, 1);
  assert.ok(html.includes("done &#60;1&#62;"));
  assert.ok(!html.includes("open.md"));
  assert.equal(tidyBox(buildBoard(cfg, [row("docs/open.md")], undefined, true, snap), t), "");
});

test("the crash box shows a start button only when the page can act and a bugs folder exists", () => {
  const signals = { app: { "lib/crash.dart": { logs: { errors: 0, warnings: 0, crashes: 2 } } } };
  const m = buildBoard(cfg, [], undefined, true, undefined, undefined, undefined, { live: { signals, includeWarnings: true, fold: false, unnamedBox: true } });
  const acting = unnamedBox(m, t, true);
  assert.ok(acting.includes('id="live-box"'));
  assert.ok(acting.includes('data-bug="0"'));
  assert.ok(!unnamedBox(m, t, false).includes("data-bug"));
  assert.equal(unnamedBox(buildBoard(cfg, [], undefined, true), t, true), "");
  const noFolder = buildBoard({ ...cfg, projects: [{ ...cfg.projects[0], roots: ["docs"] }] }, [], undefined, true, undefined, undefined, undefined, { live: { signals, includeWarnings: true, fold: false, unnamedBox: true } });
  assert.ok(!unnamedBox(noFolder, t, true).includes("data-bug"));
});
