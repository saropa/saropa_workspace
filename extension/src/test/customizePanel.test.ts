// Tests for the Customize panel host: the guard for auto shortcuts, the page it builds (CSP,
// nonce, escaping, icon and color choices), the init message (stored values, tag suggestions
// read from the file) and the save round trip through the store, including malformed input.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri, __setWorkspaceFolders, __setConfig, __resetConfig, __resetWarnings, __warningMessages, __infoMessages, __resetInfo,
  __setInstalledExtensions, __lastWebviewPanel, __resetWebviewPanels, type FakeWebviewPanel,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { settle, flushEvents } from "./settle";
import { ShortcutStore } from "../model/shortcutStore";
import { CustomizePanel } from "../views/customizePanel";
import { ICON_CATEGORIES } from "../views/iconCatalog";
import { COLOR_CHOICES } from "../commands/configureAppearance";
import { guessTagsFromContent } from "../views/customizeTagGuesser";
import type { Shortcut } from "../model/shortcut";

let dir: string;
let store: ShortcutStore;
const context = (): ReturnType<typeof fakeContext> => Object.assign(fakeContext(), { extensionUri: Uri.file("/ext") });

const panel = (): FakeWebviewPanel => __lastWebviewPanel()!;
const posted = (): Array<Record<string, unknown>> => panel().webview.postedMessages as Array<Record<string, unknown>>;
const send = (m: unknown): void => panel().webview.__receiveFromClient(m);
const fresh = (id: string): Shortcut => store.findShortcut(id)!;

async function stored(name: string, text = "x"): Promise<Shortcut> {
  nodeFs.writeFileSync(nodePath.join(dir, name), text);
  await store.addShortcut(Uri.file(`${dir}/${name}`) as never, "project");
  return store.getProjectShortcuts().find((p) => !p.isAuto && p.path === name)!;
}

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  const real = JSON.parse(nodeFs.readFileSync(nodePath.join(__dirname, "..", "..", "package.json"), "utf8"));
  __setInstalledExtensions(["saropa.saropa-workspace"], real);
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-custpanel-")).replace(/\\/g, "/");
  __setWorkspaceFolders([{ uri: Uri.file(dir), name: "proj", index: 0 }]);
  __resetWarnings(); __resetInfo(); __resetWebviewPanels();
  store = new ShortcutStore(fakeContext());
  await store.init();
});

afterEach(() => {
  __resetWebviewPanels();
  __setWorkspaceFolders(undefined);
  __resetConfig();
  nodeFs.rmSync(dir, { recursive: true, force: true });
});

test("an auto shortcut cannot be customized: a warning, no panel", () => {
  const auto = store.getProjectShortcuts().find((p) => p.isAuto)!;
  CustomizePanel.show(context(), store, auto);
  assert.deepEqual(__warningMessages(), ["An icon cannot be set on an auto-shortcut. Add the file as a shortcut explicitly first."]);
  assert.equal(__lastWebviewPanel(), undefined);
});

test("show opens one panel titled with the shortcut name", async () => {
  CustomizePanel.show(context(), store, await stored("tool.sh"));
  assert.equal(panel().viewType, "saropaWorkspace.customize");
  assert.equal(panel().title, "Saropa Customize: tool.sh");
});

test("showing again for another shortcut reuses the panel and retitles it", async () => {
  const a = await stored("a.sh");
  const b = await stored("b.sh");
  CustomizePanel.show(context(), store, a);
  const first = panel();
  CustomizePanel.show(context(), store, b);
  assert.equal(panel(), first);
  assert.equal(first.title, "Saropa Customize: b.sh");
  send({ type: "save", name: "Renamed" });
  await settle(() => first.disposed);
  assert.equal(fresh(b.id).label, "Renamed");
  assert.equal(fresh(a.id).label, undefined);
});

test("closing the panel lets the next show create a new one", async () => {
  const sc = await stored("a.sh");
  CustomizePanel.show(context(), store, sc);
  const first = panel();
  first.dispose();
  CustomizePanel.show(context(), store, sc);
  assert.notEqual(panel(), first);
});

test("the page allows only its own resources and the nonce'd script, and loads the codicon sheet", async () => {
  CustomizePanel.show(context(), store, await stored("a.sh"));
  const html = panel().webview.html;
  const nonce = /<script nonce="([^"]+)">/.exec(html)?.[1] ?? "";
  assert.match(nonce, /^[A-Za-z0-9+/]{22}==$/);
  assert.ok(html.includes(
    `content="default-src 'none'; img-src 'none'; style-src vscode-webview://fake 'unsafe-inline'; font-src vscode-webview://fake; script-src 'nonce-${nonce}'"`
  ));
  assert.equal((html.match(/<script/g) ?? []).length, 1);
  assert.match(html, /<link href="\/ext\/dist\/codicon\.css" rel="stylesheet" \/>/);
});

