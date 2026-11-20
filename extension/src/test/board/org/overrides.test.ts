// Override precedence (which source wins) and relocation: an assign or untag entry follows a moved file,
// a group entry follows a renamed folder group, and what cannot be followed is reported as stale.

import { test } from "node:test";
import assert from "node:assert/strict";
import { OrganizeConfig, relocateOverrides, resolveByPrecedence } from "../../../board/org/overrides";

const doc = (path: string, project = "app"): { project: string; path: string } => ({ project, path });

test("resolveByPrecedence: no candidate gives undefined", () => {
  assert.equal(resolveByPrecedence<string>({}), undefined);
});

test("resolveByPrecedence: a single source is returned with its name", () => {
  assert.deepEqual(resolveByPrecedence({ inference: "auto" }), { value: "auto", source: "inference" });
});

test("resolveByPrecedence: override beats rules, front matter and inference", () => {
  const r = resolveByPrecedence({ inference: "i", frontMatter: "f", rules: "r", override: "o" });
  assert.deepEqual(r, { value: "o", source: "override" });
});

test("resolveByPrecedence: rules beat front matter, which beats inference", () => {
  assert.equal(resolveByPrecedence({ inference: "i", frontMatter: "f", rules: "r" })?.source, "rules");
  assert.equal(resolveByPrecedence({ inference: "i", frontMatter: "f" })?.source, "frontMatter");
});

test("resolveByPrecedence: a falsy value that is set still wins over a weaker source", () => {
  // The test is "not undefined", so 0 and "" are real choices, not gaps.
  assert.deepEqual(resolveByPrecedence({ rules: 0, inference: 5 }), { value: 0, source: "rules" });
  assert.deepEqual(resolveByPrecedence({ override: "", inference: "x" }), { value: "", source: "override" });
});

test("resolveByPrecedence: a source set to undefined is treated as absent", () => {
  assert.equal(resolveByPrecedence({ override: undefined, inference: "i" })?.source, "inference");
});

test("relocateOverrides: an empty config gives an empty report", () => {
  const r = relocateOverrides({}, []);
  assert.deepEqual(r.config, {});
  assert.deepEqual(r.moved, []);
  assert.deepEqual(r.stale, []);
});

test("relocateOverrides: entries whose files still exist stay as they are", () => {
  const cfg: OrganizeConfig = { assign: [{ project: "app", path: "a.md", group: "app:manual:x" }], untag: [{ project: "app", path: "a.md", tag: "bugs" }] };
  const r = relocateOverrides(cfg, [doc("a.md")]);
  assert.deepEqual(r.config, cfg);
  assert.deepEqual(r.moved, []);
  assert.deepEqual(r.stale, []);
});

test("relocateOverrides: other keys of the config are carried through", () => {
  const r = relocateOverrides({ tags: { off: ["a"] } }, []);
  assert.deepEqual(r.config.tags, { off: ["a"] });
});

test("relocateOverrides: an assign follows its file to the one new document with the same file name", () => {
  const cfg: OrganizeConfig = { assign: [{ project: "app", path: "old/a.md", group: "app:manual:x" }] };
  const r = relocateOverrides(cfg, [doc("new/a.md")]);
  assert.deepEqual(r.moved, [{ from: "old/a.md", to: "new/a.md" }]);
  assert.equal(r.config.assign?.[0].path, "new/a.md");
  // Only the path moves; the group the person chose is kept.
  assert.equal(r.config.assign?.[0].group, "app:manual:x");
  assert.deepEqual(r.stale, []);
});

test("relocateOverrides: an untag follows its file and keeps its tag", () => {
  const r = relocateOverrides({ untag: [{ project: "app", path: "old/a.md", tag: "bugs" }] }, [doc("new/a.md")]);
  assert.deepEqual(r.config.untag, [{ project: "app", path: "new/a.md", tag: "bugs" }]);
});

test("relocateOverrides: a backslash path still matches by its file name", () => {
  const r = relocateOverrides({ assign: [{ project: "app", path: "old\\a.md", group: "app:manual:x" }] }, [doc("new/a.md")]);
  assert.deepEqual(r.moved, [{ from: "old\\a.md", to: "new/a.md" }]);
});

test("relocateOverrides: two new documents with the same file name leave the entry stale and untouched", () => {
  const cfg: OrganizeConfig = { assign: [{ project: "app", path: "old/a.md", group: "app:manual:x" }] };
  const r = relocateOverrides(cfg, [doc("one/a.md"), doc("two/a.md")]);
  // Guessing between two candidates could attach the override to the wrong document.
  assert.deepEqual(r.stale, [{ kind: "assign", ref: "old/a.md" }]);
  assert.deepEqual(r.moved, []);
  assert.equal(r.config.assign?.[0].path, "old/a.md");
});

test("relocateOverrides: no document with that file name leaves the entry stale", () => {
  const r = relocateOverrides({ untag: [{ project: "app", path: "old/a.md", tag: "bugs" }] }, [doc("other.md")]);
  assert.deepEqual(r.stale, [{ kind: "untag", ref: "old/a.md" }]);
});

test("relocateOverrides: a same-named document in another project is not a match", () => {
  const r = relocateOverrides({ assign: [{ project: "app", path: "old/a.md", group: "app:manual:x" }] }, [doc("new/a.md", "web")]);
  assert.deepEqual(r.stale, [{ kind: "assign", ref: "old/a.md" }]);
});

