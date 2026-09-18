// Unit tests for launcherViewData.ts's two exported builders — buildHeader and
// buildAllItems — which had NO direct test coverage before this pass (PLAN_Launcher_
// Restructure.md build-order step 8's coverage audit). Both were only ever exercised
// indirectly, as a side effect of other suites driving the full launcherView.ts
// lifecycle, so a regression in either function's own branches (the scheduled-rituals
// count, the version-chip precedence, or which item sources buildAllItems actually
// merges) could previously slip through unnoticed.
//
// buildHeader reads vscode.workspace.workspaceFolders / vscode.workspace.name, which
// the test vscode stub (_stub/vscode.ts) already models: workspaceFolders is settable
// via __setWorkspaceFolders, and workspace.name is simply absent from the stub object,
// which resolves to `undefined` like the real API's "no name" case — no stub change or
// production refactor was needed to make this testable.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { __setWorkspaceFolders, type WorkspaceFolder, Uri } from "./_stub/vscode";
import { buildHeader, buildAllItems } from "../views/launcherViewData";
import type { ShortcutStore } from "../model/shortcutStore";
import type { Shortcut, ShortcutScope } from "../model/shortcut";
import type { FolderWatchStore } from "../model/folderWatch";
import type { ScriptsTreeProvider } from "../views/scriptsTreeProvider";
import type { ProjectFileInfo } from "../model/projectFiles";
import { l10n } from "../i18n/l10n";

// A crafted Shortcut with sensible defaults, mirroring launcherItems.test.ts's `sc()`
// helper — only the fields a given test asserts on need overriding.
function sc(partial: Partial<Shortcut> & { id: string; scope: ShortcutScope }): Shortcut {
  return { path: partial.id, ...partial } as Shortcut;
}

// The slice of ShortcutStore buildHeader/buildAllItems actually read, faked the same
// way launcherItems.test.ts's asStore() fakes it: a plain object cast to the real store
// type rather than a full store instance, so this test stays free of the store's fs/
// recipe-engine machinery.
function fakeStore(project: Shortcut[] = [], global: Shortcut[] = []): ShortcutStore {
  return {
    getProjectShortcuts: () => project,
    getGlobalShortcuts: () => global,
    getRecipeShortcuts: () => [],
    getGroups: () => [],
    getRecipeGroups: () => [],
    findShortcutByUri: () => undefined,
  } as unknown as ShortcutStore;
}

function folder(name: string, fsPath: string): WorkspaceFolder {
  return { uri: Uri.file(fsPath), name, index: 0 };
}

// ProjectFileInfo.uri is typed as the real vscode.Uri; the stub's Uri models only the
// slice buildAllItems/buildHeader actually read, so it's cast at the call site — same
// convention projectFiles.test.ts uses for its own vscode.WorkspaceFolder cast.
function projectFile(partial: Partial<ProjectFileInfo> & { name: string }): ProjectFileInfo {
  return {
    uri: Uri.file(`/proj/${partial.name}`) as unknown as ProjectFileInfo["uri"],
    category: "Project",
    folderName: "proj",
    modified: 0,
    ...partial,
  };
}

afterEach(() => {
  __setWorkspaceFolders(undefined);
});

// --- buildHeader ------------------------------------------------------------------

test("buildHeader: the scheduled-rituals stat is omitted when nothing is scheduled", () => {
  __setWorkspaceFolders([folder("proj", "/proj")]);
  const header = buildHeader(fakeStore(), []);
  assert.deepEqual(header.stats, []);
});

test("buildHeader: the scheduled-rituals stat counts enabled schedules across project + global", () => {
  __setWorkspaceFolders([folder("proj", "/proj")]);
  const project = [
    sc({ id: "p1", scope: "project", schedule: { enabled: true } as never }),
    sc({ id: "p2", scope: "project", schedule: { enabled: false } as never }),
    sc({ id: "p3", scope: "project" }),
  ];
  const global = [sc({ id: "g1", scope: "global", schedule: { enabled: true } as never })];
  const header = buildHeader(fakeStore(project, global), []);
  assert.equal(header.stats.length, 1);
  assert.equal(header.stats[0].icon, "clock");
  assert.equal(header.stats[0].text, l10n("launcher.statScheduled", { count: 2 }));
});