test("every rebuild of the page gets a new nonce", async () => {
  const a = await stored("a.sh");
  const b = await stored("b.sh");
  CustomizePanel.show(context(), store, a);
  const first = /<script nonce="([^"]+)">/.exec(panel().webview.html)?.[1];
  CustomizePanel.show(context(), store, b);
  assert.notEqual(/<script nonce="([^"]+)">/.exec(panel().webview.html)?.[1], first);
});

test("the shortcut name is escaped in the title, heading and subtitle", async () => {
  const sc = await stored("a.sh");
  await store.renameShortcut(sc, `<img src=x onerror="1">&'`);
  CustomizePanel.show(context(), store, fresh(sc.id));
  const html = panel().webview.html;
  const escaped = "&lt;img src=x onerror=&quot;1&quot;&gt;&amp;&#39;";
  assert.match(html, new RegExp(`<title>Saropa Customize: ${escaped}</title>`));
  assert.match(html, new RegExp(`<h1>Saropa Customize: ${escaped}</h1>`));
  assert.equal(html.includes("<img src=x"), false);
});

test("the footer keeps the file name as the preview fallback, escaped", async () => {
  CustomizePanel.show(context(), store, await stored(`we"ird<.sh`));
  assert.match(panel().webview.html, /data-fallback="we&quot;ird&lt;\.sh"/);
});

