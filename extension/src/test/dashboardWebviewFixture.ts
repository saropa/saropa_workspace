// Shared setup for the dashboard webview tests: the real shell and script in the fake DOM.

import { renderShell, type DashboardTab } from "../views/dashboardShell";
import { runPage, type Page } from "./_stub/fakeDom";

export const EVIL = '<img src=x onerror="alert(1)">&"\'';

export function open(tab: DashboardTab = "processes", computedStyle: Record<string, string> = {}): Page {
  return runPage(renderShell(tab), { computedStyle });
}

export const strings = (page: Page): Record<string, string> => page.evalJson("STRINGS") as Record<string, string>;

export function proc(pid: number, name: string, cpu: number, rss: number): object {
  return { pid, name, cpuPercent: cpu, rssBytes: rss };
}

export function group(tool: string, cpu: number, rss: number, procs: object[]): object {
  return { tool, cpuPercent: cpu, rssBytes: rss, pidCount: procs.length, procs };
}

export function dataMessage(groups: object[], extra: object = {}): object {
  return {
    type: "data",
    result: { cores: 8, totalRamBytes: 16 * 1024 ** 3, freeRamBytes: 6 * 1024 ** 3, sampledAt: 1_700_000_000_000, groups },
    trend: [],
    killable: {},
    ...extra,
  };
}

export const groupNames = (page: Page): string[] => page.all(".group-name").map((e) => e.children.length ? e.childNodes[0].textContent : e.textContent);

export const CPU = { tools: [{ tool: "node", points: [0, 10] }, { tool: "dart", points: [5] }] };