test("buildHeader: the version chip appears when a manifest declares one, in package.json > CHANGELOG precedence", () => {
  __setWorkspaceFolders([folder("proj", "/proj")]);
  const files = [
    projectFile({ name: "CHANGELOG.md", version: "9.9.9", folderName: "proj" }),
    projectFile({ name: "package.json", version: "1.2.3", folderName: "proj" }),
  ];
  const header = buildHeader(fakeStore(), files);
  assert.equal(header.version, l10n("launcher.version", { version: "1.2.3" }));
});

test("buildHeader: the version chip is absent when no manifest declares one", () => {
  __setWorkspaceFolders([folder("proj", "/proj")]);
  const header = buildHeader(fakeStore(), []);
  assert.equal(header.version, undefined);
});

test("buildHeader: project resolves to the primary workspace folder's name", () => {
  __setWorkspaceFolders([folder("my-folder", "/w/my-folder"), folder("other", "/w/other")]);
  const header = buildHeader(fakeStore(), []);
  assert.equal(header.project, "my-folder");
  assert.equal(header.noProject, false);
});

test("buildHeader: with no workspace folder open, project falls back to noProject's localized label", () => {
  __setWorkspaceFolders(undefined);
  const header = buildHeader(fakeStore(), []);
  assert.equal(header.project, l10n("launcher.noProject"));
  assert.equal(header.noProject, true);
});

// --- buildAllItems ------------------------------------------------------------------

function fakeWatchStore(watches: ReturnType<FolderWatchStore["list"]> = []): FolderWatchStore {
  return {
    list: () => watches,
    unseenCount: () => 0,
  } as unknown as FolderWatchStore;
}

function fakeScriptsProvider(scripts: ScriptsTreeProvider["scripts"] = []): ScriptsTreeProvider {
  return { scripts } as unknown as ScriptsTreeProvider;
}

test("buildAllItems: merges shortcuts, watches, files, scripts and the adb catalog into one list", () => {
  __setWorkspaceFolders([folder("proj", "/proj")]);
  const store = fakeStore([sc({ id: "s1", scope: "project" })]);
  const watchStore = fakeWatchStore([
    {
      id: "w1",
      target: "/proj/watched",
      isFile: false,
      enabled: true,
      global: true,
    } as never,
  ]);
  const files = [projectFile({ name: "README.md" })];
  const scriptsProvider = fakeScriptsProvider([
    {
      id: "sc1",
      label: "My Script",
      description: "desc",
      icon: "gear",
      tags: [],
      entry: "/lib/my-script.sh",
      requires: [],
      config: { command: "echo hi" },
    },
  ]);

  const items = buildAllItems(store, watchStore, files, scriptsProvider);
  const panes = new Set(items.map((i) => i.pane));

  assert.ok(items.some((i) => i.pane === "mine"), "expected a shortcut-sourced item");
  assert.ok(items.some((i) => i.pane === "watches"), "expected a watch-sourced item");
  assert.ok(items.some((i) => i.pane === "files"), "expected a file-sourced item");
  assert.ok(items.some((i) => i.pane === "scripts"), "expected a script-sourced item");
  assert.ok(items.some((i) => i.pane === "mobileRemote"), "expected the adb catalog to be included");
  // Every pane the six sources can produce is represented at least once with this input
  // (no androidProfile is passed, but adbLauncherItems still emits the full catalog
  // unsubstituted per its own doc comment), so this also guards against a future source
  // silently being dropped from the merge.
  assert.ok(panes.size >= 5);
});

test("buildAllItems: with empty inputs, only the adb catalog (which needs no input data) contributes items", () => {
  __setWorkspaceFolders([folder("proj", "/proj")]);
  const items = buildAllItems(fakeStore(), fakeWatchStore([]), [], fakeScriptsProvider([]));
  assert.ok(items.length > 0);
  assert.ok(items.every((i) => i.pane === "mobileRemote"));
});
