// First run and damaged state: every reader of persisted Release Board state must return a safe
// default for missing, empty or wrong-typed input and never throw.

import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { readSeen } from "../../board/sinceLast";
import { chooseColumn, parsePlacement } from "../../board/placement";
import { planStartupWrite } from "../../board/startupToggle";
import { parseMarks } from "../../board/marks";
import { readOrgPrevious } from "../../views/boardPanelActions";
import { readSittingsChoice } from "../../commands/boardSittings";
import { RULES_FILE, loadConfig, resetDamagedRulesWarning } from "../../commands/boardConfigLoad";
import { BoardPatches } from "../../views/boardPatches";
import { DEFAULT_STARTUP_MODE } from "../../board/startupToggle";
import defaultRules from "../../board/defaultRules.json";
import { ShortcutStore } from "../../model/shortcutStore";
import { BranchSetBinder } from "../../exec/branchSets";
import { handleOpenFolder } from "../../views/launcherConfigFolder";
import { fakeContext } from "../_stub/context";
import { stub as hostStub } from "./hostHelpers";

const stub = vscode as unknown as { __setWorkspaceFolders(f: Array<{ uri: vscode.Uri; name: string; index: number }> | undefined): void };

afterEach(() => stub.__setWorkspaceFolders(undefined));

// Every shape a stored value could take after a bad write, a hand edit or an older version.
const GARBAGE: unknown[] = [undefined, null, 0, 1, NaN, "", "x", true, false, [], [1, "a", null], {}, { version: 1 }, { version: 1, at: "now", projects: [] }, { band: "a", max: [] }, { have: "no", timeBox: {} }, { a: null, b: 5, c: { band: "1" } }];

function memento(value: unknown): vscode.Memento {
  return { get: (_k: string, d?: unknown) => (value === undefined ? d : value), update: async () => undefined, keys: () => [] } as unknown as vscode.Memento;
}

test("since-last record: garbage reads as nothing seen", () => {
  for (const g of GARBAGE) {
    assert.doesNotThrow(() => readSeen(g), JSON.stringify(g));
    assert.equal(readSeen(g), undefined, JSON.stringify(g));
  }
});

test("saved layouts: garbage reads as nothing or a clean record", () => {
  for (const g of GARBAGE) {
    const out = readOrgPrevious(g);
    for (const l of Object.values(out ?? {})) {
      assert.equal(typeof l.band, "number");
      assert.equal(typeof l.max, "number");
    }
  }
  assert.deepEqual(readOrgPrevious({ p: { band: 2, max: 9 }, q: { band: "x" } }), { p: { band: 2, max: 9 } });
});

test("startup placement: a stored column of any type picks a valid column", () => {
  for (const g of GARBAGE) {
    for (const background of [true, false]) {
      for (const activeColumn of [undefined, 1]) {
        for (const setting of ["beside", "sameGroup"] as const) {
          const col = chooseColumn({ setting, stored: g, groupCount: 1, activeColumn, background });
          assert.ok(Number.isInteger(col), `${JSON.stringify(g)} -> ${col}`);
        }
      }
    }
    assert.ok(["beside", "sameGroup"].includes(parsePlacement(g)));
  }
});

test("remembered startup mode: garbage in every slot gives a plan", () => {
  for (const g of GARBAGE) {
    for (const checked of [true, false]) {
      const plan = planStartupWrite(checked, g, g, g);
      assert.equal(plan.mode, checked ? DEFAULT_STARTUP_MODE : "never", JSON.stringify(g));
    }
  }
});

test("marks: damaged text reads as empty marks", () => {
  for (const text of [undefined, "", "not json", "null", "[]", "5", '"s"', '{"marks":5,"needs":[],"rejected":{}}', '{"marks":{"a":1,"b/c":null,"d/e":{}}}', "{".repeat(100)]) {
    const m = parseMarks(text);
    assert.equal(m.version, 1);
    assert.ok(Array.isArray(m.rejected));
    assert.equal(typeof m.marks, "object");
    assert.equal(typeof m.needs, "object");
  }
});

