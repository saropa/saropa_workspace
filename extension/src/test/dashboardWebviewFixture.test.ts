// Tests for the dashboard webview test fixture.

import { test } from "node:test";
import assert from "node:assert/strict";
import { dataMessage, group, groupNames, open, proc, strings } from "./dashboardWebviewFixture";

test("proc, group and dataMessage build the shapes the script reads", () => {
  const g = group("node", 12, 2048, [proc(7, "node", 12, 2048)]);
  assert.deepEqual(g, { tool: "node", cpuPercent: 12, rssBytes: 2048, pidCount: 1, procs: [{ pid: 7, name: "node", cpuPercent: 12, rssBytes: 2048 }] });
  const msg = dataMessage([g], { killable: { node: true } }) as { type: string; killable: object; trend: unknown[] };
  assert.deepEqual([msg.type, msg.killable, msg.trend], ["data", { node: true }, []]);
});

test("open starts the real shell on a tab and passes computed styles to the page", () => {
  const page = open("trends", { "--vscode-charts-blue": "#00f" });
  assert.deepEqual(page.posted, [{ type: "activateTab", tab: "trends" }]);
  assert.equal(Object.keys(strings(page)).includes("processEmpty"), true);
  page.receive(dataMessage([group("b", 1, 1, [proc(1, "b", 1, 1)]), group("a", 5, 1, [proc(2, "a", 5, 1)])]));
  assert.deepEqual(groupNames(page), ["a", "b"]);
});
