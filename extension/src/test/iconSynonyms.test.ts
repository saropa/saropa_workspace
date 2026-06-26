// Unit tests for the icon-picker synonym dictionary. The picker shows each codicon
// id's synonym list (appearance.iconKeyword.<id>) as the row description and matches
// on it, so an alternate word — or a name like "octocat" — finds an icon whose exact
// id the user does not know. These assertions read the real English catalog (pure, no
// vscode host) and guard two things: every synonym entry is well-formed (so no raw key
// ever leaks into the picker as a description), and the specific aliases the changelog
// promises still resolve (so "settings"->gear, "octocat"->github cannot silently break).

import { test } from "node:test";
import assert from "node:assert/strict";
import en from "../i18n/locales/en.json";
import { l10n } from "../i18n/l10n";

const KEYWORD_PREFIX = "appearance.iconKeyword.";

function keywordEntries(): Array<[string, string]> {
  return Object.entries(en as Record<string, string>).filter(([key]) =>
    key.startsWith(KEYWORD_PREFIX)
  );
}

test("every icon synonym entry is a non-empty string", () => {
  // An empty or missing value would render a blank description and, worse, contribute
  // nothing to matching — the whole point of the entry. Catch that at build time.
  const entries = keywordEntries();
  assert.ok(entries.length > 0, "expected synonym entries to exist");
  for (const [key, value] of entries) {
    assert.equal(typeof value, "string", `${key} must be a string`);
    assert.ok(value.trim().length > 0, `${key} must not be blank`);
  }
});

test("a synonym lookup returns the catalog value, not the key fallback", () => {
  // l10n falls back to the key itself when a key is missing; a returned key string in
  // the picker would mean an icon id had no synonym entry. Assert a real value comes back.
  const value = l10n(`${KEYWORD_PREFIX}gear`);
  assert.notEqual(value, `${KEYWORD_PREFIX}gear`, "gear must have a synonym entry");
});

test("documented aliases resolve to the icon the changelog promises", () => {
  // These specific words are advertised to users; shortcut them so a future catalog edit
  // that drops one is caught here rather than by a confused user typing "octocat".
  assert.match(l10n(`${KEYWORD_PREFIX}gear`), /\bsettings\b/);
  assert.match(l10n(`${KEYWORD_PREFIX}gear`), /\bcog\b/);
  assert.match(l10n(`${KEYWORD_PREFIX}github`), /\boctocat\b/);
  assert.match(l10n(`${KEYWORD_PREFIX}rocket`), /\bdeploy\b/);
  assert.match(l10n(`${KEYWORD_PREFIX}rocket`), /\blaunch\b/);
});

test("a synonym may name several icons (overlap is intended)", () => {
  // "settings" deliberately matches both gear and settings-gear — the picker filters
  // to all of them. Assert the overlap exists so a well-meaning de-dupe does not remove it.
  const gear = l10n(`${KEYWORD_PREFIX}gear`);
  const settingsGear = l10n(`${KEYWORD_PREFIX}settings-gear`);
  assert.match(gear, /\bsettings\b/);
  assert.match(settingsGear, /\bsettings\b/);
});
