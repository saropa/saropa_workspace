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
import { STYLE, script } from "../../board/boardHtmlAssets";
import { renderKeywordEditor } from "../../board/keywordEditorHtml";
import { defaultDraft } from "../../board/severityEdit";
import { keywordLabels } from "../../views/keywordStrings";

// One opening tag of the page with the attributes the walk needs.
interface Tag {
  name: string;
  // The text right after the opening tag, up to the next tag (empty when a tag follows).
  text: string;
  attrs: Record<string, string>;
  // True when an element above it (still open) has a title or an aria-label.
  ancestorTitled: boolean;
}

// ASCII lower case with the same length as the text, so an index in one is an index in the other.
function asciiLower(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out += c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : text[i];
  }
  return out;
}

// The HTML without its script and style elements, in any letter case, found with indexOf: from
// each opening tag to the end of the next matching close tag, repeated until none is left.
// Nothing is removed by a pattern.
function withoutBlocks(html: string): string {
  let text = html;
  for (const name of ["script", "style"]) {
    for (let from = asciiLower(text).indexOf(`<${name}`); from >= 0; from = asciiLower(text).indexOf(`<${name}`)) {
      const close = asciiLower(text).indexOf(`</${name}`, from);
      const end = close < 0 ? -1 : text.indexOf(">", close);
      text = text.slice(0, from) + (end < 0 ? "" : text.slice(end + 1));
    }
  }
  return text;
}

const VOID = new Set(["meta", "input", "br", "hr", "img", "link"]);

// Reads the opening tags of an HTML text in order. Script and style text is skipped. Every
// attribute value on this page is escaped, so a value never holds a quote.
function walk(html: string): Tag[] {
  const text = withoutBlocks(html);
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
    const after = text.slice((m.index ?? 0) + m[0].length);
    out.push({ name: tag, attrs, text: after.slice(0, Math.max(0, after.indexOf("<"))).trim(), ancestorTitled: open.some((o) => o.titled) });
    if (!VOID.has(tag)) {
      open.push({ name: tag, titled });
    }
  }
  return out;
}

const CLASSES_NEEDING_TITLE = ["row", "vd", "stat", "facts", "cp", "fp", "tag", "k", "n", "go", "pn", "fn", "cn", "fut", "grp", "ptgrow", "chip", "hl", "sq", "link", "flame", "pin", "sev", "info", "ring", "bars", "pill"];
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
    const interactive = ["button", "a", "input", "textarea", "select", "summary", "h1", "h2", "h3", "h4", "h5", "h6"].includes(t.name) || t.attrs.role !== undefined || t.attrs.tabindex !== undefined;
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
  // A customized dictionary: the board draws its "keywords customized by you" line.
  severity: { threshold: 4 },
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
  "docs/BUG_a.md": "# Crash on start\n\nSeverity: critical. Data loss and a security hole when the app starts.\n\n- [x] repro\n- [ ] Upload the build with Xcode\n\n```dart\nvoid main() {}\n```\nNeeds: docs/plan.md\nSee lib/main.dart\n",
  "docs/plan.md": "# Plan\n\n- [ ] Write the notes\n- [ ] Install the APK with adb\n",
  "docs/wip.md": "# Work in progress\n\n- [x] one\n",
  "docs/done.md": "# Done thing\n\n- [x] only step\n",
  "docs/blocked/waiting.md": "# Waiting\n",
};

