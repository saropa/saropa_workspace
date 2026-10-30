// 2,000 documents: time budget, order independence, id stability; and the real path listing.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { OrgDoc } from "../../../board/org/orgTypes";
import { checkProperties, doc, lcg, run, shuffled } from "./orgFixtures";

function generated(n: number): OrgDoc[] {
  const rnd = lcg(7);
  const words = ["payments", "sync", "login", "release", "theme", "backup", "search", "share", "export", "import", "cache", "alert"];
  const kinds = ["PLAN", "BUG", "SPEC", "REPORT"];
  const out: OrgDoc[] = [];
  for (let i = 0; i < n; i++) {
    const project = ["app", "web", "db"][i % 3];
    const area = `area${Math.floor(rnd() * 12)}`;
    const sub = `sub${Math.floor(rnd() * 8)}`;
    const status = rnd() < 0.2 ? "/done" : "";
    const w = words[Math.floor(rnd() * words.length)];
    const seq = rnd() < 0.2 ? `_phase${1 + Math.floor(rnd() * 4)}` : "";
    out.push(doc(project, `docs/${area}/${sub}${status}/${kinds[i % 4]}_${w}${i % 50}${seq}_i${i}.md`, { sourceFiles: rnd() < 0.3 ? [`lib/f${Math.floor(rnd() * 40)}.dart`, `lib/g${Math.floor(rnd() * 40)}.dart`] : [], title: `${w} notes ${i}` }));
  }
  return out;
}

test("scale-2000: within the time budget, same result in any order, other ids stay put", () => {
  const input = generated(2000);
  const started = performance.now();
  const r = run(input);
  const ms = performance.now() - started;
  assert.ok(ms < 500, `took ${ms.toFixed(0)} ms`);
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
  assert.ok(performance.now() - started < 3000);
  checkProperties(r, input);
  const again = run(shuffled(input, 11));
  assert.equal(JSON.stringify(again.groups), JSON.stringify(r.groups));
});
