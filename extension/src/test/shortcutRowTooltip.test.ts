// Unit tests for the tree-row hover assembly: which lines appear, in what order,
// and which are suppressed (masked, running, stopping).

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildShortcutTooltipLines, type ShortcutTooltipInput } from "../views/shortcutRowTooltip";
import { l10n } from "../i18n/l10n";
import type { Shortcut } from "../model/shortcut";

const fileShortcut = { id: "a", path: "src/a.ts", scope: "project" } as Shortcut;

function input(over: Partial<ShortcutTooltipInput> = {}): ShortcutTooltipInput {
  return {
    shortcut: fileShortcut,
    masked: false,
    isFile: true,
    resolvedUri: undefined,
    isRunning: false,
    isStopping: false,
    missing: false,
    lockedBy: undefined,
    lastRun: undefined,
    sweepBadge: undefined,
    previousBadge: undefined,
    runCount: 0,
    metricBadge: undefined,
    metricText: undefined,
    untapped: false,
    customColor: undefined,
    shadowsAuto: false,
    owningFolder: undefined,
    ...over,
  };
}

test("a plain file shortcut shows its path then the gesture hint", () => {
  assert.deepEqual(buildShortcutTooltipLines(input()), ["src/a.ts", l10n("pin.gestureHint")]);
});

test("the resolved absolute path wins over the stored path", () => {
  const lines = buildShortcutTooltipLines(input({ resolvedUri: { fsPath: "/abs/src/a.ts" } as never }));
  assert.equal(lines[0], "/abs/src/a.ts");
});

test("a url shortcut shows the full URL", () => {
  const s = { id: "u", path: "", scope: "project", action: { kind: "url", url: "https://example.com/a?b=1" } } as Shortcut;
  assert.equal(buildShortcutTooltipLines(input({ shortcut: s, isFile: false }))[0], "https://example.com/a?b=1");
});

test("a masked shortcut hides the target, description and folder", () => {
  const s = { ...fileShortcut, description: "secret detail" } as Shortcut;
  const lines = buildShortcutTooltipLines(input({ shortcut: s, masked: true, owningFolder: "client-x", shadowsAuto: true }));
  assert.equal(lines[0], l10n("mask.tooltip"));
  const text = lines.join("\n");
  assert.ok(!text.includes("src/a.ts"));
  assert.ok(!text.includes("secret detail"));
  assert.ok(!text.includes("client-x"));
  assert.ok(!lines.includes(l10n("shadowsAuto.tooltip")));
});

test("a recipe description leads, followed by the target, and the click hint replaces the gesture hint", () => {
  const s = { ...fileShortcut, isRecipe: true, description: "Runs the linter" } as Shortcut;
  const lines = buildShortcutTooltipLines(input({ shortcut: s }));
  assert.deepEqual(lines.slice(0, 2), ["Runs the linter", "src/a.ts"]);
  assert.ok(lines.includes(l10n("recipe.clickHint")));
  assert.ok(!lines.includes(l10n("pin.gestureHint")));
});

test("running and stopping states lead and suppress notices", () => {
  const s = { ...fileShortcut, expires: { at: Date.now() + 1000 } } as Shortcut;
  const running = buildShortcutTooltipLines(input({ shortcut: s, isRunning: true, missing: true, lockedBy: "dep", untapped: true }));
  assert.equal(running[1], l10n("run.runningTooltip"));
  assert.equal(running.length, 2);
  const stopping = buildShortcutTooltipLines(input({ isStopping: true }));
  assert.equal(stopping[1], l10n("run.stoppingTooltip"));
});

test("a paused shortcut says so", () => {
  const s = { ...fileShortcut, paused: true } as Shortcut;
  assert.ok(buildShortcutTooltipLines(input({ shortcut: s })).includes(l10n("pause.tooltip")));
});

test("a scheduled shortcut shows its next run", () => {
  const s = { ...fileShortcut, schedule: { enabled: true, atTime: "09:00" } } as unknown as Shortcut;
  const lines = buildShortcutTooltipLines(input({ shortcut: s }));
  assert.ok(lines.some((l) => l.startsWith("Next run: ")), lines.join("|"));
  assert.equal(lines.length, 3);
});

test("missing target, lock and expiry notices appear when idle", () => {
  const s = { ...fileShortcut, expires: { at: Date.UTC(2030, 0, 1), onBranchAway: "main" } } as Shortcut;
  const lines = buildShortcutTooltipLines(input({ shortcut: s, missing: true, lockedBy: "Build" }));
  assert.ok(lines.includes(l10n("pin.missingTooltip")));
  assert.ok(lines.includes(l10n("depends.lockedTooltip", { dep: "Build" })));
  assert.ok(lines.includes(l10n("expiry.tooltip.branch", { branch: "main" })));
  assert.ok(lines.some((l) => l.startsWith("Expires ")));
});

test("run count is shown only once positive", () => {
  assert.ok(!buildShortcutTooltipLines(input({ runCount: 0 })).includes(l10n("run.countTooltip", { count: 0 })));
  assert.ok(buildShortcutTooltipLines(input({ runCount: 3 })).includes(l10n("run.countTooltip", { count: 3 })));
});

test("the last run outcome is surfaced", () => {
  const lines = buildShortcutTooltipLines(
    input({ lastRun: { outcome: "failure", exitCode: 1, durationMs: 1500, endedAt: Date.now() } })
  );
  assert.equal(lines.length, 3);
});

test("metadata lines: folder, tags, branch, metric (normal and over), untapped, shadow", () => {
  const s = { ...fileShortcut, tags: ["ci", "fast"], branch: "dev" } as Shortcut;
  const base = input({ shortcut: s, owningFolder: "api", untapped: true, shadowsAuto: true, metricText: "12 KB" });
  const lines = buildShortcutTooltipLines(base);
  assert.ok(lines.includes(l10n("folder.tooltip", { folder: "api" })));
  assert.ok(lines.includes(l10n("tag.tooltip", { tags: "#ci #fast" })));
  assert.ok(lines.includes(l10n("branch.tooltip", { branch: "dev" })));
  assert.ok(lines.includes(l10n("metric.tooltip", { value: "12 KB" })));
  assert.ok(lines.includes(l10n("shadowsAuto.tooltip")));
  assert.ok(lines.includes(l10n("untapped.rowTooltip")));
  const over = buildShortcutTooltipLines({
    ...base,
    metricBadge: { kind: "size", text: "12 KB", over: true },
  });
  assert.ok(over.includes(l10n("metric.overTooltip", { value: "12 KB" })));
  assert.ok(!over.includes(l10n("metric.tooltip", { value: "12 KB" })));
});

test("an unknown tint id adds no color line", () => {
  const withUnknown = buildShortcutTooltipLines(input({ customColor: "saropaWorkspace.tint.nope" }));
  assert.deepEqual(withUnknown, buildShortcutTooltipLines(input()));
});
