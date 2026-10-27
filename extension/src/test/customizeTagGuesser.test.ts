// Unit tests for the keyword-frequency tag guesser.

import { test } from "node:test";
import assert from "node:assert/strict";
import { guessTagsFromContent } from "../views/customizeTagGuesser";

test("returns nothing for empty or word-free content", () => {
  assert.deepEqual(guessTagsFromContent(""), []);
  assert.deepEqual(guessTagsFromContent("12 34 !! ??"), []);
});

test("ranks a repeated word above a single occurrence", () => {
  const tags = guessTagsFromContent("deploy deploy deploy server");
  assert.equal(tags[0], "deploy");
});

test("drops stop words and language keywords", () => {
  const tags = guessTagsFromContent("const function return const function return backup backup backup");
  assert.deepEqual(tags, ["backup"]);
});

test("splits camelCase and PascalCase identifiers into words", () => {
  const tags = guessTagsFromContent("parseConfig parseConfig HTTPServer HTTPServer");
  assert.ok(tags.includes("parse"));
  assert.ok(tags.includes("config"));
  assert.ok(tags.includes("server"));
});

test("ignores words shorter than three letters", () => {
  assert.deepEqual(guessTagsFromContent("ab ab ab ab ab"), []);
});

test("a word seen once passes the score floor from three letters up", () => {
  // score = count * sqrt(length): the shortest allowed word scores sqrt(3) = 1.73, above 1.5.
  assert.deepEqual(guessTagsFromContent("abc"), ["abc"]);
  assert.deepEqual(guessTagsFromContent("abcd"), ["abcd"]);
  assert.deepEqual(guessTagsFromContent("ab"), []);
});

test("at equal counts the longer word ranks first", () => {
  assert.deepEqual(guessTagsFromContent("cat elephant dog"), ["elephant", "cat", "dog"]);
});

test("a more frequent short word outranks a rarer long one", () => {
  // cat: 3 * sqrt(3) = 5.2; elephant: 1 * sqrt(8) = 2.8.
  assert.deepEqual(guessTagsFromContent("elephant cat cat cat"), ["cat", "elephant"]);
});

test("caps the result at max", () => {
  const text = "alpha alpha beta beta gamma gamma delta delta epsilon epsilon";
  assert.equal(guessTagsFromContent(text, 3).length, 3);
  assert.equal(guessTagsFromContent(text).length, 5);
});

test("is case-insensitive when counting", () => {
  assert.deepEqual(guessTagsFromContent("Backup BACKUP backup"), ["backup"]);
});
