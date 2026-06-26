// Import tests for the oleg-shilo "Favorites Manager" store dispatcher
// (importOlegShilo). The pure line parser (parseOlegShiloLines) has its own
// blank-line / comment-collapse tests; this file covers the half that turns each
// parsed entry into a PROJECT shortcut against the REAL ShortcutStore via the fs-backed vscode
// stub — file pins resolve folder-relative and dedupe, comment / separator
// annotations are positional and intentionally NOT deduped (so re-import re-adds
// them), a path-less line is reported and skipped, and an absolute path resolves
// directly. Only the host SHELL (the vscode API) is faked.

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
import { ShortcutStore } from "../model/shortcutStore";
import { importOlegShilo } from "../import/favoritesOlegShilo";
import type { DetectedFavorites } from "../import/favoritesImport";
import type { OutputChannel } from "vscode";
import { shortcutKind } from "../model/shortcut";

// A line-collecting OutputChannel: the importer only ever calls appendLine, so the
// rest of the channel surface is cast away (mirrors the kdcro / bookmarks tests).
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
function detected(): DetectedFavorites {
  return {
    folder,
    fileUri: Uri.file(`${tmpDir}/.vscode/fav.local.list.txt`),
    fileName: ".vscode/fav.local.list.txt",
    format: "olegShilo",
  } as unknown as DetectedFavorites;
}

beforeEach(() => {
  __resetConfig();
  // Skip recipe detection so a refresh exercises only store IO (mirrors the sibling
  // import tests); recipes have their own pure detector tests.
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-olegshilo-"))
    .replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

test("a path|alias line imports as a file pin whose label is the alias", async () => {
  const store = new ShortcutStore(fakeContext());
  await store.init();
  const { channel } = fakeChannel();

  const result = await importOlegShilo("src/build.ts|Build", detected(), store, channel);

  assert.equal(result.added, 1, "the file line imports");
  assert.equal(result.skipped, 0, "nothing is skipped");
  const shortcut = store.getProjectShortcuts().find((p) => p.path === "src/build.ts");
  assert.ok(shortcut, "a file pin is created at the relative path");
  assert.equal(shortcut!.label, "Build", "the alias becomes the pin label");
});

test("a `#` line imports as a comment annotation carrying its text", async () => {
  const store = new ShortcutStore(fakeContext());
  await store.init();
  const { channel } = fakeChannel();

  const result = await importOlegShilo("# Deploy scripts\ndeploy.sh", detected(), store, channel);

  assert.equal(result.added, 2, "the comment and the file both import");
  const comment = store.getProjectShortcuts().find((p) => shortcutKind(p) === "comment");
  assert.ok(comment, "a comment annotation pin is created");
  assert.equal(comment!.label, "Deploy scripts", "the comment text becomes the annotation label");
});

test("a blank-line divider imports as a separator annotation between entries", async () => {
  const store = new ShortcutStore(fakeContext());
  await store.init();
  const { channel } = fakeChannel();

  // foo.py, a blank divider, then bar.py -> two files plus one separator.
  const result = await importOlegShilo("foo.py\n\nbar.py", detected(), store, channel);

  assert.equal(result.added, 3, "two files and one separator import");
  assert.equal(
    store.getProjectShortcuts().filter((p) => shortcutKind(p) === "separator").length,
    1,
    "exactly one separator annotation is created"
  );
});

test("a path-less malformed line is reported and skipped, not pinned", async () => {
  const store = new ShortcutStore(fakeContext());
  await store.init();
  const { channel, lines } = fakeChannel();

  // "|orphan" has no path; it must surface as a reportable skip and shortcut nothing.
  const result = await importOlegShilo("foo.py\n|orphan\nbar.py", detected(), store, channel);

  assert.equal(result.added, 2, "only the two real files import");
  assert.equal(result.skipped, 1, "the path-less line is skipped");
  assert.equal(lines.length, 1, "the skip is reported to the channel exactly once");
});

test("re-importing dedupes file pins but re-adds positional annotations", async () => {
  const store = new ShortcutStore(fakeContext());
  await store.init();
  const { channel } = fakeChannel();

  // A comment plus a file: the file dedupes by path on re-run; the comment is a
  // positional annotation and is intentionally re-added (it carries no identity).
  const text = "# Section\nfoo.py";
  const first = await importOlegShilo(text, detected(), store, channel);
  assert.equal(first.added, 2, "the comment and the file both import on the first pass");

  const second = await importOlegShilo(text, detected(), store, channel);
  assert.equal(second.added, 1, "only the annotation re-adds (the file pin dedupes)");

  assert.equal(
    store.getProjectShortcuts().filter((p) => p.path === "foo.py").length,
    1,
    "the file pin exists exactly once after both passes"
  );
  assert.equal(
    store.getProjectShortcuts().filter((p) => shortcutKind(p) === "comment").length,
    2,
    "the comment annotation was re-added, so two now exist"
  );
});

test("an absolute path inside the folder imports as a project file pin", async () => {
  const store = new ShortcutStore(fakeContext());
  await store.init();
  const { channel } = fakeChannel();

  // An absolute path under the temp folder resolves directly and lands as a project
  // shortcut stored folder-relative.
  const abs = `${tmpDir}/lib/util.ts`;
  const result = await importOlegShilo(abs, detected(), store, channel);

  assert.equal(result.added, 1, "the absolute-path line imports");
  const shortcut = store.getProjectShortcuts().find((p) => p.path === "lib/util.ts");
  assert.ok(shortcut, "the absolute path is stored as a folder-relative project pin");
});

test("empty input imports nothing and skips nothing", async () => {
  const store = new ShortcutStore(fakeContext());
  await store.init();
  const { channel } = fakeChannel();

  const result = await importOlegShilo("", detected(), store, channel);
  assert.deepEqual(result, { added: 0, skipped: 0 }, "an empty list is a clean no-op");
});
