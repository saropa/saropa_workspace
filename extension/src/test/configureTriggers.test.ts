// Tests for Configure Triggers: the hub rows, adding and removing triggers, the success
// gate, the single idle trigger, emitted events and what is stored on Save.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri,
  __setWorkspaceFolders,
  __setConfig,
  __resetConfig,
  __resetHandlers,
  __resetWarnings,
  __warningMessages,
  __infoMessages,
  __resetInfo,
  __resetHosts,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { ShortcutStore } from "../model/shortcutStore";
import { configureTriggers } from "../commands/configureTriggers";
import { driveHub, drivePicks, driveInputs, type HubShowing } from "./uiDrivers";
import type { Shortcut } from "../model/shortcut";

let dir: string;
let store: ShortcutStore;
let hubs: HubShowing[];

async function stored(name: string, extra?: Record<string, unknown>): Promise<Shortcut> {
  nodeFs.writeFileSync(nodePath.join(dir, name), "x");
  await store.addShortcut(Uri.file(`${dir}/${name}`) as never, "project");
  const found = store.getProjectShortcuts().find((p) => !p.isAuto && p.path === name)!;
  if (extra?.triggers || extra?.emits) {
    await store.updateShortcutTriggers(found, extra.triggers as never, extra.emits as never);
  }
  return store.findShortcut(found.id)!;
}

const triggersOf = (s: Shortcut): unknown => store.findShortcut(s.id)!.triggers;
const emitsOf = (s: Shortcut): unknown => store.findShortcut(s.id)!.emits;
const labels = (h: HubShowing): string[] => h.rows.map((r) => r.label);

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-trig-")).replace(/\\/g, "/");
  __setWorkspaceFolders([{ uri: Uri.file(dir), name: "proj", index: 0 }]);
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  __resetHosts();
  hubs = [];
  store = new ShortcutStore(fakeContext());
  await store.init();
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  __resetHosts();
  nodeFs.rmSync(dir, { recursive: true, force: true });
});

test("an auto shortcut cannot carry triggers", async () => {
  await configureTriggers(store, { id: "a", scope: "project", path: "x", order: 0, isAuto: true } as Shortcut);
  assert.deepEqual(__warningMessages(), ["Auto-shortcuts cannot carry triggers. Promote it to a shortcut first."]);
});

test("an empty hub shows the four add rows, the nothing-emitted row, a hint and Save", async () => {
  const s = await stored("a.sh");
  hubs = driveHub();
  await configureTriggers(store, s);
  assert.equal(hubs[0].title, "Triggers - a.sh");
  assert.equal(hubs[0].placeholder, "What should auto-run this shortcut?");
  assert.deepEqual(labels(hubs[0]), [
    "$(git-merge) Run after a shortcut...",
    "$(zap) Run after an event...",
    "$(coffee) Run when idle...",
    "$(broadcast) This shortcut emits",
    "Triggers (what runs this shortcut)",
    "No triggers yet - this shortcut runs only manually or on its schedule.",
    "Actions",
    "$(save) Save changes",
  ]);
  assert.equal(hubs[0].rows[3].description, "(nothing)");
  assert.equal(hubs[0].rows[7].description, "Apply and close");
});

test("Esc discards edits and saving with nothing set stores nothing", async () => {
  const s = await stored("a.sh");
  hubs = driveHub("addIdle");
  driveInputs("5");
  await configureTriggers(store, s);
  assert.equal(triggersOf(s), undefined);
  assert.deepEqual(__infoMessages(), []);
  driveHub("save");
  await configureTriggers(store, s);
  assert.equal(triggersOf(s), undefined);
  assert.deepEqual(__infoMessages(), ["Saved triggers for a.sh."]);
});

test("the no-triggers hint row only re-renders the hub", async () => {
  const s = await stored("a.sh");
  hubs = driveHub("noop", "save");
  await configureTriggers(store, s);
  assert.equal(hubs.length, 2);
  assert.equal(hubs[1].active, "noop");
});

test("running after another shortcut lists the other shortcuts with their scope and stores the link", async () => {
  const a = await stored("a.sh");
  const b = await stored("b.sh");
  hubs = driveHub("addShortcut", "save");
  const picks = drivePicks("b.sh");
  await configureTriggers(store, a);
  assert.deepEqual(picks[0].rows.map((r) => [r.label, r.description]), [["Workspace config", "Project Shortcuts"], ["b.sh", "Project Shortcuts"]]);
  assert.equal(picks[0].options.placeHolder, "Run this shortcut after which shortcut completes?");
  assert.deepEqual(triggersOf(a), [{ kind: "pin", pinId: b.id }]);
  assert.ok(labels(hubs[1]).includes("$(git-merge) After b.sh"));
});

test("a shortcut already linked is not offered again, and with none left it says so", async () => {
  await stored("a.sh");
  const b = await stored("b.sh");
  const withLink = await stored("c.sh", { triggers: [{ kind: "pin", pinId: b.id }] });
  hubs = driveHub("addShortcut", "save");
  const picks = drivePicks(undefined);
  await configureTriggers(store, withLink);
  assert.deepEqual(picks[0].rows.map((r) => r.label), ["Workspace config", "a.sh"]);
  const lone = new ShortcutStore(fakeContext());
  __setWorkspaceFolders(undefined);
  await lone.init();
  driveHub("addShortcut", "save");
  await configureTriggers(lone, { id: "only", scope: "global", path: "/x", order: 0 } as Shortcut);
  assert.ok(__infoMessages().includes("No other shortcuts to chain from."));
});

