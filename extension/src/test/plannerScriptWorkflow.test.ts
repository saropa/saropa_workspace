// Tests for the Planner webview's Workflow tab: layout, dragging, linking, toolbox and shelf.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeDataTransfer } from "./_stub/fakeDom";
import { pin, event, daily, dataMessage, openWith, strings, tpl, style, lastState, press, node, at, A_TO_B, WIRED, dropOn } from "./plannerWebviewFixture";

test("only linked shortcuts and used events become nodes, laid out in columns by how far they sit from a start", () => {
  const page = openWith("workflow", WIRED);
  assert.deepEqual(page.all(".node").map((n) => n.dataset.id), ["a", "b", "ev"]);
  assert.deepEqual(["a", "b", "ev"].map((id) => at(page, id)), ["24px,24px", "244px,24px", "24px,120px"]);
  assert.equal(style(page.byId("canvas")).height, "420px");
});

test("saved node positions win over the automatic layout, and the canvas grows to hold them", () => {
  const page = openWith("workflow", { ...WIRED, positions: { a: { x: 500, y: 700 }, b: { x: 10, y: 20 } } });
  assert.deepEqual(["a", "b", "ev"].map((id) => at(page, id)), ["500px,700px", "10px,20px", "24px,24px"]);
  assert.equal(style(page.byId("canvas")).height, "860px");
});

test("a loop of links still lays out finitely", () => {
  const page = openWith("workflow", { nodes: [pin("a", "A"), pin("b", "B")], edges: [{ from: "a", to: "b", kind: "pin" }, { from: "b", to: "a", kind: "pin" }] });
  assert.deepEqual(["a", "b"].map((id) => at(page, id)), ["464px,24px", "244px,24px"]);
});

test("nodes show icon, name, schedule, emitted signals and last outcome; events show the event badge", () => {
  const page = openWith("workflow", {
    nodes: [
      pin("a", "Alpha", { schedule: daily("09:00"), emits: ["done"], lastOutcome: "success" }),
      pin("b", "Beta", { schedule: { everyMs: 7200000, enabled: true }, lastOutcome: "failure" }),
      event("ev", "build", "Build finished"),
    ],
    edges: A_TO_B,
  });
  const s = strings(page);
  assert.deepEqual(page.all(".node").map((n) => n.className), ["node", "node", "node event"]);
  assert.deepEqual(page.all(".node").map((n) => n.querySelector(".nt")!.textContent), ["Alpha", "Beta", "Build finished"]);
  assert.deepEqual(page.all(".node").map((n) => n.querySelectorAll(".badge").map((b) => b.className.replace("badge ", "") + ":" + b.textContent)), [
    ["sched:\u{1F551} 09:00", "emit:\u{1F4E1} done", "run:\u2714"],
    [`sched:\u{1F551} ${tpl(s.everyHours, { count: 2 })}`, "fail:\u2716"],
    [`badge:${s.eventBadge}`],
  ]);
  assert.deepEqual(page.all(".node").map((n) => n.querySelectorAll(".plug").length), [1, 1, 0]);
  assert.equal(node(page, "ev").querySelector(".nicon")!.textContent, "\u{1F528}");
});

test("edges are drawn as curves between node edges after the next frame, and the selected node's are hot", () => {
  const page = openWith("workflow", { ...WIRED, positions: {} });
  const sizes: Record<string, [number, number]> = { a: [24, 24], b: [244, 24], ev: [24, 120] };
  for (const [id, [left, top]] of Object.entries(sizes)) {
    Object.assign(node(page, id), { offsetLeft: left, offsetTop: top, offsetWidth: 100, offsetHeight: 40 });
  }
  assert.equal(page.all(".edges > path").length, 0);
  page.frames.flush();
  assert.deepEqual(page.all(".edges > path").map((p) => `${p.getAttribute("class")}|${p.getAttribute("d")}`), [
    "|M124,44 C184,44 184,44 244,44",
    "event|M124,140 C184,140 184,44 244,44",
  ]);
  assert.equal(page.all(".edges defs marker").length, 1, "the arrowhead definition survives a redraw");
  press(page, node(page, "b"));
  assert.deepEqual(page.all(".edges > path").map((p) => p.getAttribute("class")), [" hot", "event hot"]);
});

test("edges find nodes whose ids contain quotes and backslashes", () => {
  const ids = ['x"1', "y\\2"];
  const page = openWith("workflow", { nodes: ids.map((id) => pin(id, id)), edges: [{ from: ids[0], to: ids[1], kind: "pin" }] });
  page.frames.flush();
  assert.equal(page.all(".edges > path").length, 1);
});

