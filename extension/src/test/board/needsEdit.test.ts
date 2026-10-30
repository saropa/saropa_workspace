// Adding and removing a "Needs:" line in a document's text: line breaks and the final break stay.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNeeds } from "../../board/docFacts";
import { addNeed, removeNeed } from "../../board/needsEdit";
import { Classified, ProjectDef } from "../../board/types";
import { needTarget, resolveLinks, wouldCircle } from "../../board/links";

const ok = (r: ReturnType<typeof addNeed>): string => {
  assert.equal(r.ok, true);
  return (r as { text: string }).text;
};

test("a new line goes after the heading, between blank lines", () => {
  assert.equal(ok(addNeed("# Plan\n\nBody text\n", "docs/A.md")), "# Plan\n\nNeeds: docs/A.md\n\nBody text\n");
  assert.equal(ok(addNeed("# Plan\nBody text\n", "docs/A.md")), "# Plan\n\nNeeds: docs/A.md\n\nBody text\n");
});

test("with no heading it goes at the top, after front matter when there is some", () => {
  assert.equal(ok(addNeed("Body\n", "A.md")), "Needs: A.md\n\nBody\n");
  assert.equal(ok(addNeed("---\ntitle: x\n---\nBody\n", "A.md")), "---\ntitle: x\n---\n\nNeeds: A.md\n\nBody\n");
  assert.equal(ok(addNeed("", "A.md")), "Needs: A.md\n");
});

test("with a Needs line already, the new one follows the last", () => {
  assert.equal(ok(addNeed("# T\n\nNeeds: A.md\nNeeds: B.md\n\ntext", "C.md")), "# T\n\nNeeds: A.md\nNeeds: B.md\nNeeds: C.md\n\ntext");
});

test("line breaks and a missing final break stay as they were", () => {
  assert.equal(ok(addNeed("# T\r\n\r\nbody\r\n", "A.md")), "# T\r\n\r\nNeeds: A.md\r\n\r\nbody\r\n");
  assert.equal(ok(addNeed("# T", "A.md")), "# T\n\nNeeds: A.md");
  assert.equal(ok(addNeed("# T\r\nNeeds: A.md", "B.md")), "# T\r\nNeeds: A.md\r\nNeeds: B.md");
  assert.equal(ok(addNeed("# T\nbody\r\nmore\n", "A.md")), "# T\n\nNeeds: A.md\n\nbody\r\nmore\n", "mixed breaks keep their own");
});

test("a Needs line inside code is not a Needs line", () => {
  const text = "# T\n\n```\nNeeds: A.md\n```\n";
  assert.equal(ok(addNeed(text, "A.md")), "# T\n\nNeeds: A.md\n\n```\nNeeds: A.md\n```\n");
});

test("a target already named, or one a line cannot read back, is refused", () => {
  assert.deepEqual(addNeed("Needs: A.md, B.md\n", "B.md"), { ok: false, reason: "exists" });
  assert.deepEqual(addNeed("# T\n", "docs/a, b.md"), { ok: false, reason: "target" });
  assert.deepEqual(addNeed("# T\n", "a; b.md"), { ok: false, reason: "target" });
});

test("removing a target drops its line, or just the target from a shared line", () => {
  assert.equal(ok(removeNeed("# T\n\nNeeds: A.md\n\nbody\n", "A.md")), "# T\n\nbody\n");
  assert.equal(ok(removeNeed("Needs: A.md, [B](../B.md); C.md\nbody", "../B.md")), "Needs: A.md, C.md\nbody");
  assert.equal(ok(removeNeed("# T\r\nNeeds: A.md", "A.md")), "# T");
  assert.equal(ok(removeNeed("Needs: A.md\r\nbody\r\n", "A.md")), "body\r\n");
  assert.deepEqual(parseNeeds(ok(removeNeed("Needs: A.md\nNeeds: A.md, B.md\n", "A.md"))), ["B.md"]);
});

