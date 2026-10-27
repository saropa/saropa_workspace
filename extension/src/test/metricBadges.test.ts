// Unit tests for the live metric badge registry (size / lines / modified), run
// against real temp files with the file watchers faked.

import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { metricBadges, type MetricTarget } from "../exec/metricBadges";

const ws = vscode.workspace as unknown as Record<string, unknown>;
const win = vscode.window as unknown as Record<string, unknown>;

interface FakeWatcher {
  fire(): void;
  disposed: boolean;
}
let watchers: FakeWatcher[];
let warnings: string[];
let origWarn: unknown;
let dir: string;
let n = 0;

beforeEach(() => {
  watchers = [];
  warnings = [];
  origWarn = win.showWarningMessage;
  win.showWarningMessage = (m: string): Promise<undefined> => (warnings.push(m), Promise.resolve(undefined));
  ws.createFileSystemWatcher = (): unknown => {
    const handlers: Array<() => void> = [];
    const w: FakeWatcher & Record<string, unknown> = {
      disposed: false,
      fire: () => handlers.forEach((h) => h()),
      onDidChange: (h: () => void) => handlers.push(h),
      onDidCreate: (h: () => void) => handlers.push(h),
      onDidDelete: (h: () => void) => handlers.push(h),
      dispose: () => {
        w.disposed = true;
      },
    };
    watchers.push(w);
    return w;
  };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "metric-"));
});

afterEach(() => {
  metricBadges.track([]);
  win.showWarningMessage = origWarn;
  delete ws.createFileSystemWatcher;
});

function uriOf(file: string): vscode.Uri {
  return vscode.Uri.file(file);
}

function target(file: string, metric: MetricTarget["metric"], pinId = `m${++n}`): MetricTarget {
  return { pinId, name: "file", uri: uriOf(file), metric };
}

const flush = (): Promise<void> => new Promise((r) => setImmediate(() => setImmediate(r)));

test("a size metric shows the formatted byte size", async () => {
  const file = path.join(dir, "a.bin");
  fs.writeFileSync(file, Buffer.alloc(2048));
  const t = target(file, { kind: "size" });
  metricBadges.track([t]);
  await flush();
  assert.deepEqual(metricBadges.get(t.pinId), { kind: "size", text: "2.0 KB", over: false });
});

test("a size over its threshold is marked over", async () => {
  const file = path.join(dir, "big.bin");
  fs.writeFileSync(file, Buffer.alloc(2000));
  const t = target(file, { kind: "size", thresholdBytes: 1000 });
  metricBadges.track([t]);
  await flush();
  assert.equal(metricBadges.get(t.pinId)?.over, true);
});

test("a line metric counts lines", async () => {
  const file = path.join(dir, "a.txt");
  fs.writeFileSync(file, "one\ntwo\nthree\n");
  const t = target(file, { kind: "lines" });
  metricBadges.track([t]);
  await flush();
  assert.deepEqual(metricBadges.get(t.pinId), { kind: "lines", text: "3 lines", over: false });
});

test("a modified metric carries the mtime and is never over", async () => {
  const file = path.join(dir, "m.txt");
  fs.writeFileSync(file, "x");
  const t = target(file, { kind: "modified", thresholdBytes: 1 });
  metricBadges.track([t]);
  await flush();
  const badge = metricBadges.get(t.pinId)!;
  assert.equal(badge.kind, "modified");
  assert.equal(typeof badge.mtime, "number");
  assert.equal(badge.over, false);
});

test("a missing file has no badge", async () => {
  const t = target(path.join(dir, "nope.txt"), { kind: "size" });
  metricBadges.track([t]);
  await flush();
  assert.equal(metricBadges.get(t.pinId), undefined);
});

test("untracking a shortcut disposes its watcher and clears its badge", async () => {
  const file = path.join(dir, "a.txt");
  fs.writeFileSync(file, "x");
  const t = target(file, { kind: "size" });
  metricBadges.track([t]);
  await flush();
  assert.ok(metricBadges.get(t.pinId));
  metricBadges.track([]);
  assert.equal(watchers[0].disposed, true);
  assert.equal(metricBadges.get(t.pinId), undefined);
});

test("tracking the same target again keeps one watcher", async () => {
  const file = path.join(dir, "a.txt");
  fs.writeFileSync(file, "x");
  const t = target(file, { kind: "size" });
  metricBadges.track([t]);
  metricBadges.track([{ ...t, name: "renamed" }]);
  await flush();
  assert.equal(watchers.length, 1);
  assert.equal(watchers[0].disposed, false);
});

test("changing the metric kind re-arms with a fresh watcher", async () => {
  const file = path.join(dir, "a.txt");
  fs.writeFileSync(file, "a\nb\n");
  const t = target(file, { kind: "size" });
  metricBadges.track([t]);
  metricBadges.track([{ ...t, metric: { kind: "lines" } }]);
  await flush();
  assert.equal(watchers.length, 2);
  assert.equal(watchers[0].disposed, true);
  assert.equal(metricBadges.get(t.pinId)?.kind, "lines");
});

test("a file change re-measures after the debounce and notifies listeners", async () => {
  const file = path.join(dir, "g.bin");
  fs.writeFileSync(file, Buffer.alloc(10));
  const t = target(file, { kind: "size" });
  let changes = 0;
  const sub = metricBadges.onDidChange(() => void changes++);
  metricBadges.track([t]);
  await flush();
  const before = changes;
  fs.writeFileSync(file, Buffer.alloc(3000));
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    watchers[0].fire();
    watchers[0].fire();
    mock.timers.tick(399);
    await flush();
    assert.equal(metricBadges.get(t.pinId)?.text, "10 B");
    mock.timers.tick(1);
  } finally {
    mock.timers.reset();
  }
  await flush();
  sub.dispose();
  assert.equal(metricBadges.get(t.pinId)?.text, "2.9 KB");
  assert.equal(changes, before + 1);
});

test("growing past the threshold warns once, not on the first measurement", async () => {
  const file = path.join(dir, "w.bin");
  fs.writeFileSync(file, Buffer.alloc(10));
  const t = target(file, { kind: "size", thresholdBytes: 100 });
  metricBadges.track([t]);
  await flush();
  assert.equal(warnings.length, 0);
  fs.writeFileSync(file, Buffer.alloc(500));
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    watchers[0].fire();
    mock.timers.tick(400);
  } finally {
    mock.timers.reset();
  }
  await flush();
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /over your 100 B limit/);
});

test("starting over the threshold does not warn", async () => {
  const file = path.join(dir, "s.bin");
  fs.writeFileSync(file, Buffer.alloc(500));
  metricBadges.track([target(file, { kind: "size", thresholdBytes: 100 })]);
  await flush();
  assert.equal(warnings.length, 0);
});
