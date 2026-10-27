// Shared setup for the planner webview tests: the real shell and script in the fake DOM.

import { renderShell } from "../views/plannerPanelShell";
import { runPage, type Page, type PageOptions } from "./_stub/fakeDom";

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
