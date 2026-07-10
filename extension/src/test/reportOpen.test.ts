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

// Suppression is scoped to the suppressing run's async context, not to the process.
// A manual report recipe clicked during an await gap of a scheduled routine must
// still open its report — a module-level flag would have swallowed it.
test("a concurrent run outside the suppressed context still opens its report", async () => {
  __resetOpenedDocuments();
  let releaseRoutine: () => void = () => {};
  const routineIsMidRun = new Promise<void>((resolve) => (releaseRoutine = resolve));

  const routine = withReportOpenSuppressed(async () => {
    await openReport("/reports/member.md");
    await routineIsMidRun;
  });

  // Runs while the routine is parked mid-suppression, from its own async context.
  await openReport("/reports/manual.md");
  releaseRoutine();
  await routine;

  assert.deepEqual(__openedDocuments(), ["/reports/manual.md"]);
});

// Nested scopes: an inner scope unwinding must not re-enable opening while an outer
// scope still owns the screen.
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
