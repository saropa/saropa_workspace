import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

// Integrity guard for the contributed menus, prompted by folding the shortcut
// context menu (~35 flat items) into themed submenus. A submenu reference whose
// id has no `contributes.submenus` entry, a submenu with no items array, or a
// menu command that is not declared in `contributes.commands` all fail silently
// at runtime — VS Code drops the row with no error — so the wiring is pinned here.
//
// Paths resolve from the bundle location (out/test) up to the extension root, so
// the test does not depend on the runner's working directory.
const extensionRoot = path.join(__dirname, "..", "..");

interface MenuItem {
  command?: string;
  submenu?: string;
  when?: string;
}

interface Manifest {
  contributes?: {
    commands?: Array<{ command: string; title?: string; category?: string; icon?: string }>;
    submenus?: Array<{ id: string; label: string }>;
    menus?: Record<string, MenuItem[]>;
  };
}

function readManifest(): Manifest {
  return JSON.parse(
    fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8")
  ) as Manifest;
}

function readNls(): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(extensionRoot, "package.nls.json"), "utf8")
  ) as Record<string, string>;
}

test("every submenu reference resolves to a declared submenu", () => {
  const manifest = readManifest();
  const submenuIds = new Set(
    (manifest.contributes?.submenus ?? []).map((s) => s.id)
  );
  for (const [menu, items] of Object.entries(manifest.contributes?.menus ?? {})) {
    for (const item of items) {
      if (item.submenu) {
        assert.ok(
          submenuIds.has(item.submenu),
          `menu "${menu}" references submenu "${item.submenu}" with no contributes.submenus entry`
        );
      }
    }
  }
});

test("every declared submenu has an items array in contributes.menus", () => {
  const manifest = readManifest();
  const menus = manifest.contributes?.menus ?? {};
  for (const sub of manifest.contributes?.submenus ?? []) {
    assert.ok(
      Array.isArray(menus[sub.id]),
      `submenu "${sub.id}" is declared but has no items array in contributes.menus`
    );
  }
});

test("every menu command is a declared command", () => {
  const manifest = readManifest();
  const declared = new Set(
    (manifest.contributes?.commands ?? []).map((c) => c.command)
  );
  for (const [menu, items] of Object.entries(manifest.contributes?.menus ?? {})) {
    for (const item of items) {
      if (item.command) {
        assert.ok(
          declared.has(item.command),
          `menu "${menu}" references command "${item.command}" not in contributes.commands`
        );
      }
    }
  }
});

test("every command title/category NLS token has a value in package.nls.json", () => {
  // A typo in a contributes.commands[].title/.category token (e.g. "%command.foo.tite%")
  // compiles clean and passes every other test here — the submenu-label test above only
  // covers contributes.submenus, not contributes.commands — but renders the literal
  // "%key%" string in the Command Palette/title bar. Pin it the same way.
  const manifest = readManifest();
  const nls = readNls();
  const tokenPattern = /^%(.+)%$/;
  for (const cmd of manifest.contributes?.commands ?? []) {
    for (const field of ["title", "category"] as const) {
      const value = cmd[field];
      if (!value) { continue; }
      const tokenMatch = tokenPattern.exec(value);
      if (!tokenMatch) { continue; }
      assert.ok(
        nls[tokenMatch[1]],
        `command "${cmd.command}" ${field} token "${tokenMatch[1]}" has no value in package.nls.json`
      );
    }
  }
});

