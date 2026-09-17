// Unit tests for launcherCategoryList.ts — the pure host-side builder that feeds the
// Launcher webview's left panel (PLAN_Launcher_Restructure.md, build order step 3). Pure, no
// vscode import, so it runs under Node's built-in test runner like the other launcher item
// adapters (see launcherAdbItem.test.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCategoryList,
  countItemsByPane,
  LAUNCHER_PANE_ORDER,
} from "../views/launcherCategoryList";
import { LauncherItem } from "../views/launcherItems";
import { l10n } from "../i18n/l10n";
import { LAUNCHER_SCRIPT_CORE } from "../views/launcher/launcherScriptCore";

// A minimal but real LauncherItem literal — buildCategoryList only reads `.pane`, so the rest
// of the shape is filler, but it's a real object literal (no `as unknown as` cast) so a future
// required field addition to LauncherItem breaks this file at compile time instead of
// silently type-checking around it, which matters for a test file whose whole point is a
// type-driven invariant (LAUNCHER_PANE_ORDER covering every pane).
function item(pane: LauncherItem["pane"]): LauncherItem {
  return {
    id: `id:${pane}:${Math.random()}`,
    label: "x",
    sub: "",
    desc: undefined,
    pane,
    section: "s",
    groupId: "g",
    groupIcon: "i",
    groupColor: "c",
    icon: "i",
    color: "c",
    kind: "k",
    scheduled: false,
    kindLabel: undefined,
    runnable: false,
    openable: false,
    headAction: undefined,
    copyable: false,
    menu: [],
  };
}

test("buildCategoryList: 'all' is always first, with the total item count", () => {
  const items = [item("mine"), item("mine"), item("recipes"), item("mobileRemote")];
  const entries = buildCategoryList(items);
  assert.equal(entries[0].id, "all");
  assert.equal(entries[0].count, items.length);
  assert.equal(entries[0].label, l10n("launcher.allCategory"));
});

test("buildCategoryList: 'all' has the total count and a non-empty label even with zero items", () => {
  const entries = buildCategoryList([]);
  assert.equal(entries[0].id, "all");
  assert.equal(entries[0].count, 0);
  assert.ok(entries[0].label.length > 0);
});

test("buildCategoryList: every pane appears exactly once, in LAUNCHER_PANE_ORDER order", () => {
  const entries = buildCategoryList([item("mine")]);
  const paneIds = entries.slice(1).map((e) => e.id);
  assert.deepEqual(paneIds, LAUNCHER_PANE_ORDER);
});

test("buildCategoryList: a pane with zero items still appears, with count 0", () => {
  // Only "mine" has any items; every other pane must still show up, at count 0 — a
  // navigation aid, unlike the card grid, where an empty group is hidden (judgment call,
  // see this repo's PLAN_Launcher_Restructure.md build-order step 3 notes).
  const entries = buildCategoryList([item("mine")]);
  for (const pane of LAUNCHER_PANE_ORDER) {
    const entry = entries.find((e) => e.id === pane);
    assert.ok(entry, `expected an entry for pane "${pane}"`);
    assert.equal(entry?.count, pane === "mine" ? 1 : 0);
  }
});

test("buildCategoryList: each pane's count matches how many items carry that pane", () => {
  const items = [
    item("watches"),
    item("watches"),
    item("watches"),
    item("files"),
    item("notes"),
  ];
  const entries = buildCategoryList(items);
  const countOf = (id: LauncherItem["pane"]): number | undefined =>
    entries.find((e) => e.id === id)?.count;
  assert.equal(countOf("watches"), 3);
  assert.equal(countOf("files"), 1);
  assert.equal(countOf("notes"), 1);
  assert.equal(countOf("mine"), 0);
  assert.equal(countOf("recipes"), 0);
  assert.equal(countOf("scripts"), 0);
  assert.equal(countOf("mobileRemote"), 0);
});

test("buildCategoryList: each entry names the specific expected icon, not just any icon", () => {
  // Tightened from a near-tautological "every icon is non-empty" check: this pins the exact
  // codicon per category, mirroring the header's own per-pane stat icons (see PANE_ICON's
  // comment in launcherCategoryList.ts) so a typo'd/swapped icon id actually fails this test.
  const entries = buildCategoryList([item("mine")]);
  const iconOf = (id: LauncherItem["pane"] | "all"): string | undefined =>
    entries.find((e) => e.id === id)?.icon;
  assert.equal(iconOf("all"), "list-flat");
  assert.equal(iconOf("mine"), "star-full");
  assert.equal(iconOf("recipes"), "lightbulb");
  assert.equal(iconOf("watches"), "eye");
  assert.equal(iconOf("files"), "files");
  assert.equal(iconOf("scripts"), "library");
  assert.equal(iconOf("notes"), "note");
  assert.equal(iconOf("mobileRemote"), "device-mobile");
});

test("buildCategoryList: each pane's label matches the section string this codebase already uses", () => {
  // Reuses launcher.<pane>Section rather than inventing new copy — see the plan's "read the
  // exact category labels already used elsewhere" instruction.
  const entries = buildCategoryList([]);
  const labelOf = (id: LauncherItem["pane"]): string | undefined =>
    entries.find((e) => e.id === id)?.label;
  assert.equal(labelOf("mine"), l10n("launcher.mineSection"));
  assert.equal(labelOf("recipes"), l10n("launcher.recipesSection"));
  assert.equal(labelOf("watches"), l10n("launcher.watchesSection"));
  assert.equal(labelOf("files"), l10n("launcher.filesSection"));
  assert.equal(labelOf("scripts"), l10n("launcher.scriptsSection"));
  assert.equal(labelOf("notes"), l10n("launcher.notesSection"));
  assert.equal(labelOf("mobileRemote"), l10n("launcher.mobileRemoteSection"));
});

