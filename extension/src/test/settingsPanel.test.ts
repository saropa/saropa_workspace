// Tests for the Settings panel host: the single panel, the page it builds (CSP, nonce,
// one row per setting with its control, description and bounds from the manifest, escaping),
// the init values, and the change message: accepted values are written, anything that does
// not fit the setting is refused, and a failed write is reverted on the page.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import * as vscode from "./_stub/vscode";
import {
  Uri, __setConfig, __getConfig, __resetConfig, __errorMessages, __resetErrorMessages, __lastWebviewPanel, __resetWebviewPanels,
  type FakeWebviewPanel,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { settle, flushEvents } from "./settle";
import { SettingsPanel } from "../views/settingsPanel";

const workspaceApi = vscode.workspace as unknown as { getConfiguration: unknown };
const originalGetConfiguration = workspaceApi.getConfiguration;

const realManifest = (): { contributes: { configuration: Array<{ properties: Record<string, { description?: string; minimum?: number; maximum?: number }> }> } } =>
  JSON.parse(nodeFs.readFileSync(nodePath.join(__dirname, "..", "..", "package.json"), "utf8"));

function context(manifest: unknown = realManifest()): ReturnType<typeof fakeContext> {
  return Object.assign(fakeContext(), { extensionUri: Uri.file("/ext"), extension: { packageJSON: manifest } });
}
const manifestWith = (properties: Record<string, unknown>): unknown => ({ contributes: { configuration: [{ properties }] } });

const panel = (): FakeWebviewPanel => __lastWebviewPanel()!;
const posted = (): Array<Record<string, unknown>> => panel().webview.postedMessages as Array<Record<string, unknown>>;
const send = (m: unknown): void => panel().webview.__receiveFromClient(m);
const read = (key: string): unknown => __getConfig("saropaWorkspace", key);
// Only the markup before the script: the script text mentions data-key too.
const keysOnPage = (html: string): string[] => [...html.split("<script")[0].matchAll(/data-key="([^"]*)"/g)].map((m) => m[1]);

beforeEach(() => {
  __resetConfig();
  __resetErrorMessages();
  __resetWebviewPanels();
});

afterEach(() => {
  __resetWebviewPanels();
  __resetConfig();
  workspaceApi.getConfiguration = originalGetConfiguration;
});

test("show opens one panel with the settings title, and a second show reuses it", () => {
  SettingsPanel.show(context());
  const first = panel();
  assert.equal(first.viewType, "saropaWorkspace.settings");
  assert.equal(first.title, "Saropa Settings");
  SettingsPanel.show(context());
  assert.equal(panel(), first);
});

test("closing the panel lets the next show create a new one", () => {
  SettingsPanel.show(context());
  const first = panel();
  first.dispose();
  SettingsPanel.show(context());
  assert.notEqual(panel(), first);
});

test("the page allows only its own resources and the nonce'd script, and loads the codicon sheet", () => {
  SettingsPanel.show(context());
  const html = panel().webview.html;
  const nonce = /<script nonce="([^"]+)">/.exec(html)?.[1] ?? "";
  assert.match(nonce, /^[A-Za-z0-9+/]{22}==$/);
  assert.ok(html.includes(
    `content="default-src 'none'; img-src 'none'; style-src vscode-webview://fake 'unsafe-inline'; font-src vscode-webview://fake; script-src 'nonce-${nonce}'"`
  ));
  assert.equal((html.match(/<script/g) ?? []).length, 1);
  assert.match(html, /<link href="\/ext\/dist\/codicon\.css" rel="stylesheet" \/>/);
});

test("the header, search box, close button and tooltip holder are present", () => {
  SettingsPanel.show(context());
  const html = panel().webview.html;
  assert.match(html, /<h1>Saropa Settings<\/h1>/);
  assert.match(html, /<div class="sub">Customize how Saropa Workspace works<\/div>/);
  assert.match(html, /<input type="text" id="settingsSearch" placeholder="Filter settings…" \/>/);
  assert.match(html, /<button class="btn primary" id="close">Close<\/button>/);
  assert.match(html, /<div class="info-tip" id="infoTip"><\/div>/);
});

