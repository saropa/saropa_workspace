// Tests for "Run This Shortcut When a File Changes": the watched-path hub, adding by file
// or glob, removing, and what is stored on Save.

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
  __setOpenDialogHandler,
  __resetHandlers,
  __resetWarnings,
  __warningMessages,
  __infoMessages,
  __resetInfo,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { ShortcutStore } from "../model/shortcutStore";
import { configureWatchLink } from "../commands/configureWatchLink";
import { drivePicks, driveInputs, type PickShowing } from "./uiDrivers";
import type { Shortcut } from "../model/shortcut";

let dir: string;
let store: ShortcutStore;

const ADD_FILE = "Watch a file...";
const ADD_GLOB = "Watch a glob pattern...";
const SAVE = "Save";

async function stored(globs?: string[]): Promise<Shortcut> {
  nodeFs.writeFileSync(nodePath.join(dir, "job.sh"), "x");
  await store.addShortcut(Uri.file(`${dir}/job.sh`) as never, "project");
  const found = store.getProjectShortcuts().find((p) => !p.isAuto && p.path === "job.sh")!;
  if (globs) {
    await store.setShortcutWatchGlobs(found, globs);
  }
  return store.findShortcut(found.id)!;
}

const globsOf = (s: Shortcut): string[] | undefined => store.findShortcut(s.id)!.exec?.runOnSaveGlobs;
const labels = (p: PickShowing): string[] => p.rows.map((r) => r.label);

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-wlink-")).replace(/\\/g, "/");
  __setWorkspaceFolders([{ uri: Uri.file(dir), name: "proj", index: 0 }]);
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  store = new ShortcutStore(fakeContext());
  await store.init();
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  nodeFs.rmSync(dir, { recursive: true, force: true });
});

test("an auto shortcut cannot watch files", async () => {
  await configureWatchLink(store, { id: "a", scope: "project", path: "x", order: 0, isAuto: true } as Shortcut);
  assert.deepEqual(__warningMessages(), ["Run parameters cannot be set on an auto-shortcut. Add the file as a shortcut explicitly first."]);
});

test("an empty hub offers two add actions and Save, with the empty-state hint", async () => {
  const s = await stored();
  const shown = drivePicks(undefined);
  await configureWatchLink(store, s);
  assert.equal(shown[0].options.title, "Run job.sh when a file changes");
  assert.equal(shown[0].options.placeHolder, "No watched paths yet. Add a file or a glob.");
  assert.deepEqual(labels(shown[0]), [ADD_FILE, ADD_GLOB, SAVE]);
  assert.equal(shown[0].rows[2].detail, "Save the watched paths for job.sh.");
});

test("existing globs are removable rows above the add actions", async () => {
  const s = await stored(["src/**", "a.json"]);
  const shown = drivePicks(undefined);
  await configureWatchLink(store, s);
  assert.equal(shown[0].options.placeHolder, "Add or remove watched paths, then Save.");
  assert.deepEqual(labels(shown[0]), ["Remove: src/**", "Remove: a.json", ADD_FILE, ADD_GLOB, SAVE]);
});

test("Esc discards every edit", async () => {
  const s = await stored(["keep"]);
  drivePicks(ADD_GLOB);
  driveInputs("new/**");
  await configureWatchLink(store, s);
  assert.deepEqual(globsOf(s), ["keep"]);
  assert.deepEqual(__infoMessages(), []);
});

test("a typed glob is trimmed, slash-normalized, kept once and saved with a summary", async () => {
  const s = await stored();
  drivePicks(ADD_GLOB, ADD_GLOB, SAVE);
  const inputs = driveInputs("  src\\api\\**  ", "src/api/**");
  await configureWatchLink(store, s);
  assert.deepEqual(globsOf(s), ["src/api/**"]);
  assert.deepEqual(__infoMessages(), ["job.sh runs when a watched path changes: src/api/**."]);
  assert.equal(inputs[0].validateInput?.("   "), "Enter a non-empty pattern.");
  assert.equal(inputs[0].validateInput?.("x"), undefined);
  assert.equal(inputs[0].prompt, "Glob pattern (workspace-relative). Saving a matching file runs job.sh in the background.");
});

test("a canceled glob prompt adds nothing", async () => {
  const s = await stored();
  drivePicks(ADD_GLOB, SAVE);
  driveInputs(undefined);
  await configureWatchLink(store, s);
  assert.equal(globsOf(s), undefined);
});

test("a picked file inside the project is added as its project-relative path", async () => {
  const s = await stored();
  drivePicks(ADD_FILE, SAVE);
  __setOpenDialogHandler(async () => [Uri.file(`${dir}/config/app.json`)]);
  await configureWatchLink(store, s);
  assert.deepEqual(globsOf(s), ["config/app.json"]);
});

test("a picked file outside the project is added by its absolute path, and a canceled dialog adds nothing", async () => {
  const s = await stored();
  drivePicks(ADD_FILE, ADD_FILE, SAVE);
  let n = 0;
  __setOpenDialogHandler(async () => (n++ === 0 ? [Uri.file("/elsewhere/x.json")] : []));
  await configureWatchLink(store, s);
  assert.deepEqual(globsOf(s), ["/elsewhere/x.json"]);
});

test("removing an entry drops just that one, and emptying the list clears the watch with its own message", async () => {
  const s = await stored(["a", "b"]);
  drivePicks("Remove: a", SAVE);
  await configureWatchLink(store, s);
  assert.deepEqual(globsOf(s), ["b"]);

  drivePicks("Remove: b", SAVE);
  await configureWatchLink(store, store.findShortcut(s.id)!);
  assert.equal(globsOf(s), undefined);
  assert.equal(__infoMessages().at(-1), "job.sh no longer watches any files.");
});
