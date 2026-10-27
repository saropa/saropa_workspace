// Shared setup for the planner webview tests: the real shell and script in the fake DOM.

import { renderShell } from "../views/plannerPanelShell";
import { runPage, type Page, type PageOptions, type FakeElement, FakeDataTransfer } from "./_stub/fakeDom";
import assert from "node:assert/strict";

export type Node = Record<string, unknown> & { id: string; kind: string; label: string };

export interface Edge { from: string; to: string; kind: "pin" | "event" }

export const EVIL = '<img src=x onerror="alert(1)">&"\'';

export function pin(id: string, label: string, extra: Record<string, unknown> = {}): Node {
  return { id, kind: "pin", label, scope: "workspace", shortcutKind: "shell", runnable: true, ...extra };
}

export function event(id: string, name: string, label: string): Node {
  return { id, kind: "event", event: name, label };
}

export const daily = (time: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ atTime: time, enabled: true, ...extra });

export function open(options: PageOptions = {}): Page {
  return runPage(renderShell(), options);
}

export interface Data { nodes: Node[]; edges?: Edge[]; positions?: Record<string, { x: number; y: number }>; nowMin?: number }

export function dataMessage(d: Data): Record<string, unknown> {
  return { type: "data", data: { nodes: d.nodes, edges: d.edges ?? [] }, positions: d.positions ?? {}, nowMin: d.nowMin ?? 0 };
}

/** Opens the page on a view, sends the data, and drops the boot messages. */
export function openWith(view: "day" | "week" | "workflow", d: Data, options: PageOptions = {}): Page {
  const page = open({ ...options, state: { view, density: "compact", ...(options.state as object | undefined) } });
  page.receive(dataMessage(d));
  page.takePosted();
  return page;
}

export const strings = (page: Page): Record<string, string> => page.evalJson("STRINGS") as Record<string, string>;

/** Fills {name} style placeholders, like the script's own tpl(). */
export function tpl(text: string, params: Record<string, string | number>): string {
  return Object.entries(params).reduce((out, [k, v]) => out.split(`{${k}}`).join(String(v)), text);
}

export const WEEK_ORDER = ["1", "2", "3", "4", "5", "6", "0"];

export const WEEKDAYS = [1, 2, 3, 4, 5];

export const text = (els: FakeElement[]): string[] => els.map((e) => e.textContent);

export const style = (el: FakeElement): Record<string, string> => el.style as unknown as Record<string, string>;

export const lastState = (page: Page): Record<string, unknown> => page.states[page.states.length - 1] as Record<string, unknown>;

export const SCHEDULED: Data = {
  nodes: [
    pin("p1", "Morning build", { schedule: daily("09:30", { days: WEEKDAYS }) }),
    pin("p2", "Backup", { schedule: daily("08:00", { enabled: false }) }),
  ],
  nowMin: 600,
};

/** A press and release without moving: selects blocks and nodes. */
export function press(page: Page, el: FakeElement): void {
  page.fire(el, "mousedown", { button: 0, clientX: 1, clientY: 1 });
  page.fire(page.document, "mouseup", { clientX: 1, clientY: 1 });
}

export function dragBlock(page: Page, block: FakeElement, dy: number, dropOn: FakeElement | null, dx = 0): void {
  page.fire(block, "mousedown", { button: 0, clientX: 100, clientY: 100 });
  page.fire(page.document, "mousemove", { clientX: 100 + dx, clientY: 100 + dy });
  page.document.hitTest = () => dropOn;
  page.fire(page.document, "mouseup", { clientX: 100 + dx, clientY: 100 + dy });
}

export const firstBlock = (page: Page, id = "p1"): FakeElement => page.all(".daycol")[0].children.find((b) => b.dataset.id === id)!;

export const DAY: Data = {
  nodes: [
    pin("d1", "Nine", { schedule: daily("09:00") }),
    pin("d2", "Ten", { schedule: daily("10:00", { enabled: false, days: [1] }) }),
    pin("d3", "Eight pm", { schedule: daily("20:00") }),
    pin("i1", "Ninety", { schedule: { everyMs: 90 * 60000, enabled: true } }),
    pin("i2", "Two hours", { schedule: { everyMs: 120 * 60000, enabled: true } }),
    pin("i3", "Daily", { schedule: { everyMs: 1440 * 60000, enabled: true } }),
  ],
  nowMin: 720,
};

export function rightClick(page: Page, el: FakeElement, x = 30, y = 40): void {
  page.fire(el, "contextmenu", { clientX: x, clientY: y });
}

export const menu = (page: Page): FakeElement | null => page.document.querySelector(".menu");

export const rows = (page: Page): string[] => menu(page)!.children.map((c) => (c.classList.contains("msep") ? "-" : c.textContent));

export const LINKABLE: Data = { nodes: [pin("a", "Alpha"), pin("b", "Beta build"), pin("c", "Gamma build", { scope: "global" }), event("ev", "build", "Event")] };

export function openLinkSearch(page: Page): FakeElement {
  rightClick(page, page.one('.shelf-shortcut[data-id="a"]'));
  page.click(menu(page)!.children[menu(page)!.children.length - 1]);
  return page.one(".ac input");
}

export const options = (page: Page): string[] => page.all(".ac .opt").map((o) => o.textContent);

export const node = (page: Page, id: string): FakeElement => page.one(`.node[data-id="${id.replace(/["\\]/g, "\\$&")}"]`);

export const at = (page: Page, id: string): string => `${style(node(page, id)).left},${style(node(page, id)).top}`;

export const A_TO_B: Edge[] = [{ from: "a", to: "b", kind: "pin" }, { from: "ev", to: "b", kind: "event" }];

export const WIRED: Data = {
  nodes: [pin("a", "Alpha"), pin("b", "Beta"), event("ev", "build", "Build finished"), pin("c", "Gamma")],
  edges: A_TO_B,
};

export function dropOn(page: Page, target: FakeElement | null, dataTransfer: FakeDataTransfer): void {
  page.document.hitTest = () => target;
  const wrap = page.one(".canvas-wrap");
  page.fire(wrap, "dragover", { dataTransfer });
  assert.equal(wrap.classList.contains("droptarget"), true);
  page.fire(wrap, "drop", { dataTransfer, clientX: 50, clientY: 50 });
  assert.equal(wrap.classList.contains("droptarget"), false);
}
