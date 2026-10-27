// Tests for the toasts a finished background run raises: the failure toast and its fix
// suggestion, the success toast, the blocked-port prompt, and copying an extracted value.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as net from "node:net";
import * as vscode from "vscode";
import { __errorMessages, __resetEnv, __resetErrorMessages, env } from "./_stub/vscode";
import { extractAndCopy, notifyCompletion, notifyFailure } from "../exec/backgroundNotify";

const win = vscode.window as unknown as Record<string, unknown>;
let infos: string[];
let errors: Array<{ message: string; actions: string[] }>;
let errorAnswer: ((actions: string[]) => string | undefined) | undefined;
let terminals: Array<{ options: { name: string; cwd: string }; sent: string[]; shown: boolean[] }>;
const channelShows: boolean[] = [];
const saved: Record<string, unknown> = {};

// The module caches its output channel on first use, so the recording channel is
// installed once for the whole file, before any test runs.
saved.channel = win.createOutputChannel;
win.createOutputChannel = (): unknown => ({
  appendLine(): void {},
  show(preserve?: boolean): void {
    channelShows.push(preserve === true);
  },
});

beforeEach(() => {
  infos = [];
  errors = [];
  errorAnswer = undefined;
  terminals = [];
  channelShows.length = 0;
  __resetEnv();
  __resetErrorMessages();
  saved.info = win.showInformationMessage;
  saved.error = win.showErrorMessage;
  saved.terminal = win.createTerminal;
  win.showInformationMessage = (m: string): Promise<undefined> => (infos.push(m), Promise.resolve(undefined));
  win.showErrorMessage = (message: string, ...actions: string[]): Promise<string | undefined> => {
    errors.push({ message, actions });
    return Promise.resolve(errorAnswer?.(actions));
  };
  win.createTerminal = (options: { name: string; cwd: string }): unknown => {
    const t = { options, sent: [] as string[], shown: [] as boolean[] };
    terminals.push(t);
    return {
      show: (preserve: boolean): void => void t.shown.push(preserve),
      sendText: (text: string): void => void t.sent.push(text),
    };
  };
});
afterEach(() => {
  win.showInformationMessage = saved.info;
  win.showErrorMessage = saved.error;
  win.createTerminal = saved.terminal;
});

const settle = (): Promise<void> => new Promise((r) => setImmediate(r));

test("a success toast names the run and how long it took", () => {
  notifyCompletion("Build", "success", 0, 1500);
  assert.deepEqual(infos, ["Build finished in 1.5s."]);
  assert.deepEqual(errors, []);
});

test("a failure toast shows the exit code and offers to show the output", async () => {
  errorAnswer = (actions) => actions[0];
  notifyCompletion("Build", "failure", 2, 90_000);
  await settle();
  assert.deepEqual(errors, [{ message: "Build failed (exit 2) after 1m 30s.", actions: ["Show Output"] }]);
  assert.deepEqual(channelShows, [true]);
});

test("a failure with no exit code shows a question mark", () => {
  notifyCompletion("Build", "failure", null, 500);
  assert.equal(errors[0].message, "Build failed (exit ?) after 500ms.");
});

test("a failure with a fix offers it first, and choosing it runs the fix in a terminal", async () => {
  errorAnswer = (actions) => actions[0];
  notifyCompletion("Build", "failure", 1, 100, { command: "npm install left-pad", cwd: "/p" });
  await settle();
  assert.deepEqual(errors[0].actions, ["Run: npm install left-pad", "Show Output"]);
  assert.equal(terminals.length, 1);
  assert.deepEqual([terminals[0].options.name, terminals[0].options.cwd], ["Saropa Workspace: Build", "/p"]);
  assert.deepEqual(terminals[0].sent, ["npm install left-pad"]);
  assert.deepEqual(terminals[0].shown, [false]);
});

test("dismissing a failure toast does nothing more", async () => {
  notifyCompletion("Build", "failure", 1, 100, { command: "x", cwd: "/p" });
  await settle();
  assert.deepEqual(terminals, []);
  assert.deepEqual(channelShows, []);
});

const fixFor = async (output: string): Promise<string[]> => {
  errors = [];
  await notifyFailure("Job", 1, 100, output, "/p");
  return errors[0].actions;
};

test("fix suggestions are recognized for the common package managers and 'run X' hints", async () => {
  assert.deepEqual(await fixFor("Error: missing. Try running `npm install lodash`"), ["Run: npm install lodash", "Show Output"]);
  assert.deepEqual(await fixFor("run: 'dart pub get'"), ["Run: dart pub get", "Show Output"]);
  assert.deepEqual(await fixFor("Cannot find module. pnpm install --save-dev @types/node first"), ["Run: pnpm install --save-dev @types/node", "Show Output"]);
  assert.deepEqual(await fixFor("missing; yarn add react-dom"), ["Run: yarn add react-dom", "Show Output"]);
  assert.deepEqual(await fixFor("ModuleNotFoundError: pip3 install requests>=2"), ["Run: pip3 install requests>=2", "Show Output"]);
});

test("output with no recognizable fix offers only the output", async () => {
  assert.deepEqual(await fixFor("segmentation fault"), ["Show Output"]);
});

test("a copied value is the first capture group, else the whole match", async () => {
  extractAndCopy("version (\\d+\\.\\d+)", "tool version 1.2 ready", "Tool");
  assert.equal(await env.clipboard.readText(), "1.2");
  extractAndCopy("ready", "tool version 1.2 ready", "Tool");
  assert.equal(await env.clipboard.readText(), "ready");
  assert.deepEqual(infos, ["Copied from Tool: 1.2", "Copied from Tool: ready"]);
});

test("the pattern is matched per line, so ^ anchors a line", async () => {
  extractAndCopy("^id=(\\w+)", "noise\nid=abc\nid=def", "Tool");
  assert.equal(await env.clipboard.readText(), "abc");
});

test("an invalid pattern or no match copies nothing and shows no toast", async () => {
  extractAndCopy("(", "text", "Tool");
  extractAndCopy("nothing", "text", "Tool");
  assert.equal(await env.clipboard.readText(), "");
  assert.deepEqual(infos, []);
});

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

test("a blocked port with no identifiable holder offers to inspect the port", async () => {
  const port = await freePort();
  errorAnswer = (actions) => actions[0];
  await notifyFailure("Server", 1, 100, `Error: listen EADDRINUSE: address already in use :::${port}`, "/p");
  await settle();
  assert.equal(
    errors[0].message,
    `Port ${port} is in use, so Server couldn't start, but the process holding it couldn't be identified.`
  );
  assert.deepEqual(errors[0].actions, ["Inspect Port", "Show Output"]);
  assert.deepEqual(terminals[0].sent, [
    process.platform === "win32" ? `netstat -ano | findstr :${port}` : `lsof -nP -iTCP:${port} -sTCP:LISTEN`,
  ]);
});

test("an in-use marker with no port number falls back to the ordinary failure toast", async () => {
  await notifyFailure("Server", 1, 100, "address already in use", "/p");
  assert.equal(errors[0].message, "Server failed (exit 1) after 100ms.");
  assert.deepEqual(__errorMessages(), []);
});