const HEALTH = {
  app: evaluateHealth(
    undefined,
    {
      lint: { name: "lint", outcome: "failure", exitCode: 1, endedAt: 1 },
      tests: { name: "tests", outcome: "success", exitCode: 0, endedAt: 1, run: 5, failed: 0 },
    },
    undefined,
    1,
    { build: { ok: false, feed: "build", why: "stale", detail: "Build report is old" } }
  ),
};

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
    { ...row("app", "docs/plan.md", "amber", "", "plan"), rule: "status-docs-plan-md" },
    row("app", "docs/wip.md", "purple"),
    row("app", "docs/done.md", "amber"),
    row("app", "docs/blocked/waiting.md", "amber", "blocked"),
    row("db", "docs/x.md", "amber"),
  ];
  return buildBoard({ ...cfg, pinned: ["app/docs/plan.md"], severityOverrides: [{ project: "app", path: "docs/BUG_a.md", severity: "critical" }, { project: "app", path: "docs/plan.md", severity: "high" }] }, rows, undefined, false, snapshot(FILES), undefined, HEALTH, {
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
  const empty = buildBoard({ ...cfg, severity: undefined }, [], undefined, true);
  return [
    ["full", renderBoard(m, t, "n", 1, { startup: true, scope: "all" }, paths, since, [train], future(true))],
    ["stale", renderBoard(m, t, "n", 1, { stale: true, startup: false }, paths, undefined, [train], future(false))],
    ["loading", renderBoard(m, t, "n", 1, { loading: true }, paths)],
    ["empty", renderBoard(empty, t, "n", 1)],
    ["skeleton", renderSkeleton(t, "n")],
    ["keyword editor", renderKeywordEditor(keywordLabels(), "n", { ...defaultDraft(), threshold: 4 }, defaultDraft())],
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
  assert.ok(count((t) => t.name === "input" || t.name === "textarea") >= 2);
  assert.ok(count((t) => t.name === "summary") >= 3);
  assert.ok(count((t) => t.attrs["data-kw"] === "edit") === 1 && count((t) => t.attrs["data-kw"] === "restore") === 1, "the keyword line has its two buttons");
  assert.ok(count((t) => t.attrs["data-act"] === "keywords") === 1, "the options menu has the keyword editor entry");
  assert.ok(count((t) => /^h[1-6]$/.test(t.name)) >= 8);
  assert.ok(count((t) => t.name === "i" && (t.attrs.class ?? "").startsWith("sq")) >= 1);
  assert.ok(count((t) => (t.attrs.class ?? "").split(" ").includes("stat")) >= 4, "rows carry a status pill, not a square");
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

const decode = (s: string): string => s.replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)));

test("every glyph says what it looks like and what it means, and no title only repeats its label", () => {
  const glyphs: string[] = [];
  for (const [name, html] of pages()) {
    for (const t of walk(html)) {
      const title = decode(t.attrs.title ?? t.attrs["aria-label"] ?? "");
      const classes = (t.attrs.class ?? "").split(/\s+/);
      if (t.name === "i") {
        assert.ok(t.attrs.title !== undefined && t.attrs.title.trim() !== "", `page "${name}": a glyph <i class="${t.attrs.class}"> has its own title`);
        assert.ok(/^[A-Z][\w -]+: \S/.test(title), `page "${name}": glyph title "${title}" is "<look>: <meaning>"`);
        glyphs.push(title);
      }
      const label = decode(t.text);
      const labelled = t.name === "button" || ["tag", "k", "pill", "go", "pn", "code"].some((c) => classes.includes(c));
      if (labelled && label !== "") {
        assert.notEqual(title.toLowerCase(), label.toLowerCase(), `page "${name}": title repeats its label "${label}"`);
        assert.ok(title.length > label.length, `page "${name}": title "${title}" says more than "${label}"`);
      }
    }
  }
  const words = new Set(glyphs.map((g) => g.split(":")[0]));
  for (const look of ["Amber square", "Progress ring", "Red dot", "Green dot", "Gray dot", "Amber diamond", "Filled amber diamond", "Amber flame", "Information icon"]) {
    assert.ok(words.has(look), `the full page draws a glyph described as "${look}"`);
  }
});

test("what the user set is marked with a tooltip, counted in the summary, and its menu entries have tooltips", () => {
  const html = pages()[0][1];
  assert.ok(html.includes("Set by hand in the rules file. Back to automatic in the row menu."));
  assert.ok(walk(html).some((t) => t.name === "span" && t.text === "\u270E" && (t.attrs.title ?? "").startsWith("Set by hand")), "the pen mark carries the tooltip");
  assert.ok(walk(html).some((t) => (t.attrs.class ?? "").includes("byuser") && (t.attrs.title ?? "") !== ""));
  assert.ok(walk(html).some((t) => t.attrs["data-act"] === "severity" && (t.attrs.title ?? "") !== ""));
  assert.ok(walk(html).some((t) => t.attrs["data-act"] === "auto" && (t.attrs.title ?? "") !== ""));
});

test("each glyph look has its own meaning text", () => {
  const exact = pages()[0][1];
  assert.ok(exact.includes('title="Blocks the release, address it now: Crash on start'), "the hover card of a blocking row");
  assert.ok(exact.includes('title="Review next: '));
  assert.ok(exact.includes("Critical severity. This document stops a release"), "the card names the severity and that it stops the release");
});

