// Extra projects of the Release Board on the host side: reading the chosen folders into
// projects, the grey rows for folders that cannot be read, the setup menu and the hint.
// Real temp folders; every test removes what it made.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { RULES_FILE, boardReady, loadConfig } from "../../commands/boardConfigLoad";
import { chosenFolders, hasChosenFolders } from "../../commands/boardExtraProjects";
import { chooseProjects, menuItems, openBoardSettings } from "../../views/boardProjectsFlow";
import { HINT_DISMISSED_KEY, dismissHint, hintVisible } from "../../views/boardProjectsHint";
import { fakeContext } from "../_stub/context";
import { BoardConfig } from "../../board/types";

const stub = vscode as unknown as {
  __setConfig(section: string, key: string, value: unknown): void;
  __getConfig(section: string, key: string): unknown;
  __resetConfig(): void;
  __setWorkspaceFolders(f: Array<{ uri: vscode.Uri; name: string; index: number }> | undefined): void;
  __setPickHandler(h: (items: readonly unknown[]) => Promise<unknown>): void;
  __setOpenDialogHandler(h: (opts?: unknown) => Promise<vscode.Uri[] | undefined>): void;
  __resetHandlers(): void;
  __infoMessages(): readonly string[];
  __resetRecordedCommands(): void;
  __recordedCommands(): ReadonlyArray<{ command: string; args: unknown[] }>;
};
const SECTION = "saropaWorkspace.releaseBoard";

const made: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "board-extra-"));
  made.push(d);
  return d;
}
function mk(dir: string, ...names: string[]): string {
  for (const n of names) {
    fs.mkdirSync(path.join(dir, n), { recursive: true });
  }
  return dir;
}
function open(dir: string, name = "app"): void {
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(dir), name, index: 0 }]);
}
function choose(...dirs: string[]): void {
  stub.__setConfig(SECTION, "projects", dirs);
}

afterEach(() => {
  stub.__resetConfig();
  stub.__setWorkspaceFolders(undefined);
  stub.__resetHandlers();
  stub.__resetRecordedCommands();
  while (made.length > 0) {
    fs.rmSync(made.pop()!, { recursive: true, force: true });
  }
});

test("with nothing chosen the board is exactly the open folders", async () => {
  const dir = mk(tmp(), "bugs");
  open(dir);
  const cfg = await loadConfig();
  assert.deepEqual(cfg.projects.map((p) => [p.id, p.extra]), [["app", undefined]]);
  assert.equal(cfg.skipped, undefined);
  assert.equal(hasChosenFolders(), false);
});

test("a chosen folder becomes a project after the open ones, over the folders it has", async () => {
  const home = mk(tmp(), "bugs");
  const other = mk(tmp(), "plans", "docs", "src");
  open(home, "app");
  choose(other);
  const cfg = await loadConfig();
  assert.deepEqual(cfg.projects.map((p) => p.id), ["app", path.basename(other)]);
  const extra = cfg.projects[1];
  assert.equal(extra.extra, true);
  assert.equal(extra.path, other);
  assert.deepEqual(extra.roots, ["docs", "plans"]);
  assert.deepEqual(extra.ruleSets, cfg.projects[0].ruleSets);
  assert.equal(cfg.skipped, undefined);
});

test("a chosen folder named like an open project gets its own id", async () => {
  const parent = tmp();
  const home = mk(path.join(parent, "one", "same"), "bugs");
  const other = mk(path.join(parent, "two", "same"), "bugs");
  open(home, "same");
  choose(other);
  assert.deepEqual((await loadConfig()).projects.map((p) => p.id), ["same", "same-2"]);
});

test("an open folder in the list is not added twice", async () => {
  const home = mk(tmp(), "bugs");
  open(home);
  choose(home + path.sep);
  assert.deepEqual((await loadConfig()).projects.map((p) => p.id), ["app"]);
});

