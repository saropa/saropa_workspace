// Assigning a category to a folder of documents no rule placed: the categories on offer and the
// exact text written to the rules file.

import { test } from "node:test";
import assert from "node:assert/strict";
import defaultRules from "../../board/defaultRules.json";
import { OVERRIDE_RULE_SET, USER_RULE_SET, addDocRule, addFolderRule, decodeRules, docGlob, folderGlob, losesData, ruleCategories } from "../../board/ruleAssign";
import { busyReason } from "../../views/boardBusy";
import en from "../../i18n/locales/en.json";
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
            "path": "docs/notes/**",
            "project": "app"
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
  assert.deepEqual(out.ruleSets["my-rules"].rules, [{ id: "assigned-plans-x", when: { path: "plans/x/**", project: "app" }, set: { status: "amber", note: "blocked" } }]);
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
  assert.equal(addFolderRule('{"projects": [{"id": "other"}]}', a).ok, true, "a chosen project the file does not list takes the shared set");
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

const done = { status: "green" as const, label: "Done" };

test("a document becomes a glob of its own path; a wildcard in the path cannot", () => {
  assert.equal(docGlob("docs/plans/a.md"), "docs/plans/a.md");
  assert.equal(docGlob("\\docs\\a.md"), "docs/a.md");
  assert.equal(docGlob("docs/a*.md"), undefined);
  assert.equal(docGlob("docs/{a,b}.md"), undefined);
  assert.equal(docGlob(""), undefined);
  assert.deepEqual(addDocRule(undefined, { project: "app", path: "docs/a?.md", category: done }), { ok: false, reason: "glob" });
});

test("a status for one document goes first, into the my-overrides set when no project is listed", () => {
  const first = addDocRule(undefined, { project: "app", path: "docs/a.md", category: done });
  assert.ok(first.ok);
  assert.equal(first.id, "status-docs-a-md");
  const second = addDocRule(first.text, { project: "app", path: "docs/b.md", category: bug });
  assert.ok(second.ok);
  assert.deepEqual(JSON.parse(second.text), {
    version: 1,
    ruleSets: {
      [OVERRIDE_RULE_SET]: {
        rules: [
          { id: "status-docs-b-md", when: { path: "docs/b.md", project: "app" }, set: { status: "red", kind: "bug", final: true } },
          { id: "status-docs-a-md", when: { path: "docs/a.md", project: "app" }, set: { status: "green", final: true } },
        ],
      },
    },
  });
});

test("a status for one document wins over the shipped rule that placed it", () => {
  const written = addDocRule(undefined, { project: "app", path: "bugs/BUG_a.md", category: done });
  assert.ok(written.ok);
  const cfg = layerUserRules(shipped, JSON.parse(written.text) as Partial<BoardConfig>);
  const file = (path: string) => ({ path, size: 1, mtimeMs: 1 });
  const before = compileProject(shipped, { id: "app", path: "app", roots: ["bugs"], ruleSets: ["folder-states", "doc-kinds"] });
  const after = compileProject(cfg, { id: "app", path: "app", roots: ["bugs"], ruleSets: [OVERRIDE_RULE_SET, "folder-states", "doc-kinds"] });
  assert.equal(classifyFile(before, file("bugs/BUG_a.md"), undefined).status, "red", "the shipped rules say red");
  assert.equal(classifyFile(after, file("bugs/BUG_a.md"), undefined).status, "green");
  assert.equal(classifyFile(after, file("bugs/BUG_b.md"), undefined).status, "red", "other documents keep their status");
});

test("a file that lists the project gets the status rule first in that project's rules", () => {
  const text = JSON.stringify({ projects: [{ id: "app", rules: [{ id: "x", when: { path: "a" }, set: { status: "blue" } }] }] });
  const r = addDocRule(text, { project: "app", path: "docs/a.md", category: done });
  assert.ok(r.ok);
  const ids = (JSON.parse(r.text).projects[0].rules as Array<{ id: string }>).map((x) => x.id);
  assert.deepEqual(ids, ["status-docs-a-md", "x"]);
});

const green = { status: "green" as const, label: "Done" };
const files = (path: string) => ({ path, size: 1, mtimeMs: 1 });
const twoProjects = (sets: string[]) => [
  { id: "a", path: "a", roots: ["docs"], ruleSets: sets },
  { id: "b", path: "b", roots: ["docs"], ruleSets: sets },
];

test("a rule written for one project never changes another project's document at the same path", () => {
  const written = addDocRule(undefined, { project: "a", path: "bugs/BUG_x.md", category: green });
  assert.ok(written.ok);
  const cfg = layerUserRules(shipped, JSON.parse(written.text) as Partial<BoardConfig>);
  const [a, b] = twoProjects([OVERRIDE_RULE_SET, "folder-states", "doc-kinds"]).map((p) => compileProject(cfg, p));
  assert.equal(classifyFile(a, files("bugs/BUG_x.md"), undefined).status, "green");
  assert.equal(classifyFile(b, files("bugs/BUG_x.md"), undefined).status, "red", "the other project keeps its status");
});