test("every setting on the page is unique and exists in the extension manifest with a description", () => {
  SettingsPanel.show(context());
  const keys = keysOnPage(panel().webview.html);
  assert.equal(keys.length, 36);
  assert.equal(new Set(keys).size, keys.length);
  const props = realManifest().contributes.configuration.reduce((all, c) => ({ ...all, ...c.properties }), {} as Record<string, { description?: string }>);
  for (const key of keys) {
    assert.equal(typeof props[`saropaWorkspace.${key}`]?.description, "string", key);
  }
});

test("each control type is rendered for its setting", () => {
  SettingsPanel.show(context());
  const html = panel().webview.html;
  assert.match(html, /<label class="toggle"><input type="checkbox" data-key="previewMode\.enabled" \/>/);
  assert.match(html, /<input type="number" min="\d+"[^>]* data-key="doubleClickMs" \/>/);
  assert.match(html, /<input type="text" class="setting-input" data-key="terminalName" \/>/);
  assert.match(html, /<select data-key="hygiene\.mode"><option value="empty">empty<\/option><option value="oversized">oversized<\/option><option value="both">both<\/option><\/select>/);
});

test("number bounds come from the manifest, and default to a minimum of zero with no maximum", () => {
  SettingsPanel.show(context(manifestWith({
    "saropaWorkspace.doubleClickMs": { description: "d", minimum: 100, maximum: 2000 },
    "saropaWorkspace.hygiene.fileMaxMB": { description: "d" },
  })));
  const html = panel().webview.html;
  assert.match(html, /<input type="number" min="100" max="2000" data-key="doubleClickMs" \/>/);
  assert.match(html, /<input type="number" min="0" data-key="hygiene\.fileMaxMB" \/>/);
});

test("a description is escaped inside the tooltip attribute, and a setting without one gets none", () => {
  SettingsPanel.show(context(manifestWith({
    "saropaWorkspace.terminalName": { description: `Say "hi" <b>&</b>` },
  })));
  const html = panel().webview.html;
  assert.match(html, /<span class="info-icon" tabindex="0" role="button" aria-label="Info" data-tip="Say &quot;hi&quot; &lt;b&gt;&amp;&lt;\/b&gt;">i<\/span>/);
  assert.equal(html.includes("<b>&</b>"), false);
  assert.match(html, /<span class="info-icon" tabindex="0" role="button" aria-label="Info">i<\/span>/);
});

test("a manifest without a configuration list still renders every row, without tooltips", () => {
  SettingsPanel.show(context({}));
  const html = panel().webview.html;
  assert.equal(keysOnPage(html).length, 36);
  assert.equal(html.includes("data-tip="), false);
});

test("ready posts the current value of every setting", async () => {
  __setConfig("saropaWorkspace", "doubleClickMs", 350);
  __setConfig("saropaWorkspace", "terminalName", "Saropa");
  __setConfig("saropaWorkspace", "previewMode.enabled", true);
  SettingsPanel.show(context());
  send({ type: "ready" });
  await settle(() => posted().length === 1);
  const settings = (posted()[0] as { settings: Record<string, unknown> }).settings;
  assert.equal(posted()[0].type, "init");
  assert.deepEqual([settings.doubleClickMs, settings.terminalName, settings["previewMode.enabled"]], [350, "Saropa", true]);
  assert.deepEqual(Object.keys(settings).sort(), keysOnPage(panel().webview.html).sort());
});

test("a valid change of each control type is written to the setting", async () => {
  SettingsPanel.show(context());
  const changes: Array<[string, unknown]> = [
    ["previewMode.enabled", true],
    ["doubleClickMs", 450],
    ["terminalName", "Mine"],
    ["hygiene.mode", "both"],
  ];
  for (const [key, value] of changes) {
    send({ type: "change", key, value });
  }
  await settle(() => read("hygiene.mode") === "both");
  assert.deepEqual(changes.map(([key]) => read(key)), [true, 450, "Mine", "both"]);
});

