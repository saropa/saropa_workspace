// The boxes around the project rows: sittings, tidy, crash signals, trains, linked
// documents, outside sources, the since strip and the profile picker. Each box is built
// from a real model, and each test checks that untrusted text is escaped and that the page
// carries indexes, never paths or URLs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBoard } from "../../board/boardModel";
import { BoardStrings } from "../../board/boardHtmlUtil";
import { chains, needsRule, outsideBoxes, profilePicker, sinceBox, sittingsBox, tidyBox, trainBox, unnamedBox } from "../../board/boardHtmlBoxes";
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

test("the profile picker marks the chosen profile as pressed", () => {
  const m = buildBoard({ ...cfg, profile: "rush" }, [], undefined, true);
  const html = profilePicker(m, t);
  assert.ok(html.includes('data-profile="rush" class="on" aria-pressed="true"'));
  assert.ok(html.includes('data-profile="zero" aria-pressed="false"'));
});

test("the needs-a-rule box is empty without grey folders and lists each folder with a button-like row", () => {
  const empty = buildBoard(cfg, [], undefined, true);
  assert.equal(needsRule(empty, t, new Map()), "");
  const m = buildBoard(cfg, [], undefined, true, snapshotOf({}, 1, { "docs/<odd>": 4, "": 1 }));
  const html = needsRule(m, t, new Map([["app", "App"]]));
  assert.ok(html.includes("docs/&#60;odd&#62;"));
  assert.ok(html.includes('title="4"'));
  assert.ok(html.includes("<span class=\"f\">/</span>"), "the project root shows as a slash");
  assert.equal(html.match(/class="cn rulefix click"/g)?.length, 2);
});

test("linked documents: chains, flags and suggestions, with indexes only", () => {
  const snap = snapshotOf({
    "docs/a.md": "# A\nNeeds: docs/b.md\nNeeds: docs/ghost.md\nSee c.md\n",
    "docs/b.md": "# B\n",
    "docs/c.md": "# C <i>\n",
  });
  const m = buildBoard(cfg, [row("docs/a.md"), row("docs/b.md"), row("docs/c.md")], undefined, true, snap);
  const html = chains(m, t);
  assert.ok(html.startsWith('<details class="box">'));
  assert.ok(html.includes('class="chain"'));
  assert.ok(html.includes("[flagsHeading]"));
  assert.ok(html.includes("ghost.md: missing"));
  assert.ok(html.includes("[suggestHeading]"));
  assert.ok(html.includes('data-decision="accept"') && html.includes('data-decision="reject"'));
  assert.ok(html.includes("C &#60;i&#62;"));
  assert.ok(!html.includes("<i>"), "a title cannot add markup");
  assert.ok(!html.includes("docs/b.md\""), "no path is a data attribute");
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
  const html = outsideBoxes(m);
  assert.ok(html.includes("Reviews &#60;3&#62;"));
  assert.ok(html.includes('data-g="0" data-i="0"'));
  assert.ok(!html.includes("example.com"));
  assert.equal(html.match(/click ext/g)?.length, 1, "only the item with a link is clickable");
});

test("no outside groups, no markup", () => {
  assert.equal(outsideBoxes(buildBoard(cfg, [], undefined, true)), "");
});

test("the since strip lists each line with its details, escaped", () => {
  const html = sinceBox({ heading: "Since <1h>", lines: [{ text: "App: 1 new blocker", details: ["+ Fix <x>", "- Old"] }, { text: "Db: light changed", details: [] }] });
  assert.ok(html.includes('role="status"'));
  assert.ok(html.includes("Since &#60;1h&#62;"));
  assert.ok(html.includes("+ Fix &#60;x&#62;"));
  assert.equal(html.match(/<ul class="sd">/g)?.length, 1);
  assert.equal(sinceBox(undefined), "");
  assert.equal(sinceBox({ heading: "h", lines: [] }), "");
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

test("the sittings box offers what the owner can have in hand and lists the steps that fit", () => {
  const snap = snapshotOf({ "docs/a.md": "# A\n\n- [ ] Upload the build with Xcode\n- [ ] Write the notes\n" });
  const m = buildBoard(cfg, [row("docs/a.md")], undefined, true, snap, undefined, undefined, {
    sittings: { selection: { have: ["mac"], timeBox: "any", maxSteps: 10 }, onlyOwner: false },
  });
  const html = sittingsBox(m, t);
  assert.ok(html.includes('id="sit-panel" hidden'));
  assert.ok(html.includes('data-have="mac" aria-pressed="true"'));
  assert.ok(html.includes('data-have="iphone" aria-pressed="false"'));
  assert.ok(html.includes('data-box="any" aria-pressed="true"'));
  assert.equal(html.match(/data-step="/g)?.length, 2, "one step that fits and one with no context");
  assert.ok(html.includes('id="sit-untag"'));
  assert.ok(!html.includes("docs/a.md"));
});

test("with nothing in hand the box asks to pick, and with no sittings it is not drawn", () => {
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
