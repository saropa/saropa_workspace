// Unit tests for buildLauncherItems — the pure data layer behind the Saropa Launcher
// Panel webview. It turns the store's shortcuts and detected recipes into the flat,
// section-tagged rows the responsive grid renders. The function depends only on five
// store accessors plus the model + l10n catalog (no VS Code), so these drive a minimal
// fake store of crafted shortcuts/groups to pin every branch deterministically: tree
// ordering (project, then global, then recipes), annotation exclusion, recipe routing
// out of the project pass and into the Recipes section, the "Scope / Group" header
// (and its bare-scope fallback when a group id no longer resolves), and the
// file-vs-action kind/openable flags. The section strings are the exact English the
// catalog (en.json) defines, which imports as plain JSON under the test stub.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Shortcut, ShortcutGroup, ShortcutScope } from "../model/shortcut";
import type { ShortcutStore } from "../model/shortcutStore";
import {
  buildLauncherItems,
  watchLauncherItem,
  fileLauncherItem,
} from "../views/launcherItems";

// A crafted Shortcut with sensible defaults; each test overrides only the fields it
// asserts on, so the intent of a row reads at its call site.
function sc(partial: Partial<Shortcut> & { id: string; scope: ShortcutScope }): Shortcut {
  return { path: partial.id, ...partial } as Shortcut;
}

// The slice of ShortcutStore buildLauncherItems reads. Casting one of these to the real
// store keeps the test free of fs/recipe-engine setup while exercising the exact
// accessors the function calls.
interface FakeStore {
  project: Shortcut[];
  global: Shortcut[];
  recipes: Shortcut[];
  projectGroups: ShortcutGroup[];
  globalGroups: ShortcutGroup[];
  recipeGroups: ShortcutGroup[];
}

function asStore(fake: FakeStore): ShortcutStore {
  return {
    getProjectShortcuts: () => fake.project,
    getGlobalShortcuts: () => fake.global,
    getRecipeShortcuts: () => fake.recipes,
    getGroups: (scope: ShortcutScope) =>
      scope === "global" ? fake.globalGroups : fake.projectGroups,
    getRecipeGroups: () => fake.recipeGroups,
  } as unknown as ShortcutStore;
}

const empty: FakeStore = {
  project: [],
  global: [],
  recipes: [],
  projectGroups: [],
  globalGroups: [],
  recipeGroups: [],
};

test("orders project shortcuts before global before recipes", () => {
  const items = buildLauncherItems(
    asStore({
      ...empty,
      project: [sc({ id: "p1", scope: "project" })],
      global: [sc({ id: "g1", scope: "global" })],
      recipes: [
        sc({ id: "r1", scope: "project", isRecipe: true, action: { kind: "url", url: "x" } as Shortcut["action"] }),
      ],
    })
  );
  assert.deepEqual(
    items.map((i) => i.id),
    ["p1", "g1", "r1"]
  );
});

test("excludes comment and separator annotations from every pass", () => {
  const items = buildLauncherItems(
    asStore({
      ...empty,
      project: [
        sc({ id: "p1", scope: "project" }),
        sc({ id: "note", scope: "project", action: { kind: "comment" } as Shortcut["action"] }),
        sc({ id: "div", scope: "project", action: { kind: "separator" } as Shortcut["action"] }),
      ],
      recipes: [
        sc({ id: "rnote", scope: "project", isRecipe: true, action: { kind: "separator" } as Shortcut["action"] }),
      ],
    })
  );
  assert.deepEqual(
    items.map((i) => i.id),
    ["p1"]
  );
});

test("a recipe-tagged shortcut is not double-listed in the project pass", () => {
  // Recipe shortcuts live in the project list AND in getRecipeShortcuts; the project
  // pass must skip isRecipe rows so each recipe appears once, under Recipes.
  const recipe = sc({
    id: "r1",
    scope: "project",
    isRecipe: true,
    action: { kind: "url", url: "x" } as Shortcut["action"],
  });
  const items = buildLauncherItems(
    asStore({ ...empty, project: [recipe], recipes: [recipe] })
  );
  assert.deepEqual(items.map((i) => i.id), ["r1"]);
  assert.equal(items[0].section, "Recipes");
});

