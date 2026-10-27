// Tests for the Scripts view: tag folders in alphabetical order, a script listed under each
// of its tags, the flat list when there is at most one tag, lookup by id, and the count
// event that fires only when the number of scripts changes.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import * as os from "node:os";
import { ScriptsTreeProvider, ScriptTreeItem } from "../views/scriptsTreeProvider";

let dir: string;

function writeManifest(scripts: Array<{ id: string; tags: string[]; icon?: string }>): void {
  const libDir = nodePath.join(dir, "scripts", "library");
  nodeFs.mkdirSync(libDir, { recursive: true });
  const entries = scripts.map((s) => ({
    id: s.id,
    labelKey: `label.${s.id}`,
    descriptionKey: `desc.${s.id}`,
    ...(s.icon ? { icon: s.icon } : {}),
    tags: s.tags,
    entry: `${s.id}/__main__.py`,
    requires: [],
    config: { command: "python" },
  }));
  nodeFs.writeFileSync(nodePath.join(libDir, "library.json"), JSON.stringify({ version: 1, scripts: entries }));
}
const label = (item: { label?: unknown }): string => String(item.label);

beforeEach(() => {
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-scripts-"));
});

afterEach(() => {
  nodeFs.rmSync(dir, { recursive: true, force: true });
});

test("scripts group under alphabetical tag folders and appear under every tag they carry", () => {
  writeManifest([
    { id: "a", tags: ["reports", "cleanup"] },
    { id: "b", tags: ["cleanup"] },
    { id: "c", tags: ["android"] },
  ]);
  const provider = new ScriptsTreeProvider(dir);
  const folders = provider.getChildren();
  assert.deepEqual(folders.map(label), ["android", "cleanup", "reports"]);
  assert.deepEqual(folders.map((f) => f.description), ["1", "2", "1"]);
  assert.deepEqual(folders.map((f) => f.contextValue), ["scriptTag", "scriptTag", "scriptTag"]);
  assert.equal(folders[0].collapsibleState, 2);
  assert.equal((folders[0].iconPath as { id: string }).id, "tag");
  assert.deepEqual(provider.getChildren(folders[1]).map(label), ["label.a", "label.b"]);
  assert.deepEqual(provider.getChildren(folders[2]).map(label), ["label.a"]);
});

test("a script row shows its tags, description and icon, and has no children", () => {
  writeManifest([{ id: "a", tags: ["x", "y"], icon: "beaker" }, { id: "b", tags: ["x"] }]);
  const provider = new ScriptsTreeProvider(dir);
  const [first, second] = provider.getChildren(provider.getChildren()[0]) as ScriptTreeItem[];
  assert.equal(first.description, "x, y");
  assert.equal(first.tooltip, "desc.a");
  assert.equal((first.iconPath as { id: string }).id, "beaker");
  assert.equal(first.contextValue, "libraryScript");
  assert.equal(first.collapsibleState, 0);
  assert.equal((second.iconPath as { id: string }).id, "file");
  assert.deepEqual(provider.getChildren(first), []);
  assert.equal(provider.getTreeItem(first), first);
});

test("one shared tag lists the scripts flat at the root", () => {
  writeManifest([{ id: "a", tags: ["only"] }, { id: "b", tags: ["only"] }]);
  const provider = new ScriptsTreeProvider(dir);
  assert.deepEqual(provider.getChildren().map(label), ["label.a", "label.b"]);
});

test("scripts with no tags are listed flat", () => {
  writeManifest([{ id: "a", tags: [] }]);
  assert.deepEqual(new ScriptsTreeProvider(dir).getChildren().map(label), ["label.a"]);
});

test("a missing manifest gives an empty view", () => {
  const provider = new ScriptsTreeProvider(dir);
  assert.deepEqual(provider.getChildren(), []);
  assert.equal(provider.count, 0);
  assert.deepEqual(provider.scripts, []);
});

test("findScript looks a script up by its manifest id", () => {
  writeManifest([{ id: "a", tags: ["t"] }, { id: "b", tags: ["t"] }]);
  const provider = new ScriptsTreeProvider(dir);
  assert.equal(provider.findScript("b")?.entry, "b/__main__.py");
  assert.equal(provider.findScript("missing"), undefined);
});

test("refresh reloads the manifest, repaints and reports a changed count only once", () => {
  writeManifest([{ id: "a", tags: ["t"] }]);
  const provider = new ScriptsTreeProvider(dir);
  const counts: number[] = [];
  let repaints = 0;
  provider.onDidChangeCount((n) => counts.push(n));
  provider.onDidChangeTreeData(() => repaints++);
  assert.equal(provider.count, 1);
  provider.refresh();
  assert.deepEqual([repaints, counts], [1, []]);
  writeManifest([{ id: "a", tags: ["t"] }, { id: "b", tags: ["t"] }]);
  provider.refresh();
  assert.deepEqual([repaints, counts, provider.count], [2, [2], 2]);
  assert.deepEqual(provider.getChildren().map(label), ["label.a", "label.b"]);
});