test("the four shortcut submenus exist with NLS labels and non-empty items", () => {
  const manifest = readManifest();
  const nls = readNls();
  const menus = manifest.contributes?.menus ?? {};
  const byId = new Map(
    (manifest.contributes?.submenus ?? []).map((s) => [s.id, s])
  );
  // The shortcut context menu's overflow folds into exactly these four groups;
  // a missing one means the flat menu leaked back or a rename drifted.
  const expected = [
    "saropaWorkspace.outputSubmenu",
    "saropaWorkspace.configureSubmenu",
    "saropaWorkspace.appearanceSubmenu",
    "saropaWorkspace.fileSubmenu",
  ];
  for (const id of expected) {
    const def = byId.get(id);
    assert.ok(def, `expected submenu "${id}" is not declared`);
    // The label is an NLS token (%key%) that must have a value in package.nls.json,
    // or the submenu row renders the raw token.
    const tokenMatch = /^%(.+)%$/.exec(def!.label);
    assert.ok(tokenMatch, `submenu "${id}" label must be an NLS token, got "${def!.label}"`);
    assert.ok(
      nls[tokenMatch![1]],
      `submenu "${id}" label token "${tokenMatch![1]}" has no value in package.nls.json`
    );
    assert.ok(
      (menus[id]?.length ?? 0) > 0,
      `submenu "${id}" has no items`
    );
  }
});

// Manifest-consistency guard for the Launcher's own native view/title icons
// (PLAN_Launcher_Restructure.md build order step 5/7): a typo in any of the three manifest
// locations below (contributes.commands, contributes.menus["view/title"], contributes.menus
// ["commandPalette"]), or drift from the actual vscode.commands.registerCommand ids in
// wiringViews.ts/wiringCommands.ts, currently ships silently — VS Code drops a bad reference
// with no error, same failure mode the other tests in this file already guard against for
// the shortcut context-menu submenus.
test("the Launcher's view/title commands are declared, scoped to the Launcher view, and icon'd", () => {
  const manifest = readManifest();
  const commands = manifest.contributes?.commands ?? [];
  const viewTitle = manifest.contributes?.menus?.["view/title"] ?? [];
  const launcherCommands = [
    "saropaWorkspace.launcher.cycleSort",
    "saropaWorkspace.launcher.showRightPanel",
    "saropaWorkspace.launcher.hideRightPanel",
    "saropaWorkspace.openSettings",
  ];
  for (const command of launcherCommands) {
    const declared = commands.find((c) => c.command === command);
    assert.ok(declared, `expected command "${command}" to be declared in contributes.commands`);
    assert.ok(declared!.icon, `expected command "${command}" to declare an icon`);

    const entry = viewTitle.find(
      (item) =>
        item.command === command &&
        (item.when ?? "").includes("view == saropaWorkspace.launcher")
    );
    assert.ok(
      entry,
      `expected "${command}" to appear in contributes.menus["view/title"], scoped to ` +
        `"view == saropaWorkspace.launcher"`
    );
  }
});

test("the Launcher-only view/title commands are hidden from the Command Palette; openSettings is not", () => {
  // cycleSort/showRightPanel/hideRightPanel only make sense with the Launcher webview's own
  // client-side state in view (a selected category, current panel visibility) and would be
  // dead or confusing if run from the palette, so each must carry a "false" when-clause there.
  // openSettings is deliberately NOT hidden — confirmed by checking its other usages first
  // (wiringCommands.ts registers it once; it's also wired onto saropaWorkspace.pins's own
  // view/title, so it's a genuinely global command, not Launcher-scoped) — hiding it from the
  // palette would also hide its non-Launcher usages.
  const manifest = readManifest();
  const commandPalette = manifest.contributes?.menus?.["commandPalette"] ?? [];
  const hiddenIds = new Set(
    commandPalette.filter((item) => item.when === "false").map((item) => item.command)
  );

  for (const command of [
    "saropaWorkspace.launcher.cycleSort",
    "saropaWorkspace.launcher.showRightPanel",
    "saropaWorkspace.launcher.hideRightPanel",
  ]) {
    assert.ok(
      hiddenIds.has(command),
      `expected "${command}" to be hidden from the Command Palette via when: "false"`
    );
  }

  assert.ok(
    !hiddenIds.has("saropaWorkspace.openSettings"),
    "openSettings is a genuinely global command (also used on saropaWorkspace.pins's " +
      "view/title) and must stay visible in the Command Palette"
  );
});