test("section is the bare scope label when a shortcut has no group", () => {
  const items = buildLauncherItems(
    asStore({
      ...empty,
      project: [sc({ id: "p1", scope: "project" })],
      global: [sc({ id: "g1", scope: "global" })],
    })
  );
  assert.equal(items.find((i) => i.id === "p1")?.section, "Project Shortcuts");
  assert.equal(items.find((i) => i.id === "g1")?.section, "Global Shortcuts");
});

test("section appends the group label as 'Scope / Group' when the group resolves", () => {
  const items = buildLauncherItems(
    asStore({
      ...empty,
      project: [sc({ id: "p1", scope: "project", groupId: "g-deploy" })],
      projectGroups: [{ id: "g-deploy", label: "Deploy", order: 0 }],
    })
  );
  assert.equal(items[0].section, "Project Shortcuts / Deploy");
});

test("a shortcut whose group id no longer resolves falls back to the bare scope", () => {
  // Matches the tree: a shortcut filed into a now-hidden/removed group floats to the
  // scope top level rather than vanishing or showing a dangling header.
  const items = buildLauncherItems(
    asStore({
      ...empty,
      project: [sc({ id: "p1", scope: "project", groupId: "gone" })],
      projectGroups: [],
    })
  );
  assert.equal(items[0].section, "Project Shortcuts");
});

test("a recipe files under 'Recipes / Category' using its recipe group label", () => {
  const items = buildLauncherItems(
    asStore({
      ...empty,
      recipes: [
        sc({
          id: "r1",
          scope: "project",
          isRecipe: true,
          groupId: "rg-github",
          action: { kind: "url", url: "x" } as Shortcut["action"],
        }),
      ],
      recipeGroups: [{ id: "rg-github", label: "GitHub", order: 0 }],
    })
  );
  assert.equal(items[0].section, "Recipes / GitHub");
});

test("a document file leads with Open; a script file and an action lead with Run", () => {
  const items = buildLauncherItems(
    asStore({
      ...empty,
      project: [
        // No extension and no run command: a plain document/data file, not executable.
        sc({ id: "doc", scope: "project", path: "NOTES" }),
        // A .py file maps to an interpreter in the exec catalog, so it is a runnable script.
        sc({ id: "script", scope: "project", path: "deploy.py" }),
        sc({ id: "act", scope: "project", action: { kind: "shell", shellCommand: "ls", useIntegratedTerminal: true } as Shortcut["action"] }),
      ],
    })
  );
  const doc = items.find((i) => i.id === "doc");
  const script = items.find((i) => i.id === "script");
  const act = items.find((i) => i.id === "act");
  // A document is openable but not runnable, so its head leads with Open.
  assert.equal(doc?.kind, "file");
  assert.equal(doc?.openable, true);
  assert.equal(doc?.runnable, false);
  assert.equal(doc?.headAction, "open");
  // A script file is both openable and runnable, and its head leads with Run.
  assert.equal(script?.openable, true);
  assert.equal(script?.runnable, true);
  assert.equal(script?.headAction, "run");
  // A non-file action runs but cannot be opened, and its head leads with Run.
  assert.equal(act?.kind, "shell");
  assert.equal(act?.openable, false);
  assert.equal(act?.runnable, true);
  assert.equal(act?.headAction, "run");
});

test("a file shortcut with an explicit run command is runnable even without a script extension", () => {
  const items = buildLauncherItems(
    asStore({
      ...empty,
      // A .json with no interpreter is normally open-only, but an explicit exec command opts
      // it into Run — the user deliberately configured how to run it.
      project: [sc({ id: "j", scope: "project", path: "task.json", exec: { command: "node" } })],
    })
  );
  const item = items.find((i) => i.id === "j");
  assert.equal(item?.runnable, true);
  assert.equal(item?.headAction, "run");
});

test("a data file with no interpreter is open-only (no Run affordance)", () => {
  const items = buildLauncherItems(
    asStore({
      ...empty,
      project: [sc({ id: "cfg", scope: "project", path: ".vscode/saropa-workspace.json" })],
    })
  );
  const item = items.find((i) => i.id === "cfg");
  assert.equal(item?.openable, true);
  assert.equal(item?.runnable, false);
  assert.equal(item?.headAction, "open");
});

test("the label defaults to the path basename when no label override is set", () => {
  const items = buildLauncherItems(
    asStore({
      ...empty,
      project: [sc({ id: "p1", scope: "project", path: "scripts/deploy.sh" })],
    })
  );
  assert.equal(items[0].label, "deploy.sh");
  assert.equal(items[0].sub, "scripts/deploy.sh");
});

