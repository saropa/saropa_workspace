// Every element the board page draws explains itself. The test renders the whole page with the
// real text table, in every state, then walks the HTML and fails on any control, link, tab,
// input, select, summary, heading, mark, badge, count or row with no title (or aria-label).

import { test } from "node:test";
import assert from "node:assert/strict";
import { BoardStrings, renderBoard, renderSkeleton } from "../../board/boardHtml";
import { FutureView } from "../../board/boardHtmlFuture";
import { buildBoard } from "../../board/boardModel";
import { buildFuture } from "../../board/futureList";
import { evaluateHealth } from "../../board/health";
import { pathToGo } from "../../board/pathToGo";
import { readFacts } from "../../board/docFacts";
import { ScanSnapshot } from "../../board/scanner";
import { Train } from "../../board/train";
import { BoardConfig, BoardStatus, Classified, emptyCounts } from "../../board/types";
import { POLISH_KEYS, strings } from "../../views/boardStrings";

// One opening tag of the page with the attributes the walk needs.
interface Tag {
  name: string;
  attrs: Record<string, string>;
  // True when an element above it (still open) has a title or an aria-label.
  ancestorTitled: boolean;
}

const VOID = new Set(["meta", "input", "br", "hr", "img", "link"]);

// Reads the opening tags of an HTML text in order. Script and style text is skipped. Every
// attribute value on this page is escaped, so a value never holds a quote.
function walk(html: string): Tag[] {
  const text = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
  const out: Tag[] = [];
  const open: Array<{ name: string; titled: boolean }> = [];
  for (const m of text.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*\/?>/g)) {
    const [, close, name, rest] = m;
    const tag = name.toLowerCase();
    if (close) {
      const at = open.map((o) => o.name).lastIndexOf(tag);
      if (at >= 0) {
        open.length = at;
      }
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of rest.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) {
      attrs[a[1]] = a[2] ?? "";
    }
    const titled = (attrs.title ?? attrs["aria-label"] ?? "").trim() !== "";
    out.push({ name: tag, attrs, ancestorTitled: open.some((o) => o.titled) });
    if (!VOID.has(tag)) {
      open.push({ name: tag, titled });
    }
  }
  return out;
}

const CLASSES_NEEDING_TITLE = ["row", "vd", "tag", "k", "n", "go", "pn", "fn", "cn", "fut", "grp", "ptgrow", "chip", "hl", "sq", "link", "flame", "pin", "sev", "info", "ring", "bars"];
// Pure text containers and layout wrappers: they hold text that already says what it is.
const TEXT_CONTAINERS = ["div", "span", "p", "ul", "ol", "li", "section", "details", "label", "option", "body", "head", "html", "title", "meta", "main"];
// Decorative glyphs inside a titled parent (the ring and the bars of a marks group).
const GLYPHS = new Set(["i", "u"]);

// The elements that fail the rule, described for the failure message.
function missing(html: string): string[] {
  const bad: string[] = [];
  for (const t of walk(html)) {
    const own = (t.attrs.title ?? t.attrs["aria-label"] ?? "").trim() !== "";
    const classes = (t.attrs.class ?? "").split(/\s+/);
    const interactive = ["button", "a", "input", "select", "summary", "h1", "h2", "h3", "h4", "h5", "h6"].includes(t.name) || t.attrs.role !== undefined || t.attrs.tabindex !== undefined;
    const marked = GLYPHS.has(t.name) || t.name === "b" || classes.some((c) => CLASSES_NEEDING_TITLE.includes(c));
    if (!interactive && !marked) {
      assert.ok(TEXT_CONTAINERS.includes(t.name) || GLYPHS.has(t.name), `unexpected element <${t.name}> is not covered by the rule`);
      continue;
    }
    if (!own && !(GLYPHS.has(t.name) && t.ancestorTitled)) {
      bad.push(`<${t.name} class="${t.attrs.class ?? ""}"${t.attrs.id ? ` id="${t.attrs.id}"` : ""}>`);
    }
  }
  return bad;
}

const cfg: BoardConfig = {
  version: 1,
  ignore: [],
  ruleSets: {
    kinds: { rules: [{ id: "bug", when: { name: "BUG_*" }, set: { status: "red", kind: "bug" } }] },
  },
  projects: [
    { id: "app", name: "App", path: "app", roots: ["docs"], ruleSets: [], dependsOn: ["db"] },
    { id: "db", name: "Db", path: "db", roots: ["docs"], ruleSets: [] },
  ],
};

