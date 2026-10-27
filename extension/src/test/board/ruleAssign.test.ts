// Assigning a category to a folder of documents no rule placed: the categories on offer and the
// exact text written to the rules file.

import { test } from "node:test";
import assert from "node:assert/strict";
import defaultRules from "../../board/defaultRules.json";
import { USER_RULE_SET, addFolderRule, folderGlob, ruleCategories } from "../../board/ruleAssign";
import { layerUserRules } from "../../commands/boardConfigLoad";
import { compileProject, classifyFile } from "../../board/ruleEngine";
import { BoardConfig } from "../../board/types";

const shipped = defaultRules as unknown as BoardConfig;
const bug = { status: "red" as const, kind: "bug", label: "bug (Address now)" };

test("the shipped rules offer these categories, once each, red first", () => {
  assert.deepEqual(
    ruleCategories(shipped).map((c) => c.label),
    ["bug (Address now)", "bug report (Address now)", "owner action (Address now)", "sql waiting to run (Address now)", "plan (Review next)", "research (Review next)", "Review next (blocked)", "Deferred on purpose", "Done", "index (Reference)", "Reference"]
  );
});

test("grey is never offered, and a category repeated by several rules is listed once", () => {
  const cfg: BoardConfig = {
    version: 1,
    ignore: [],
    ruleSets: { a: { rules: [{ id: "1", when: { path: "x" }, set: { status: "grey" } }, { id: "2", when: { path: "y" }, set: { status: "red", kind: "bug" } }] } },
    projects: [{ id: "p", path: "p", roots: [], ruleSets: [], rules: [{ id: "3", when: { path: "z" }, set: { status: "red", kind: "bug" } }, { id: "4", when: { path: "w" }, set: { status: "blue" } }] }],
  };
  assert.deepEqual(ruleCategories(cfg).map((c) => c.label), ["bug (Address now)", "Deferred on purpose"]);
});

test("the rules file's own color names are used when it has them", () => {
  const cfg = { ...shipped, colors: { red: "Fix first" } } as unknown as BoardConfig;
  assert.equal(ruleCategories(cfg)[0].label, "bug (Fix first)");
});

test("a folder becomes a glob; a wildcard in its name cannot", () => {
  assert.equal(folderGlob("docs/guides"), "docs/guides/**");
  assert.equal(folderGlob("/docs/guides/"), "docs/guides/**");
  assert.equal(folderGlob("docs\\guides"), "docs/guides/**");
  assert.equal(folderGlob(""), "*");
  assert.equal(folderGlob("docs/a*b"), undefined);
  assert.equal(folderGlob("docs/{x}"), undefined);
  assert.equal(folderGlob("docs/a?"), undefined);
});

test("with no file, a small one is made with the rule in the my-rules set", () => {
  const r = addFolderRule(undefined, { project: "app", folder: "docs/notes", category: bug });
  assert.deepEqual(r, {
    ok: true,
    id: "assigned-docs-notes",
    glob: "docs/notes/**",
    text: `{
  "version": 1,
  "ruleSets": {
    "my-rules": {
      "rules": [
        {
          "id": "assigned-docs-notes",
          "when": {
            "path": "docs/notes/**"
          },
          "set": {
            "status": "red",
            "kind": "bug"
          }
        }
      ]
    }
  }
}
`,
  });
  assert.equal(USER_RULE_SET, "my-rules");
});

test("existing content, key order and indent are kept; the new rule is appended", () => {
  const before = `{\n\t"version": 1,\n\t"profile": "rush",\n\t"pinned": ["app/docs/a.md"],\n\t"ruleSets": {\n\t\t"mine": { "rules": [] }\n\t}\n}\n`;
  const r = addFolderRule(before, { project: "app", folder: "plans/x", category: { status: "amber", note: "blocked", label: "" } });
  assert.ok(r.ok);
  const out = JSON.parse(r.text) as { profile: string; pinned: string[]; ruleSets: Record<string, { rules: unknown[] }> };
  assert.equal(out.profile, "rush");
  assert.deepEqual(out.pinned, ["app/docs/a.md"]);
  assert.deepEqual(Object.keys(out), ["version", "profile", "pinned", "ruleSets"]);
  assert.deepEqual(Object.keys(out.ruleSets), ["mine", "my-rules"]);
  assert.deepEqual(out.ruleSets["my-rules"].rules, [{ id: "assigned-plans-x", when: { path: "plans/x/**" }, set: { status: "amber", note: "blocked" } }]);
  assert.ok(r.text.startsWith('{\n\t"version": 1,'), "the tab indent is kept");
  assert.ok(r.text.endsWith("}\n"));
});