test("a folder that is gone, a file and a list past the limit give grey rows and no error", async () => {
  const home = mk(tmp(), "bugs");
  const file = path.join(tmp(), "afile.txt");
  fs.writeFileSync(file, "x");
  open(home);
  const gone = path.join(tmp(), "gone");
  choose(gone, file);
  const cfg = await loadConfig();
  assert.deepEqual(cfg.projects.map((p) => p.id), ["app"]);
  assert.deepEqual(cfg.skipped, [
    { name: "gone", reason: "missing" },
    { name: "afile.txt", reason: "notFolder" },
  ]);
});

test("the list past the limit is grey rows for the rest", async () => {
  const home = mk(tmp(), "bugs");
  open(home);
  const base = tmp();
  const dirs = Array.from({ length: 42 }, (_, i) => path.join(base, `p${String(i).padStart(2, "0")}`));
  dirs.forEach((d) => mk(d, "bugs"));
  choose(...dirs);
  const cfg = await loadConfig();
  assert.equal(cfg.projects.length, 1 + 40);
  assert.deepEqual(cfg.skipped, [
    { name: "p40", reason: "overLimit" },
    { name: "p41", reason: "overLimit" },
  ]);
});

test("openOnly hides the chosen projects without losing the list", async () => {
  const home = mk(tmp(), "bugs");
  const other = mk(tmp(), "docs");
  open(home);
  choose(other);
  stub.__setConfig(SECTION, "projectScope", "openOnly");
  const cfg = await loadConfig();
  assert.deepEqual(cfg.projects.map((p) => p.id), ["app"]);
  assert.equal(cfg.skipped, undefined);
  assert.deepEqual(chosenFolders().paths, [other]);
  assert.equal(hasChosenFolders(), false);
});

test("a chosen folder uses its own rules file and keeps its rule sets to itself", async () => {
  const home = mk(tmp(), "bugs");
  const other = mk(tmp(), ".saropa", "notes");
  fs.writeFileSync(
    path.join(other, RULES_FILE),
    JSON.stringify({ version: 1, ruleSets: { mine: { description: "x" } }, projects: [{ id: "sub", path: "notes", roots: ["."], ruleSets: ["mine"] }, { id: "out", path: "../outside", roots: [], ruleSets: [] }] })
  );
  open(home);
  choose(other);
  const cfg: BoardConfig = await loadConfig();
  const sub = cfg.projects.find((p) => p.id === "sub")!;
  assert.equal(sub.path, path.join(other, "notes"));
  assert.deepEqual(sub.ruleSets, [`${path.basename(other)}:mine`]);
  assert.deepEqual(cfg.projects.map((p) => p.id), ["app", "sub"]);
  assert.ok(cfg.ruleSets[`${path.basename(other)}:mine`]);
  assert.equal(cfg.ruleSets.mine, undefined);
});

test("a rules file that is not valid JSON falls back to the default rule sets", async () => {
  const home = mk(tmp(), "bugs");
  const other = mk(tmp(), ".saropa", "docs");
  fs.writeFileSync(path.join(other, RULES_FILE), "{ not json");
  open(home);
  choose(other);
  const cfg = await loadConfig();
  assert.deepEqual(cfg.projects[1].roots, ["docs"]);
  assert.deepEqual(cfg.projects[1].ruleSets, cfg.projects[0].ruleSets);
});

test("with no folder open the board is ready only when a folder is chosen", async () => {
  assert.equal(boardReady(true), false);
  const other = mk(tmp(), "docs");
  choose(other);
  assert.equal(boardReady(true), true);
  const cfg = await loadConfig();
  assert.deepEqual(cfg.projects.map((p) => p.id), [path.basename(other)]);
});

test("the setup menu offers adding always, and removing and the scope switch once something is chosen", () => {
  const none = menuItems(0, "all");
  assert.deepEqual(none.map((i) => i.action), ["add", "addParent"]);
  assert.deepEqual(none.map((i) => i.label), ["Add a folder...", "Add all folders in a parent folder..."]);
  const some = menuItems(2, "all");
  assert.deepEqual(some.map((i) => i.action), ["add", "addParent", "remove", "scope"]);
  assert.equal(some[2].label, "Remove...");
  assert.equal(some[3].label, "Show only the open project");
  assert.equal(menuItems(2, "openOnly")[3].label, "Show all chosen projects");
});