test("an edge whose node is not on the canvas is skipped", () => {
  const page = openWith("workflow", { nodes: [pin("a", "A"), pin("b", "B")], edges: [{ from: "a", to: "b", kind: "pin" }, { from: "a", to: "gone", kind: "pin" }] });
  page.frames.flush();
  assert.equal(page.all(".edges > path").length, 1);
});

test("dragging a node moves it live and saves every position on release", () => {
  const page = openWith("workflow", WIRED);
  page.fire(node(page, "a"), "mousedown", { button: 0, clientX: 100, clientY: 100 });
  assert.equal(node(page, "a").classList.contains("dragging"), true);
  page.fire(page.document, "mousemove", { clientX: 160, clientY: 120 });
  assert.equal(at(page, "a"), "84px,44px");
  assert.deepEqual(page.posted, []);
  page.fire(page.document, "mouseup", { clientX: 160, clientY: 120 });
  assert.deepEqual(page.takePosted(), [{ type: "savePositions", positions: { a: { x: 84, y: 44 }, b: { x: 244, y: 24 }, ev: { x: 24, y: 120 } } }]);
  assert.equal(node(page, "a").classList.contains("dragging"), false);
  assert.equal(page.document.listenerCount("mousemove"), 0);
});

test("a node cannot be dragged to negative coordinates", () => {
  const page = openWith("workflow", WIRED);
  page.fire(node(page, "a"), "mousedown", { button: 0, clientX: 100, clientY: 100 });
  page.fire(page.document, "mousemove", { clientX: -900, clientY: -900 });
  assert.equal(at(page, "a"), "0px,0px");
});

test("pressing a node without moving selects it and shows its details", () => {
  const page = openWith("workflow", WIRED);
  press(page, node(page, "b"));
  assert.deepEqual(page.takePosted(), []);
  assert.deepEqual(page.all(".node.sel").map((n) => n.dataset.id), ["b"]);
  assert.equal(page.one(".dt").textContent, "Beta");
});

test("a secondary mouse button does not start a node drag", () => {
  const page = openWith("workflow", WIRED);
  page.fire(node(page, "a"), "mousedown", { button: 2, clientX: 1, clientY: 1 });
  assert.equal(node(page, "a").classList.contains("dragging"), false);
});

test("dragging from a node's plug onto another shortcut links them", () => {
  const page = openWith("workflow", WIRED);
  page.byId("canvas").rect = { left: 5, top: 5, right: 0, bottom: 0, width: 0, height: 0 };
  const plug = node(page, "a").querySelector(".plug")!;
  page.fire(plug, "mousedown", { button: 0, clientX: 10, clientY: 10 });
  page.document.hitTest = () => node(page, "b").querySelector(".nt");
  page.fire(page.document, "mousemove", { clientX: 200, clientY: 100 });
  assert.equal(page.byId("linkline").innerHTML, '<path d="M5,5 C65,5 135,95 195,95"></path>');
  assert.deepEqual(page.all(".node.linktarget").map((n) => n.dataset.id), ["b"]);
  page.fire(page.document, "mouseup", { clientX: 200, clientY: 100 });
  assert.deepEqual(page.takePosted(), [{ type: "addTrigger", to: "b", kind: "pin", from: "a" }]);
  assert.equal(page.byId("linkline").innerHTML, "");
  assert.equal(page.all(".linktarget").length, 0);
  assert.equal(node(page, "a").classList.contains("dragging"), false, "the plug drag does not drag the node");
});

test("releasing a plug drag over itself, an event node or nothing links nothing", () => {
  const page = openWith("workflow", WIRED);
  const plug = node(page, "a").querySelector(".plug")!;
  for (const target of [node(page, "a"), node(page, "ev"), null]) {
    page.fire(plug, "mousedown", { button: 0, clientX: 1, clientY: 1 });
    page.document.hitTest = () => target;
    page.fire(page.document, "mousemove", { clientX: 5, clientY: 5 });
    assert.equal(page.all(".linktarget").length, 0);
    page.fire(page.document, "mouseup", { clientX: 5, clientY: 5 });
  }
  assert.deepEqual(page.takePosted(), []);
});

test("the toolbox offers the four events as draggable tools", () => {
  const page = openWith("workflow", WIRED);
  const tools = page.all(".tool");
  assert.deepEqual(tools.map((t) => t.dataset.event), ["build", "publish", "gitCommit", "gitPush"]);
  const dt = new FakeDataTransfer();
  page.fire(tools[2], "dragstart", { dataTransfer: dt });
  assert.deepEqual([dt.getData("text/event"), dt.effectAllowed], ["gitCommit", "copy"]);
});

test("dropping an event tool on a shortcut node adds an event trigger", () => {
  const page = openWith("workflow", WIRED);
  const dt = new FakeDataTransfer();
  page.fire(page.all(".tool")[1], "dragstart", { dataTransfer: dt });
  dropOn(page, node(page, "a"), dt);
  assert.deepEqual(page.takePosted(), [{ type: "addTrigger", to: "a", kind: "event", event: "publish" }]);
});