const row = (project: string, path: string, status: BoardStatus, note = "", kind = ""): Classified => ({ project, path, status, kind, note });

function snapshot(files: Record<string, string>): ScanSnapshot {
  const facts = Object.fromEntries(Object.entries(files).map(([p, text]) => [p, { size: text.length, mtimeMs: 1, facts: readFacts(text, p) }]));
  const cached = Object.fromEntries(Object.keys(files).map((p) => [p, { size: 1, mtimeMs: 1, word: "" }]));
  const project = { counts: emptyCounts(), folders: {}, ruleCounts: {}, greyFolders: { "docs/loose": 3, "": 1 }, files: cached, facts };
  return { version: 1, takenAt: 1, projects: { app: project, db: { ...project, greyFolders: {} } } };
}

const FILES: Record<string, string> = {
  "docs/BUG_a.md": "# Crash on start\n\nSeverity: critical\n\n- [x] repro\n- [ ] Upload the build with Xcode\n\n```dart\nvoid main() {}\n```\nNeeds: docs/plan.md\nSee lib/main.dart\n",
  "docs/plan.md": "# Plan\n\n- [ ] Write the notes\n- [ ] Install the APK with adb\n",
  "docs/wip.md": "# Work in progress\n\n- [x] one\n",
  "docs/done.md": "# Done thing\n\n- [x] only step\n",
  "docs/blocked/waiting.md": "# Waiting\n",
};

const HEALTH = { app: evaluateHealth(undefined, undefined, undefined, 1) };

const train: Train = {
  key: "a|b",
  name: "Both",
  light: "unverified",
  members: [
    { id: "db", name: "Db", light: "go", label: "1.0.0" },
    { id: "app", name: "App", light: "unverified", label: "2.0.0" },
  ],
  heldBy: ["App"],
  cycle: true,
};

function future(canEdit: boolean): FutureView {
  const doc = (path: string, lines: string[], title: string) => ({ project: "app", projectName: "App", path, text: `# ${title}\n\n${lines.join("\n")}\n\nBody\n` });
  return {
    items: buildFuture([
      doc("plans/deferred/a.md", ["Importance: nice-to-have", "Research: ready"], "Idea A"),
      doc("plans/deferred/b.md", ["Research: needed", "Research question: Is it possible?"], "Idea B"),
      doc("plans/blocked/c.md", ["Importance: not-feasible", "Blocker: waits on legal"], "Idea C"),
    ]),
    outside: [{ project: "app", projectName: "App", path: "ROADMAP.md", title: "Later thing", line: 4, why: "later" }],
    sort: "score",
    canEdit,
    researchParallel: 3,
    handEnabled: true,
  };
}

// The richest board the page can draw: every box, every kind of mark and every control.
function fullModel() {
  const rows = [
    row("app", "docs/BUG_a.md", "red", "", "bug"),
    row("app", "docs/plan.md", "amber", "", "plan"),
    row("app", "docs/wip.md", "purple"),
    row("app", "docs/done.md", "amber"),
    row("app", "docs/blocked/waiting.md", "amber", "blocked"),
    row("db", "docs/x.md", "amber"),
  ];
  return buildBoard({ ...cfg, pinned: ["app/docs/plan.md"] }, rows, undefined, false, snapshot(FILES), undefined, HEALTH, {
    sittings: { selection: { timeBox: "any", maxSteps: 10 }, onlyOwner: false },
    tidy: { now: Date.UTC(2026, 5, 1), afterDays: 7, archiveFolder: "docs/history" },
    inProgress: { edited: ["app/docs/plan.md"], max: 15 },
    outside: {
      chats: { "app/docs/BUG_a.md": 3 },
      groups: [{ id: "g", label: "Reviews", items: [{ title: "Fix it", detail: "repo#1", url: "https://example.com/pull/1" }, { title: "No link" }] }],
    },
    live: { signals: { app: { "lib/main.dart": { problems: { errors: 1, warnings: 0 } }, "lib/crash.dart": { logs: { errors: 0, warnings: 0, crashes: 2 } } } }, includeWarnings: true, fold: false, unnamedBox: true },
  });
}

