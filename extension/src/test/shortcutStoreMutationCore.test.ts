// Unit tests for the core mutation layer (model/shortcutStoreMutationCore.ts): add /
// addLine / addShell / addAnnotation / import pins, remove / rename / re-point, the
// shared placeAfter (ordered insert) and mutateShortcut (find-apply-persist) helpers.
// These are the abstract internals ShortcutStore composes, so the tests drive a real
// ShortcutStore against the fs-backed vscode stub over a temp directory and assert the
// behavior distinct to THIS layer — the variant add paths and the ordered insert —
// rather than re-covering the store round-trips already in shortcutStore.test.ts.

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
import { pruneRoutineMembers } from "../model/routineMembers";
import { shortcutKind, type Shortcut } from "../model/shortcut";
import type { RoutineMember } from "../model/shortcutAction";
import type { Uri as VscodeUri } from "vscode";

const asUri = (u: Uri): VscodeUri => u as unknown as VscodeUri;

let tmpDir: string;
let folder: WorkspaceFolder;

beforeEach(() => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-mutcore-"))
    .replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

test("addPin into a named group creates the group once and assigns membership", async () => {
  // The shortcut's groupId must resolve to a group created in the SAME folder's file, and
  // a second add into the same group name reuses it (label-matched, idempotent).
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "a.ts")), "project", undefined, "Build");
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "b.ts")), "project", undefined, "Build");
  const groups = store.getProjectGroups().filter((g) => g.label === "Build");
  assert.equal(groups.length, 1, "the named group is created once, not per pin");
  const groupId = groups[0].id;
  const inGroup = store.getProjectShortcuts().filter((p) => p.groupId === groupId);
  assert.equal(inGroup.length, 2, "both pins join the single named group");
});

test("an added file with no named group auto-sorts into its default group by name/type", async () => {
  // The headline behavior: a file added without a chosen group is filed into a built-in
  // default group by its name (a build file -> Build) or extension (.md -> Docs), and the
  // synthetic default groups are present in the Project scope to render it.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "build.gradle")), "project");
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "README.md")), "project");
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "data.csv")), "project");
  const byPath = (p: string): string | undefined =>
    store.getProjectShortcuts().find((s) => s.path === p)?.groupId;
  assert.equal(byPath("build.gradle"), "default:build");
  assert.equal(byPath("README.md"), "default:docs");
  assert.equal(byPath("data.csv"), "default:data");
  // The default groups are injected (synthetic) so the shortcuts have a folder to land in.
  const groupIds = store.getProjectGroups().map((g) => g.id);
  assert.ok(groupIds.includes("default:build") && groupIds.includes("default:docs"));
});

test("a hand-made group of a default name absorbs the default — no duplicate folder", async () => {
  // A user "Build" group must not coexist with a synthetic "Build": the synthetic one is
  // suppressed and an auto-sorted build file lands in the USER group, so the scope never
  // shows two same-named folders and the membership renders.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  // Create a user group named "Build" (the same label as the default).
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "a.ts")), "project", undefined, "Build");
  // An auto-sorted build file then files into that user group, not "default:build".
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "build.gradle")), "project");
  const builds = store.getProjectGroups().filter((g) => g.label === "Build");
  assert.equal(builds.length, 1, "exactly one Build folder (the user's), not two");
  assert.notEqual(builds[0].id, "default:build", "the user group, not the synthetic one");
  const buildFile = store.getProjectShortcuts().find((s) => s.path === "build.gradle");
  assert.equal(buildFile?.groupId, builds[0].id, "the file lands in the user Build group");
});

test("default groups off: no synthetic folders and no auto-assignment", async () => {
  // The setting gates both the scaffolding and the auto-sort; off, an added file stays at
  // the top level (no groupId) and no default folder is injected.
  __setConfig("saropaWorkspace", "defaultGroups.enabled", false);
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "README.md")), "project");
  const shortcut = store.getProjectShortcuts().find((s) => s.path === "README.md");
  assert.equal(shortcut?.groupId, undefined, "no auto-assignment when disabled");
  assert.equal(
    store.getProjectGroups().some((g) => g.id.startsWith("default:")),
    false,
    "no synthetic default folders when disabled"
  );
});

test("addPin returns false for a project file outside any workspace folder", async () => {
  // A file the workspace does not own cannot be a project shortcut (no folder to store it
  // relative to); the caller offers global instead.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  const outside = Uri.file("/elsewhere/not-in-workspace.ts");
  assert.equal(await store.addShortcut(asUri(outside), "project"), false);
});

