// Unit tests for parsePinIds (pinTreeDragDrop.ts) — the defensive parser for the
// JSON pin-id payload carried on an internal drag. It is the one pure, host-free
// export in the drag-and-drop module: it takes the raw transfer string and must
// always yield a clean string[] even for absent, malformed, or wrong-typed input,
// because the payload crosses the (untrusted) DataTransfer boundary.
//
// The module's other exports (buildPinDragData, resolveDropTarget,
// handleExternalFileDrop) construct / instanceof-check vscode.DataTransferItem and
// the PinTreeItem family (TreeItem subclasses), none of which the test stub models,
// so they are exercised through the extension host instead. parsePinIds references
// none of them, so esbuild drops those imports and this file bundles and runs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePinIds } from "../views/pinTreeDragDrop";

test("parsePinIds: a well-formed id array round-trips", () => {
  assert.deepEqual(parsePinIds(JSON.stringify(["a", "b", "c"])), ["a", "b", "c"]);
});

test("parsePinIds: an empty array stays empty", () => {
  assert.deepEqual(parsePinIds("[]"), []);
});

test("parsePinIds: absent input (undefined) yields an empty array", () => {
  // No PIN_MIME payload on the transfer is the common "external drag" case; the
  // caller relies on [] (not a throw) so it can fall through to the file-drop path.
  assert.deepEqual(parsePinIds(undefined), []);
});

test("parsePinIds: an empty string yields an empty array", () => {
  // The falsy guard covers "" before JSON.parse would throw on it.
  assert.deepEqual(parsePinIds(""), []);
});

test("parsePinIds: malformed JSON is swallowed, not fatal", () => {
  // A corrupt transfer string must never crash the drop handler; it degrades to [].
  assert.deepEqual(parsePinIds("{not json"), []);
  assert.deepEqual(parsePinIds("['unquoted']"), []);
});

test("parsePinIds: a non-array JSON value yields an empty array", () => {
  // Valid JSON that is not an array (an object, a bare string/number) is rejected by
  // the Array.isArray guard rather than being coerced.
  assert.deepEqual(parsePinIds('{"id":"a"}'), []);
  assert.deepEqual(parsePinIds('"a"'), []);
  assert.deepEqual(parsePinIds("42"), []);
});

test("parsePinIds: non-string array elements are filtered out", () => {
  // Only real string ids survive; numbers, nulls, nested arrays, and objects are
  // dropped so the result is a clean string[] the store can look up directly.
  assert.deepEqual(
    parsePinIds(JSON.stringify(["a", 1, null, "b", { x: 1 }, ["c"], true, "d"])),
    ["a", "b", "d"]
  );
});

test("parsePinIds: an all-invalid array collapses to empty", () => {
  assert.deepEqual(parsePinIds(JSON.stringify([1, 2, null, false])), []);
});
