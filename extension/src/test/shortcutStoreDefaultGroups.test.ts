// Unit tests for the built-in default groups: file-name rules and the
// recipe-to-group table.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GROUPS,
  isDefaultGroupId,
  defaultGroupLabel,
  matchDefaultGroup,
  recipeDefaultGroupId,
} from "../model/shortcutStoreDefaultGroups";

test("default groups have unique ids and strictly increasing order", () => {
  const ids = new Set(DEFAULT_GROUPS.map((g) => g.id));
  assert.equal(ids.size, DEFAULT_GROUPS.length);
  for (let i = 1; i < DEFAULT_GROUPS.length; i++) {
    assert.ok(DEFAULT_GROUPS[i].order > DEFAULT_GROUPS[i - 1].order);
  }
});

test("isDefaultGroupId recognizes built-in ids only", () => {
  assert.equal(isDefaultGroupId("default:build"), true);
  assert.equal(isDefaultGroupId("my-group"), false);
  assert.equal(isDefaultGroupId(undefined), false);
});

test("defaultGroupLabel resolves labels and returns undefined for unknown ids", () => {
  assert.equal(defaultGroupLabel("default:deploy"), "Deploy");
  assert.equal(defaultGroupLabel("nope"), undefined);
  assert.equal(defaultGroupLabel(undefined), undefined);
});

test("matchDefaultGroup sorts by intent word before file type", () => {
  assert.equal(matchDefaultGroup("scripts/publish.ts"), "default:deploy");
  assert.equal(matchDefaultGroup("tools/release-notes.py"), "default:deploy");
  assert.equal(matchDefaultGroup("test/helper.ts"), "default:test");
  assert.equal(matchDefaultGroup("a/foo.spec.js"), "default:test");
  assert.equal(matchDefaultGroup("webpack.config.js"), "default:build");
  assert.equal(matchDefaultGroup("Dockerfile"), "default:build");
  assert.equal(matchDefaultGroup("scripts/dev.sh"), "default:run");
});

test("matchDefaultGroup falls back to file type", () => {
  assert.equal(matchDefaultGroup("README.md"), "default:docs");
  assert.equal(matchDefaultGroup("config/app.yaml"), "default:data");
  assert.equal(matchDefaultGroup("src/main.go"), "default:code");
});

test("matchDefaultGroup is case-insensitive and anchored to word boundaries", () => {
  assert.equal(matchDefaultGroup("PUBLISH.PS1"), "default:deploy");
  // "development" must not fire the run rule; it falls through to the .ts code rule.
  assert.equal(matchDefaultGroup("development.ts"), "default:code");
  // "server" is not "serve"; no intent match, .txt -> docs.
  assert.equal(matchDefaultGroup("server.txt"), "default:docs");
});

test("matchDefaultGroup returns undefined when nothing matches", () => {
  assert.equal(matchDefaultGroup("photo.png"), undefined);
  assert.equal(matchDefaultGroup("noextension"), undefined);
});

test("recipeDefaultGroupId maps known recipes and ignores unknown ones", () => {
  assert.equal(recipeDefaultGroupId("lint"), "default:test");
  assert.equal(recipeDefaultGroupId("dev"), "default:run");
  assert.equal(recipeDefaultGroupId("registry.pub"), "default:deploy");
  assert.equal(recipeDefaultGroupId("doc.readme"), "default:docs");
  assert.equal(recipeDefaultGroupId("flutter.dance"), undefined);
  assert.equal(recipeDefaultGroupId(undefined), undefined);
  assert.equal(recipeDefaultGroupId(""), undefined);
});

test("every recipe-table target is a real default group", () => {
  for (const id of ["build", "install", "boot", "ci", "db.migrate", "doc.license"]) {
    assert.equal(isDefaultGroupId(recipeDefaultGroupId(id)), true, id);
  }
});