function pages(): Array<[string, string]> {
  const t: BoardStrings = strings();
  const m = fullModel();
  const paths = m.projects.map((p) => pathToGo(m, p, { maxSteps: 8, canRun: () => true }));
  const since = { heading: "Since you last looked", lines: [{ text: "App: 1 new blocker", details: ["+ Crash on start"] }] };
  const empty = buildBoard(cfg, [], undefined, true);
  return [
    ["full", renderBoard(m, t, "n", 1, {}, paths, since, [train], future(true))],
    ["stale", renderBoard(m, t, "n", 1, { stale: true }, paths, undefined, [train], future(false))],
    ["loading", renderBoard(m, t, "n", 1, { loading: true }, paths)],
    ["empty", renderBoard(empty, t, "n", 1)],
    ["skeleton", renderSkeleton(t, "n")],
  ];
}

test("every control, link, tab, input, select, summary, heading, mark, badge, count and row has a title", () => {
  for (const [name, html] of pages()) {
    assert.deepEqual(missing(html), [], `page "${name}"`);
  }
});

test("the walk sees the elements it is meant to check", () => {
  const html = pages()[0][1];
  const tags = walk(html);
  const count = (f: (t: Tag) => boolean): number => tags.filter(f).length;
  assert.ok(count((t) => t.name === "button") >= 20);
  assert.ok(count((t) => t.name === "a" && t.attrs.class === "doc") >= 8);
  assert.equal(count((t) => t.attrs.role === "tab"), 2);
  assert.equal(count((t) => t.name === "select") >= 10, true);
  assert.ok(count((t) => t.name === "input") >= 3);
  assert.ok(count((t) => t.name === "summary") >= 3);
  assert.ok(count((t) => /^h[1-6]$/.test(t.name)) >= 8);
  assert.ok(count((t) => t.name === "i" && (t.attrs.class ?? "").startsWith("sq")) >= 4);
});

test("the walk fails on an element with no title", () => {
  assert.deepEqual(missing('<button id="x">Go</button>'), ['<button class="" id="x">']);
  assert.deepEqual(missing('<a href="#">x</a><h2>Head</h2><span class="tag">p</span>'), ['<a class="">', '<h2 class="">', '<span class="tag">']);
  assert.deepEqual(missing('<button title="Go">Go</button><button aria-label="Go">Go</button>'), []);
  assert.deepEqual(missing('<span class="marks" title="figures"><i class="ring"></i><i class="bars"><u></u></i></span>'), [], "glyphs inherit the title of the group they sit in");
  assert.deepEqual(missing('<i class="ring"></i>'), ['<i class="ring">']);
  assert.deepEqual(missing('<button title="  ">Go</button>'), ['<button class="">'], "a blank title does not count");
});

test("no title is a raw key or has an unfilled placeholder", () => {
  const keys = new Set<string>(POLISH_KEYS);
  for (const [name, html] of pages()) {
    for (const t of walk(html)) {
      const title = t.attrs.title ?? "";
      assert.ok(!keys.has(title), `page "${name}": title "${title}" is a key with no text`);
      assert.ok(!/\{\w+\}/.test(title), `page "${name}": title "${title}" has an unfilled placeholder`);
    }
  }
});

test("document links carry their project-relative path as the tooltip and no data attribute holds a path", () => {
  const html = pages()[0][1];
  const links = walk(html).filter((t) => t.name === "a" && t.attrs.class === "doc");
  const paths = links.map((l) => l.attrs.title).filter((x) => x !== ".saropa/release-board.json");
  assert.ok(paths.length >= 6);
  assert.ok(paths.every((p) => /^(docs|plans|ROADMAP)/.test(p)), `tooltips: ${paths.join(", ")}`);
  assert.ok(links.some((l) => l.attrs.title === "docs/BUG_a.md" && l.attrs["data-id"] !== undefined));
  for (const t of walk(html)) {
    for (const [k, v] of Object.entries(t.attrs)) {
      if (k.startsWith("data-") && k !== "data-suggest" && k !== "data-all") {
        assert.ok(!v.includes("/") && !v.includes("\\"), `${k}="${v}" looks like a path`);
      }
    }
  }
});
