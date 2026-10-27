import { BoardItem, BoardModel, BoardProject } from "./boardModel";
import { PathStep } from "./pathToGo";
import { SittingLine } from "./sittings";

// Hand to chat: turns one blocker or step into a ready-to-paste prompt. Pure text, built
// only from facts the board already holds. Nothing here reads files, starts a tool or sends
// anything; the host copies the text to the clipboard. The prompt is plain English on
// purpose: it is meant to be pasted into any chat tool.

export const DETAIL_LEVELS = ["short", "standard", "full"] as const;
// How much a Hand to chat prompt says.
export type DetailLevel = (typeof DETAIL_LEVELS)[number];
// Whether the board offers to open a chat after copying a prompt.
export const OPEN_CHAT_MODES = ["never", "offer"] as const;
// One of the open-chat modes.
export type OpenChatMode = (typeof OPEN_CHAT_MODES)[number];

// Plain setting value to a detail level; anything unknown means standard.
export function asDetail(v: unknown): DetailLevel {
  return typeof v === "string" && (DETAIL_LEVELS as readonly string[]).includes(v) ? (v as DetailLevel) : "standard";
}

// Plain setting value to an open-chat mode; anything but offer means never.
export function asOpenChat(v: unknown): OpenChatMode {
  return v === "offer" ? "offer" : "never";
}

// What a prompt says. `evidence` shows at "standard" and "full", `extra` only at "full".
export interface HandTarget {
  // The blocker or step, in one line.
  headline: string;
  project: string;
  // Project-relative path (with ":line" for a step), never an absolute path.
  file?: string;
  evidence: string[];
  extra: string[];
}

const MAX_NAMES = 8;

// "1 open document waits on it", "2 open documents wait on it".
function waitPhrase(n: number): string {
  return `${n} open document${n === 1 ? " waits" : "s wait"} on`;
}

function docs(n: number): string {
  return `${n} document${n === 1 ? "" : "s"}`;
}

function names(titles: string[]): string {
  const shown = titles.slice(0, MAX_NAMES).join("; ");
  return titles.length > MAX_NAMES ? `${shown}; and ${titles.length - MAX_NAMES} more` : shown;
}

function why(it: BoardItem): string {
  if (it.status === "red") {
    return "it sits in a red folder";
  }
  return it.pinned ? "it is pinned as critical" : `its severity (${it.severity ?? "unknown"}) stops the release under the chosen profile`;
}

function projectFacts(p: BoardProject | undefined): string[] {
  if (!p) {
    return [];
  }
  const out = [`Project light: ${p.light}${p.reasons.length > 0 ? ` (${p.reasons.join(", ")})` : ""}`];
  if (p.health) {
    out.push(`Lint evidence: ${p.health.lint} - ${p.health.lintDetail}`, `Test evidence: ${p.health.tests} - ${p.health.testsDetail}`);
    if (p.health.build !== undefined) {
      out.push(`Build evidence: ${p.health.build} - ${p.health.buildDetail ?? ""}`);
    }
    if (p.health.deps !== undefined) {
      out.push(`Dependency evidence: ${p.health.deps} - ${p.health.depsDetail ?? ""}`);
    }
  }
  return out;
}