test("a file without a final newline keeps none, and CRLF line ends stay CRLF", () => {
  const lf = addFolderRule('{"version":1}', { project: "app", folder: "docs", category: bug });
  assert.ok(lf.ok);
  assert.equal(lf.text.endsWith("}"), true);
  const crlf = addFolderRule('{\r\n  "version": 1\r\n}\r\n', { project: "app", folder: "docs", category: bug });
  assert.ok(crlf.ok);
  assert.equal(crlf.text.includes("\r\n"), true);
  assert.equal(crlf.text.replace(/\r\n/g, "").includes("\n"), false, "no bare line feed");
  assert.equal(crlf.text.endsWith("}\r\n"), true);
});

test("a second rule for the same folder gets its own id", () => {
  const first = addFolderRule(undefined, { project: "app", folder: "docs", category: bug });
  assert.ok(first.ok);
  const second = addFolderRule(first.text, { project: "app", folder: "docs", category: { status: "blue", label: "" } });
  assert.ok(second.ok);
  assert.equal(second.id, "assigned-docs-2");
  assert.equal(JSON.parse(second.text).ruleSets["my-rules"].rules.length, 2);
});

test("a file that lists the project gets the rule in that project's own rules", () => {
  const before = JSON.stringify({ version: 1, projects: [{ id: "a", path: "a", roots: [], ruleSets: [] }, { id: "app", path: "app", roots: [], ruleSets: [], rules: [{ id: "old", when: { path: "o" }, set: { status: "green" } }] }] });
  const r = addFolderRule(before, { project: "app", folder: "docs", category: bug });
  assert.ok(r.ok);
  const out = JSON.parse(r.text) as { projects: Array<{ rules?: Array<{ id: string }> }>; ruleSets?: unknown };
  assert.equal(out.projects[0].rules, undefined, "another project is untouched");
  assert.deepEqual(out.projects[1].rules?.map((x) => x.id), ["old", "assigned-docs"]);
  assert.equal(out.ruleSets, undefined);
});

test("a file that does not parse, or has the wrong shape, is refused and not changed", () => {
  const a = { project: "app", folder: "docs", category: bug };
  assert.deepEqual(addFolderRule("{ // comment\n}", a), { ok: false, reason: "parse" });
  assert.deepEqual(addFolderRule("{", a), { ok: false, reason: "parse" });
  assert.deepEqual(addFolderRule("[]", a), { ok: false, reason: "shape" });
  assert.deepEqual(addFolderRule('"x"', a), { ok: false, reason: "shape" });
  assert.deepEqual(addFolderRule('{"ruleSets": []}', a), { ok: false, reason: "shape" });
  assert.deepEqual(addFolderRule('{"ruleSets": {"my-rules": {"rules": 3}}}', a), { ok: false, reason: "shape" });
  assert.deepEqual(addFolderRule('{"projects": "x"}', a), { ok: false, reason: "shape" });
  assert.deepEqual(addFolderRule('{"projects": [{"id": "other"}]}', a), { ok: false, reason: "shape" });
  assert.deepEqual(addFolderRule(undefined, { ...a, folder: "d*" }), { ok: false, reason: "glob" });
});

test("a file name that is a prototype key does not pollute anything", () => {
  const r = addFolderRule('{"__proto__": {"x": 1}}', { project: "app", folder: "__proto__", category: bug });
  assert.ok(r.ok);
  assert.equal(({} as Record<string, unknown>).x, undefined);
});

test("the rule written classifies the folder's documents the way the category says", () => {
  const written = addFolderRule(undefined, { project: "app", folder: "docs/loose", category: bug });
  assert.ok(written.ok);
  const cfg = layerUserRules(shipped, JSON.parse(written.text) as Partial<BoardConfig>);
  const project = { id: "app", path: "app", roots: ["docs"], ruleSets: ["doc-kinds", USER_RULE_SET] };
  const cp = compileProject(cfg, project);
  const file = (path: string) => ({ path, size: 1, mtimeMs: 1 });
  const hit = classifyFile(cp, file("docs/loose/notes.md"), undefined);
  assert.equal(hit.status, "red");
  assert.equal(hit.kind, "bug");
  assert.equal(hit.rule, "assigned-docs-loose");
  assert.equal(classifyFile(cp, file("docs/other/notes.md"), undefined).status, "grey", "other folders are still unplaced");
});
