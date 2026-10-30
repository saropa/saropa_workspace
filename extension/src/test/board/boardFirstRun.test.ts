// First run and damaged state: every reader of persisted Release Board state must return a safe
// default for missing, empty or wrong-typed input and never throw.

import { test, afterEach } from "node:test";
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
import { RULES_FILE, loadConfig } from "../../commands/boardConfigLoad";
import { BoardPatches } from "../../views/boardPatches";

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
      assert.equal(typeof plan.mode, "string", JSON.stringify(g));
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
    const c = readSittingsChoice(ctx);
    if (c) {
      assert.ok(Array.isArray(c.have));
    }
  }
});

test("answered replies: garbage in the workspace state starts with none", () => {
  for (const g of GARBAGE) {
    assert.doesNotThrow(() => new BoardPatches(() => undefined, () => undefined, () => undefined, () => memento(g)), JSON.stringify(g));
  }
  assert.doesNotThrow(() => new BoardPatches(() => undefined, () => undefined, () => undefined));
});

test("rules: no workspace folder and a damaged rules file both load", async () => {
  stub.__setWorkspaceFolders(undefined);
  assert.ok(Array.isArray((await loadConfig()).projects));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-first-"));
  fs.mkdirSync(path.dirname(path.join(dir, RULES_FILE)), { recursive: true });
  for (const text of ["", "not json", "null", "[]", '{"projects":5,"ruleSets":[],"ignore":"x"}']) {
    fs.writeFileSync(path.join(dir, RULES_FILE), text);
    stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(dir), name: "app", index: 0 }]);
    const cfg = await loadConfig();
    assert.ok(Array.isArray(cfg.projects), text);
    assert.ok(Array.isArray(cfg.ignore), text);
  }
});