test("sittings choice: garbage reads as no choice or a clean one", () => {
  for (const g of GARBAGE) {
    const ctx = { globalState: memento(g) } as unknown as vscode.ExtensionContext;
    assert.equal(readSittingsChoice(ctx), undefined, JSON.stringify(g));
  }
  const ok = { globalState: memento({ have: ["a", 1, "b"], timeBox: "nope" }) } as unknown as vscode.ExtensionContext;
  assert.deepEqual(readSittingsChoice(ok), { have: ["a", "b"], timeBox: "any" });
});

test("answered replies: garbage in the workspace state starts with none", () => {
  const answered = (g: unknown): Set<string> => (new BoardPatches(() => undefined, () => undefined, () => undefined, () => memento(g)) as unknown as { answered: Set<string> }).answered;
  for (const g of GARBAGE) {
    if (!Array.isArray(g)) {
      assert.equal(answered(g).size, 0, JSON.stringify(g));
    }
  }
  assert.deepEqual([...answered([1, "p\t1", null, "q\t2"])], ["p\t1", "q\t2"]);
  assert.equal(answered(undefined).size, 0);
  assert.equal((new BoardPatches(() => undefined, () => undefined, () => undefined) as unknown as { answered: Set<string> }).answered.size, 0);
});

test("rules: no workspace folder and a damaged rules file both load", async () => {
  stub.__setWorkspaceFolders(undefined);
  assert.ok(Array.isArray((await loadConfig()).projects));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-first-"));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const shipped = defaultRules as unknown as { ignore: string[]; projects: unknown[] };
  fs.mkdirSync(path.dirname(path.join(dir, RULES_FILE)), { recursive: true });
  for (const text of ["", "not json", "null", "[]", '{"projects":5,"ruleSets":[],"ignore":"x"}']) {
    fs.writeFileSync(path.join(dir, RULES_FILE), text);
    stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(dir), name: "app", index: 0 }]);
    hostStub.__resetWarnings();
    resetDamagedRulesWarning();
    const cfg = await loadConfig();
    assert.ok(Array.isArray(cfg.projects), text);
    assert.deepEqual(cfg.ignore, shipped.ignore, text);
    // The folder's own project stands in for the shipped (empty) project list.
    assert.equal(cfg.projects.length, 1, text);
    if (text === "" || text === "not json" || text === "null" || text === "[]") {
      await loadConfig();
      assert.equal(hostStub.__warningMessages().filter((m) => m.includes(RULES_FILE)).length, 1, `warned once: ${text}`);
    }
    // A damaged file is never rewritten by loading.
    assert.equal(fs.readFileSync(path.join(dir, RULES_FILE), "utf8"), text);
  }
});

test("shortcut store, launcher recent list and branch bindings: garbage reads as empty", async () => {
  for (const g of GARBAGE) {
    const ctx = fakeContext();
    await ctx.globalState.update("saropaWorkspace.globalPins", g);
    const store = new ShortcutStore(ctx);
    assert.doesNotThrow(() => (store as unknown as { readGlobalShortcuts(): unknown[] }).readGlobalShortcuts(), JSON.stringify(g));
    if (!Array.isArray(g)) {
      assert.deepEqual((store as unknown as { readGlobalShortcuts(): unknown[] }).readGlobalShortcuts(), [], JSON.stringify(g));
    }
    const bctx = fakeContext();
    await bctx.workspaceState.update("saropaWorkspace.branchSets", g);
    const expected = g && typeof g === "object" && !Array.isArray(g) ? g : {};
    assert.deepEqual(new BranchSetBinder(bctx, store, { onDidChangeBranch: () => ({ dispose: () => undefined }) } as never).bindings(), expected, JSON.stringify(g));
    if (!Array.isArray(g)) {
      const lctx = fakeContext();
      await lctx.globalState.update("saropaWorkspace.recentConfigFiles", g);
      await assert.doesNotReject(handleOpenFolder(lctx), JSON.stringify(g));
    }
  }
  const mixed = fakeContext();
  await mixed.globalState.update("saropaWorkspace.globalPins", [null, 5, { id: "a", scope: "project" }]);
  const shortcuts = (new ShortcutStore(mixed) as unknown as { readGlobalShortcuts(): Array<{ id: string; scope: string }> }).readGlobalShortcuts();
  assert.deepEqual(shortcuts.map((x) => [x.id, x.scope]), [["a", "global"]]);
});