test("a change for a key the panel does not offer is ignored", async () => {
  SettingsPanel.show(context());
  for (const key of ["telemetry.nope", "editor.fontSize", "", "__proto__", 5, undefined]) {
    send({ type: "change", key, value: 1 });
  }
  await flushEvents();
  assert.equal(read("telemetry.nope"), undefined);
  assert.equal(read("editor.fontSize"), undefined);
  assert.equal(read("__proto__"), undefined);
  assert.deepEqual(posted(), []);
});

test("a value that does not fit the setting is refused and nothing is written", async () => {
  SettingsPanel.show(context(manifestWith({ "saropaWorkspace.doubleClickMs": { description: "d", minimum: 100, maximum: 2000 } })));
  const refused: Array<[string, unknown]> = [
    ["previewMode.enabled", "yes"],
    ["previewMode.enabled", 1],
    ["doubleClickMs", "450"],
    ["doubleClickMs", Number.NaN],
    ["doubleClickMs", Number.POSITIVE_INFINITY],
    ["doubleClickMs", 50],
    ["doubleClickMs", 5000],
    ["terminalName", 12],
    ["terminalName", { a: 1 }],
    ["hygiene.mode", "everything"],
    ["hygiene.mode", 2],
  ];
  for (const [key, value] of refused) {
    send({ type: "change", key, value });
  }
  await flushEvents();
  for (const [key] of refused) {
    assert.equal(read(key), undefined, key);
  }
  assert.deepEqual(__errorMessages(), []);
});

test("a change without a value is refused", async () => {
  SettingsPanel.show(context());
  send({ type: "change", key: "previewMode.enabled" });
  await flushEvents();
  assert.equal(read("previewMode.enabled"), undefined);
});

function failWrites(error: unknown, after?: Promise<void>): void {
  workspaceApi.getConfiguration = (section?: string) => {
    const real = (originalGetConfiguration as (s?: string) => { get(k: string, d?: unknown): unknown })(section);
    return {
      get: (k: string, d?: unknown) => real.get(k, d),
      update: async () => {
        await after;
        throw error;
      },
    };
  };
}

test("a failed write shows the reason and puts the previous value back on the page", async () => {
  __setConfig("saropaWorkspace", "terminalName", "Before");
  failWrites(new Error("disk full"));
  SettingsPanel.show(context());
  send({ type: "change", key: "terminalName", value: "After" });
  await settle(() => posted().length === 1);
  assert.deepEqual(__errorMessages(), ["Could not update terminalName: disk full"]);
  assert.deepEqual(posted()[0], { type: "revertSetting", key: "terminalName", value: "Before" });
});

test("a failure that is not an Error is reported by its text", async () => {
  failWrites("nope");
  SettingsPanel.show(context());
  send({ type: "change", key: "hygiene.mode", value: "both" });
  await settle(() => posted().length === 1);
  assert.deepEqual(__errorMessages(), ["Could not update hygiene.mode: nope"]);
  assert.deepEqual(posted()[0], { type: "revertSetting", key: "hygiene.mode", value: undefined });
});

test("a write that fails after the panel was closed shows the error but posts nothing to the closed page", async () => {
  let release!: () => void;
  failWrites(new Error("late"), new Promise<void>((resolve) => { release = resolve; }));
  SettingsPanel.show(context());
  const closed = panel();
  send({ type: "change", key: "terminalName", value: "X" });
  closed.dispose();
  release();
  await settle(() => __errorMessages().length === 1);
  await flushEvents();
  assert.deepEqual(closed.webview.postedMessages, []);
});

test("the close message closes the panel", () => {
  SettingsPanel.show(context());
  send({ type: "close" });
  assert.equal(panel().disposed, true);
});

test("messages that are not objects or have an unknown type do nothing", async () => {
  SettingsPanel.show(context());
  for (const m of [null, undefined, "ready", 3, {}, { type: "nope" }]) {
    send(m);
  }
  await flushEvents();
  assert.deepEqual(posted(), []);
  assert.equal(panel().disposed, false);
});