test("a folder rule written for one project is scoped the same way", () => {
  const written = addFolderRule(undefined, { project: "a", folder: "docs/loose", category: bug });
  assert.ok(written.ok);
  const cfg = layerUserRules(shipped, JSON.parse(written.text) as Partial<BoardConfig>);
  const [a, b] = twoProjects(["doc-kinds", USER_RULE_SET]).map((p) => compileProject(cfg, p));
  assert.equal(classifyFile(a, files("docs/loose/n.md"), undefined).status, "red");
  assert.equal(classifyFile(b, files("docs/loose/n.md"), undefined).status, "grey");
});

test("a row's folder rule goes first and moves a document a shipped rule already placed; the no-rule rule goes last and does not", () => {
  const winning = addFolderRule(undefined, { project: "a", folder: "bugs", category: green, front: true });
  assert.ok(winning.ok);
  assert.equal(winning.id, "assigned-bugs");
  const cfgFirst = layerUserRules(shipped, JSON.parse(winning.text) as Partial<BoardConfig>);
  assert.ok(OVERRIDE_RULE_SET in cfgFirst.ruleSets);
  const first = compileProject(cfgFirst, { id: "a", path: "a", roots: ["bugs"], ruleSets: [OVERRIDE_RULE_SET, "folder-states", "doc-kinds"] });
  assert.equal(classifyFile(first, files("bugs/BUG_x.md"), undefined).status, "green", "the document moved");
  const last = addFolderRule(undefined, { project: "a", folder: "bugs", category: green });
  assert.ok(last.ok);
  const cfgLast = layerUserRules(shipped, JSON.parse(last.text) as Partial<BoardConfig>);
  const behind = compileProject(cfgLast, { id: "a", path: "a", roots: ["bugs"], ruleSets: ["folder-states", "doc-kinds", USER_RULE_SET] });
  assert.equal(classifyFile(behind, files("bugs/BUG_x.md"), undefined).status, "red", "a placed document is left alone");
});

test("a dollar sign in a folder or document path is refused, because the engine would read it as a parameter", () => {
  assert.equal(folderGlob("docs/$name"), undefined);
  assert.equal(docGlob("docs/$name.md"), undefined);
  assert.deepEqual(addFolderRule(undefined, { project: "a", folder: "d$x", category: bug }), { ok: false, reason: "glob" });
});

test("a file with a repeated key or a number a double cannot hold is refused, not rewritten", () => {
  assert.equal(losesData('{"a": 1, "a": 2}'), true);
  assert.equal(losesData('{"x": {"a": 1}, "y": {"a": 2}}'), false, "the same key in two objects is fine");
  assert.equal(losesData('{"a": [{"k": 1}, {"k": 2}]}'), false);
  assert.equal(losesData('{"s": "a\\" \\"b\\": 1"}'), false, "a quote or colon inside a string is not a key");
  assert.equal(losesData('{"n": 12345678901234567890}'), true);
  assert.equal(losesData('{"n": 0.1234567890123456789}'), true);
  assert.equal(losesData('{"n": 9007199254740991, "m": 1.5, "e": 1e3}'), false);
  const a = { project: "app", folder: "docs", category: bug };
  assert.deepEqual(addFolderRule('{"version": 1, "version": 2}', a), { ok: false, reason: "lossy" });
  assert.deepEqual(addDocRule('{"big": 12345678901234567890}', { project: "app", path: "docs/a.md", category: green }), { ok: false, reason: "lossy" });
});

test("a rules file with a byte order mark or bytes that are not UTF-8 is not read", () => {
  assert.equal(decodeRules(new Uint8Array([0x7b, 0x7d])), "{}");
  assert.equal(decodeRules(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])), undefined);
  assert.equal(decodeRules(new Uint8Array([0x7b, 0xff, 0x7d])), undefined);
  assert.equal(decodeRules(new TextEncoder().encode('{"a": "\u00e9\u4e2d"}')), '{"a": "\u00e9\u4e2d"}');
});

const statusRed = { status: "red" as const, label: "Address now" };

test("the Status line cannot undo a status the user confirmed from the board, but still moves an ordinary rule's document", () => {
  const project = { id: "a", path: "a", roots: ["docs"], ruleSets: [OVERRIDE_RULE_SET, "doc-kinds", "status-line", "folder-states", USER_RULE_SET] };
  const mine = addDocRule(undefined, { project: "a", path: "docs/x.md", category: statusRed });
  assert.ok(mine.ok);
  assert.deepEqual((JSON.parse(mine.text).ruleSets[OVERRIDE_RULE_SET].rules[0] as { set: object }).set, { status: "red", final: true });
  const cfg = layerUserRules(shipped, JSON.parse(mine.text) as Partial<BoardConfig>);
  const cp = compileProject(cfg, project);
  assert.equal(classifyFile(cp, files("docs/x.md"), "done").status, "red", "the user's red stays although the document says Status: done");
  const plain = addFolderRule(undefined, { project: "a", folder: "docs", category: statusRed });
  assert.ok(plain.ok);
  const cfgPlain = layerUserRules(shipped, JSON.parse(plain.text) as Partial<BoardConfig>);
  assert.equal(classifyFile(compileProject(cfgPlain, project), files("docs/y.md"), "done").status, "green", "a folder rule for unplaced documents is not final");
});

