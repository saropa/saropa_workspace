// Unit tests for the folder/file watch snapshot diff (PLAN_FILE_AND_FOLDER_WATCH).
// Pure logic — no VS Code, no filesystem — so the new/changed semantics that drive
// both the startup scan and the live watcher are pinned here. The engine's
// "seed-silently-on-first-scan" rule (don't announce everything when there is no
// baseline yet) lives in the engine, not diffSnapshots; these tests assert what
// diffSnapshots itself reports given a non-empty baseline.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diffSnapshots,
  isEmptyDelta,
  watchAlertsIn,
  defaultAlertScopes,
  FolderSnapshot,
  FolderWatch,
  FolderWatchStore,
} from "../model/folderWatch";
import { fakeContext } from "./_stub/context";

// A minimal enabled folder watch for the store tests.
function watch(id: string, target: string): FolderWatch {
  return { id, target, isFile: false, mode: "new", enabled: true };
}

test("a new file is reported as added in 'new' mode", () => {
  const baseline: FolderSnapshot = { "a.md": 100 };
  const current: FolderSnapshot = { "a.md": 100, "b.md": 200 };
  const delta = diffSnapshots(baseline, current, "new");
  assert.deepEqual(delta.added, ["b.md"]);
  assert.deepEqual(delta.changed, []);
});

test("'new' mode ignores a file whose mtime advanced", () => {
  const baseline: FolderSnapshot = { "a.md": 100 };
  const current: FolderSnapshot = { "a.md": 999 };
  const delta = diffSnapshots(baseline, current, "new");
  assert.ok(isEmptyDelta(delta));
});

test("'changed' mode reports both new files and advanced mtimes", () => {
  const baseline: FolderSnapshot = { "a.md": 100, "c.md": 50 };
  const current: FolderSnapshot = { "a.md": 150, "b.md": 200, "c.md": 50 };
  const delta = diffSnapshots(baseline, current, "changed");
  assert.deepEqual(delta.added, ["b.md"]);
  assert.deepEqual(delta.changed, ["a.md"]); // c.md unchanged, a.md advanced
});

test("an unchanged snapshot yields an empty delta", () => {
  const snap: FolderSnapshot = { "a.md": 100, "b.md": 200 };
  assert.ok(isEmptyDelta(diffSnapshots(snap, snap, "changed")));
  assert.ok(isEmptyDelta(diffSnapshots(snap, snap, "new")));
});

test("a deleted file is never reported (arrivals/edits only)", () => {
  const baseline: FolderSnapshot = { "a.md": 100, "b.md": 200 };
  const current: FolderSnapshot = { "a.md": 100 };
  assert.ok(isEmptyDelta(diffSnapshots(baseline, current, "changed")));
});

test("an mtime that moved backward is not a change", () => {
  // A clock skew or a restored-from-backup file can lower mtime; only a strictly
  // greater mtime counts as a change, so this must report nothing.
  const baseline: FolderSnapshot = { "a.md": 500 };
  const current: FolderSnapshot = { "a.md": 100 };
  assert.ok(isEmptyDelta(diffSnapshots(baseline, current, "changed")));
});

test("added and changed lists are sorted deterministically", () => {
  const baseline: FolderSnapshot = { "m.md": 1 };
  const current: FolderSnapshot = {
    "m.md": 9,
    "z.md": 1,
    "a.md": 1,
    "k.md": 1,
  };
  const delta = diffSnapshots(baseline, current, "changed");
  assert.deepEqual(delta.added, ["a.md", "k.md", "z.md"]);
  assert.deepEqual(delta.changed, ["m.md"]);
});

test("diff against an empty baseline reports every file (engine must seed instead)", () => {
  // Documents WHY the engine seeds silently on first scan: with an empty baseline
  // diffSnapshots faithfully calls everything new, which would flood the user.
  const current: FolderSnapshot = { "a.md": 1, "b.md": 2 };
  const delta = diffSnapshots({}, current, "new");
  assert.deepEqual(delta.added, ["a.md", "b.md"]);
});

// --- per-project alert scope (the "do not blast every project" gate) ----------

// A folder watch with an optional explicit alert scope, for the gate tests.
function scopedWatch(target: string, alertScopes?: string[]): FolderWatch {
  return { id: "w", target, isFile: false, mode: "new", enabled: true, alertScopes };
}

