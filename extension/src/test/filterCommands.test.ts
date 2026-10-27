// Tests for the Shortcuts filter commands: the find-bar input box (live text, chip buttons,
// clear), the standalone facet toggles, and the tag mode picker.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  __registeredCommands, __inputBoxes, __resetShell, __infoMessages, __resetInfo, __resetHandlers,
  __setPickHandler, QuickPickItemKind, type FakeInputBox,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { registrarContext, captureRegistrations, declaredCommandIds } from "./registrarCheck";
import { registerFilterCommands } from "../commands/filterCommands";
import { ShortcutFilterState } from "../views/shortcutFilter";
import type { ShortcutStore } from "../model/shortcutStore";
import { l10n } from "../i18n/l10n";

let state: ShortcutFilterState;
let tags: string[];

const store = (): ShortcutStore => ({ tagsInUse: () => tags }) as unknown as ShortcutStore;
const run = (id: string): unknown => __registeredCommands().get(`saropaWorkspace.${id}`)!();
const iconIds = (box: FakeInputBox): unknown[] => box.buttons.map((b) => (b.iconPath as { id: string }).id);
const tips = (box: FakeInputBox): Array<string | undefined> => box.buttons.map((b) => b.tooltip);

beforeEach(() => {
  tags = [];
  state = new ShortcutFilterState(fakeContext());
  registerFilterCommands(registrarContext(), state, store());
});

afterEach(() => {
  __resetShell();
  __resetInfo();
  __resetHandlers();
});

test("it registers exactly the eight declared filter and mode commands", () => {
  const ids = captureRegistrations(() => registerFilterCommands(registrarContext(), state, store()));
  assert.deepEqual(ids, [
    "saropaWorkspace.filterPins",
    "saropaWorkspace.filterPinsActive",
    "saropaWorkspace.clearPinFilter",
    "saropaWorkspace.toggleFilterScripts",
    "saropaWorkspace.toggleFilterFiles",
    "saropaWorkspace.toggleFilterFailed",
    "saropaWorkspace.pickMode",
    "saropaWorkspace.clearMode",
  ]);
  const declared = declaredCommandIds();
  ids.forEach((id) => assert.ok(declared.includes(id), id));
});

test("the find bar opens with the saved text, its labels and four unlit chip buttons", () => {
  state.setText("redis");
  run("filterPins");
  const box = __inputBoxes()[0];
  assert.deepEqual([box.title, box.prompt, box.placeholder, box.value, box.shown], [
    l10n("filter.input.title"), l10n("filter.input.prompt"), l10n("filter.input.placeholder"), "redis", true,
  ]);
  assert.deepEqual(iconIds(box), ["terminal", "file", "error", "clear-all"]);
  assert.deepEqual(tips(box), [
    l10n("filter.button.scripts"), l10n("filter.button.files"), l10n("filter.button.failed"), l10n("filter.button.clear"),
  ]);
});

test("the active-state twin command opens the same find bar", () => {
  run("filterPinsActive");
  assert.equal(__inputBoxes().length, 1);
  assert.equal(__inputBoxes()[0].title, l10n("filter.input.title"));
});

test("typing filters live, trimmed, and an empty box drops the text facet", () => {
  run("filterPins");
  const box = __inputBoxes()[0];
  box.type("  red ");
  assert.equal(state.get().text, "red");
  box.type("   ");
  assert.equal(state.get().text, undefined);
});

test("each chip button flips its facet and lights its own icon and tooltip", () => {
  run("filterPins");
  const box = __inputBoxes()[0];
  box.press(0);
  assert.deepEqual(iconIds(box), ["check", "file", "error", "clear-all"]);
  assert.equal(tips(box)[0], l10n("filter.button.scriptsOn"));
  box.press(1);
  box.press(2);
  assert.deepEqual(iconIds(box), ["check", "check", "check", "clear-all"]);
  assert.deepEqual(tips(box).slice(0, 3), [
    l10n("filter.button.scriptsOn"), l10n("filter.button.filesOn"), l10n("filter.button.failedOn"),
  ]);
  assert.equal(state.get().failedOnly, true);
  assert.equal(state.get().kinds?.includes("file"), true);
  box.press(0);
  assert.deepEqual(iconIds(box), ["terminal", "check", "check", "clear-all"]);
});