test("the icon grid has the clear tile and each catalog icon exactly once", async () => {
  CustomizePanel.show(context(), store, await stored("a.sh"));
  const html = panel().webview.html;
  const ids = [...html.matchAll(/<button class="tile" type="button" data-id="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ICON_CATEGORIES.flatMap((c) => [...c.ids]));
  assert.equal(new Set(ids).size, ids.length);
  assert.match(html, /<button class="tile def sel" type="button" data-id="" /);
});

test("each tint color has a swatch with its registered hex, after the default swatch", async () => {
  CustomizePanel.show(context(), store, await stored("a.sh"));
  const html = panel().webview.html;
  const swatches = [...html.matchAll(/<button class="swatch" type="button" data-color="([^"]*)" data-hex="([^"]*)" style="background:([^"]*)"/g)];
  assert.deepEqual(swatches.map((m) => m[1]), COLOR_CHOICES.map((c) => c.id));
  for (const m of swatches) {
    assert.match(m[2], /^#[0-9a-fA-F]{6,8}$/, m[1]);
    assert.equal(m[3], m[2]);
  }
  assert.ok(html.indexOf('class="swatch def"') < html.indexOf('data-color="saropaWorkspace.tint.red"'));
});

test("the color names have no leading icon token", async () => {
  CustomizePanel.show(context(), store, await stored("a.sh"));
  assert.equal(/class="swatch[^>]*title="[^"]*\$\(/.test(panel().webview.html), false);
  assert.match(panel().webview.html, /data-color="saropaWorkspace\.tint\.red"[^>]*title="Red"/);
});

test("tags in use are offered as suggestion chips, escaped, and no row appears when there are none", async () => {
  const sc = await stored("a.sh");
  CustomizePanel.show(context(), store, sc);
  assert.equal(panel().webview.html.includes('class="sugchip"'), false);
  await store.setShortcutTags(sc, ["build", `x"y`]);
  CustomizePanel.show(context(), store, fresh(sc.id));
  const chips = [...panel().webview.html.matchAll(/<button class="sugchip" type="button" data-tag="([^"]*)">([^<]*)<\/button>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(chips, [["build", "build"], ["x&quot;y", "x&quot;y"]]);
});

test("ready posts the stored name, icon, color and tags with a guessed name from the file name", async () => {
  const sc = await stored("my_build-script.sh");
  await store.renameShortcut(sc, "Build it");
  await store.updateShortcutAppearance(fresh(sc.id), "rocket", "saropaWorkspace.tint.red");
  await store.setShortcutTags(fresh(sc.id), ["ci"]);
  CustomizePanel.show(context(), store, fresh(sc.id));
  send({ type: "ready" });
  await settle(() => posted().length === 1);
  const work = (posted()[0] as { work: Record<string, unknown> }).work;
  assert.equal(posted()[0].type, "init");
  assert.deepEqual({ ...work, suggestedTags: undefined }, {
    name: "Build it", guessedName: "My Build Script", icon: "rocket", color: "saropaWorkspace.tint.red", tags: ["ci"], suggestedTags: undefined,
  });
});

test("ready for an unnamed shortcut posts an empty name and the tags suggested by the file content", async () => {
  const text = "deploy deploy deploy deploy server server server server";
  const sc = await stored("deploy.sh", text);
  CustomizePanel.show(context(), store, sc);
  send({ type: "ready" });
  await settle(() => posted().length === 1);
  const work = (posted()[0] as { work: Record<string, unknown> }).work;
  assert.equal(work.name, "");
  assert.deepEqual(work.suggestedTags, guessTagsFromContent(text));
  assert.deepEqual(work.suggestedTags, ["deploy", "server"]);
});

test("a shell shortcut or an unreadable file gets no tag suggestions", async () => {
  await store.addShellShortcut("Build", "npm run build", "project", true);
  const shell = store.getProjectShortcuts().find((p) => p.action?.kind === "shell")!;
  CustomizePanel.show(context(), store, shell);
  send({ type: "ready" });
  await settle(() => posted().length === 1);
  assert.deepEqual((posted()[0] as { work: { suggestedTags: string[] } }).work.suggestedTags, []);
  const file = await stored("gone.sh", "alpha alpha alpha alpha");
  nodeFs.rmSync(nodePath.join(dir, "gone.sh"));
  CustomizePanel.show(context(), store, file);
  send({ type: "ready" });
  await settle(() => posted().length === 2);
  assert.deepEqual((posted()[1] as { work: { suggestedTags: string[] } }).work.suggestedTags, []);
});

test("ready after the shortcut was removed posts nothing", async () => {
  const sc = await stored("a.sh");
  CustomizePanel.show(context(), store, sc);
  await store.removeShortcut(sc);
  send({ type: "ready" });
  await flushEvents();
  assert.deepEqual(posted(), []);
});

test("save stores the name, icon, color and cleaned tags, thanks the user by the new name and closes", async () => {
  const sc = await stored("a.sh");
  CustomizePanel.show(context(), store, sc);
  send({ type: "save", name: "  Nightly  ", icon: "rocket", color: "saropaWorkspace.tint.blue", tags: [" CI ", "ci", "", "Deploy"] });
  await settle(() => panel().disposed);
  const saved = fresh(sc.id);
  assert.deepEqual([saved.label, saved.icon, saved.color, saved.tags], ["Nightly", "rocket", "saropaWorkspace.tint.blue", ["ci", "deploy"]]);
  assert.deepEqual(__infoMessages(), ["Saved appearance for Nightly."]);
});

test("saving with no icon drops the color, since a color only tints an icon", async () => {
  const sc = await stored("a.sh");
  await store.updateShortcutAppearance(sc, "rocket", "saropaWorkspace.tint.red");
  CustomizePanel.show(context(), store, fresh(sc.id));
  send({ type: "save", name: "", icon: "", color: "saropaWorkspace.tint.blue", tags: [] });
  await settle(() => panel().disposed);
  assert.equal(fresh(sc.id).icon, undefined);
  assert.equal(fresh(sc.id).color, undefined);
});

test("saving a blank name removes the custom label and the thanks names the shortcut as it now shows", async () => {
  const sc = await stored("plain.sh");
  await store.renameShortcut(sc, "Old name");
  CustomizePanel.show(context(), store, fresh(sc.id));
  send({ type: "save", name: "   ", tags: [] });
  await settle(() => panel().disposed);
  assert.equal(fresh(sc.id).label, undefined);
  assert.deepEqual(__infoMessages(), ["Saved appearance for plain.sh."]);
});

test("malformed fields in a save are ignored instead of failing the save", async () => {
  const sc = await stored("a.sh");
  await store.setShortcutTags(sc, ["keep"]);
  CustomizePanel.show(context(), store, fresh(sc.id));
  send({ type: "save", name: 5, icon: { x: 1 }, color: 7, tags: ["ok", 3, null, { a: 1 }] });
  await settle(() => panel().disposed);
  const saved = fresh(sc.id);
  assert.deepEqual([saved.label, saved.icon, saved.color, saved.tags], [undefined, undefined, undefined, ["ok"]]);
  assert.deepEqual(__infoMessages(), ["Saved appearance for a.sh."]);
});

test("a save with tags that is not a list clears the tags", async () => {
  const sc = await stored("a.sh");
  await store.setShortcutTags(sc, ["keep"]);
  CustomizePanel.show(context(), store, fresh(sc.id));
  send({ type: "save", name: "N", tags: "keep" });
  await settle(() => panel().disposed);
  assert.equal(fresh(sc.id).tags, undefined);
});

test("saving for a shortcut removed in the meantime warns and closes without a thank-you", async () => {
  const sc = await stored("a.sh");
  CustomizePanel.show(context(), store, sc);
  await store.removeShortcut(sc);
  send({ type: "save", name: "X" });
  await settle(() => panel().disposed);
  assert.deepEqual(__warningMessages(), ["An icon cannot be set on an auto-shortcut. Add the file as a shortcut explicitly first."]);
  assert.deepEqual(__infoMessages(), []);
});

test("cancel closes the panel and changes nothing", async () => {
  const sc = await stored("a.sh");
  CustomizePanel.show(context(), store, sc);
  send({ type: "cancel" });
  assert.equal(panel().disposed, true);
  assert.equal(fresh(sc.id).label, undefined);
  assert.deepEqual(__infoMessages(), []);
});

test("messages that are not objects or have an unknown type do nothing", async () => {
  CustomizePanel.show(context(), store, await stored("a.sh"));
  for (const m of [null, undefined, "save", 3, {}, { type: "nope" }]) {
    send(m);
  }
  await flushEvents();
  assert.deepEqual(posted(), []);
  assert.equal(panel().disposed, false);
});