test("dropping an event tool anywhere else shows a hint that fades after a moment", () => {
  const page = openWith("workflow", WIRED);
  const dt = new FakeDataTransfer();
  page.fire(page.all(".tool")[0], "dragstart", { dataTransfer: dt });
  dropOn(page, node(page, "ev"), dt);
  assert.deepEqual(page.takePosted(), []);
  assert.equal(page.byId("flash").textContent, strings(page).dropEventHint);
  assert.equal(style(page.byId("flash")).opacity, "1");
  page.timers.advance(2199);
  assert.equal(style(page.byId("flash")).opacity, "1");
  page.timers.advance(1);
  assert.equal(style(page.byId("flash")).opacity, "0");
});

test("dropping a shelf shortcut on a node makes the dropped one run after that node", () => {
  const page = openWith("workflow", WIRED);
  const dt = new FakeDataTransfer();
  page.fire(page.one('.shelf-shortcut[data-id="c"]'), "dragstart", { dataTransfer: dt });
  assert.deepEqual([dt.getData("text/pinId"), dt.effectAllowed], ["c", "copy"]);
  dropOn(page, node(page, "a"), dt);
  assert.deepEqual(page.takePosted(), [{ type: "addTrigger", to: "c", kind: "pin", from: "a" }]);
});

test("dropping a shelf shortcut on an event node or empty canvas shows the shortcut hint", () => {
  const page = openWith("workflow", WIRED);
  const dt = new FakeDataTransfer();
  page.fire(page.one('.shelf-shortcut[data-id="c"]'), "dragstart", { dataTransfer: dt });
  dropOn(page, node(page, "ev"), dt);
  dropOn(page, null, dt);
  assert.deepEqual(page.takePosted(), []);
  assert.equal(page.byId("flash").textContent, strings(page).dropShortcutHint);
});

test("leaving the canvas clears the drop highlight", () => {
  const page = openWith("workflow", WIRED);
  const wrap = page.one(".canvas-wrap");
  page.fire(wrap, "dragover", { dataTransfer: new FakeDataTransfer() });
  page.fire(wrap, "dragleave");
  assert.equal(wrap.classList.contains("droptarget"), false);
});

test("right-clicking empty canvas opens a link search; right-clicking a node does not", () => {
  const page = openWith("workflow", WIRED);
  const onNode = page.fire(page.one(".nt"), "contextmenu", { clientX: 5, clientY: 5 });
  assert.equal(page.all(".ac").length, 0);
  assert.equal(onNode.defaultPrevented, true, "the node's own menu handles it");
  const empty = page.fire(page.byId("canvas"), "contextmenu", { clientX: 40, clientY: 60 });
  assert.equal(empty.defaultPrevented, true);
  assert.equal(page.one(".ac input").placeholder, strings(page).linkPlaceholderSearch);
  assert.deepEqual([style(page.one(".ac")).left, style(page.one(".ac")).top], ["40px", "60px"]);
});

test("linking from the search picks the first shortcut, then the one that runs after it", () => {
  const page = openWith("workflow", WIRED);
  page.fire(page.byId("canvas"), "contextmenu", { clientX: 1, clientY: 1 });
  page.key(page.one(".ac input"), "Enter");
  assert.equal(page.one(".ac input").placeholder, strings(page).linkPlaceholderTarget);
  assert.deepEqual(page.all(".ac .opt").map((o) => o.children[1].textContent), ["Beta", "Gamma"]);
  page.key(page.one(".ac input"), "ArrowDown");
  page.key(page.one(".ac input"), "ArrowDown");
  page.key(page.one(".ac input"), "Enter");
  assert.deepEqual(page.takePosted(), [{ type: "addTrigger", to: "c", kind: "pin", from: "a" }]);
});

test("the how-to band's add-link button opens the search just under itself", () => {
  const page = openWith("workflow", WIRED);
  const button = page.one(".wf-howto .btn.primary");
  button.rect = { left: 12, top: 0, right: 0, bottom: 30, width: 0, height: 0 };
  page.click(button);
  assert.deepEqual([style(page.one(".ac")).left, style(page.one(".ac")).top], ["12px", "34px"]);
});

test("auto-arrange recomputes the layout of the workflow nodes, keeps other saved positions and saves", () => {
  const page = openWith("workflow", { ...WIRED, positions: { a: { x: 500, y: 500 }, b: { x: 600, y: 600 }, c: { x: 7, y: 8 } } });
  page.click(page.one(".wf-howto .btn:not(.primary)"));
  assert.deepEqual(page.takePosted(), [{ type: "savePositions", positions: { c: { x: 7, y: 8 }, a: { x: 24, y: 24 }, b: { x: 244, y: 24 }, ev: { x: 24, y: 120 } } }]);
  assert.equal(at(page, "a"), "24px,24px");
});

