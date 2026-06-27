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
import { buildLauncherItems } from "../views/launcherItems";

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

test("a file shortcut is openable; an action shortcut is run-only with a kind", () => {
  const items = buildLauncherItems(
    asStore({
      ...empty,
      project: [
        sc({ id: "file", scope: "project" }),
        sc({ id: "act", scope: "project", action: { kind: "shell", shellCommand: "ls", useIntegratedTerminal: true } as Shortcut["action"] }),
      ],
    })
  );
  const file = items.find((i) => i.id === "file");
  const act = items.find((i) => i.id === "act");
  assert.equal(file?.kind, "file");
  assert.equal(file?.openable, true);
  assert.equal(file?.runnable, true);
  assert.equal(act?.kind, "shell");
  assert.equal(act?.openable, false);
  assert.equal(act?.runnable, true);
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

test("an empty store yields no items", () => {
  assert.deepEqual(buildLauncherItems(asStore(empty)), []);
});
