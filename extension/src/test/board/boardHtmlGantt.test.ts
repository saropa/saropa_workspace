// The Gantt tab: groups, work-order bars, finished rows as history, the light, the since-you-left
// border, escaping and the key pill.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BoardStrings } from "../../board/boardHtmlUtil";
import { GANTT_SCRIPT, ganttPanel } from "../../board/boardHtmlGantt";
import { buildGantt } from "../../board/ganttModel";
import { buildBoard } from "../../board/boardModel";
import { readFacts } from "../../board/docFacts";
import { ScanSnapshot } from "../../board/scanner";
import { SinceView } from "../../board/sinceLast";
import { BoardConfig, BoardStatus, Classified, emptyCounts } from "../../board/types";

const t: BoardStrings = new Proxy({} as BoardStrings, { get: (_o, k: string) => `[${k}]` });

const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", name: "App <b>", path: "app", roots: [], ruleSets: [] }] };
const row = (path: string, status: BoardStatus): Classified => ({ project: "app", path, status, kind: "", note: "" });

function snapshotOf(files: Record<string, string>): ScanSnapshot {
  const facts = Object.fromEntries(Object.entries(files).map(([p, text]) => [p, { size: text.length, mtimeMs: 1, facts: readFacts(text, p) }]));
  return { version: 1, takenAt: 1, projects: { app: { counts: emptyCounts(), folders: {}, ruleCounts: {}, greyFolders: {}, files: {}, facts } } };
}

const files = { "a.md": "# Alpha\n", "b.md": "# Beta\n\nNeeds: a.md\n", "c.md": "# Gamma\n\nNeeds: done.md\n", "done.md": "# Finished <i>\n" };
const rows = [row("a.md", "amber"), row("b.md", "red"), row("c.md", "purple"), row("done.md", "green")];
const model = buildBoard(cfg, rows, undefined, true, snapshotOf(files));

test("an item that waits starts after what it waits on, and its row names the dependency", () => {
  const [g] = buildGantt(model);
  const a = g.rows.find((r) => r.title === "Alpha")!;
  const b = g.rows.find((r) => r.title === "Beta")!;
  assert.equal(a.start, 0);
  assert.ok(b.start >= a.start + a.width - 0.1);
  assert.deepEqual(b.after, [a.id]);
  assert.deepEqual(b.waits, ["Alpha"]);
});

test("a finished document an open item needed stays as a dimmed history row", () => {
  const [g] = buildGantt(model);
  const done = g.rows.find((r) => r.status === "green")!;
  assert.equal(done.title, "Finished <i>");
  assert.equal(done.id, undefined);
  assert.equal(g.rows[0], done, "history comes first");
  assert.equal(g.open, 3);
  assert.ok(ganttPanel(model, t).includes('class="gr done"'));
});

test("the panel escapes titles and names, closes each group with its light and carries the key pill", () => {
  const html = ganttPanel(model, t);
  assert.ok(!html.includes("<i>") && !html.includes("<b>"));
  assert.ok(html.includes("Finished &#60;i&#62;") && html.includes("App &#60;b&#62;"));
  assert.ok(html.includes('class="go no-go"'));
  assert.ok(html.includes('aria-label="ganttKeyLabel" title="ganttKey">?</button>'));
  assert.ok(html.includes('role="tabpanel" aria-labelledby="tb-gantt"'));
  assert.ok(html.includes('tabindex="0" data-gid='), "rows are reachable by keyboard");
});

test("a row changed since the last look gets the static marker class", () => {
  const since = { marked: ["app/b.md"] } as SinceView;
  assert.equal(ganttPanel(model, t, since).match(/class="gr[^"]* chg"/g)?.length, 1);
  assert.ok(!ganttPanel(model, t).includes(" chg"));
});

test("no items shows the empty line, and the script draws arrows only for the hovered or selected row", () => {
  const empty = buildBoard(cfg, [], undefined, true);
  assert.ok(ganttPanel(empty, t).includes("ganttEmpty"));
  assert.ok(GANTT_SCRIPT.includes("[hov,sel]"));
  assert.ok(!GANTT_SCRIPT.includes("postMessage"), "the view is read-only");
});
