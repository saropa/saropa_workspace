// Tests for the GitHub repo-watch commands: the slug prompt (prefill from the git remote and its
// validation), duplicates, the label and author filters, the reachability check with sign-in, and
// editing the repo of an existing watch. The GitHub API is a replaced fetch.

import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  __setWorkspaceFolders, __resetHandlers, __resetHosts, __progressRuns, __warningMessages, __resetWarnings,
  __authRequests, __resetAuth, __setAuthSession,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { driveInputs } from "./uiDrivers";
import { FolderWatchStore, type FolderWatch } from "../model/folderWatch";
import { addGitHubRepoWatch, editGitHubRepoWatch } from "../commands/githubWatchCommands";
import { l10n } from "../i18n/l10n";

let fx: FsFixture;
let store: FolderWatchStore;
let calls: Array<{ url: string; auth: string | undefined }>;
let reply: (url: string) => Response;
const realFetch = globalThis.fetch;

const titles = (): Array<string | undefined> => __progressRuns().map((r) => r.title);
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, statusText: status === 200 ? "OK" : "Not Found" });

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout"] });
  fx = createFsFixture("sw-ghwatch-");
  store = new FolderWatchStore(fakeContext());
  calls = [];
  reply = () => json([]);
  globalThis.fetch = (async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, auth: init?.headers?.Authorization });
    return reply(url);
  }) as typeof fetch;
  __resetHosts();
  __resetAuth();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  mock.timers.reset();
  fx.remove();
  __resetHosts();
  __resetHandlers();
  __resetWarnings();
  __resetAuth();
});

async function seed(over: Partial<FolderWatch>): Promise<FolderWatch> {
  const watch: FolderWatch = { id: "r1", kind: "repo", target: "saropa/demo", isFile: false, mode: "new", enabled: true, ...over };
  await store.add(watch);
  return store.find(watch.id)!;
}

test("a repo is added after the filters and the sign-in check, scoped to the open project", async () => {
  __setAuthSession({ accessToken: "tok" });
  const inputs = driveInputs("saropa/demo ", " bug, , urgent ", " octocat ");
  await addGitHubRepoWatch(store);
  const [watch] = store.list();
  assert.deepEqual(
    [watch.target, watch.kind, watch.mode, watch.enabled, watch.alertScopes, watch.global, watch.filterLabels, watch.filterAuthor],
    ["saropa/demo", "repo", "new", true, [fx.dir], undefined, ["bug", "urgent"], "octocat"]
  );
  assert.deepEqual(inputs.map((i) => i.title), [l10n("github.addRepoTitle"), l10n("github.addRepoTitle"), l10n("github.addRepoTitle")]);
  assert.deepEqual(__authRequests().map((r) => r.createIfNone), [true], "the sign-in prompt is asked for here");
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.startsWith("https://api.github.com/repos/saropa/demo/issues?state=open"));
  assert.ok(calls[1].url.startsWith("https://api.github.com/repos/saropa/demo/pulls?state=open"));
  assert.equal(calls[0].auth, "token tok");
  assert.deepEqual(titles(), [l10n("github.repoAdded", { repo: "saropa/demo" })]);
});

test("empty filters are stored as no filter", async () => {
  driveInputs("saropa/demo", "", "  ");
  await addGitHubRepoWatch(store);
  const [watch] = store.list();
  assert.deepEqual([watch.filterLabels, watch.filterAuthor], [undefined, undefined]);
});

test("with no folder open the watch is global so that it can alert somewhere", async () => {
  __setWorkspaceFolders(undefined);
  driveInputs("saropa/demo", "", "");
  await addGitHubRepoWatch(store);
  const [watch] = store.list();
  assert.deepEqual([watch.alertScopes, watch.global], [undefined, true]);
});

test("the slug box is prefilled from the origin remote and rejects anything but owner/repo", async () => {
  fx.write(".git/config", '[remote "origin"]\n\turl = git@github.com:saropa/demo.git\n');
  const inputs = driveInputs(undefined);
  await addGitHubRepoWatch(store);
  assert.equal(inputs[0].value, "saropa/demo");
  assert.equal(inputs[0].placeHolder, "owner/repo");
  const validate = inputs[0].validateInput!;
  assert.equal(validate(" saropa/demo "), undefined);
  assert.equal(validate("saropa"), l10n("github.invalidSlug"));
  assert.equal(validate("https://github.com/saropa/demo"), l10n("github.invalidSlug"));
});

test("no prefill when the remote is not on GitHub, there is no remote, or no folder is open", async () => {
  fx.write(".git/config", '[remote "origin"]\n\turl = git@gitlab.com:saropa/demo.git\n');
  let inputs = driveInputs(undefined);
  await addGitHubRepoWatch(store);
  assert.equal(inputs[0].value, undefined);
  fx.write(".git/config", "[core]\n\tbare = false\n");
  inputs = driveInputs(undefined);
  await addGitHubRepoWatch(store);
  assert.equal(inputs[0].value, undefined);
  __setWorkspaceFolders(undefined);
  inputs = driveInputs(undefined);
  await addGitHubRepoWatch(store);
  assert.equal(inputs[0].value, undefined);
});

