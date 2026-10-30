// Every key in the Needs key maps must have a value in the English catalog.

import { test } from "node:test";
import assert from "node:assert/strict";
import { NEEDS_REFUSAL_KEYS, NEEDS_STATE_KEYS } from "../board/needsKeys";
import en from "../i18n/locales/en.json";

const catalog = en as Record<string, string>;

for (const [name, keys] of [["refusal", NEEDS_REFUSAL_KEYS], ["state", NEEDS_STATE_KEYS]] as const) {
  test(`every ${name} key exists in en.json`, () => {
    for (const key of Object.values(keys)) {
      assert.ok(typeof catalog[key] === "string" && catalog[key].length > 0, key);
    }
  });
}