test("the clear button resets every facet and empties the box without closing it", () => {
  state.setText("abc");
  run("filterPins");
  const box = __inputBoxes()[0];
  box.press(0);
  box.press(2);
  box.press(3);
  assert.deepEqual(state.get(), {});
  assert.equal(box.value, "");
  assert.equal(box.shown, true);
  assert.deepEqual(iconIds(box), ["terminal", "file", "error", "clear-all"]);
});

test("pressing Enter closes the box and stops it listening to the filter", () => {
  run("filterPins");
  const box = __inputBoxes()[0];
  box.accept();
  assert.equal(box.shown, false);
  assert.equal(box.disposed, true);
  const before = box.buttons;
  state.toggleFailed();
  assert.equal(box.buttons, before);
});

test("the standalone toggle commands flip the same facets", () => {
  run("toggleFilterScripts");
  run("toggleFilterFiles");
  run("toggleFilterFailed");
  assert.equal(state.get().failedOnly, true);
  assert.equal(state.get().kinds?.includes("file"), true);
  assert.equal(state.get().kinds?.includes("shell"), true);
  run("toggleFilterFailed");
  assert.equal(state.get().failedOnly, undefined);
});

test("clear filter drops every facet and says so", () => {
  state.setText("x");
  state.setTag("ops");
  run("clearPinFilter");
  assert.deepEqual(state.get(), {});
  assert.deepEqual(__infoMessages(), [l10n("filter.cleared")]);
});

test("clear mode drops only the tag and says so", () => {
  state.setText("x");
  state.setTag("ops");
  run("clearMode");
  assert.deepEqual(state.get(), { text: "x", tag: undefined });
  assert.deepEqual(__infoMessages(), [l10n("mode.cleared")]);
});

test("pick mode with no tags in use shows the hint and no picker", async () => {
  let picked = 0;
  __setPickHandler(async () => {
    picked++;
    return undefined;
  });
  await run("pickMode");
  assert.equal(picked, 0);
  assert.deepEqual(__infoMessages(), [l10n("mode.noTags")]);
});

test("pick mode lists show-all ticked, a separator and each tag, marking the active one", async () => {
  tags = ["ops", "web"];
  state.setTag("web");
  let rows: Array<Record<string, unknown>> = [];
  let options: unknown;
  __setPickHandler(async (items, opts) => {
    rows = items as Array<Record<string, unknown>>;
    options = opts;
    return undefined;
  });
  await run("pickMode");
  assert.deepEqual(rows.map((r) => [r.label, r.description, r.picked, r.kind]), [
    [l10n("mode.showAll"), undefined, false, undefined],
    [l10n("mode.tagsSeparator"), undefined, undefined, QuickPickItemKind.Separator],
    ["$(tag) ops", undefined, undefined, undefined],
    ["$(tag) web", l10n("mode.activeTag"), undefined, undefined],
  ]);
  assert.deepEqual(options, { title: l10n("mode.title"), placeHolder: l10n("mode.placeholder") });
  assert.deepEqual(__infoMessages(), []);
});

test("show-all is ticked when no tag is active", async () => {
  tags = ["ops"];
  let first: Record<string, unknown> = {};
  __setPickHandler(async (items) => {
    first = (items as Array<Record<string, unknown>>)[0];
    return undefined;
  });
  await run("pickMode");
  assert.equal(first.picked, true);
});

test("choosing a tag sets the mode and names it; choosing show-all clears it", async () => {
  tags = ["ops"];
  __setPickHandler(async (items) => (items as unknown[])[2]);
  await run("pickMode");
  assert.equal(state.getTag(), "ops");
  assert.deepEqual(__infoMessages(), [l10n("mode.set", { tag: "#ops" })]);
  __setPickHandler(async (items) => (items as unknown[])[0]);
  await run("pickMode");
  assert.equal(state.getTag(), undefined);
  assert.equal(__infoMessages()[1], l10n("mode.allShown"));
});

test("dismissing the tag picker changes nothing", async () => {
  tags = ["ops"];
  state.setTag("ops");
  __setPickHandler(async () => undefined);
  await run("pickMode");
  assert.equal(state.getTag(), "ops");
  assert.deepEqual(__infoMessages(), []);
});