test("addLinePin does NOT dedupe by path — the same file pins to several lines", async () => {
  // Unlike addShortcut, a line shortcut is a distinct jump target, so the same file may be
  // added to multiple lines; each add creates a new shortcut.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  const target = Uri.joinPath(folder.uri, "big.ts");
  assert.equal(await store.addLineShortcut(asUri(target), "project", 10, "fn A"), true);
  assert.equal(await store.addLineShortcut(asUri(target), "project", 200, "fn B"), true);
  const lineShortcuts = store.getProjectShortcuts().filter((p) => p.path === "big.ts" && p.line);
  assert.equal(lineShortcuts.length, 2);
  assert.deepEqual(lineShortcuts.map((p) => p.line).sort((x, y) => x! - y!), [10, 200]);
});

test("addShellPin stores a runnable shell action with no file path", async () => {
  // A shell shortcut carries the command in action.shell and an empty path; shortcutKind must
  // route it as "shell", and it is added (not run).
  const store = new ShortcutStore(fakeContext());
  await store.init();
  assert.equal(await store.addShellShortcut("Tests", "npm test", "project", true), true);
  const shortcut = store.getProjectShortcuts().find((p) => p.label === "Tests");
  assert.ok(shortcut);
  assert.equal(shortcut!.path, "");
  assert.equal(shortcutKind(shortcut!), "shell");
  assert.equal(shortcut!.action?.shellCommand, "npm test");
});

test("addUrlShortcut stores an openable url action with a label and no file path", async () => {
  // A website shortcut carries the address in action.url and an empty path; shortcutKind
  // must route it as "url", and it is added (not opened). The label is kept as given.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  assert.equal(
    await store.addUrlShortcut("https://github.com/saropa", "project", "Saropa on GitHub"),
    true
  );
  const shortcut = store.getProjectShortcuts().find((p) => p.label === "Saropa on GitHub");
  assert.ok(shortcut);
  assert.equal(shortcut!.path, "");
  assert.equal(shortcutKind(shortcut!), "url");
  assert.equal(shortcut!.action?.url, "https://github.com/saropa");
});

test("addUrlShortcut with a blank label stores no label override (shows the address)", async () => {
  // An empty label must not be stored as "" — the shortcut then falls back to rendering the
  // url itself, mirroring how a blank rename clears to the default.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addUrlShortcut("https://example.com", "project", "   ");
  const shortcut = store.getProjectShortcuts().find((p) => p.action?.url === "https://example.com")!;
  assert.equal(shortcut.label, undefined, "a blank label is dropped, not stored empty");
});

test("addAnnotationPin inserts a comment immediately after its anchor pin", async () => {
  // A comment anchored to a shortcut must land directly below it (placeAfter), so the
  // annotation sits exactly where the user clicked — its order is the anchor's + 1.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "first.ts")), "project");
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "second.ts")), "project");
  const anchor = store.getProjectShortcuts().find((p) => p.path === "first.ts")!;
  assert.equal(await store.addAnnotationShortcut("comment", "project", "A note", anchor), true);

  // Within the top-level group, the comment's order is one past the anchor's.
  const note = store.getProjectShortcuts().find((p) => p.label === "A note")!;
  assert.equal(shortcutKind(note), "comment");
  assert.equal(note.order, anchor.order + 1, "the comment lands directly after its anchor");
});

test("removePin drops an explicit pin but suppresses an auto-pin via removedAutoPins", async () => {
  // Two distinct removal paths in this layer: an explicit shortcut is filtered out of
  // pins[]; an auto-shortcut (not stored there) is suppressed so it is not re-seeded.
  __setConfig("saropaWorkspace", "autoPins.patterns", ["config.yaml"]);
  nodeFs.writeFileSync(nodePath.join(tmpDir, "config.yaml"), "a: 1\n");
  const store = new ShortcutStore(fakeContext());
  await store.init();

  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "explicit.ts")), "project");
  const explicit = store.getProjectShortcuts().find((p) => p.path === "explicit.ts")!;
  await store.removeShortcut(explicit);
  assert.ok(
    !store.getProjectShortcuts().some((p) => p.path === "explicit.ts"),
    "an explicit pin is removed from pins[]"
  );

  const auto = store.getProjectShortcuts().find((p) => p.isAuto && p.path === "config.yaml")!;
  await store.removeShortcut(auto);
  const onDisk = JSON.parse(
    nodeFs.readFileSync(nodePath.join(tmpDir, ".vscode", "saropa-workspace.json"), "utf8")
  );
  assert.ok(
    onDisk.removedAutoPins.includes(auto.id),
    "an auto-pin removal is recorded in removedAutoPins, not by deleting a stored pin"
  );
});