test("cancelling the slug box, a blank slug, or either filter box adds nothing", async () => {
  driveInputs(undefined);
  await addGitHubRepoWatch(store);
  driveInputs("");
  await addGitHubRepoWatch(store);
  driveInputs("saropa/demo", undefined);
  await addGitHubRepoWatch(store);
  driveInputs("saropa/demo", "", undefined);
  await addGitHubRepoWatch(store);
  assert.deepEqual(store.list(), []);
  assert.deepEqual(calls, []);
  assert.deepEqual(titles(), []);
});

test("a repo already watched, in any letter case, is reported and the filters are not asked", async () => {
  await seed({ target: "Saropa/Demo" });
  const inputs = driveInputs("saropa/DEMO");
  await addGitHubRepoWatch(store);
  assert.equal(store.list().length, 1);
  assert.equal(inputs.length, 1);
  assert.deepEqual(titles(), [l10n("github.alreadyWatched", { repo: "saropa/DEMO" })]);
});

test("an unreachable repo shows the failure and stores nothing", async () => {
  reply = () => json({}, 404);
  driveInputs("saropa/gone", "", "");
  await addGitHubRepoWatch(store);
  assert.deepEqual(store.list(), []);
  assert.deepEqual(__warningMessages(), [l10n("github.addRepoFailed", { repo: "saropa/gone", error: "404 Not Found" })]);
  assert.deepEqual(titles(), []);
});

test("a declined sign-in still checks the repo without a token", async () => {
  __setAuthSession(undefined);
  driveInputs("saropa/demo", "", "");
  await addGitHubRepoWatch(store);
  assert.equal(calls[0].auth, undefined);
  assert.equal(store.list().length, 1);
});

test("editing changes the target in place, keeps the label and filters, and drops the old baseline and unseen items", async () => {
  const watch = await seed({ label: "Mine", filterLabels: ["bug"], alertScopes: ["/p"] });
  await store.setBaseline("r1", { "issue:1": 5 } as never);
  await store.addUnseen("r1", ["issue:1"]);
  const inputs = driveInputs(" saropa/other ");
  await editGitHubRepoWatch(store, watch);
  const after = store.find("r1")!;
  assert.deepEqual([after.target, after.label, after.filterLabels, after.alertScopes], ["saropa/other", "Mine", ["bug"], ["/p"]]);
  assert.equal(store.getBaseline("r1"), undefined);
  assert.deepEqual(store.getUnseen("r1"), []);
  assert.deepEqual([inputs[0].title, inputs[0].value], [l10n("github.editRepoTitle"), "saropa/demo"]);
  assert.deepEqual(titles(), [l10n("github.repoRetargeted", { repo: "saropa/other" })]);
});

test("editing to the same repo (any case) or cancelling changes nothing and checks nothing", async () => {
  const watch = await seed({});
  await store.addUnseen("r1", ["issue:1"]);
  driveInputs("SAROPA/Demo");
  await editGitHubRepoWatch(store, watch);
  driveInputs(undefined);
  await editGitHubRepoWatch(store, watch);
  assert.equal(store.find("r1")!.target, "saropa/demo");
  assert.deepEqual(store.getUnseen("r1"), ["issue:1"]);
  assert.deepEqual(calls, []);
  assert.deepEqual(titles(), []);
});

test("editing to a repo another watch already has is reported, but the watch's own target is not a clash", async () => {
  const watch = await seed({});
  await seed({ id: "r2", target: "saropa/taken" });
  driveInputs("Saropa/Taken");
  await editGitHubRepoWatch(store, watch);
  assert.equal(store.find("r1")!.target, "saropa/demo");
  assert.deepEqual(titles(), [l10n("github.alreadyWatched", { repo: "Saropa/Taken" })]);
});

test("editing to an unreachable repo keeps the old target and its unseen items", async () => {
  const watch = await seed({});
  await store.addUnseen("r1", ["issue:1"]);
  reply = () => json({}, 404);
  driveInputs("saropa/gone");
  await editGitHubRepoWatch(store, watch);
  assert.equal(store.find("r1")!.target, "saropa/demo");
  assert.deepEqual(store.getUnseen("r1"), ["issue:1"]);
  assert.equal(__warningMessages().length, 1);
});

test("the edit box checks the slug the same way the add box does", async () => {
  const watch = await seed({});
  const inputs = driveInputs(undefined);
  await editGitHubRepoWatch(store, watch);
  assert.equal(inputs[0].validateInput!("saropa/ok"), undefined);
  assert.equal(inputs[0].validateInput!("nope"), l10n("github.invalidSlug"));
});
