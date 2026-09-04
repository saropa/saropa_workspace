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
  isGlobalWatch,
  watchKind,
  watchDisplayName,
  matchesRepoFilter,
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

// --- repo watch kind + display name (WatchKind "repo") ------------------------

test("watchKind defaults absent kind to 'folder' (old data needs no migration)", () => {
  const w: FolderWatch = { id: "w", target: "/src/x", isFile: false, mode: "new", enabled: true };
  assert.equal(watchKind(w), "folder");
});

test("watchKind reads an explicit 'repo' kind", () => {
  const w: FolderWatch = {
    id: "w",
    target: "saropa/saropa-workspace",
    kind: "repo",
    isFile: false,
    mode: "new",
    enabled: true,
  };
  assert.equal(watchKind(w), "repo");
});

test("watchDisplayName keeps a repo watch's owner/repo target intact", () => {
  // path.basename would wrongly strip this down to just "saropa-workspace".
  const w: FolderWatch = {
    id: "w",
    target: "saropa/saropa-workspace",
    kind: "repo",
    isFile: false,
    mode: "new",
    enabled: true,
  };
  assert.equal(watchDisplayName(w), "saropa/saropa-workspace");
});

test("watchDisplayName basenames a folder watch's target", () => {
  const w: FolderWatch = {
    id: "w",
    target: "/src/contacts/bugs",
    isFile: false,
    mode: "new",
    enabled: true,
  };
  assert.equal(watchDisplayName(w), "bugs");
});

test("watchDisplayName prefers an explicit label over the target for either kind", () => {
  const w: FolderWatch = {
    id: "w",
    target: "saropa/saropa-workspace",
    kind: "repo",
    label: "Main repo",
    isFile: false,
    mode: "new",
    enabled: true,
  };
  assert.equal(watchDisplayName(w), "Main repo");
});

// --- per-project alert scope (the "do not blast every project" gate) ----------

// A folder watch with an optional explicit alert scope, for the gate tests.
function scopedWatch(
  target: string,
  alertScopes?: string[],
  global?: boolean
): FolderWatch {
  return {
    id: "w",
    target,
    isFile: false,
    mode: "new",
    enabled: true,
    alertScopes,
    global,
  };
}

test("a watch alerts in the project that contains its target (projects watch their own)", () => {
  // The automatic default: a per-project bugs watch fires in its own project and
  // nowhere else, with no scope set.
  const w = scopedWatch("/src/contacts/bugs");
  assert.equal(watchAlertsIn(w, ["/src/contacts"]), true);
  // The exact "blasted every project" report: it must NOT fire in another project.
  assert.equal(watchAlertsIn(w, ["/src/workspace"]), false);
});

test("a watch on its own folder alerts there regardless of alertScopes", () => {
  // "Projects watch their own": the containing project always alerts, so neither an
  // empty scope nor a scope listing other projects can silence a watch in its owner.
  assert.equal(watchAlertsIn(scopedWatch("/src/contacts/bugs", []), ["/src/contacts"]), true);
  assert.equal(
    watchAlertsIn(scopedWatch("/src/contacts/bugs", ["/src/other"]), ["/src/contacts"]),
    true
  );
});

test("alertScopes opts an outside-target watch into extra projects only", () => {
  // A target outside any open project alerts only where explicitly opted in.
  const w = scopedWatch("/external/dropbox", ["/src/contacts"]);
  assert.equal(watchAlertsIn(w, ["/src/contacts"]), true);
  assert.equal(watchAlertsIn(w, ["/src/workspace"]), false);
  // Multi-root window holding one listed folder still alerts.
  assert.equal(watchAlertsIn(w, ["/src/workspace", "/src/contacts"]), true);
  // No scope and an outside target: alerts nowhere until opted in.
  assert.equal(watchAlertsIn(scopedWatch("/external/dropbox"), ["/src/workspace"]), false);
});

test("a global watch alerts in every project, including unrelated ones", () => {
  const w = scopedWatch("/src/contacts/bugs", undefined, true);
  assert.equal(isGlobalWatch(w), true);
  assert.equal(watchAlertsIn(w, ["/src/contacts"]), true);
  assert.equal(watchAlertsIn(w, ["/src/workspace"]), true);
  // Even with no folder open, a global watch is considered alerting.
  assert.equal(watchAlertsIn(w, []), true);
});