test("Add a folder writes the picked folders to the user setting", async () => {
  const home = mk(tmp());
  const a = mk(tmp());
  const b = mk(tmp());
  open(home);
  stub.__setPickHandler(async (items) => (items as Array<{ action: string }>).find((i) => i.action === "add"));
  stub.__setOpenDialogHandler(async () => [vscode.Uri.file(a), vscode.Uri.file(b), vscode.Uri.file(home)]);
  await chooseProjects();
  assert.deepEqual(stub.__getConfig(SECTION, "projects"), [a, b]);
  assert.ok(stub.__infoMessages().includes("Added 2 project(s) to the Release Board."));
});

test("cancelling the menu or the folder picker writes nothing", async () => {
  await chooseProjects();
  assert.equal(stub.__getConfig(SECTION, "projects"), undefined);
  stub.__setPickHandler(async (items) => (items as Array<{ action: string }>).find((i) => i.action === "add"));
  await chooseProjects();
  assert.equal(stub.__getConfig(SECTION, "projects"), undefined);
});

test("Add all folders in a parent adds only the children that look like projects, after the pick", async () => {
  const home = mk(tmp());
  const parent = tmp();
  mk(parent, "alpha/.git", "beta/docs", "gamma/src", "delta/.saropa", ".hidden/.git", "node_modules/.git");
  fs.writeFileSync(path.join(parent, "file.txt"), "x");
  open(home);
  let offered: string[] = [];
  stub.__setPickHandler(async (items) => {
    const list = items as Array<{ action?: string; label: string; description?: string }>;
    if (list.some((i) => i.action)) {
      return list.find((i) => i.action === "addParent");
    }
    offered = list.map((i) => i.label);
    // The user unticks beta.
    return list.filter((i) => i.label !== "beta");
  });
  stub.__setOpenDialogHandler(async () => [vscode.Uri.file(parent)]);
  await chooseProjects();
  assert.deepEqual(offered, ["alpha", "beta", "delta"]);
  assert.deepEqual(stub.__getConfig(SECTION, "projects"), [path.join(parent, "alpha"), path.join(parent, "delta")]);
});

test("a parent with no project folder says so and writes nothing", async () => {
  const parent = tmp();
  mk(parent, "plain/src");
  stub.__setPickHandler(async (items) => (items as Array<{ action: string }>).find((i) => i.action === "addParent"));
  stub.__setOpenDialogHandler(async () => [vscode.Uri.file(parent)]);
  await chooseProjects();
  assert.equal(stub.__getConfig(SECTION, "projects"), undefined);
  assert.ok(stub.__infoMessages().includes(`No folder inside ${path.basename(parent)} looks like a project. A project folder has .git, .saropa, plans, docs or bugs.`));
});

test("Remove takes the picked projects off the list, and the last one clears it", async () => {
  const a = mk(tmp());
  const b = mk(tmp());
  choose(a, b);
  stub.__setPickHandler(async (items) => {
    const list = items as Array<{ action?: string; description?: string }>;
    return list.some((i) => i.action) ? list.find((i) => i.action === "remove") : list.filter((i) => i.description === a);
  });
  await chooseProjects();
  assert.deepEqual(stub.__getConfig(SECTION, "projects"), [b]);
  stub.__setPickHandler(async (items) => {
    const list = items as Array<{ action?: string }>;
    return list.some((i) => i.action) ? list.find((i) => i.action === "remove") : list;
  });
  await chooseProjects();
  assert.equal(stub.__getConfig(SECTION, "projects"), undefined);
});

test("the scope switch flips between all and openOnly", async () => {
  choose(mk(tmp()));
  stub.__setPickHandler(async (items) => (items as Array<{ action: string }>).find((i) => i.action === "scope"));
  await chooseProjects();
  assert.equal(stub.__getConfig(SECTION, "projectScope"), "openOnly");
  await chooseProjects();
  assert.equal(stub.__getConfig(SECTION, "projectScope"), "all");
});

test("the Settings command opens the Settings editor filtered to the board", async () => {
  await openBoardSettings();
  assert.deepEqual(stub.__recordedCommands(), [{ command: "workbench.action.openSettings", args: ["saropaWorkspace.releaseBoard"] }]);
});

