// 2,000 documents: time budget, order independence, id stability; and the real path listing.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { assertScales, checkProperties, doc, generated, run, shuffled } from "./orgFixtures";

test("scale-2000: within the time budget, same result in any order, other ids stay put", () => {
  assertScales((n) => generated(n), (d) => void run(d));
  const input = generated(2000);
  const r = run(input);
  checkProperties(r, input);
  assert.ok(r.groups.length > 20);
  const shuffledRun = run(shuffled(input, 3));
  assert.equal(JSON.stringify(shuffledRun.groups), JSON.stringify(r.groups));
  const more = run([...input, doc("app", "docs/unrelated_zone/zzq.md")]);
  const before = new Set(r.groups.map((g) => g.id));
  const after = new Set(more.groups.map((g) => g.id));
  assert.ok([...before].every((id) => after.has(id)), "an unrelated document changed other groups' ids");
});

test("the real listing of 5,700+ documents groups with no broken rule", () => {
  const dir = path.join(__dirname, "..", "..", "..", "..", "src", "test", "board", "fixtures");
  const text = zlib.gunzipSync(fs.readFileSync(path.join(dir, "saropaRepos.tsv.gz"))).toString("utf8");
  const input = text.split("\n").filter(Boolean).map((l) => {
    const [project, p] = l.split("\t");
    return doc(project, p);
  });
  assert.ok(input.length >= 5754);
  const started = performance.now();
  const r = run(input);
  assert.ok(performance.now() - started < 10000);
  checkProperties(r, input);
  const again = run(shuffled(input, 11));
  assert.equal(JSON.stringify(again.groups), JSON.stringify(r.groups));
});
