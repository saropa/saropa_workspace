// The stub output channel keeps its name and offers the whole OutputChannel surface the
// extension calls, all as harmless no-ops.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createOutputChannel } from "./vscodeOutput";

test("the channel keeps the name it was created with", () => {
  assert.equal(createOutputChannel("Saropa").name, "Saropa");
});

test("every output method exists and returns nothing", () => {
  const channel = createOutputChannel("x");
  assert.deepEqual(
    [
      channel.appendLine("a"),
      channel.append("a"),
      channel.clear(),
      channel.show(true),
      channel.hide(),
      channel.replace("a"),
      channel.dispose(),
    ],
    [undefined, undefined, undefined, undefined, undefined, undefined, undefined]
  );
});