test("updatePinPath rejects re-pointing a project pin outside its owning folder", async () => {
  // A project shortcut stores a folder-relative path and cannot reach a sibling folder;
  // a target outside the owner is refused with false so the caller can tell the user.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "a.ts")), "project");
  const shortcut = store.getProjectShortcuts().find((p) => p.path === "a.ts")!;
  const outside = Uri.file("/elsewhere/b.ts");
  assert.equal(await store.updateShortcutPath(shortcut, asUri(outside)), false);
  // A target inside the owning folder is accepted and the stored path updates.
  const inside = Uri.joinPath(folder.uri, "moved/a.ts");
  assert.equal(await store.updateShortcutPath(shortcut, asUri(inside)), true);
  assert.ok(store.getProjectShortcuts().some((p) => p.path === "moved/a.ts"));
});

test("renamePin clears the label override when given a blank name", async () => {
  // A blank rename drops the override so the shortcut falls back to the file basename,
  // rather than storing an empty string.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "a.ts")), "project", "Alias");
  let shortcut = store.getProjectShortcuts().find((p) => p.path === "a.ts")!;
  assert.equal(shortcut.label, "Alias");
  await store.renameShortcut(shortcut, "   ");
  shortcut = store.getProjectShortcuts().find((p) => p.path === "a.ts")!;
  assert.equal(shortcut.label, undefined, "a blank rename clears the alias to the basename default");
});

test("duplicateShortcut inserts a variant after the source with merged exec and new args", async () => {
  // The core behavior: the copy points at the SAME file, keeps the source's run config
  // (interpreter/cwd) while replacing only the args, takes the given name, and lands
  // directly below the source (placeAfter -> order = source.order + 1).
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "build.py")), "project");
  let source = store.getProjectShortcuts().find((p) => p.path === "build.py")!;
  await store.updateShortcutExec(source, { command: "python", cwd: "scripts", args: ["--lang", "fr"] });
  source = store.getProjectShortcuts().find((p) => p.path === "build.py")!;

  assert.equal(await store.duplicateShortcut(source, "build.py -o", ["-o"]), true);
  const copy = store.getProjectShortcuts().find((p) => p.label === "build.py -o")!;
  assert.ok(copy, "the duplicate is created with the given name");
  assert.equal(copy.path, "build.py", "the duplicate points at the same file");
  assert.deepEqual(copy.exec?.args, ["-o"], "only the args are replaced");
  assert.equal(copy.exec?.command, "python", "the interpreter is carried over");
  assert.equal(copy.exec?.cwd, "scripts", "the working directory is carried over");
  assert.notEqual(copy.id, source.id, "the duplicate is a distinct entry");
  assert.equal(copy.order, source.order + 1, "the duplicate lands directly after the source");
});

test("duplicateShortcut does not inherit the source's schedule (no double-scheduling)", async () => {
  // Automation is per-instance: a run variant must start with no schedule so the same
  // script is never silently scheduled twice.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "nightly.py")), "project");
  let source = store.getProjectShortcuts().find((p) => p.path === "nightly.py")!;
  await store.updateShortcutSchedule(source, { atTime: "02:00", enabled: true });
  source = store.getProjectShortcuts().find((p) => p.path === "nightly.py")!;
  assert.ok(source.schedule, "the source carries a schedule");

  await store.duplicateShortcut(source, "nightly.py --dry-run", ["--dry-run"]);
  const copy = store.getProjectShortcuts().find((p) => p.label === "nightly.py --dry-run")!;
  assert.equal(copy.schedule, undefined, "the duplicate carries no inherited schedule");
});

test("duplicateShortcut carries the masked flag so a secret's duplicate stays hidden", async () => {
  // The screen-share guard is behavior, not decoration: duplicating a masked shortcut
  // must not expose the target file name in the tree.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "secret.env")), "project");
  let source = store.getProjectShortcuts().find((p) => p.path === "secret.env")!;
  await store.setMasked(source, true);
  source = store.getProjectShortcuts().find((p) => p.path === "secret.env")!;

  await store.duplicateShortcut(source, "secret.env --check", ["--check"]);
  const copy = store.getProjectShortcuts().find((p) => p.label === "secret.env --check")!;
  assert.equal(copy.masked, true, "the duplicate keeps the screen-share guard");
});

