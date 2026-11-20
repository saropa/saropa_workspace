// Table test for every branch of losesData: the guard that refuses to rewrite a rules file when a
// rewrite would silently drop user data.

import { test } from "node:test";
import assert from "node:assert/strict";
import { losesData } from "../../board/ruleAssign";

const cases: Array<[string, string, boolean]> = [
  ["a repeated key in one object", '{"a": 1, "a": 2}', true],
  ["a repeated key with whitespace before the colon", '{"a" \n: 1, "a"\t: 2}', true],
  ["a repeated key in a nested object", '{"o": {"k": 1, "k": 2}}', true],
  ["a repeated key inside an array of objects", '[{"k": 1, "k": 2}]', true],
  ["the same key in two sibling objects", '{"x": {"a": 1}, "y": {"a": 2}}', false],
  ["the same key in objects of one array", '{"a": [{"k": 1}, {"k": 2}]}', false],
  ["the same string twice as array values", '{"a": ["v", "v"]}', false],
  ["the same string as a key and as a value", '{"a": "a"}', false],
  ["an escaped quote and colon inside a string", '{"s": "a\\" \\"b\\": 1"}', false],
  ["a key reused after its object closed", '{"o": {"k": 1}, "p": {"k": 2}, "o2": 3}', false],
  ["a long non-integer number", '{"n": 0.1234567890123456789}', true],
  ["a long negative non-integer number", '{"n": -0.1234567890123456789}', true],
  ["a long integer above the safe range", '{"n": 12345678901234567890}', true],
  ["a long negative integer above the safe range", '{"n": -12345678901234567890}', true],
  ["a long exponent form that is not an integer", '{"n": 1.2345678901234567e-3}', true],
  ["the largest safe integer", '{"n": 9007199254740991}', false],
  ["a 16-digit safe integer", '{"n": 1234567890123456}', false],
  ["a short fraction and an exponent", '{"m": 1.5, "e": 1e3}', false],
  ["a long number inside an array", '{"a": [12345678901234567890]}', true],
  ["leading zeros do not count as digits", '{"n": 0.000000000000000012}', false],
  ["an empty object", "{}", false],
  ["an empty text", "", false],
];

for (const [name, text, expected] of cases) {
  test(`losesData: ${name}`, () => {
    assert.equal(losesData(text), expected);
  });
}