test("the hint shows while nothing is chosen and goes for good once dismissed", async () => {
  const home = mk(tmp(), "bugs");
  open(home);
  const context = fakeContext();
  const cfg = await loadConfig();
  assert.equal(hintVisible(context, cfg), true);
  await dismissHint(context);
  assert.equal(context.globalState.get(HINT_DISMISSED_KEY), true);
  assert.equal(hintVisible(context, cfg), false);
});

test("the hint is not shown once a project is chosen, even if it cannot be read", async () => {
  const home = mk(tmp(), "bugs");
  open(home);
  choose(path.join(tmp(), "gone"));
  const cfg = await loadConfig();
  assert.equal(hintVisible(fakeContext(), cfg), false);
});

import { loadExtraProjects } from "../../commands/boardExtraProjects";
import { buildBoard } from "../../board/boardModel";
import { boardLights, worstLight } from "../../board/sidebar";

test("a rules file in a chosen folder cannot bring health settings: lintFile and test shortcuts are dropped", async () => {
  const home = mk(tmp(), "bugs");
  const other = mk(tmp(), ".saropa", "docs");
  fs.writeFileSync(
    path.join(other, RULES_FILE),
    JSON.stringify({ version: 1, projects: [{ id: "sub", path: ".", roots: ["docs"], ruleSets: [], health: { lintFile: "../../x", tests: ["open tests"], lint: ["open lint"] } }] })
  );
  open(home);
  choose(other);
  const sub = (await loadConfig()).projects.find((p) => p.id === "sub")!;
  assert.equal(sub.health, undefined);
  assert.deepEqual(Object.keys(sub).sort(), ["extra", "id", "name", "path", "roots", "ruleSets"]);
});

test("a rules file over the byte limit is ignored without being read whole", async () => {
  const home = mk(tmp(), "bugs");
  const other = mk(tmp(), ".saropa", "docs");
  const pad = " ".repeat(300 * 1024);
  fs.writeFileSync(path.join(other, RULES_FILE), `{"version":1,"projects":[{"id":"big","path":".","roots":["docs"],"ruleSets":[]}]${pad}}`);
  open(home);
  choose(other);
  assert.deepEqual((await loadConfig()).projects.map((p) => p.id), ["app", path.basename(other)]);
});

test("a rules file that is a link, even to a small file outside the folder, is ignored", async () => {
  const home = mk(tmp(), "bugs");
  const outside = tmp();
  const target = path.join(outside, "rules.json");
  fs.writeFileSync(target, JSON.stringify({ version: 1, projects: [{ id: "linked", path: ".", roots: [], ruleSets: [] }] }));
  const other = mk(tmp(), ".saropa", "docs");
  try {
    fs.symlinkSync(target, path.join(other, RULES_FILE));
  } catch {
    return; // links not allowed on this machine
  }
  open(home);
  choose(other);
  assert.deepEqual((await loadConfig()).projects.map((p) => p.id), ["app", path.basename(other)]);
});

test("a rules file reached through a linked .saropa folder that leaves the chosen folder is ignored", async () => {
  const home = mk(tmp(), "bugs");
  const outside = mk(tmp(), "cfg");
  fs.writeFileSync(path.join(outside, "release-board.json"), JSON.stringify({ version: 1, projects: [{ id: "escaped", path: ".", roots: [], ruleSets: [] }] }));
  const other = mk(tmp(), "docs");
  try {
    fs.symlinkSync(outside, path.join(other, ".saropa"), "dir");
  } catch {
    return;
  }
  open(home);
  choose(other);
  assert.deepEqual((await loadConfig()).projects.map((p) => p.id), ["app", path.basename(other)]);
});

