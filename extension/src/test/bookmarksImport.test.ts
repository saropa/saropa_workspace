// Mapping + idempotency tests for the alefragnani "Bookmarks" importer (roadmap
// "additional import formats" — the Bookmarks slice). These run the REAL importer
// against the REAL PinStore: the fs-backed vscode stub persists the project file to
// a temp directory, so the 0-based->1-based line conversion, the "$ROOTPATH$" strip,
// the label fallback, the outside-folder skip, the malformed-file guard, and dedup
// on re-run all execute end to end. Only the host SHELL (the vscode API) is faked.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri,
  __setWorkspaceFolders,
  __setConfig,
  __resetConfig,
  type WorkspaceFolder,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { PinStore } from "../model/pinStore";
import { importBookmarks } from "../import/favoritesKdcroBookmarks";
import type { DetectedFavorites } from "../import/favoritesImport";
import type { OutputChannel } from "vscode";

// A line-collecting OutputChannel: the importer only ever calls appendLine, so the
// rest of the channel surface is cast away (mirrors the kdcro test).
function fakeChannel(): { channel: OutputChannel; lines: string[] } {
  const lines: string[] = [];
  const channel = {
    appendLine: (m: string): void => {
      lines.push(m);
    },
  } as unknown as OutputChannel;
  return { channel, lines };
}

let tmpDir: string;
let folder: WorkspaceFolder;

// The detected-file descriptor the importer reads (folder + fileName for logging).
// The stub's Uri/WorkspaceFolder stand in for the real vscode types at run time
// (esbuild aliases "vscode" to the stub), so the shape is cast to satisfy the
// importer's vscode-typed signature — the same cast the fake channel uses.
function detected(): DetectedFavorites {
  return {
    folder,
    fileUri: Uri.file(`${tmpDir}/.vscode/bookmarks.json`),
    fileName: ".vscode/bookmarks.json",
    format: "bookmarks",
  } as unknown as DetectedFavorites;
}

beforeEach(() => {
  __resetConfig();
  // Skip recipe detection so a refresh exercises only store IO (mirrors the kdcro
  // and store tests); recipes have their own pure detector tests.
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-bookmarks-"))
    .replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

test("a bookmark imports as a line pin with the 0-based line converted to 1-based", async () => {
  const store = new PinStore(fakeContext());
  await store.init();

  // Stored line 9 is the raw vscode.Position.line (0-based); it must import as 10.
  const json = JSON.stringify({
    files: [{ path: "src/app.ts", bookmarks: [{ line: 9, column: 4, label: "entry point" }] }],
  });
  const { channel } = fakeChannel();

  const result = await importBookmarks(json, detected(), store, channel);

  assert.equal(result.added, 1, "the bookmark imports");
  assert.equal(result.skipped, 0, "nothing is skipped");

  const pin = store.getProjectPins().find((p) => p.line !== undefined);
  assert.ok(pin, "a line pin is created");
  assert.equal(pin!.line, 10, "the 0-based line 9 became the 1-based line 10");
  assert.equal(pin!.path, "src/app.ts", "the path is stored folder-relative");
  assert.equal(pin!.label, "entry point", "the bookmark label becomes the pin label");
});

test("the legacy $ROOTPATH$ prefix is stripped before resolving the path", async () => {
  const store = new PinStore(fakeContext());
  await store.init();

  const json = JSON.stringify({
    files: [{ path: "$ROOTPATH$/lib/util.ts", bookmarks: [{ line: 0 }] }],
  });
  const { channel } = fakeChannel();

  const result = await importBookmarks(json, detected(), store, channel);

  assert.equal(result.added, 1, "the bookmark imports");
  const pin = store.getProjectPins().find((p) => p.line !== undefined);
  assert.ok(pin, "a line pin is created");
  assert.equal(pin!.path, "lib/util.ts", "the $ROOTPATH$ token and its separator are stripped");
  // No label on the mark, so the pin falls back to the "basename:line" default.
  assert.equal(pin!.label, "util.ts:1", "the label falls back to basename:line (line 0 -> 1)");
});

test("a bookmark file outside any workspace folder is reported and skipped", async () => {
  const store = new PinStore(fakeContext());
  await store.init();

  // An absolute path outside the temp folder cannot become a project line pin.
  const outside = `${os.tmpdir().replace(/\\/g, "/")}/elsewhere/foreign.ts`;
  const json = JSON.stringify({
    files: [{ path: outside, bookmarks: [{ line: 2 }] }],
  });
  const { channel, lines } = fakeChannel();

  const result = await importBookmarks(json, detected(), store, channel);

  assert.equal(result.added, 0, "nothing imports from outside the folder");
  assert.equal(result.skipped, 1, "the outside-folder file is skipped");
  assert.equal(lines.length, 1, "the skip is reported to the channel");
  assert.equal(
    store.getProjectPins().filter((p) => p.line !== undefined).length,
    0,
    "no line pin is created"
  );
});

test("re-importing the same bookmarks adds no duplicate line pins (idempotent)", async () => {
  const store = new PinStore(fakeContext());
  await store.init();

  const json = JSON.stringify({
    files: [
      {
        path: "src/main.ts",
        // Two distinct lines in one file: both import, neither dedupes the other.
        bookmarks: [{ line: 0 }, { line: 41 }],
      },
    ],
  });
  const { channel } = fakeChannel();

  const first = await importBookmarks(json, detected(), store, channel);
  assert.equal(first.added, 2, "both distinct lines import");

  // Second pass over the identical source: each resolved file+line already exists,
  // so the dedup leaves the store untouched.
  const second = await importBookmarks(json, detected(), store, channel);
  assert.equal(second.added, 0, "the second import adds nothing");

  const linePins = store.getProjectPins().filter((p) => p.line !== undefined);
  assert.equal(linePins.length, 2, "exactly the two line pins exist");
  assert.deepEqual(
    linePins.map((p) => p.line).sort((a, b) => (a ?? 0) - (b ?? 0)),
    [1, 42],
    "the two pins are the 1-based conversions of lines 0 and 41"
  );
});

test("a malformed bookmarks file imports nothing, logs the error, and does not throw", async () => {
  const store = new PinStore(fakeContext());
  await store.init();
  const { channel, lines } = fakeChannel();

  const result = await importBookmarks("{ not valid json", detected(), store, channel);

  assert.deepEqual(result, { added: 0, skipped: 0 });
  assert.equal(
    store.getProjectPins().filter((p) => p.line !== undefined).length,
    0,
    "no line pin is created"
  );
  assert.equal(lines.length, 1, "the parse failure is reported once");
});
