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
}

interface Manifest {
  contributes?: {
    commands?: Array<{ command: string }>;
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
