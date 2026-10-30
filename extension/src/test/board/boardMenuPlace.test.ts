// Where a pop-up menu goes: below its button, flipped above when short of room, scrolled inside
// when taller than any room, and kept inside the sides.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PLACE_SCRIPT, placeMenu } from "../../board/boardMenuPlace";

test("a menu that fits sits just below its button, right edges aligned", () => {
  const p = placeMenu({ top: 100, bottom: 120, right: 400 }, 200, 300, 420, 800, 0, 50);
  assert.deepEqual(p, { top: 172, left: 200, maxHeight: 300 });
});

test("a menu with no room below flips above when there is more room there", () => {
  const p = placeMenu({ top: 600, bottom: 620, right: 400 }, 200, 400, 420, 800, 0, 0);
  assert.equal(p.maxHeight, 400);
  assert.equal(p.top, 600 - 2 - 400);
});

test("a menu taller than the room scrolls inside it, below or above", () => {
  const below = placeMenu({ top: 40, bottom: 60, right: 400 }, 200, 900, 420, 800, 0, 0);
  assert.equal(below.top, 62);
  assert.equal(below.maxHeight, 800 - 60 - 6);
  const above = placeMenu({ top: 700, bottom: 720, right: 400 }, 200, 900, 420, 800, 0, 0);
  assert.equal(above.maxHeight, 694);
  assert.equal(above.top, 700 - 2 - 694);
});

test("the left edge stays inside the viewport and the scroll offset is added", () => {
  assert.equal(placeMenu({ top: 0, bottom: 20, right: 30 }, 200, 100, 420, 800, 10, 0).left, 14);
  assert.equal(placeMenu({ top: 0, bottom: 20, right: 900 }, 200, 100, 420, 800, 0, 0).left, 216);
});

test("the page script carries a standalone copy of the function", () => {
  const copy = new Function(`${PLACE_SCRIPT}return placeMenu;`)() as typeof placeMenu;
  const args = [{ top: 600, bottom: 620, right: 400 }, 200, 400, 420, 800, 3, 5] as const;
  assert.deepEqual(copy(...args), placeMenu(...args));
});