test("duplicateShortcut clears exec when the source has none and args are empty", async () => {
  // A plain file shortcut duplicated with no arguments must not store an inert empty
  // exec object — round-trip parity with the other add paths.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "plain.sh")), "project");
  const source = store.getProjectShortcuts().find((p) => p.path === "plain.sh")!;
  await store.duplicateShortcut(source, "plain copy", []);
  const copy = store.getProjectShortcuts().find((p) => p.label === "plain copy")!;
  assert.equal(copy.exec, undefined, "no inert exec object is stored");
});

test("duplicateShortcut returns false for a source not in its store", async () => {
  // An auto/recipe shortcut is recomputed, not stored, so there is nothing to duplicate;
  // the method reports false so the command can surface a visible outcome.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  const phantom = {
    id: "not-a-real-id",
    path: "ghost.py",
    scope: "project" as const,
    order: 0,
  };
  assert.equal(await store.duplicateShortcut(phantom, "ghost copy", ["-x"]), false);
});

test("mutatePin is a no-op on an auto-pin (recomputed, not stored)", async () => {
  // Auto-pins have no stored target, so a field toggle routed through mutateShortcut must
  // not throw and must not persist anything — the masked toggle is one such caller.
  __setConfig("saropaWorkspace", "autoPins.patterns", ["config.yaml"]);
  nodeFs.writeFileSync(nodePath.join(tmpDir, "config.yaml"), "a: 1\n");
  const store = new ShortcutStore(fakeContext());
  await store.init();
  const auto = store.getProjectShortcuts().find((p) => p.isAuto && p.path === "config.yaml")!;
  // setMasked routes through mutateShortcut; on an auto-shortcut it finds no target and no-ops.
  await store.setMasked(auto, true);
  const onDisk = JSON.parse(
    nodeFs.readFileSync(nodePath.join(tmpDir, ".vscode", "saropa-workspace.json"), "utf8")
  );
  assert.equal(
    onDisk.pins.some((p: { masked?: boolean }) => p.masked),
    false,
    "masking an auto-pin writes nothing to the stored pins"
  );
});

// Minimal routine shortcut for the prune tests — the helper reads only action.members.
function routinePin(id: string, members: RoutineMember[]): Shortcut {
  return {
    id,
    path: "",
    scope: "project",
    order: 0,
    action: { kind: "routine", members },
  };
}

function members(pin: Shortcut): RoutineMember[] {
  return (pin.action?.kind === "routine" ? pin.action.members : undefined) ?? [];
}

test("pruneRoutineMembers unlinks a removed recipe from every routine that ran it", () => {
  // The failure this closes: a removed recipe is suppressed by recipeId forever, so a
  // routine still listing it could never resolve that member again on any run.
  const pins = [
    routinePin("morning", [{ recipeId: "ritual.lint" }, { recipeId: "ritual.prs" }]),
    routinePin("evening", [{ recipeId: "ritual.lint" }]),
    { id: "plain", path: "a.py", scope: "project" as const, order: 0 },
  ];
  assert.equal(pruneRoutineMembers(pins, { id: "recipe:x:ritual.lint", recipeId: "ritual.lint" }), 2);
  assert.deepEqual(members(pins[0]), [{ recipeId: "ritual.prs" }]);
  assert.deepEqual(members(pins[1]), []);
});

test("pruneRoutineMembers unlinks a hand-composed member by pin id", () => {
  const pins = [routinePin("morning", [{ pinId: "abc" }, { pinId: "def" }])];
  assert.equal(pruneRoutineMembers(pins, { id: "abc", recipeId: undefined }), 1);
  assert.deepEqual(members(pins[0]), [{ pinId: "def" }]);
});

test("pruneRoutineMembers leaves unrelated members and non-routine pins alone", () => {
  // A recipe-referencing member must not be swept up by a pinId match against the
  // synthetic `recipe:<folder>:<id>` shortcut id it happens to resolve through.
  const pins = [routinePin("morning", [{ recipeId: "ritual.prs" }, { pinId: "keep" }])];
  assert.equal(pruneRoutineMembers(pins, { id: "recipe:x:ritual.lint", recipeId: "ritual.lint" }), 0);
  assert.equal(members(pins[0]).length, 2);
});
