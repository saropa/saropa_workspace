// Tests for the launcher page shell: the content security policy, the per-load nonce, the
// escaping of the folder name (user-controlled) and the required elements the client script
// looks up by id.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "./_stub/vscode";
import { Uri, __setWorkspaceFolders, fakeWebviewPanel } from "./_stub/vscode";
import { renderHtml } from "../views/launcherViewShell";

const workspaceApi = vscode.workspace as unknown as Record<string, unknown>;

afterEach(() => {
  __setWorkspaceFolders(undefined);
  delete workspaceApi.name;
});

const page = (): string => {
  const webview = fakeWebviewPanel("t", "t").webview as unknown as vscode.Webview;
  return renderHtml(webview, Uri.file("/ext"));
};
const folder = (name: string): void =>
  __setWorkspaceFolders([{ uri: Uri.file("/w/" + name), name, index: 0 }]);
const nonceOf = (html: string): string => /<script nonce="([^"]+)">/.exec(html)?.[1] ?? "";
const cspOf = (html: string): string => /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? "";

test("the policy blocks everything by default and allows only the nonce'd script", () => {
  const html = page();
  const nonce = nonceOf(html);
  assert.match(nonce, /^[A-Za-z0-9+/]{22}==$/);
  assert.equal(
    cspOf(html),
    `default-src 'none'; img-src 'none'; style-src vscode-webview://fake 'unsafe-inline'; font-src vscode-webview://fake; script-src 'nonce-${nonce}'`
  );
});

test("the page has exactly one script and it carries the nonce", () => {
  const html = page();
  assert.equal((html.match(/<script/g) ?? []).length, 1);
  assert.equal(html.includes("<script>"), false);
});

test("every load gets a fresh nonce", () => {
  assert.notEqual(nonceOf(page()), nonceOf(page()));
});

test("the codicon stylesheet is loaded from the dist folder of the extension", () => {
  assert.match(page(), /<link href="\/ext\/dist\/codicon\.css" rel="stylesheet" \/>/);
});

test("the folder name is escaped before it reaches the markup", () => {
  folder(`<img src=x onerror="a">&'`);
  const html = page();
  assert.match(html, /<div id="projName" class="project-name">&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;<\/div>/);
  assert.equal(html.includes("<img src=x"), false);
});

test("a folder name is shown without the no-project mark", () => {
  folder("my-app");
  assert.match(page(), /<div id="projName" class="project-name">my-app<\/div>/);
});

test("with no folder and no workspace name the header says so and carries the no-project mark", () => {
  assert.match(page(), /<div id="projName" class="project-name no-project">No folder open<\/div>/);
});

test("a saved workspace name stands in when there is no folder", () => {
  workspaceApi.name = "My <Workspace>";
  assert.match(page(), /<div id="projName" class="project-name">My &lt;Workspace&gt;<\/div>/);
});

test("the elements the client script looks up are all present", () => {
  const html = page();
  for (const id of ["projName", "projMeta", "q", "count", "leftPanel", "rsz-left", "empty", "root", "rightPanel", "rsz-right"]) {
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1, `id ${id} appears once`);
  }
});

test("the search box has a spoken label and the right panel starts hidden", () => {
  const html = page();
  assert.match(html, /<input id="q" type="text" spellcheck="false" aria-label="Search" \/>/);
  assert.match(html, /<div id="rightPanel" class="side-panel right-panel hidden">/);
  assert.match(html, /<div id="empty" class="empty hidden">No shortcuts yet\./);
});

test("the document title and the resize handles use the localized strings", () => {
  const html = page();
  assert.match(html, /<title>Saropa Workspace<\/title>/);
  assert.match(html, /title="Drag to resize left panel"/);
  assert.match(html, /title="Drag to resize right panel"/);
});