test("a repo watch's slug target never matches via path-relative containment", () => {
  // A repo watch's target is "owner/repo", not a filesystem path — even one that
  // happens to collide with an open folder's basename must not alert there without
  // an explicit alertScopes opt-in, unlike a folder watch (rule 2 is folder-only).
  const w: FolderWatch = {
    id: "r1",
    target: "saropa/saropa-workspace",
    kind: "repo",
    isFile: false,
    mode: "new",
    enabled: true,
  };
  assert.equal(watchAlertsIn(w, ["/src/saropa-workspace"]), false);
  // Still respects an explicit opt-in via alertScopes.
  const scoped: FolderWatch = { ...w, alertScopes: ["/src/saropa-workspace"] };
  assert.equal(watchAlertsIn(scoped, ["/src/saropa-workspace"]), true);
});

// --- repo watch label/author filter --------------------------------------------

function repoItem(labels: string[], author: string): { author: string; labels: string[] } {
  return { author, labels };
}

test("matchesRepoFilter matches everything when no filter is set", () => {
  const w: FolderWatch = { id: "r1", target: "a/b", isFile: false, mode: "new", enabled: true };
  assert.equal(matchesRepoFilter(w, repoItem([], "anyone")), true);
  assert.equal(matchesRepoFilter(w, repoItem(["bug"], "octocat")), true);
});

test("matchesRepoFilter's label filter is case-insensitive OR across filterLabels", () => {
  const w: FolderWatch = {
    id: "r1",
    target: "a/b",
    isFile: false,
    mode: "new",
    enabled: true,
    filterLabels: ["Bug", "priority-high"],
  };
  assert.equal(matchesRepoFilter(w, repoItem(["bug"], "x")), true);
  assert.equal(matchesRepoFilter(w, repoItem(["PRIORITY-HIGH"], "x")), true);
  assert.equal(matchesRepoFilter(w, repoItem(["docs"], "x")), false);
  assert.equal(matchesRepoFilter(w, repoItem([], "x")), false);
});

test("matchesRepoFilter's author filter is case-insensitive exact match", () => {
  const w: FolderWatch = {
    id: "r1",
    target: "a/b",
    isFile: false,
    mode: "new",
    enabled: true,
    filterAuthor: "Octocat",
  };
  assert.equal(matchesRepoFilter(w, repoItem([], "octocat")), true);
  assert.equal(matchesRepoFilter(w, repoItem([], "someone-else")), false);
});

test("matchesRepoFilter ANDs label and author filters when both are set", () => {
  const w: FolderWatch = {
    id: "r1",
    target: "a/b",
    isFile: false,
    mode: "new",
    enabled: true,
    filterLabels: ["bug"],
    filterAuthor: "octocat",
  };
  assert.equal(matchesRepoFilter(w, repoItem(["bug"], "octocat")), true);
  assert.equal(matchesRepoFilter(w, repoItem(["bug"], "someone-else")), false);
  assert.equal(matchesRepoFilter(w, repoItem(["docs"], "octocat")), false);
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
  assert.equal(store.totalUnseen(), 4); // sum across watches
});

test("the scoped badge total counts only watches that alert in this window", async () => {
  // The badge form of the "do not blast every project" rule: a window's total must
  // exclude another project's watch, even though both have unseen files globally.
  const store = new FolderWatchStore(fakeContext());
  await store.add(watch("local", "/p/bugs")); // owned by /p
  await store.add(watch("away", "/external/x")); // outside any open project
  await store.addUnseen("local", ["a.md", "b.md"]);
  await store.addUnseen("away", ["x.md"]);

  assert.equal(store.totalUnseen(), 3); // unscoped: every watch
  assert.equal(store.totalUnseen(["/p"]), 2); // scoped to /p: only the local watch
  assert.equal(store.totalUnseen(["/other"]), 0); // neither alerts here
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

function repoWatch(id: string, target: string): FolderWatch {
  return { id, target, kind: "repo", isFile: false, mode: "new", enabled: true };
}

test("a case-different repo watch add does not create a second watch (store-level backstop)", async () => {
  // The add-repo-watch command flow already checks this before calling add(), but
  // the store enforces it too, so any other caller of add() (an import/sync path)
  // cannot silently reintroduce a case-duplicate.
  const store = new FolderWatchStore(fakeContext());
  await store.add(repoWatch("w1", "Facebook/react"));
  await store.add(repoWatch("w2", "facebook/REACT"));
  assert.equal(store.list().length, 1);
});

test("a folder watch's target dedup stays exact-case (not folded into the repo case-insensitive rule)", async () => {
  const store = new FolderWatchStore(fakeContext());
  await store.add(watch("w1", "/p/Bugs"));
  await store.add(watch("w2", "/p/bugs")); // different case, folder watch
  assert.equal(store.list().length, 2);
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
