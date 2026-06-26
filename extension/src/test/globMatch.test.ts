// Unit tests for the dependency-free glob matcher behind the cross-file watch links
// (#25). Pure logic — no VS Code, no filesystem — so the wildcard semantics (segment
// vs cross-segment, anchoring, the "**/" zero-or-more-segments case) are pinned here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { globToRegExp, matchesAnyGlob } from "../exec/globMatch";

test("a literal path matches only itself", () => {
  const re = globToRegExp("schema.graphql");
  assert.ok(re.test("schema.graphql"));
  assert.ok(!re.test("src/schema.graphql"));
  assert.ok(!re.test("schema_graphql")); // the dot is a literal, not "any char"
});

test("a single * stays within one path segment", () => {
  const re = globToRegExp("*.graphql");
  assert.ok(re.test("schema.graphql"));
  assert.ok(!re.test("src/schema.graphql")); // * does not cross "/"
});

test("**/ matches zero or more leading segments", () => {
  const re = globToRegExp("**/*.graphql");
  assert.ok(re.test("schema.graphql")); // zero leading segments
  assert.ok(re.test("src/schema.graphql"));
  assert.ok(re.test("src/gen/api/schema.graphql"));
  assert.ok(!re.test("schema.graphqlx")); // still anchored at the end
});

test("a trailing ** matches everything under a directory", () => {
  const re = globToRegExp("src/**");
  assert.ok(re.test("src/a.ts"));
  assert.ok(re.test("src/nested/deep/a.ts"));
  assert.ok(!re.test("lib/a.ts"));
});

test("a mid-path ** spans intermediate directories", () => {
  const re = globToRegExp("src/**/*.ts");
  assert.ok(re.test("src/a.ts"));
  assert.ok(re.test("src/x/y/a.ts"));
  assert.ok(!re.test("src/a.js"));
});

test("? matches exactly one non-separator character", () => {
  const re = globToRegExp("file?.txt");
  assert.ok(re.test("file1.txt"));
  assert.ok(!re.test("file.txt")); // requires one char
  assert.ok(!re.test("file12.txt")); // exactly one, not many
});

test("matchesAnyGlob: true when any pattern matches, ignoring blanks", () => {
  assert.ok(matchesAnyGlob("src/schema.graphql", ["  ", "**/*.graphql"]));
  assert.ok(!matchesAnyGlob("src/main.ts", ["**/*.graphql", "*.md"]));
});

test("matchesAnyGlob: an empty glob list never matches", () => {
  assert.ok(!matchesAnyGlob("anything", []));
});
