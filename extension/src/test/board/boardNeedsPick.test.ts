// The Waits on and Blocks pickers: what they offer, the preview before an addition, and the
// refusal of a circle.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { BoardItem, BoardModel } from "../../board/boardModel";
import { resolveLinks } from "../../board/links";
import { Classified, ProjectDef } from "../../board/types";
import { BoardRun } from "../../commands/boardScanStore";
import { pickNeeds } from "../../views/boardNeedsPick";
import { stub } from "./hostHelpers";

const vs = vscode as unknown as {
  __setPickHandler(h: (items: readonly unknown[]) => Promise<unknown>): void;
  __resetHandlers(): void;
  __setInfoAnswer(h: (m: string, b: readonly string[]) => string | undefined): void;
  __resetInfo(): void;
  __infoMessages(): readonly string[];
};

afterEach(() => {
  vs.__resetHandlers();
  vs.__resetInfo();
});

const projects: ProjectDef[] = [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }];
const rows: Classified[] = ["A", "B", "C"].map((n) => ({ project: "app", path: `docs/${n}.md`, status: "amber", kind: "", note: "" }));
const items = rows.map((r, id) => ({ id, project: r.project, path: r.path, title: "Doc " + r.path.slice(5, 6), status: "amber" }) as BoardItem);

// A waits on B; the picker is opened on each.
function setup(needs: Array<[string, string[]]>): { run: BoardRun; model: BoardModel } {
  const links = resolveLinks(rows, new Map(needs.map(([k, v]) => ["app\t" + k, v])), projects);
  return { run: { cfg: { projects }, result: { rows } } as unknown as BoardRun, model: { items, links, projects: [{ id: "app", name: "App" }] } as unknown as BoardModel };
}

const choose = (label: RegExp) => async (list: readonly unknown[]): Promise<unknown> => (list as Array<{ label: string }>).find((i) => label.test(i.label));

test("the picker lists existing links first, then the other open items, and previews the line", async () => {
  const { run, model } = setup([["docs/A.md", ["docs/B.md"]]]);
  let seen: Array<{ label: string }> = [];
  vs.__setPickHandler(async (list) => {
    seen = list as Array<{ label: string }>;
    return seen.find((i) => /Doc C/.test(i.label));
  });
  vs.__setInfoAnswer((_m, b) => b[0]);
  const pick = await pickNeeds(run, model, items[0], "waits");
  assert.deepEqual(seen.map((i) => i.label), ["✕ Remove: Doc B", "◆ Doc C"]);
  assert.ok(vs.__infoMessages().some((m) => m.includes("Needs: docs/C.md") && m.includes("Doc A")));
  assert.deepEqual(pick?.change, { kind: "add", target: "docs/C.md", to: { project: "app", path: "docs/C.md" } });
  assert.deepEqual(pick?.doc.path, "docs/A.md");
});

test("an addition is dropped when the preview is not confirmed", async () => {
  const { run, model } = setup([]);
  vs.__setPickHandler(choose(/Doc B/));
  assert.equal(await pickNeeds(run, model, items[0], "waits"), undefined);
});

test("a link that would make a circle is refused with a reason", async () => {
  const { run, model } = setup([["docs/B.md", ["docs/A.md"]]]);
  vs.__setPickHandler(choose(/Doc B/));
  vs.__setInfoAnswer((_m, b) => b[0]);
  assert.equal(await pickNeeds(run, model, items[0], "waits"), undefined);
  assert.ok(vs.__infoMessages().some((m) => m.includes("circle")));
});

test("a link is removed from the document that holds it", async () => {
  const { run, model } = setup([["docs/A.md", ["docs/B.md"]]]);
  vs.__setPickHandler(choose(/Remove: Doc B/));
  assert.deepEqual((await pickNeeds(run, model, items[0], "waits"))?.change, { kind: "remove", target: "docs/B.md" });
  // From B, the same link is listed as one that blocks it, and the line is taken out of A.
  vs.__setPickHandler(choose(/Remove: Doc A/));
  const blocks = await pickNeeds(run, model, items[1], "blocks");
  assert.equal(blocks?.doc.path, "docs/A.md");
  assert.deepEqual(blocks?.change, { kind: "remove", target: "docs/B.md" });
});

test("Blocks adds the line to the chosen document, naming this one", async () => {
  const { run, model } = setup([]);
  vs.__setPickHandler(choose(/Doc C/));
  vs.__setInfoAnswer((_m, b) => b[0]);
  const pick = await pickNeeds(run, model, items[0], "blocks");
  assert.equal(pick?.doc.path, "docs/C.md");
  assert.deepEqual(pick?.change, { kind: "add", target: "docs/A.md", to: { project: "app", path: "docs/A.md" } });
});

test("cancelling the picker changes nothing", async () => {
  const { run, model } = setup([]);
  assert.equal(await pickNeeds(run, model, items[0], "waits"), undefined);
  assert.deepEqual(stub.__warningMessages(), []);
});

test("a link held only by an accepted mark has no remove entry", async () => {
  const { run, model } = setup([["docs/A.md", ["docs/B.md"]]]);
  model.links[0].markOnly = true;
  let seen: Array<{ label: string }> = [];
  vs.__setPickHandler(async (list) => {
    seen = list as Array<{ label: string }>;
    return undefined;
  });
  await pickNeeds(run, model, items[0], "waits");
  assert.deepEqual(seen.map((i) => i.label), ["◆ Doc C"]);
});
