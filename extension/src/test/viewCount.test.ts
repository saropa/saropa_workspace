import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "./_stub/vscode";
import { syncViewCount, CountProvider } from "../views/viewCount";

function makeProvider(initial: number): CountProvider & { fire(n: number): void } {
  const emitter = new EventEmitter<number>();
  return {
    count: initial,
    onDidChangeCount: emitter.event,
    fire: (n: number) => emitter.fire(n),
  };
}

function makeView(): { description?: string | undefined } {
  return { description: undefined };
}

describe("syncViewCount", () => {
  test("sets initial description from provider count", () => {
    const view = makeView();
    const provider = makeProvider(5);
    syncViewCount(view, provider);
    assert.equal(view.description, "5");
  });

  test("clears description when initial count is zero", () => {
    const view = makeView();
    const provider = makeProvider(0);
    syncViewCount(view, provider);
    assert.equal(view.description, undefined);
  });

  test("updates description when provider fires a new count", () => {
    const view = makeView();
    const provider = makeProvider(0);
    syncViewCount(view, provider);
    assert.equal(view.description, undefined);

    provider.fire(3);
    assert.equal(view.description, "3");
  });

  test("clears description when count drops to zero", () => {
    const view = makeView();
    const provider = makeProvider(7);
    syncViewCount(view, provider);
    assert.equal(view.description, "7");

    provider.fire(0);
    assert.equal(view.description, undefined);
  });

  test("returned disposable stops updates", () => {
    const view = makeView();
    const provider = makeProvider(1);
    const disposable = syncViewCount(view, provider);
    assert.equal(view.description, "1");

    disposable.dispose();
    provider.fire(99);
    assert.equal(view.description, "1");
  });
});