test("a file shortcut carries its file-type glyph + tint and files under the 'mine' pane", () => {
  // The launcher reuses the SAME file-type token map the sidebar tree uses, so a .py
  // shortcut reads as the snake glyph in blue in both surfaces.
  const items = buildLauncherItems(
    asStore({ ...empty, project: [sc({ id: "p1", scope: "project", path: "scripts/deploy.py" })] })
  );
  assert.equal(items[0].pane, "mine");
  assert.equal(items[0].icon, "snake");
  assert.equal(items[0].color, "charts.blue");
});

test("a user-chosen icon/color overrides the file-type default", () => {
  const items = buildLauncherItems(
    asStore({
      ...empty,
      project: [sc({ id: "p1", scope: "project", path: "a.py", icon: "rocket", color: "charts.red" })],
    })
  );
  assert.equal(items[0].icon, "rocket");
  assert.equal(items[0].color, "charts.red");
});

test("an action shortcut gets a kind glyph + tint when it has no custom icon", () => {
  const items = buildLauncherItems(
    asStore({
      ...empty,
      project: [sc({ id: "act", scope: "project", action: { kind: "shell", shellCommand: "ls", useIntegratedTerminal: true } as Shortcut["action"] })],
    })
  );
  assert.equal(items[0].icon, "terminal");
  assert.equal(items[0].color, "charts.green");
});

test("a stored shortcut's menu mirrors the sidebar actions, including a danger Remove", () => {
  const items = buildLauncherItems(
    asStore({ ...empty, project: [sc({ id: "p1", scope: "project", path: "deploy.sh" })] })
  );
  const commands = items[0].menu.map((m) => m.command);
  assert.ok(commands.includes("saropaWorkspace.runPin"));
  assert.ok(commands.includes("saropaWorkspace.customizeShortcut"));
  const remove = items[0].menu.find((m) => m.command === "saropaWorkspace.unpin");
  assert.equal(remove?.danger, true);
});

test("a paused shortcut's menu offers Resume, not Pause", () => {
  const items = buildLauncherItems(
    asStore({ ...empty, project: [sc({ id: "p1", scope: "project", paused: true })] })
  );
  const commands = items[0].menu.map((m) => m.command);
  assert.ok(commands.includes("saropaWorkspace.unpausePin"));
  assert.ok(!commands.includes("saropaWorkspace.pausePin"));
});

test("a recipe's menu is the pre-adoption set (add-to-shortcuts, no remove)", () => {
  const items = buildLauncherItems(
    asStore({
      ...empty,
      recipes: [
        sc({ id: "r1", scope: "project", isRecipe: true, action: { kind: "shell", shellCommand: "x", useIntegratedTerminal: true } as Shortcut["action"] }),
      ],
    })
  );
  assert.equal(items[0].pane, "recipes");
  const commands = items[0].menu.map((m) => m.command);
  assert.ok(commands.includes("saropaWorkspace.promoteRecipe"));
  assert.ok(!commands.includes("saropaWorkspace.unpin"));
});

test("a recipe's menu offers Pin and Schedule (adopt-then-schedule)", () => {
  // The recipes pane is where a user decides to keep or automate a recommendation, so both
  // Pin (promote) and Schedule (promote, then open the schedule editor) must be present. A
  // detected recipe stores nothing, so scheduling necessarily adopts first.
  const items = buildLauncherItems(
    asStore({
      ...empty,
      recipes: [
        sc({ id: "r1", scope: "project", isRecipe: true, action: { kind: "shell", shellCommand: "x", useIntegratedTerminal: true } as Shortcut["action"] }),
      ],
    })
  );
  const commands = items[0].menu.map((m) => m.command);
  assert.ok(commands.includes("saropaWorkspace.promoteRecipe"), "recipe menu must offer Pin");
  assert.ok(commands.includes("saropaWorkspace.scheduleRecipe"), "recipe menu must offer Schedule");
});

test("an empty store yields no items", () => {
  assert.deepEqual(buildLauncherItems(asStore(empty)), []);
});

// --- watchLauncherItem ---------------------------------------------------------------
// The Watches launcher card mirrors the Watches sidebar row's state visuals exactly (bell
// when files are unseen, plain eye when idle, closed eye when disabled) and is openable but
// never runnable. The sub line is the same English the watchesView.row* catalog keys define.