test("removing a target the document does not name is refused", () => {
  assert.deepEqual(removeNeed("# T\nNeeds: A.md\n", "B.md"), { ok: false, reason: "absent" });
  assert.deepEqual(removeNeed("```\nNeeds: A.md\n```\n", "A.md"), { ok: false, reason: "absent" });
});

const projects: ProjectDef[] = [
  { id: "app", name: "App", path: "app", roots: [], ruleSets: [] },
  { id: "db", name: "Supabase", path: "db", roots: [], ruleSets: [] },
];
const row = (project: string, path: string): Classified => ({ project, path, status: "amber", kind: "", note: "" });
const rows = [row("app", "docs/A.md"), row("app", "docs/B.md"), row("db", "docs/A.md"), row("db", "x/C.md")];
const n = (project: string, path: string): { project: string; path: string } => ({ project, path });

test("a target is a project path, or project:path for another project", () => {
  assert.equal(needTarget(rows, projects, n("app", "docs/A.md"), n("app", "docs/B.md")), "docs/B.md");
  assert.equal(needTarget(rows, projects, n("app", "docs/A.md"), n("db", "docs/A.md")), "db:docs/A.md");
  assert.equal(needTarget(rows, projects, n("app", "docs/A.md"), n("db", "x/C.md")), "db:x/C.md");
});

test("a circle is found through any length of chain, and a document waiting on itself", () => {
  const links = resolveLinks(rows, new Map([["app\tdocs/A.md", ["docs/B.md"]], ["app\tdocs/B.md", ["db:x/C.md"]]]), projects);
  assert.equal(wouldCircle(links, n("db", "x/C.md"), n("app", "docs/A.md")), true);
  assert.equal(wouldCircle(links, n("app", "docs/B.md"), n("app", "docs/A.md")), true);
  assert.equal(wouldCircle(links, n("app", "docs/A.md"), n("db", "x/C.md")), false);
  assert.equal(wouldCircle(links, n("app", "docs/A.md"), n("app", "docs/A.md")), true);
});

test("a Needs line is not written into a document type the board does not read it in", () => {
  assert.deepEqual(addNeed("select 1;\n", "A.md", "db/run.sql"), { ok: false, reason: "type" });
  assert.deepEqual(addNeed("select 1;\n", "A.md", "db/RUN.SQL"), { ok: false, reason: "type" });
  assert.deepEqual(removeNeed("Needs: A.md\n", "A.md", "db/run.sql"), { ok: false, reason: "type" });
  assert.equal(ok(addNeed("# T\n", "A.md", "docs/p.md")), "# T\n\nNeeds: A.md\n");
});

test("a heading inside front matter or a fence is not the heading", () => {
  assert.equal(ok(addNeed("---\n# generated\ntitle: x\n---\n# Real\n", "A.md")), "---\n# generated\ntitle: x\n---\n# Real\n\nNeeds: A.md\n");
  assert.equal(ok(addNeed("~~~\n# code\n~~~\n# Real\n", "A.md")), "~~~\n# code\n~~~\n# Real\n\nNeeds: A.md\n");
  assert.equal(ok(addNeed("---\n# generated\n---\nBody\n", "A.md")), "---\n# generated\n---\n\nNeeds: A.md\n\nBody\n");
});

test("removing a target cuts only its own part of the line", () => {
  assert.equal(ok(removeNeed("Needs: [Spec](a.md) and b.md\n", "b.md")), "Needs: [Spec](a.md)\n");
  assert.equal(ok(removeNeed("Needs: [Spec](a.md) and b.md\n", "a.md")), "Needs: b.md\n");
  assert.equal(ok(removeNeed("- **Needs:** [S, T](a.md); b.md; c.md\n", "b.md")), "- **Needs:** [S, T](a.md); c.md\n");
});

test("adding a line and removing it again gives back the same text", () => {
  for (const text of ["# Plan\n\nBody text\n", "Body\n", "# T\n", "# T", "---\nx: 1\n---\n\nBody\n", "# T\r\n\r\nbody\r\n", ""]) {
    assert.equal(ok(removeNeed(ok(addNeed(text, "A.md")), "A.md")), text, JSON.stringify(text));
  }
});
