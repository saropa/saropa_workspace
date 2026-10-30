// Future tab, research: the hand-off batch, the counts and the queue.

import { test } from "node:test";
import assert from "node:assert/strict";
import { asResearchParallel, researchCounts, researchQueue } from "../../board/futureResearch";
import { buildFuture } from "../../board/futureList";

const doc = (name: string, lines: string[]) => ({ project: "app", projectName: "App", path: `plans/deferred/${name}.md`, text: `# ${name}\n\n${lines.join("\n")}\n\nBody\n` });

test("the parallel setting is a whole number from 1 to 10; anything else is 3", () => {
  assert.equal(asResearchParallel(3), 3);
  assert.equal(asResearchParallel(1), 1);
  assert.equal(asResearchParallel(10), 10);
  assert.equal(asResearchParallel(0), 1);
  assert.equal(asResearchParallel(-4), 1);
  assert.equal(asResearchParallel(99), 10);
  assert.equal(asResearchParallel(2.9), 2);
  for (const bad of ["5", undefined, null, NaN, Infinity, {}]) {
    assert.equal(asResearchParallel(bad), 3, String(bad));
  }
});

test("the counts add up the three states the tab reports", () => {
  const items = buildFuture([
    doc("a", ["Research: needed"]),
    doc("b", ["Research: needed"]),
    doc("c", ["Research: in-progress"]),
    doc("d", ["Research: ready"]),
    doc("e", ["Research: reviewed"]),
    doc("f", ["Wow: 2"]),
  ]);
  assert.deepEqual(researchCounts(items), { needed: 2, inProgress: 1, readyUnreviewed: 1 });
  assert.deepEqual(researchCounts([]), { needed: 0, inProgress: 0, readyUnreviewed: 0 });
});

test("the queue takes flagged documents in the order the tab shows, up to the limit, and counts the rest", () => {
  const items = buildFuture([
    doc("a", ["Importance: nice-to-have", "Research: needed", "Wow: 1", "Reach: rare", "Effort: XL"]),
    doc("b", ["Importance: build-next", "Research: needed", "Wow: 5", "Reach: daily", "Effort: S"]),
    doc("c", ["Importance: build-next", "Research: ready"]),
    doc("d", ["Importance: nice-to-have", "Research: needed", "Wow: 5", "Reach: daily", "Effort: S"]),
    doc("e", ["Importance: marketable", "Research: needed"]),
  ]);
  const name = (i: number): string => items[i].title;
  const two = researchQueue(items, "score", 2);
  assert.deepEqual(two.batch.map(name), ["b", "e"]);
  assert.equal(two.queued, 2);
  const all = researchQueue(items, "score", 10);
  assert.deepEqual(all.batch.map(name), ["b", "e", "d", "a"]);
  assert.equal(all.queued, 0);
  assert.deepEqual(researchQueue(items, "score", 4).batch.length, 4);
  assert.deepEqual(researchQueue(items, "score", 0).batch.map(name), ["b"], "a limit below 1 is read as 1");
});

test("with nothing flagged the queue is empty", () => {
  assert.deepEqual(researchQueue(buildFuture([doc("a", ["Research: ready"])]), "score", 3), { batch: [], queued: 0 });
});