test("a chosen folder that does not answer in time is one grey row and the others still load", async () => {
  const slow = mk(tmp(), "docs");
  const fast = mk(tmp(), "docs");
  choose(slow, fast);
  const real = vscode.workspace.fs;
  const original = real.stat.bind(real);
  (real as { stat: typeof real.stat }).stat = (uri) => (uri.fsPath === slow ? new Promise(() => undefined) : original(uri));
  try {
    const out = await loadExtraProjects(new Set(["app"]), (n, used) => (used.add(n), n), ["docs"], [], 50);
    assert.deepEqual(out.skipped, [{ name: path.basename(slow), reason: "timedOut" }]);
    assert.deepEqual(out.projects.map((p) => p.id), [path.basename(fast)]);
  } finally {
    (real as { stat: typeof real.stat }).stat = original;
  }
});

test("with the open-only scope the chosen projects are counted as hidden and none is loaded", async () => {
  const home = mk(tmp(), "bugs");
  open(home);
  choose(mk(tmp(), "docs"), mk(tmp(), "docs"));
  stub.__setConfig(SECTION, "projectScope", "openOnly");
  const cfg = await loadConfig();
  assert.equal(cfg.hidden, 2);
  assert.deepEqual(cfg.projects.map((p) => p.id), ["app"]);
  const model = buildBoard(cfg, [], undefined, true);
  assert.equal(model.hidden, 2);
  stub.__setConfig(SECTION, "projectScope", "all");
  assert.equal((await loadConfig()).hidden, undefined);
});

test("the hint still shows while chosen projects are hidden by the open-only scope", async () => {
  const home = mk(tmp(), "bugs");
  open(home);
  choose(mk(tmp(), "docs"));
  stub.__setConfig(SECTION, "projectScope", "openOnly");
  assert.equal(hintVisible(fakeContext(), await loadConfig()), true);
});

test("a deleted chosen folder raises no safety finding but the board is not GO", async () => {
  const home = mk(tmp(), "bugs");
  const other = mk(tmp(), "docs");
  open(home);
  choose(other);
  fs.rmSync(other, { recursive: true, force: true });
  const cfg = await loadConfig();
  assert.deepEqual(cfg.skipped, [{ name: path.basename(other), reason: "missing" }]);
  const model = buildBoard(cfg, [], undefined, true);
  model.projects.forEach((p) => (p.light = "go"));
  assert.equal(worstLight(boardLights(model)), "unverified");
});

test("with the open folder A already stored, adding B keeps A in the setting", async () => {
  const a = mk(tmp());
  const b = mk(tmp());
  open(a);
  choose(a);
  stub.__setPickHandler(async (items) => (items as Array<{ action: string }>).find((i) => i.action === "add"));
  stub.__setOpenDialogHandler(async () => [vscode.Uri.file(b)]);
  await chooseProjects();
  assert.deepEqual(stub.__getConfig(SECTION, "projects"), [a, b]);
  assert.deepEqual(chosenFolders().paths, [b], "the open folder is filtered only when the board loads");
});

test("removing one project keeps an open folder that is stored", async () => {
  const a = mk(tmp());
  const b = mk(tmp());
  open(a);
  choose(a, b);
  stub.__setPickHandler(async (items) => {
    const list = items as Array<{ action?: string; description?: string }>;
    return list.some((i) => i.action) ? list.find((i) => i.action === "remove") : list.filter((i) => i.description === b);
  });
  await chooseProjects();
  assert.deepEqual(stub.__getConfig(SECTION, "projects"), [a]);
});

test("rules written from the board apply to a chosen folder too: the overrides set first, the my-rules set last", async () => {
  const home = mk(tmp(), "bugs");
  const other = mk(tmp(), "bugs");
  fs.mkdirSync(path.join(home, ".saropa"));
  fs.writeFileSync(path.join(home, ".saropa", "release-board.json"), JSON.stringify({ version: 1, ruleSets: { "my-overrides": { rules: [] }, "my-rules": { rules: [] } } }));
  open(home, "app");
  choose(other);
  const cfg = await loadConfig();
  const [openProject, chosen] = cfg.projects;
  assert.equal(openProject.ruleSets[0], "my-overrides");
  assert.equal(openProject.ruleSets[openProject.ruleSets.length - 1], "my-rules");
  assert.deepEqual(chosen.ruleSets, openProject.ruleSets, "the chosen folder reads the same sets in the same order");
});