test("a trigger whose source shortcut was removed shows the removed marker", async () => {
  const s = await stored("a.sh", { triggers: [{ kind: "pin", pinId: "gone" }] });
  hubs = driveHub();
  await configureTriggers(store, s);
  assert.ok(labels(hubs[0]).includes("$(git-merge) After (removed shortcut)"));
});

test("the success gate row toggles and the stored trigger carries the flag", async () => {
  const b = await stored("b.sh");
  const s = await stored("a.sh", { triggers: [{ kind: "pin", pinId: b.id }] });
  hubs = driveHub((r) => r.act === "toggleSuccess", "save");
  await configureTriggers(store, s);
  assert.equal(hubs[0].rows.find((r) => r.act === "toggleSuccess")!.label, "    $(circle-large-outline) Runs on any completion (select to require success)");
  assert.equal(hubs[1].rows.find((r) => r.act === "toggleSuccess")!.label, "    $(pass-filled) Only when the source succeeds");
  assert.deepEqual(triggersOf(s), [{ kind: "pin", pinId: b.id, onlyOnSuccess: true }]);
});

test("selecting a trigger row removes it, and the saved list becomes empty", async () => {
  const s = await stored("a.sh", { triggers: [{ kind: "event", event: "build" }] });
  hubs = driveHub((r) => r.act === "removeTrigger", "save");
  await configureTriggers(store, s);
  assert.equal(hubs[0].rows.find((r) => r.act === "removeTrigger")!.description, "Select to remove");
  assert.equal(triggersOf(s), undefined);
});

test("event triggers offer only events not yet added, and a full set says so", async () => {
  const s = await stored("a.sh", { triggers: [{ kind: "event", event: "build" }] });
  hubs = driveHub("addEvent", "save");
  const picks = drivePicks("$(rocket) After a publish");
  await configureTriggers(store, s);
  assert.deepEqual(picks[0].rows.map((r) => r.label), ["$(rocket) After a publish", "$(git-commit) After a git commit", "$(repo-push) After a git push"]);
  assert.equal(picks[0].rows[0].detail, "Runs when a shortcut marked as a publish step finishes.");
  assert.deepEqual(triggersOf(s), [{ kind: "event", event: "build" }, { kind: "event", event: "publish" }]);
  assert.ok(labels(hubs[1]).includes("$(zap) On build"));

  const full = await stored("full.sh", {
    triggers: ["build", "publish", "gitCommit", "gitPush"].map((event) => ({ kind: "event", event })),
  });
  __resetInfo();
  driveHub("addEvent", "save");
  await configureTriggers(store, full);
  assert.deepEqual(__infoMessages().slice(0, 1), ["All events are already added."]);
});

test("the idle trigger starts at 3 minutes, is validated, and replaces an existing one", async () => {
  const s = await stored("a.sh");
  hubs = driveHub("addIdle", "save");
  const inputs = driveInputs(" 7 ");
  await configureTriggers(store, s);
  assert.equal(inputs[0].value, "3");
  const validate = inputs[0].validateInput!;
  for (const bad of ["0", "-1", "2.5", "x", ""]) {
    assert.equal(validate(bad), "Enter a whole number of minutes greater than 0.", bad);
  }
  assert.equal(validate("10"), undefined);
  assert.deepEqual(triggersOf(s), [{ kind: "idle", minutes: 7 }]);

  hubs = driveHub("addIdle", "save");
  const again = driveInputs("12");
  await configureTriggers(store, store.findShortcut(s.id)!);
  assert.equal(again[0].value, "7");
  assert.deepEqual(triggersOf(s), [{ kind: "idle", minutes: 12 }]);
  assert.ok(labels(hubs[1]).includes("$(coffee) When idle 12m (runs in the background)"));
});

test("canceling an add prompt leaves the triggers alone", async () => {
  const s = await stored("a.sh");
  hubs = driveHub("addIdle", "addEvent", "addShortcut", "save");
  driveInputs(undefined);
  drivePicks(undefined, undefined);
  await configureTriggers(store, s);
  assert.equal(triggersOf(s), undefined);
});

test("emitted events offer build and publish with the current ones ticked and are saved", async () => {
  const s = await stored("a.sh", { emits: ["build"] });
  hubs = driveHub("emits", "save");
  const picks = drivePicks(["$(rocket) After a publish"]);
  await configureTriggers(store, s);
  assert.deepEqual(picks[0].rows.map((r) => [r.label, r.picked]), [["$(tools) After a build", true], ["$(rocket) After a publish", false]]);
  assert.equal(picks[0].rows[0].detail, "Other shortcuts can run after a build by triggering on it.");
  assert.deepEqual(emitsOf(s), ["publish"]);
  assert.equal(hubs[0].rows[3].description, "build");
  assert.equal(hubs[1].rows[3].description, "publish");
});

test("unticking every emitted event and saving clears them; canceling keeps them", async () => {
  const s = await stored("a.sh", { emits: ["build", "publish"] });
  hubs = driveHub("emits", "save");
  drivePicks(undefined);
  await configureTriggers(store, s);
  assert.deepEqual(emitsOf(s), ["build", "publish"]);
  assert.equal(hubs[0].rows[3].description, "build, publish");
  driveHub("emits", "save");
  drivePicks([]);
  await configureTriggers(store, s);
  assert.equal(emitsOf(s), undefined);
});

test("the row just acted on is active on the next render", async () => {
  const s = await stored("a.sh");
  hubs = driveHub("addIdle", "emits", "save");
  driveInputs("4");
  drivePicks(undefined);
  await configureTriggers(store, s);
  assert.deepEqual(hubs.map((h) => h.active), [undefined, "addIdle", "emits"]);
});