// The prompt target for a blocker or open document.
export function itemTarget(model: BoardModel, it: BoardItem): HandTarget {
  const project = model.projects.find((p) => p.id === it.project);
  const stops = it.status === "red" || it.stopping;
  const evidence = [`State: ${it.status}${it.kind ? `, ${it.kind}` : ""}`];
  if (stops) {
    evidence.push(`It stops the release because ${why(it)}`);
  }
  if (it.severity) {
    evidence.push(`Severity: ${it.severity}${it.severityByUser ? " (set by hand in the rules file, not computed)" : ""}`);
  }
  if (it.blocksCount > 0) {
    evidence.push(`${waitPhrase(it.blocksCount)} it`);
  }
  if (it.link) {
    evidence.push(`Link: ${it.link.detail}`);
  }
  const extra: string[] = [];
  const waitsOn = it.waitsOn.map((id) => model.items[id]?.title).filter((x): x is string => x !== undefined);
  if (waitsOn.length > 0) {
    extra.push(`It waits on: ${names(waitsOn)}`);
  }
  const waiting = model.items.filter((x) => x.waitsOn.includes(it.id)).map((x) => x.title);
  if (waiting.length > 0) {
    extra.push(`Waiting on it: ${names(waiting)}`);
  }
  if (it.group) {
    const mates = model.items.filter((x) => x.id !== it.id && x.group?.id === it.group?.id).map((x) => x.title);
    extra.push(`Group: ${it.group.name}${mates.length > 0 ? ` (with ${names(mates)})` : ""}`);
  }
  if (it.marks && it.marks.total > 0) {
    extra.push(`Checklist: ${it.marks.done} of ${it.marks.total} steps done`);
  }
  if (it.chats) {
    extra.push(`Earlier chats that touched this document: ${it.chats}`);
  }
  extra.push(...projectFacts(project));
  return { headline: `${stops ? "Blocker" : "Open document"}: ${it.title}`, project: project?.name ?? it.project, file: it.path, evidence, extra };
}

// The prompt target for a Path to GO step.
export function stepTarget(model: BoardModel, project: BoardProject, step: PathStep): HandTarget {
  if (step.kind === "item" && step.itemId !== undefined && model.items[step.itemId]) {
    return itemTarget(model, model.items[step.itemId]);
  }
  const base = { project: project.name, evidence: [] as string[], extra: projectFacts(project) };
  switch (step.kind) {
    case "build":
    case "deps":
    case "lint":
    case "tests": {
      const label = step.kind === "build" ? "Build" : step.kind === "deps" ? "Dependency" : step.kind === "lint" ? "Lint" : "Test";
      return { ...base, headline: `${label} evidence is ${step.evidence ?? "missing"}`, evidence: step.detail ? [step.detail] : [] };
    }
    case "blocked":
      return { ...base, headline: `${docs(step.count ?? 0)} in blocked folders would stop the release` };
    case "rules":
      return { ...base, headline: `${docs(step.count ?? 0)} ${(step.count ?? 0) === 1 ? "has" : "have"} no rule placing ${(step.count ?? 0) === 1 ? "it" : "them"}`, file: step.folder || undefined };
    case "unread":
      return { ...base, headline: `${docs(step.count ?? 0)} could not be read, so ${(step.count ?? 0) === 1 ? "its severity is" : "their severity is"} unknown` };
    case "accept":
      return { ...base, headline: "The scan has not been accepted as the baseline" };
    default:
      return { ...base, headline: step.title ?? "Release step" };
  }
}

// The prompt target for a Sittings line.
export function lineTarget(model: BoardModel, l: SittingLine): HandTarget {
  const evidence = [`Document: ${l.docTitle}`, `Estimated time: ${l.minutes} minutes`];
  if (l.needs.length > 0) {
    evidence.push(`Needs: ${l.needs.join(" + ")}`);
  }
  if (l.severity) {
    evidence.push(`Severity: ${l.severity}`);
  }
  const extra: string[] = [];
  if (l.heading) {
    extra.push(`Section: ${l.heading}`);
  }
  if (l.blocksCount > 0) {
    extra.push(`${waitPhrase(l.blocksCount)} this document`);
  }
  extra.push(...projectFacts(model.projects.find((p) => p.id === l.project)));
  return { headline: `Step: ${l.text || l.heading || l.docTitle}`, project: l.projectName, file: l.line > 0 ? `${l.path}:${l.line}` : l.path, evidence, extra };
}

// The text copied to the clipboard.
export function formatPrompt(t: HandTarget, level: DetailLevel): string {
  const lines = [`Release Board - ${t.headline}`, `Project: ${t.project}`];
  if (t.file) {
    lines.push(`File: ${t.file}`);
  }
  if (level !== "short" && t.evidence.length > 0) {
    lines.push("", "Evidence:", ...t.evidence.map((e) => `- ${e}`));
  }
  if (level === "full" && t.extra.length > 0) {
    lines.push("", "Context:", ...t.extra.map((e) => `- ${e}`));
  }
  lines.push("", "Please help me clear this. Read the file first, say what is needed to finish it, and make the change if it is clear.");
  return lines.join("\n");
}
