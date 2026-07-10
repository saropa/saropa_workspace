import { test } from "node:test";
import assert from "node:assert/strict";
import { __openedDocuments, __resetOpenedDocuments } from "./_stub/vscode";
import {
  isReportOpenSuppressed,
  openReport,
  withReportOpenSuppressed,
} from "../exec/reportOpen";

test("openReport raises an editor for the report it is given", async () => {
  __resetOpenedDocuments();
  await openReport("/reports/standup.md");
  assert.deepEqual(__openedDocuments(), ["/reports/standup.md"]);
});

test("openReport raises nothing while opens are suppressed", async () => {
  __resetOpenedDocuments();
  await withReportOpenSuppressed(async () => {
    await openReport("/reports/standup.md");
    await openReport("/reports/debt.md");
  });
  assert.deepEqual(__openedDocuments(), []);
});

test("suppression lifts once the scope ends, so the summary still opens", async () => {
  __resetOpenedDocuments();
  await withReportOpenSuppressed(async () => {
    await openReport("/reports/member.md");
  });
  await openReport("/reports/summary.md");
  assert.deepEqual(__openedDocuments(), ["/reports/summary.md"]);
});

// A member that throws must not leave every later report opening into the user's
// face — the counter unwinds through the finally, not only on the happy path.
test("suppression lifts even when the suppressed body throws", async () => {
  __resetOpenedDocuments();
  await assert.rejects(
    withReportOpenSuppressed(async () => {
      throw new Error("member failed");
    })
  );
  assert.equal(isReportOpenSuppressed(), false);
  await openReport("/reports/summary.md");
  assert.deepEqual(__openedDocuments(), ["/reports/summary.md"]);
});

// Nested scopes are depth-counted: an inner scope unwinding must not re-enable
// opening while an outer scope still owns the screen.
test("a nested suppression scope does not re-enable opening when it unwinds", async () => {
  __resetOpenedDocuments();
  await withReportOpenSuppressed(async () => {
    await withReportOpenSuppressed(async () => {
      await openReport("/reports/inner.md");
    });
    assert.equal(isReportOpenSuppressed(), true);
    await openReport("/reports/outer.md");
  });
  assert.deepEqual(__openedDocuments(), []);
});
