// Tests for the Configure Run page: the content security policy and nonce, escaping of the
// shortcut name and of every path or label taken from stored data, the working-directory
// presets and the dependency list, plus the elements the page script looks up.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Uri, __setWorkspaceFolders } from "./_stub/vscode";
import { renderConfigureRunHtml } from "../views/configureRunShell";
import type { Shortcut } from "../model/shortcut";
import type { ShortcutStore } from "../model/shortcutStore";

const sc = (over: Partial<Shortcut> & { id: string }): Shortcut => ({ path: "run.sh", scope: "project", order: 0, ...over });

/** A store with the four calls the page makes. `fileAt` is where the shortcut's file resolves (undefined: not resolvable). */
function fakeStore(fileAt: string | undefined, project: Shortcut[] = [], global: Shortcut[] = []): ShortcutStore {
  return {
    resolveUri: () => (fileAt ? Uri.file(fileAt) : undefined),
    getProjectShortcuts: () => project,
    getGlobalShortcuts: () => global,
  } as unknown as ShortcutStore;
}

afterEach(() => __setWorkspaceFolders(undefined));

const inFolder = (path: string): void => __setWorkspaceFolders([{ uri: Uri.file(path), name: "w", index: 0 }]);
const page = (shortcut: Shortcut, store = fakeStore("/w/run.sh")): string => renderConfigureRunHtml(store, shortcut);
const nonceOf = (html: string): string => /<script nonce="([^"]+)">/.exec(html)?.[1] ?? "";
const presets = (html: string): string[] => [...html.matchAll(/<button class="btn cwdpreset" type="button" data-path="([^"]*)">([^<]*)<\/button>/g)].map((m) => `${m[1]}|${m[2]}`);
const depOptions = (html: string): string[] => {
  const select = /<select id="dependsOn">([\s\S]*?)<\/select>/.exec(html)?.[1] ?? "";
  return [...select.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map((m) => `${m[1]}|${m[2]}`);
};

test("the policy allows no network or images, inline styles and only the nonce'd script", () => {
  const html = page(sc({ id: "a" }));
  const nonce = nonceOf(html);
  assert.match(nonce, /^[A-Za-z0-9+/]{22}==$/);
  assert.match(html, new RegExp(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce.replace(/[+/]/g, "\\$&")}'" />`));
  assert.equal((html.match(/<script/g) ?? []).length, 1);
});

test("every load gets a fresh nonce", () => {
  const shortcut = sc({ id: "a" });
  assert.notEqual(nonceOf(page(shortcut)), nonceOf(page(shortcut)));
});

test("the shortcut name is escaped in the title, heading and subtitle", () => {
  const html = page(sc({ id: "a", label: `<img src=x onerror="1">&'` }));
  const escaped = "&lt;img src=x onerror=&quot;1&quot;&gt;&amp;&#39;";
  assert.match(html, new RegExp(`<title>Saropa Run: ${escaped}</title>`));
  assert.match(html, new RegExp(`<h1>Saropa Run: ${escaped}</h1>`));
  assert.match(html, new RegExp(`<div class="sub">Set how ${escaped} runs when you execute it\\.`));
  assert.equal(html.includes("<img src=x"), false);
});

test("every control the page script reads or writes is present exactly once", () => {
  const html = page(sc({ id: "a" }));
  const ids = ["command", "interpreterChips", "interpreterHint", "args", "fileArgRow", "fileArg", "cwd", "envEmpty", "envList", "envAdd",
    "location", "elevatedRow", "elevated", "extract", "extractInvalid", "dependsOn", "sound", "runOnSave", "concurrency", "lock",
    "commandPreview", "cancel", "save", "envRowTpl"];
  for (const id of ids) {
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1, `id ${id}`);
  }
});

test("the run location choices and the sound choices carry the values the host stores", () => {
  const html = page(sc({ id: "a" }));
  const location = /<select id="location">([\s\S]*?)<\/select>/.exec(html)?.[1] ?? "";
  assert.deepEqual([...location.matchAll(/value="([^"]*)"/g)].map((m) => m[1]), ["default", "terminal", "background", "external"]);
  const sound = /<select id="sound">([\s\S]*?)<\/select>/.exec(html)?.[1] ?? "";
  assert.deepEqual([...sound.matchAll(/value="([^"]*)"/g)].map((m) => m[1]), ["default", "on", "off"]);
});

test("the administrator switch is always on the page, next to the note that it needs an external window", () => {
  const html = page(sc({ id: "a" }));
  assert.match(html, /<div class="opt" id="elevatedRow">/);
  assert.match(html, /<input type="checkbox" id="elevated" \/>/);
  assert.match(html, /<div class="needs">[^<]+<\/div>/);
});

test("a file in a subfolder gets the default, workspace and file-folder presets", () => {
  inFolder("/w");
  assert.deepEqual(presets(page(sc({ id: "a" }), fakeStore("/w/scripts/run.sh"))), [
    "|Owning folder", "/w|Workspace folder", "/w/scripts|File&#39;s folder",
  ]);
});

test("a file directly in the workspace folder gets no duplicate file-folder preset", () => {
  inFolder("/w");
  assert.deepEqual(presets(page(sc({ id: "a" }), fakeStore("/w/run.sh"))), ["|Owning folder", "/w|Workspace folder"]);
});

test("a file that cannot be resolved offers only the default preset", () => {
  inFolder("/w");
  assert.deepEqual(presets(page(sc({ id: "a" }), fakeStore(undefined))), ["|Owning folder"]);
});

test("a file outside every workspace folder offers the default and its own folder", () => {
  assert.deepEqual(presets(page(sc({ id: "a" }), fakeStore("/elsewhere/run.sh"))), ["|Owning folder", "/elsewhere|File&#39;s folder"]);
});

test("a path with quotes and markup is escaped inside the data-path attribute", () => {
  const html = page(sc({ id: "a" }), fakeStore(`/odd"><b>/x/run.sh`));
  assert.deepEqual(presets(html), ["|Owning folder", "/odd&quot;&gt;&lt;b&gt;/x|File&#39;s folder"]);
  assert.equal(html.includes("<b>/x"), false);
});

test("the dependency list holds the other shortcuts of both scopes, without itself or recipes", () => {
  const self = sc({ id: "self", label: "Self" });
  const project = [self, sc({ id: "p1", label: "Build" }), sc({ id: "r1", label: "Recipe", isRecipe: true })];
  const global = [sc({ id: "g1", label: "Deploy", scope: "global" })];
  assert.deepEqual(depOptions(page(self, fakeStore("/w/run.sh", project, global))), [
    "|No dependency", "p1|Build (Project Shortcuts)", "g1|Deploy (Global Shortcuts)",
  ]);
});

test("a dependency name and id are escaped", () => {
  const evil = sc({ id: `x"y`, label: "<script>alert(1)</script>" });
  const html = page(sc({ id: "self" }), fakeStore("/w/run.sh", [evil]));
  assert.deepEqual(depOptions(html).slice(1), ["x&quot;y|&lt;script&gt;alert(1)&lt;/script&gt; (Project Shortcuts)"]);
  assert.equal(html.includes("<script>alert"), false);
});