test("an enabled watch with unseen files shows a blue bell and leads with the count", () => {
  const item = watchLauncherItem({
    id: "w1",
    label: "bugs",
    target: "d:/src/app/bugs",
    isFile: false,
    mode: "new",
    enabled: true,
    unseen: 3,
  });
  assert.equal(item.pane, "watches");
  assert.equal(item.icon, "bell-dot");
  assert.equal(item.color, "charts.blue");
  assert.equal(item.sub, "3 new - folder - Only new files");
  assert.equal(item.label, "bugs");
  // The drawer surfaces the watched path; the card opens, never runs.
  assert.equal(item.desc, "d:/src/app/bugs");
  assert.equal(item.openable, true);
  assert.equal(item.runnable, false);
  assert.deepEqual(item.menu, []);
});

test("an idle enabled watch shows a plain eye with no count", () => {
  const item = watchLauncherItem({
    id: "w1",
    label: "schema",
    target: "d:/src/app/schema.graphql",
    isFile: true,
    mode: "changed",
    enabled: true,
    unseen: 0,
  });
  assert.equal(item.icon, "eye");
  assert.equal(item.color, "foreground");
  assert.equal(item.sub, "file - New and changed files");
});

test("a disabled watch reads muted (closed eye, off) and shows no count", () => {
  const item = watchLauncherItem({
    id: "w1",
    label: "bugs",
    target: "d:/src/app/bugs",
    isFile: false,
    mode: "new",
    enabled: false,
    unseen: 5,
  });
  assert.equal(item.icon, "eye-closed");
  assert.equal(item.color, "descriptionForeground");
  assert.equal(item.sub, "off - folder - Only new files");
});

// --- fileLauncherItem ----------------------------------------------------------------
// The Project Files launcher card reuses the tree's file-type token map and the Project
// Files sidebar row's description (version leads, then freshness, then a "· shortcut" tag).

test("a project file card carries version + freshness and its file-type glyph", () => {
  const item = fileLauncherItem({
    path: "d:/src/app/pubspec.yaml",
    fileName: "pubspec.yaml",
    version: "1.2.3",
    relative: "2h ago",
    isShortcut: false,
    category: "Project",
    categoryGlyph: "package",
  });
  assert.equal(item.pane, "files");
  assert.equal(item.label, "pubspec.yaml");
  assert.equal(item.sub, "v1.2.3 · 2h ago");
  assert.equal(item.icon, "settings-gear");
  assert.equal(item.color, "charts.purple");
  // The id IS the fsPath — the launcher host validates the open message against it.
  assert.equal(item.id, "d:/src/app/pubspec.yaml");
  assert.equal(item.desc, "d:/src/app/pubspec.yaml");
  assert.equal(item.openable, true);
  assert.equal(item.runnable, false);
  // The category drives the files-pane group header: the section is the bare category
  // name, the groupId is namespaced so it cannot collide with another pane's group, and
  // the header glyph is the category's, not the file's.
  assert.equal(item.section, "Project");
  assert.equal(item.groupId, "files:Project");
  assert.equal(item.groupIcon, "package");
});

test("a project file card in a platform category carries that category's group identity", () => {
  // An Android-category file groups under "Android" with the device-mobile glyph, so the
  // launcher mirrors the sidebar tree's per-area grouping.
  const item = fileLauncherItem({
    path: "d:/src/app/android/app/build.gradle",
    fileName: "build.gradle",
    version: undefined,
    relative: "1d ago",
    isShortcut: false,
    category: "Android",
    categoryGlyph: "device-mobile",
  });
  assert.equal(item.section, "Android");
  assert.equal(item.groupId, "files:Android");
  assert.equal(item.groupIcon, "device-mobile");
});

test("a versionless project file that is already a shortcut shows freshness + the tag", () => {
  const item = fileLauncherItem({
    path: "d:/src/app/README.md",
    fileName: "README.md",
    version: undefined,
    relative: "5d ago",
    isShortcut: true,
    category: "Project",
    categoryGlyph: "package",
  });
  assert.equal(item.sub, "5d ago · shortcut");
});

test("an unmapped file type falls back to the generic file glyph", () => {
  const item = fileLauncherItem({
    path: "d:/src/app/NOTES",
    fileName: "NOTES",
    version: undefined,
    relative: "just now",
    isShortcut: false,
    category: "Project",
    categoryGlyph: "package",
  });
  assert.equal(item.icon, "file");
  assert.equal(item.color, "charts.foreground");
});
