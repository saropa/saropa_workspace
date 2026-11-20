// Group-level edits: the words a group shares, merging one group into another, and a new tag from a group.

import { test } from "node:test";
import assert from "node:assert/strict";
import { addTagText, mergeGroupsText, newTagId, sharedWords } from "../../../board/org/groupOps";
import { groupOverrides } from "../../../board/org/organizeEdit";

const member = (path: string, title: string) => ({ project: "app", path, title });

test("sharedWords returns the words every document is named by, whole and most shared first", () => {
  const words = sharedWords([member("docs/PLAN_billing_refunds.md", "Billing refunds plan"), member("docs/billing-invoices.md", "Billing invoices")]);
  assert.deepEqual(words, ["billing"]);
});

test("sharedWords falls back to words in at least half the documents when none is in all", () => {
  const words = sharedWords([member("a/payments_one.md", "Payments one"), member("a/payments_two.md", "Payments two"), member("a/other.md", "Unrelated")]);
  assert.deepEqual(words, ["payments"]);
});

test("sharedWords is empty when no word is shared, and for no documents", () => {
  assert.deepEqual(sharedWords([member("a/x.md", "A"), member("b/y.md", "B")]), []);
  assert.deepEqual(sharedWords([]), []);
});

test("mergeGroupsText assigns every member to the target group and drops the source look", () => {
  const start = JSON.stringify({ version: 1, organize: { groups: { "app:folder:a": { name: "Old" } } } });
  const out = mergeGroupsText(start, [member("docs/a.md", "a"), member("docs/b.md", "b")], "app:folder:a", "app:folder:z");
  assert.ok(out.ok);
  const doc = JSON.parse(out.text) as { organize: { assign: Array<{ path: string; group: string }> } };
  assert.deepEqual(doc.organize.assign.map((a) => [a.path, a.group]), [["docs/a.md", "app:folder:z"], ["docs/b.md", "app:folder:z"]]);
  assert.equal(groupOverrides(out.text)["app:folder:a"], undefined);
});

test("mergeGroupsText refuses a malformed assign list instead of overwriting it", () => {
  const out = mergeGroupsText(JSON.stringify({ version: 1, organize: { assign: "nope" } }), [member("docs/a.md", "a")], "app:folder:a", "app:folder:z");
  assert.equal(out.ok, false);
});

test("newTagId makes a slug and avoids ids already taken", () => {
  assert.equal(newTagId("Store Payments!", new Set()), "store-payments");
  assert.equal(newTagId("Store Payments", new Set(["store-payments"])), "store-payments-2");
  assert.equal(newTagId("!!!", new Set()), "tag");
});

test("addTagText adds a tag of your own after the shipped ones and keeps the file valid", () => {
  const out = addTagText(undefined, { label: "Billing", patterns: ["billing", "invoice"], emoji: "💳" });
  assert.ok(out.ok, out.ok ? "" : out.reason);
  const doc = JSON.parse(out.text) as { organize: { tags: { add: Array<{ id: string; patterns: string[]; label: string }> } } };
  const added = doc.organize.tags.add.find((t) => t.id === "billing");
  assert.deepEqual(added?.patterns, ["billing", "invoice"]);
  assert.equal(added?.label, "Billing");
});

test("addTagText refuses a pattern that is not a single word", () => {
  assert.equal(addTagText(undefined, { label: "Bad", patterns: ["two words"] }).ok, false);
});