test("every section and subsection folds, each remembers its state under its own name, and long lists start folded", () => {
  const html = pages()[0][1];
  const tags = walk(html);
  const details = tags.filter((t) => t.name === "details");
  assert.ok(details.length >= 8);
  const ids = details.map((d) => d.attrs["data-sec"]);
  assert.ok(ids.every((i) => i !== undefined && i !== ""), "every details element has a state name");
  assert.equal(new Set(ids).size, ids.length, "no two share a name");
  for (const must of ["list.resolveNow", "list.inProgress", "list.workOn", "since", "tidy", "sittings", "sittings-steps", "norule", "linked", "live"]) {
    assert.ok(ids.includes(must), `a folding section named ${must}: ${ids.join(", ")}`);
  }
  assert.ok(ids.some((i) => i?.startsWith("future:")), "the Future groups fold too");
  assert.ok(details.every((d) => "open" in d.attrs), "everything starts open when the lists are short");
  const summaries = tags.filter((t) => t.name === "summary");
  assert.equal(summaries.length, details.length, "every details element has its summary");
  const m = buildBoard(cfg, Array.from({ length: 26 }, (_x, i) => row("app", `docs/BUG_${i}.md`, "red")), undefined, true, snapshot(FILES));
  const long = walk(renderBoard(m, strings(), "n")).filter((t) => t.name === "details" && t.attrs["data-sec"] === "list.resolveNow");
  assert.equal(long.length, 1);
  assert.equal("open" in long[0].attrs, false, "a list of more than 25 starts folded");
});

test("the page script keeps each folded section's state per viewer", () => {
  const js = script(1, "x", "y");
  assert.ok(js.includes("details[data-sec]"));
  assert.ok(js.includes("SEC[k]=!d.open"), "only a click on the summary records a choice");
  assert.equal(js.includes("addEventListener('toggle'"), false, "a change the page makes itself is not recorded");
  assert.ok(js.includes("SEC_MAX=100") && js.includes("indexOf('outside:')"), "the stored keys are bounded and group ids are not stored");
  assert.ok(js.includes("vscode.setState({...(vscode.getState()||{}),y:window.scrollY,sec:SEC})"));
  assert.ok(js.includes("d.open=SEC[k]===true"));
});

test("every number the page counts is a pill, a small rounded badge in the editor's badge colors", () => {
  assert.ok(STYLE.includes(".pill{display:inline-block;font-size:11px;"));
  assert.ok(STYLE.includes("border-radius:9px"));
  assert.ok(STYLE.includes("background:var(--vscode-badge-background,#4d4d4d);color:var(--vscode-badge-foreground,#fff)"));
  const html = pages()[0][1];
  const pills = walk(html).filter((t) => (t.attrs.class ?? "").split(/\s+/).includes("pill"));
  assert.ok(pills.length >= 20);
  assert.ok(pills.every((p) => /^\d+$/.test(p.text)), "a pill holds only a number");
  // Visible text with the pills, the document links, the headings and the hidden parts taken out:
  // no bare number may remain, apart from version labels and list numbering.
  const bare = withoutBlocks(html)
    .replace(/<span class="pill"[^>]*>\d+<\/span>/g, "")
    .replace(/<span class="fx">[^<]*<\/span>/g, "")
    .replace(/<a class="doc"[^>]*>[^<]*<\/a>/g, "")
    .replace(/<h1[^>]*>[^<]*<\/h1>/g, "")
    .replace(/<option[^>]*>[^<]*<\/option>/g, "")
    .replace(/<[^>]*>/g, "|")
    .split("|")
    .map((x) => decode(x).trim())
    .filter((x) => /\b\d+\b/.test(x));
  assert.deepEqual(bare, ["15 min", "30 min", "1 hour", "1", "1.0.0", "2", "2.0.0", "repo#1"], "time labels, train numbering and versions, and a review reference are not counts");
});

test("withoutBlocks drops every script and style element in any letter case and leaves the rest", () => {
  assert.equal(withoutBlocks("a<script>x</script>b<SCRIPT>y</SCRIPT >c<Style>z</STYLE>d<style>w</style>e"), "abcde");
  assert.equal(withoutBlocks("<p>no blocks</p>"), "<p>no blocks</p>");
  assert.equal(withoutBlocks("a<script>never closed"), "a");
});
