// The Tags editor's group landing: the same documents run under the saved and the draft dictionary.

import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultState } from "../../../board/org/organizeEditCore";
import { groupLanding } from "../../../board/org/organizeLanding";
import { docs } from "./orgFixtures";

// Invoices scattered over many folders, plus unrelated documents, so a group-making tag has something to gather.
const sample = docs("app", [
  ...["march", "april", "may", "june", "july", "august"].map((m, i) => `docs/f${i}/${m}_invoice.md`),
  ...["alpha", "bravo", "cedar", "delta", "ember", "flint"].map((w, i) => `docs/g${i}/${w}.md`),
]);

const withBilling = () => {
  const s = defaultState();
  s.tags.unshift({ id: "billing", label: "Billing", emoji: "💳", colour: "teal", patterns: ["invoice"], effects: ["group"], off: false });
  return s;
};

test("a draft equal to the saved state moves no documents", () => {
  const s = defaultState();
  assert.equal(groupLanding(sample, s, structuredClone(s)).moved, 0);
});

test("a new group-making tag moves its documents and names where they land", () => {
  const out = groupLanding(sample, defaultState(), withBilling());
  assert.ok(out.moved > 0, "invoices leave their folder groups");
  assert.equal(out.byTag.billing?.group, "Billing");
  assert.ok((out.byTag.billing?.count ?? 0) >= 2);
});

test("no documents gives an empty landing", () => {
  assert.deepEqual(groupLanding([], defaultState(), withBilling()), { byTag: {}, moved: 0 });
});
