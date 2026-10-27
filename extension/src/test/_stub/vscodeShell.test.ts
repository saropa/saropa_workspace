import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "./vscode";

beforeEach(() => vscode.__resetShell());

test("an input box starts empty and hidden and is recorded in creation order", () => {
  const first = vscode.window.createInputBox();
  const second = vscode.window.createInputBox();
  assert.deepEqual(vscode.__inputBoxes(), [first, second]);
  assert.deepEqual([first.value, first.title, first.shown, first.disposed, first.buttons.length], ["", undefined, false, false, 0]);
});

test("typing sets the value and fires the change event with the text", () => {
  const box = vscode.window.createInputBox();
  const seen: string[] = [];
  box.onDidChangeValue((v) => seen.push(v));
  box.type("abc");
  assert.equal(box.value, "abc");
  assert.deepEqual(seen, ["abc"]);
  box.value = "set by code";
  assert.deepEqual(seen, ["abc"]);
});

test("pressing a button fires the event with that button, by index", () => {
  const box = vscode.window.createInputBox();
  const a = { tooltip: "a" };
  const b = { tooltip: "b" };
  box.buttons = [a, b];
  const seen: unknown[] = [];
  box.onDidTriggerButton((x) => seen.push(x));
  box.press(1);
  box.press(0);
  assert.deepEqual(seen, [b, a]);
});

test("accept fires the accept event; hide clears shown and fires the hide event", () => {
  const box = vscode.window.createInputBox();
  const log: string[] = [];
  box.onDidAccept(() => log.push("accept"));
  box.onDidHide(() => log.push("hide"));
  box.show();
  assert.equal(box.shown, true);
  box.accept();
  box.hide();
  box.dispose();
  assert.deepEqual(log, ["accept", "hide"]);
  assert.deepEqual([box.shown, box.disposed], [false, true]);
});

test("the active color theme follows the kind a test sets and resets to dark", () => {
  const theme = vscode.window.activeColorTheme;
  assert.equal(theme.kind, vscode.ColorThemeKind.Dark);
  vscode.__setColorThemeKind(vscode.ColorThemeKind.Light);
  assert.equal(theme.kind, vscode.ColorThemeKind.Light);
  vscode.__resetShell();
  assert.equal(theme.kind, vscode.ColorThemeKind.Dark);
});

test("an extension is reported only when installed, with its manifest", () => {
  assert.equal(vscode.extensions.getExtension("a.b"), undefined);
  vscode.__setInstalledExtensions(["a.b"], { contributes: { colors: [] } });
  assert.deepEqual(vscode.extensions.getExtension("a.b"), { id: "a.b", packageJSON: { contributes: { colors: [] } } });
  assert.equal(vscode.extensions.getExtension("c.d"), undefined);
  vscode.__resetShell();
  assert.equal(vscode.extensions.getExtension("a.b"), undefined);
});

test("the config reset also marks every extension as not installed", () => {
  vscode.__setInstalledExtensions(["a.b"]);
  vscode.__resetConfig();
  assert.equal(vscode.extensions.getExtension("a.b"), undefined);
});

test("a terminal records its options, shows and typed text until the shell reset", () => {
  const terminal = vscode.window.createTerminal({ name: "Run", cwd: "/work" });
  terminal.show(true);
  terminal.show();
  terminal.sendText("npm test");
  assert.deepEqual(vscode.__terminals(), [terminal]);
  assert.deepEqual([terminal.options, terminal.shownWith, terminal.sentTexts], [{ name: "Run", cwd: "/work" }, [true, false], ["npm test"]]);
  terminal.dispose();
  assert.equal(terminal.disposed, true);
  vscode.__resetShell();
  assert.deepEqual(vscode.__terminals(), []);
});