test("a never-scoped watch alerts only in the project that contains its target", () => {
  // The legacy/auto-correct default: an existing per-project bugs watch fires in
  // its own project and nowhere else, with no migration write.
  const w = scopedWatch("/src/contacts/bugs");
  assert.equal(watchAlertsIn(w, ["/src/contacts"]), true);
  // The exact "blasted every project" report: it must NOT fire in another project.
  assert.equal(watchAlertsIn(w, ["/src/workspace"]), false);
});

test("an explicitly-scoped watch alerts only in its listed projects", () => {
  const w = scopedWatch("/external/dropbox", ["/src/contacts"]);
  assert.equal(watchAlertsIn(w, ["/src/contacts"]), true);
  assert.equal(watchAlertsIn(w, ["/src/workspace"]), false);
  // Multi-root window holding one listed folder still alerts.
  assert.equal(watchAlertsIn(w, ["/src/workspace", "/src/contacts"]), true);
});

test("an empty alert scope is muted everywhere (an opt-out persists)", () => {
  // [] is distinct from undefined: removing the last project must not fall back to
  // the containing-project default and resurrect the alert.
  const w = scopedWatch("/src/contacts/bugs", []);
  assert.equal(watchAlertsIn(w, ["/src/contacts"]), false);
});

test("defaultAlertScopes materializes the containing project among current folders", () => {
  const w = scopedWatch("/src/contacts/bugs");
  assert.deepEqual(
    defaultAlertScopes(w, ["/src/workspace", "/src/contacts"]),
    ["/src/contacts"]
  );
  assert.deepEqual(defaultAlertScopes(w, ["/src/workspace"]), []);
});

// --- unseen tally (the per-row counter + activity-bar total) ------------------

test("unseen files accumulate, de-duplicate, and sum across watches", async () => {
  const store = new FolderWatchStore(fakeContext());
  await store.add(watch("w1", "/p/bugs"));
  await store.add(watch("w2", "/p/reports"));

  await store.addUnseen("w1", ["a.md", "b.md"]);
  await store.addUnseen("w1", ["b.md", "c.md"]); // b.md already counted
  await store.addUnseen("w2", ["x.md"]);

  assert.equal(store.unseenCount("w1"), 3); // a, b, c
  assert.equal(store.unseenCount("w2"), 1);
  assert.equal(store.totalUnseen(), 4); // the sidebar badge total
});

test("opening a watch clears only its counter and updates the total", async () => {
  const store = new FolderWatchStore(fakeContext());
  await store.add(watch("w1", "/p/bugs"));
  await store.add(watch("w2", "/p/reports"));
  await store.addUnseen("w1", ["a.md", "b.md"]);
  await store.addUnseen("w2", ["x.md"]);

  await store.clearUnseen("w1");

  assert.equal(store.unseenCount("w1"), 0);
  assert.equal(store.unseenCount("w2"), 1);
  assert.equal(store.totalUnseen(), 1);
});

test("removing a watch drops its unseen tally from the total", async () => {
  const store = new FolderWatchStore(fakeContext());
  await store.add(watch("w1", "/p/bugs"));
  await store.addUnseen("w1", ["a.md", "b.md"]);
  assert.equal(store.totalUnseen(), 2);

  await store.remove("w1");
  assert.equal(store.totalUnseen(), 0);
  assert.equal(store.unseenCount("w1"), 0);
});

test("a duplicate target+mode add does not create a second watch", async () => {
  const store = new FolderWatchStore(fakeContext());
  await store.add(watch("w1", "/p/bugs"));
  await store.add(watch("w2", "/p/bugs")); // same target + mode
  assert.equal(store.list().length, 1);
});

test("the counts event fires on a real unseen change, not a redundant one", async () => {
  const store = new FolderWatchStore(fakeContext());
  await store.add(watch("w1", "/p/bugs"));
  let fired = 0;
  store.onDidChangeCounts(() => fired++);

  await store.addUnseen("w1", ["a.md"]); // real change -> fires
  await store.addUnseen("w1", ["a.md"]); // already counted -> no fire
  await store.addUnseen("w1", []); // nothing -> no fire

  assert.equal(fired, 1);
});