test("the shelf lists unlinked shortcuts by name with a count, and selecting one shows its details", () => {
  const page = openWith("workflow", { nodes: [pin("z", "Zulu", { schedule: daily("07:00") }), pin("m", "mike"), pin("a", "Alpha")] });
  assert.deepEqual(page.all(".shelf-shortcut").map((c) => c.querySelector(".sl")!.textContent), ["Alpha", "mike", "Zulu"]);
  assert.equal(page.one(".sh-c").textContent, "3");
  assert.equal(page.all(".sclock").length, 1);
  assert.equal(page.one('.shelf-shortcut[data-id="m"]').dataset.label, "mike");
  page.click(page.one('.shelf-shortcut[data-id="m"]'));
  assert.deepEqual(page.all(".shelf-shortcut.sel").map((c) => c.dataset.id), ["m"]);
  assert.equal(page.one(".dt").textContent, "mike");
});

test("when every shortcut is wired the shelf says so; with nothing linked the canvas explains how to start", () => {
  const wired = openWith("workflow", { nodes: [pin("a", "A"), pin("b", "B")], edges: [{ from: "a", to: "b", kind: "pin" }] });
  assert.equal(wired.one(".shelf-grid .shelf-empty").textContent, strings(wired).shelfAllWired);
  const bare = openWith("workflow", { nodes: [pin("a", "A")] });
  assert.equal(bare.one(".canvas .empty .big").textContent, strings(bare).workflowEmptyTitle);
  assert.equal(bare.all(".node").length, 0);
});

test("clicking the shelf head folds it and the choice is saved", () => {
  const page = openWith("workflow", WIRED);
  page.click(page.one(".shelf-head"));
  assert.equal(page.one(".shelf").classList.contains("collapsed"), true);
  assert.equal(lastState(page).shelfOpen, false);
  page.click(page.one(".shelf-head"));
  assert.equal(page.one(".shelf").classList.contains("collapsed"), false);
  assert.equal(lastState(page).shelfOpen, true);
});

test("a shelf folded last time stays folded", () => {
  const page = openWith("workflow", WIRED, { state: { shelfOpen: false } });
  assert.equal(page.one(".shelf").classList.contains("collapsed"), true);
});

test("a long shelf gets a filter box that hides non-matching chips and says when none match", () => {
  const nodes = Array.from({ length: 13 }, (_v, i) => pin(`p${i}`, i === 12 ? "Special" : `Pin ${i}`));
  const page = openWith("workflow", { nodes });
  const input = page.one(".shelf-filter");
  assert.equal(input.placeholder, tpl(strings(page).shelfFilterPlaceholder, { count: 13 }));
  const shown = (): string[] => page.all(".shelf-shortcut").filter((c) => style(c).display !== "none").map((c) => c.querySelector(".sl")!.textContent);
  page.type(input, "SPEC");
  assert.deepEqual(shown(), ["Special"]);
  assert.equal(style(page.one(".shelf > .shelf-empty")).display, "none");
  page.type(input, "nothing");
  assert.deepEqual(shown(), []);
  assert.equal(style(page.one(".shelf > .shelf-empty")).display, "");
  page.type(input, "");
  assert.equal(shown().length, 13);
});

test("a short shelf has no filter box", () => {
  const nodes = Array.from({ length: 12 }, (_v, i) => pin(`p${i}`, `Pin ${i}`));
  assert.equal(openWith("workflow", { nodes }).all(".shelf-filter").length, 0);
});

test("dragging the toolbox handle resizes the toolbox within its limits and saves on release", () => {
  const page = openWith("workflow", WIRED);
  const width = (): string => page.document.documentElement.style.getPropertyValue("--toolbox-w");
  page.fire(page.one(".tb-rsz"), "mousedown", { button: 0, clientX: 100 });
  page.fire(page.document, "mousemove", { clientX: 150 });
  assert.equal(width(), "218px");
  page.fire(page.document, "mousemove", { clientX: 9000 });
  assert.equal(width(), "340px");
  page.fire(page.document, "mouseup");
  assert.equal(lastState(page).toolboxW, 340);
});

test("a data message with no data object resets to an empty workflow", () => {
  const page = openWith("workflow", WIRED);
  page.receive({ type: "data", data: null, positions: null });
  assert.equal(page.all(".node").length, 0);
  assert.equal(page.all(".shelf-shortcut").length, 0);
  page.receive(dataMessage({ nodes: [] }));
  assert.equal(page.one(".shelf-grid .shelf-empty").textContent, strings(page).shelfAllWired);
});
