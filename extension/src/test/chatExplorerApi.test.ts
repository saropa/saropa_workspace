// The Chat Explorer wrapper treats every step as possibly failing: absent, throwing, malformed
// and valid answers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readChats } from "../commands/chatExplorerApi";

const ext = (api: unknown) => () => ({ activate: () => Promise.resolve(api) });

test("an extension that is not installed gives nothing, without throwing", async () => {
  assert.deepEqual(await readChats(() => undefined), { ok: false });
});

test("a failing activation, a missing method and an old version all give nothing", async () => {
  assert.deepEqual(await readChats(() => ({ activate: () => Promise.reject(new Error("boom")) })), { ok: false });
  assert.deepEqual(await readChats(() => ({ activate: () => { throw new Error("sync"); } })), { ok: false });
  assert.deepEqual(await readChats(ext(undefined)), { ok: false });
  assert.deepEqual(await readChats(ext({ apiVersion: 1 })), { ok: false });
  assert.deepEqual(await readChats(ext({ apiVersion: 0, listChats: async () => [] })), { ok: false });
});

test("a listing that rejects or is not an array gives nothing", async () => {
  assert.deepEqual(await readChats(ext({ apiVersion: 1, listChats: () => Promise.reject(new Error("index failed")) })), { ok: false });
  assert.deepEqual(await readChats(ext({ apiVersion: 1, listChats: async () => ({}) })), { ok: false });
});

test("a valid listing is reduced to the fields the board uses, and malformed rows are dropped", async () => {
  const api = {
    apiVersion: 1,
    listChats: async () => [
      { id: "a", title: "x", folder: "/work/app", last: 1000, state: "waiting", archived: false },
      { folder: "/work/other", last: 5, archived: true },
      { folder: "", last: 5 },
      { folder: "/work/x", last: "soon" },
      null,
      "junk"
    ]
  };
  assert.deepEqual(await readChats(ext(api)), {
    ok: true,
    chats: [
      { folder: "/work/app", last: 1000, state: "waiting", archived: false },
      { folder: "/work/other", last: 5, state: undefined, archived: true }
    ]
  });
  assert.deepEqual(await readChats(ext({ apiVersion: 1, listChats: async () => [] })), { ok: true, chats: [] });
});