test("relocateOverrides: a document that already has an override of its own is not taken over", () => {
  const cfg: OrganizeConfig = {
    assign: [
      { project: "app", path: "old/a.md", group: "app:manual:x" },
      { project: "app", path: "new/a.md", group: "app:manual:y" },
    ],
  };
  const r = relocateOverrides(cfg, [doc("new/a.md")]);
  assert.deepEqual(r.stale, [{ kind: "assign", ref: "old/a.md" }]);
  // The existing entry for the new file is untouched.
  assert.equal(r.config.assign?.[1].group, "app:manual:y");
});

test("relocateOverrides: two entries cannot move onto the same new document", () => {
  const cfg: OrganizeConfig = {
    assign: [
      { project: "app", path: "old1/a.md", group: "app:manual:x" },
      { project: "app", path: "old2/a.md", group: "app:manual:x" },
    ],
  };
  const r = relocateOverrides(cfg, [doc("new/a.md")]);
  assert.deepEqual(r.moved, [{ from: "old1/a.md", to: "new/a.md" }]);
  assert.deepEqual(r.stale, [{ kind: "assign", ref: "old2/a.md" }]);
});

const FILES = ["a.md", "b.md", "c.md", "d.md", "e.md"];
const OLD = "app:folder:old";

test("relocateOverrides: a group entry follows to the folder group that holds at least 80 percent of the same files", () => {
  const cfg: OrganizeConfig = { groups: { [OLD]: { name: "Kept" } } };
  // 4 of the 5 old files: exactly 0.8, the boundary that still follows.
  const r = relocateOverrides(cfg, [], [{ id: "app:folder:new", files: ["a.md", "b.md", "c.md", "d.md", "z.md"] }], { [OLD]: FILES });
  assert.deepEqual(r.moved, [{ from: OLD, to: "app:folder:new" }]);
  assert.deepEqual(Object.keys(r.config.groups ?? {}), ["app:folder:new"]);
  assert.equal(r.config.groups?.["app:folder:new"].name, "Kept");
});

test("relocateOverrides: under 80 percent shared files leaves the group entry stale and in place", () => {
  const cfg: OrganizeConfig = { groups: { [OLD]: { name: "Kept" } } };
  // 3 of 5 is 0.6, below the share at which a group counts as the same folder.
  const r = relocateOverrides(cfg, [], [{ id: "app:folder:new", files: ["a.md", "b.md", "c.md"] }], { [OLD]: FILES });
  assert.deepEqual(r.stale, [{ kind: "group", ref: OLD }]);
  assert.deepEqual(Object.keys(r.config.groups ?? {}), [OLD]);
});

test("relocateOverrides: a group with no recorded previous files is stale", () => {
  const r = relocateOverrides({ groups: { [OLD]: { name: "Kept" } } }, [], [{ id: "app:folder:new", files: FILES }], {});
  assert.deepEqual(r.stale, [{ kind: "group", ref: OLD }]);
});

test("relocateOverrides: a group that is still current is not touched", () => {
  const r = relocateOverrides({ groups: { [OLD]: { name: "Kept" } } }, [], [{ id: OLD, files: FILES }], { [OLD]: FILES });
  assert.deepEqual(r.moved, []);
  assert.deepEqual(r.stale, []);
});

test("relocateOverrides: only folder groups are followed; a group of another kind that is gone is ignored", () => {
  const r = relocateOverrides({ groups: { "app:stem:gone": { name: "Kept" } } }, [], [], {});
  // Stem and tag groups have no stable file set to follow, so nothing is reported either.
  assert.deepEqual(r.moved, []);
  assert.deepEqual(r.stale, []);
});

test("relocateOverrides: a folder group of another project is never a target", () => {
  const r = relocateOverrides({ groups: { [OLD]: { name: "Kept" } } }, [], [{ id: "web:folder:new", files: FILES }], { [OLD]: FILES });
  assert.deepEqual(r.stale, [{ kind: "group", ref: OLD }]);
});

test("relocateOverrides: of several matching groups the largest share wins, and a tie goes to the lower id", () => {
  const cfg: OrganizeConfig = { groups: { [OLD]: { name: "Kept" } } };
  const prev = { [OLD]: FILES };
  const better = relocateOverrides(cfg, [], [{ id: "app:folder:a", files: ["a.md", "b.md", "c.md", "d.md"] }, { id: "app:folder:b", files: FILES }], prev);
  assert.equal(better.moved[0].to, "app:folder:b");
  const tie = relocateOverrides(cfg, [], [{ id: "app:folder:b", files: FILES }, { id: "app:folder:a", files: FILES }], prev);
  // Equal shares must resolve the same way on every run, whatever order the groups arrive in.
  assert.equal(tie.moved[0].to, "app:folder:a");
});

test("relocateOverrides: an assign into a gone folder group is re-pointed at the group it followed to", () => {
  const cfg: OrganizeConfig = { assign: [{ project: "app", path: "a.md", group: OLD }] };
  const r = relocateOverrides(cfg, [doc("a.md")], [{ id: "app:folder:new", files: FILES }], { [OLD]: FILES });
  assert.equal(r.config.assign?.[0].group, "app:folder:new");
  assert.deepEqual(r.moved, [{ from: OLD, to: "app:folder:new" }]);
});