test("a rule the user confirmed wins over the project's own rules and over any rule set", () => {
  const mine = addDocRule(undefined, { project: "a", path: "bugs/BUG_x.md", category: green });
  assert.ok(mine.ok);
  const cfg = layerUserRules(shipped, JSON.parse(mine.text) as Partial<BoardConfig>);
  const own = [{ id: "own", when: { path: "bugs/**" }, set: { status: "amber" as const } }];
  const cp = compileProject(cfg, { id: "a", path: "a", roots: ["bugs"], ruleSets: ["folder-states", OVERRIDE_RULE_SET], rules: own });
  assert.equal(classifyFile(cp, files("bugs/BUG_x.md"), undefined).status, "green", "ahead of the project's own rule and of a set listed after the shipped ones");
  assert.equal(classifyFile(cp, files("bugs/BUG_y.md"), undefined).status, "amber", "other documents keep the project's own rule");
});

test("final is honored only on a rule that names its project", () => {
  const project = { id: "a", path: "a", roots: ["docs"], ruleSets: ["doc-kinds", "status-line", "x"] };
  const withProject = { ruleSets: { x: { rules: [{ id: "r", when: { path: "docs/**", project: "a" }, set: { status: "red", final: true } }] } } };
  const without = { ruleSets: { x: { rules: [{ id: "r", when: { path: "docs/**" }, set: { status: "red", final: true } }] } } };
  const first = compileProject(layerUserRules(shipped, withProject as unknown as Partial<BoardConfig>), project);
  assert.equal(classifyFile(first, files("docs/z.md"), "done").status, "red", "final with a project: the Status line cannot undo it");
  const second = compileProject(layerUserRules(shipped, without as unknown as Partial<BoardConfig>), project);
  const hit = classifyFile(second, files("docs/z.md"), "done");
  assert.equal(hit.status, "green", "final with no project is ignored: the Status line still moves it");
  assert.equal(second.rules[0].rule.id === "r", false, "and it is not moved to the front");
});

test("a folder rule that must win is final too: the Status lines of its folder's documents cannot undo it", () => {
  const written = addFolderRule(undefined, { project: "a", folder: "docs", category: statusRed, front: true });
  assert.ok(written.ok);
  assert.equal((JSON.parse(written.text).ruleSets[OVERRIDE_RULE_SET].rules[0] as { set: { final: boolean } }).set.final, true);
  const cfg = layerUserRules(shipped, JSON.parse(written.text) as Partial<BoardConfig>);
  const cp = compileProject(cfg, { id: "a", path: "a", roots: ["docs"], ruleSets: [OVERRIDE_RULE_SET, "doc-kinds", "status-line"] });
  for (const name of ["docs/one.md", "docs/two.md"]) {
    assert.equal(classifyFile(cp, files(name), "done").status, "red", name);
  }
});

test("broken JSON gets the not-valid-JSON refusal even when it also repeats a key", () => {
  assert.deepEqual(addFolderRule('{"a": 1, "a": 2', { project: "app", folder: "docs", category: bug }), { ok: false, reason: "parse" });
});

test("the busy texts say apart: a dialog is open, a scan is running, an old result is shown", () => {
  const keys = ["busyDialog", "busyScan", "busyStale"].map((k) => (en as Record<string, string>)["releaseBoard.rowMenu." + k]);
  assert.ok(keys.every((k) => typeof k === "string"));
  assert.equal(new Set(keys).size, 3);
  assert.ok(keys[0].includes("dialog") && !keys[0].includes("scan"));
  const key = (assigning: boolean, scanning: boolean, cached: boolean): string | undefined => busyReason({ assigning, scanning, cached });
  assert.equal(key(false, false, false), undefined);
  assert.equal(key(true, false, false), "releaseBoard.rowMenu.busyDialog");
  assert.equal(key(false, true, false), "releaseBoard.rowMenu.busyScan");
  assert.equal(key(false, false, true), "releaseBoard.rowMenu.busyStale");
  assert.equal(key(true, true, true), "releaseBoard.rowMenu.busyDialog", "an open dialog is named first");
  assert.equal(key(false, true, true), "releaseBoard.rowMenu.busyScan", "a running scan is named before an old result");
  assert.ok(keys[1].includes("scan is running"));
  assert.ok(keys[2].includes("last result") && keys[2].includes("Refresh"));
  assert.equal((en as Record<string, string>)["releaseBoard.rowMenu.busy"], undefined);
});

test("the confirmations say plainly that the rule can turn a blocking document green and move the light to GO", () => {
  for (const k of ["assignConfirm"]) {
    const text = (en as Record<string, string>)["releaseBoard.rowMenu." + k];
    assert.ok(text.includes("turn a document that blocks the release green") && text.includes("for example to GO") && text.includes("Status line"), k);
  }
});
