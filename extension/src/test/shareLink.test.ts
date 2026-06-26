// Unit tests for the "Share this Pin" link codec (toSharedPin / encodePinLink /
// decodeSharedPin / describeSharedPin). All four are pure — they reduce a pin to its
// portable subset, base64url-encode it into a vscode:// URI, decode it back, and
// describe it — so they bundle and run under node --test with no vscode host. The
// security contract is the focus: a link carries ONLY portable config (never id /
// scope / order), and a malformed/wrong-version/empty link decodes to undefined
// rather than throwing, so a hostile paste can at worst add an inspectable pin.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toSharedPin,
  encodePinLink,
  decodeSharedPin,
  describeSharedPin,
} from "../import/shareLink";
import type { Pin, PinAction } from "../model/pin";

// A minimal Pin carrying only the fields a given test exercises; the non-portable
// fields (id, scope, order) are present so the test can prove they are dropped.
function pin(overrides: Partial<Pin>): Pin {
  return {
    id: "pin-id-123",
    path: "src/app.ts",
    scope: "project",
    order: 7,
    ...overrides,
  };
}

test("toSharedPin keeps the portable fields and drops id / scope / order", () => {
  const shared = toSharedPin(
    pin({ label: "App", icon: "rocket", color: "charts.green" })
  );
  assert.equal(shared.v, 1, "the schema version is stamped");
  assert.equal(shared.label, "App");
  assert.equal(shared.path, "src/app.ts", "a file pin carries its path");
  assert.equal(shared.icon, "rocket");
  assert.equal(shared.color, "charts.green");
  // The non-portable identity fields must never leak into the link.
  assert.equal((shared as Record<string, unknown>).id, undefined, "the id is not shared");
  assert.equal((shared as Record<string, unknown>).scope, undefined, "the scope is not shared");
  assert.equal((shared as Record<string, unknown>).order, undefined, "the order is not shared");
});

test("toSharedPin carries an action pin's action and omits its path", () => {
  // A non-file (action) pin: pinKind reads the action's kind, so `path` must be
  // omitted from the shared shape (only a "file" kind shares a path).
  const action: PinAction = { kind: "shell", shellCommand: "npm test" };
  const shared = toSharedPin(pin({ action, path: "ignored.ts" }));
  assert.equal(shared.path, undefined, "an action pin shares no path");
  assert.deepEqual(shared.action, action, "the action is carried verbatim");
});

test("encodePinLink produces a vscode:// import URI whose payload round-trips", () => {
  const link = encodePinLink(pin({ label: "Repo", action: { kind: "url", url: "https://example.com" } }));
  assert.match(link, /^vscode:\/\/saropa\.saropa-workspace\/import\?data=/, "the link routes to the extension's import handler");

  // The base64url payload after data= must decode back to the same shared pin.
  const data = link.split("data=")[1];
  const decoded = decodeSharedPin(data);
  assert.ok(decoded, "the payload decodes");
  assert.equal(decoded!.label, "Repo");
  assert.equal(decoded!.action?.kind, "url");
  assert.equal(decoded!.action?.url, "https://example.com");
});

test("encode then decode is a faithful round-trip for a macro pin", () => {
  const macro: PinAction = {
    kind: "macro",
    steps: [
      { kind: "open", path: "a.ts", label: "Open A" },
      { kind: "shell", shellCommand: "npm i" },
    ],
  };
  const link = encodePinLink(pin({ label: "Boot", action: macro }));
  const decoded = decodeSharedPin(link.split("data=")[1]);
  assert.deepEqual(decoded!.action, macro, "the macro and its steps survive the round-trip");
});

test("decodeSharedPin rejects a null / undefined / empty payload", () => {
  // A link with no ?data= at all degrades to invalid, not a crash.
  assert.equal(decodeSharedPin(null), undefined);
  assert.equal(decodeSharedPin(undefined), undefined);
  assert.equal(decodeSharedPin(""), undefined);
});

test("decodeSharedPin returns undefined for non-base64 / non-JSON garbage", () => {
  // Random text base64url-decodes to bytes that are not valid JSON; the try/catch
  // must swallow the parse error and yield undefined.
  assert.equal(decodeSharedPin("%%%not base64%%%"), undefined);
  // Valid base64url of a non-JSON string ("hello") still fails the JSON.parse.
  const notJson = Buffer.from("hello", "utf8").toString("base64url");
  assert.equal(decodeSharedPin(notJson), undefined);
});

test("decodeSharedPin rejects a payload with the wrong schema version", () => {
  // A future/old version is rejected outright rather than partially interpreted.
  const wrongVersion = Buffer.from(
    JSON.stringify({ v: 999, action: { kind: "shell", shellCommand: "x" } }),
    "utf8"
  ).toString("base64url");
  assert.equal(decodeSharedPin(wrongVersion), undefined);
});

test("decodeSharedPin rejects a payload with nothing runnable or openable", () => {
  // A pin with neither a path nor an action carries nothing importable, so it is
  // rejected — a share link must do something when imported.
  const empty = Buffer.from(JSON.stringify({ v: 1, label: "nothing" }), "utf8").toString("base64url");
  assert.equal(decodeSharedPin(empty), undefined);
});

test("decodeSharedPin accepts a path-only file pin", () => {
  // A bare file pin (path, no action) is valid: opening the file is the action.
  const fileOnly = Buffer.from(JSON.stringify({ v: 1, path: "README.md" }), "utf8").toString("base64url");
  const decoded = decodeSharedPin(fileOnly);
  assert.ok(decoded, "a path-only pin decodes");
  assert.equal(decoded!.path, "README.md");
});

test("describeSharedPin summarizes each action kind via the recipe-description strings", () => {
  assert.equal(
    describeSharedPin({ v: 1, action: { kind: "url", url: "https://x.dev" } }),
    "Opens https://x.dev"
  );
  assert.equal(
    describeSharedPin({ v: 1, action: { kind: "shell", shellCommand: "npm run build" } }),
    "Runs: npm run build"
  );
  assert.equal(
    describeSharedPin({ v: 1, action: { kind: "command", commandId: "editor.action.format" } }),
    "Runs the editor.action.format command."
  );
});

test("describeSharedPin joins macro steps by their label, falling back to kind", () => {
  // The macro summary lists each step's label, or its kind when unlabeled, joined by
  // " -> " so the import dialog shows the sequence the user is about to add.
  const desc = describeSharedPin({
    v: 1,
    action: {
      kind: "macro",
      steps: [{ kind: "open", label: "Open config" }, { kind: "shell" }],
    },
  });
  assert.equal(desc, "Runs these steps: Open config -> shell");
});

test("describeSharedPin falls back to the path when there is no action", () => {
  // A plain file pin has no action; the description is just its path.
  assert.equal(describeSharedPin({ v: 1, path: "src/main.ts" }), "src/main.ts");
  // No action and no path yields an empty description rather than throwing.
  assert.equal(describeSharedPin({ v: 1 }), "");
});
