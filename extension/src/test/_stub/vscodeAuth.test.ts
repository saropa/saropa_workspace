// Tests for the stub's sign-in session and request log.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { authentication, __authRequests, __resetAuth, __setAuthFailure, __setAuthSession } from "./vscodeAuth";

beforeEach(() => __resetAuth());

test("signed out by default, and every request is logged with its prompt flag", async () => {
  assert.equal(await authentication.getSession("github", ["repo"], { createIfNone: true }), undefined);
  assert.equal(await authentication.getSession("github", ["repo"]), undefined);
  assert.deepEqual(__authRequests(), [
    { provider: "github", scopes: ["repo"], createIfNone: true },
    { provider: "github", scopes: ["repo"], createIfNone: false },
  ]);
});

test("a set session is returned until the reset", async () => {
  __setAuthSession({ accessToken: "tok" });
  assert.deepEqual(await authentication.getSession("github", []), { accessToken: "tok" });
  __resetAuth();
  assert.equal(await authentication.getSession("github", []), undefined);
  assert.deepEqual(__authRequests().length, 1);
});

test("a set failure is thrown and the request is still logged", async () => {
  __setAuthFailure(new Error("no provider"));
  await assert.rejects(authentication.getSession("github", []), /no provider/);
  assert.equal(__authRequests().length, 1);
  __setAuthFailure(undefined);
  assert.equal(await authentication.getSession("github", []), undefined);
});