test("countItemsByPane: counts only items carrying the given pane", () => {
  const items = [item("mine"), item("recipes"), item("mine")];
  assert.equal(countItemsByPane(items, "mine"), 2);
  assert.equal(countItemsByPane(items, "recipes"), 1);
  assert.equal(countItemsByPane(items, "watches"), 0);
});

// The previous "pane order" test above (`assert.deepEqual(paneIds, LAUNCHER_PANE_ORDER)`)
// looped over LAUNCHER_PANE_ORDER to build `entries` and then asserted the result against
// that very same array — it could never fail. LAUNCHER_PANE_ORDER's only real job is to stay
// in lockstep with paneModel()'s own hardcoded pane order inside the untyped
// LAUNCHER_SCRIPT_CORE client-script string (launcherScriptCore.ts) — the compile-time guard
// added alongside LAUNCHER_PANE_ORDER only catches a pane being missing from the array
// entirely, not the two orderings disagreeing on SEQUENCE. This test is the one thing that
// actually catches that: it parses paneModel()'s own `raw` pane-array literal out of the
// client-script string and compares the id sequence it builds to LAUNCHER_PANE_ORDER.
//
// A `new Function` eval (the pattern webviewClientUtils.test.ts uses for pure formatter/
// escaper helpers) isn't needed here — paneModel() reaches into module-level state
// (`strings`) and DOM-adjacent helpers this test has no reason to fake, and all that's
// actually needed is the literal id sequence, not the function's runtime behavior — so a
// bracket-aware string extraction is simpler and sufficient (per this repo's existing
// precedent of asserting on LAUNCHER_SCRIPT content directly, e.g. launcherAssets.test.ts's
// `LAUNCHER_SCRIPT.includes(...)` checks).
function extractPaneModelOrder(source: string): string[] {
  const fnStart = source.indexOf("function paneModel(list) {");
  assert.ok(fnStart !== -1, "expected to find paneModel() in LAUNCHER_SCRIPT_CORE");
  const rawKeyword = source.indexOf("var raw = [", fnStart);
  assert.ok(rawKeyword !== -1, "expected to find paneModel()'s `raw` pane array");
  // Everything paneModel() assigns before `raw` (mine/recipes/.../filesPane/notesPane) — used
  // below to resolve a bare identifier entry in `raw` back to the pane id its own definition
  // carries.
  const fnBodyBeforeRaw = source.slice(fnStart, rawKeyword);

  // Walk bracket depth from `raw`'s own `[` to its matching `]`, so a nested `{ }` object
  // literal or `(...)` call inside an entry (e.g. `groupsOf(mine)`) is never mistaken for the
  // end of the array.
  const arrayStart = source.indexOf("[", rawKeyword);
  let depth = 0;
  let arrayEnd = -1;
  for (let i = arrayStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === "[") {
      depth++;
    } else if (ch === "]") {
      depth--;
      if (depth === 0) {
        arrayEnd = i;
        break;
      }
    }
  }
  assert.ok(arrayEnd !== -1, "expected a closing bracket for paneModel()'s `raw` array");
  const arrayBody = source.slice(arrayStart + 1, arrayEnd);

  // Split into top-level entries by comma, respecting `{}`/`()` nesting so a nested call or
  // object inside one entry never gets mistaken for an entry boundary.
  const rawEntries: string[] = [];
  let entryStart = 0;
  let nesting = 0;
  for (let i = 0; i < arrayBody.length; i++) {
    const ch = arrayBody[i];
    if (ch === "{" || ch === "(") {
      nesting++;
    } else if (ch === "}" || ch === ")") {
      nesting--;
    } else if (ch === "," && nesting === 0) {
      rawEntries.push(arrayBody.slice(entryStart, i));
      entryStart = i + 1;
    }
  }
  const lastEntry = arrayBody.slice(entryStart).trim();
  if (lastEntry) {
    rawEntries.push(lastEntry);
  }

  return rawEntries.map((raw) => {
    const entry = raw.trim();
    const inlineId = entry.match(/id:\s*'(\w+)'/);
    if (inlineId) {
      return inlineId[1];
    }
    // A bare identifier entry (filesPane/notesPane, whose flat-vs-grouped shape is decided
    // above `raw`): resolve it to the id its own earlier definition carries, rather than
    // assuming the identifier's name matches its pane id.
    const identMatch = entry.match(/^[A-Za-z_$][\w$]*$/);
    assert.ok(identMatch, `unexpected paneModel() \`raw\` entry shape: ${JSON.stringify(entry)}`);
    const ident = identMatch[0];
    const defMatch = fnBodyBeforeRaw.match(new RegExp(`${ident}\\s*=[\\s\\S]*?id:\\s*'(\\w+)'`));
    assert.ok(defMatch, `expected to resolve "${ident}" to a pane id`);
    return defMatch[1];
  });
}

test("LAUNCHER_SCRIPT_CORE's paneModel() pane order matches LAUNCHER_PANE_ORDER", () => {
  // This is the actual drift guard the plan calls for: LAUNCHER_PANE_ORDER
  // (launcherCategoryList.ts, host side) and paneModel()'s own hardcoded pane order
  // (launcherScriptCore.ts, client side) currently agree, but nothing besides this test
  // enforces it — see this test's own comment above and the compile-time guard next to
  // LAUNCHER_PANE_ORDER's declaration for what each mechanism does and does not catch.
  const order = extractPaneModelOrder(LAUNCHER_SCRIPT_CORE);
  assert.deepEqual(order, LAUNCHER_PANE_ORDER);
});
