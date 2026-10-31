import { BoardItem, BoardModel } from "./boardModel";
import { oneLine } from "./futureBlock";
import { DEFAULT_QUESTION } from "./futureResearch";
import { markdown } from "./handoffMarkdown";

// The hand-off: one pure builder that turns the items the owner chose into a document for an
// AI (Markdown and JSON). Nothing here reads a file, starts a tool or sends anything; the
// host writes the document to a file and copies a short line that points at it. Document
// text is fenced and labeled data, and anything that looks like a secret or a home folder is
// removed before the text leaves this module.

export const HANDOFF_TASKS = ["fix", "plan", "review", "triage", "organize", "research"] as const;
// What the AI is asked to do with the items.
export type HandoffTask = (typeof HANDOFF_TASKS)[number];
export const HANDOFF_FORMATS = ["md", "json"] as const;
// The format of the text shown in the drawer.
export type HandoffFormat = (typeof HANDOFF_FORMATS)[number];
export const HANDOFF_SCOPES = ["item", "chosen", "group", "project", "board"] as const;
// Which items a hand-off covers.
export type HandoffScope = (typeof HANDOFF_SCOPES)[number];
export const COPY_MODES = ["referral", "full"] as const;
// What Copy puts on the clipboard: the short line that points at the file, or the whole document.
export type CopyMode = (typeof COPY_MODES)[number];

// Folder (inside each project) that holds the hand-off files, and how many hand-offs it keeps.
export const HANDOFF_DIR = ".saropa/handoff";
export const KEEP_HANDOFFS = 20;
export const DEFAULT_TERMINAL_COMMAND = 'claude "Read .saropa/handoff/{id}.md and action it."';

export const asTask = (v: unknown): HandoffTask => ((HANDOFF_TASKS as readonly unknown[]).includes(v) ? (v as HandoffTask) : "fix");
export const asFormat = (v: unknown): HandoffFormat => (v === "json" ? "json" : "md");
export const asScope = (v: unknown): HandoffScope | undefined => ((HANDOFF_SCOPES as readonly unknown[]).includes(v) ? (v as HandoffScope) : undefined);
export const asCopyMode = (v: unknown): CopyMode => (v === "full" ? "full" : "referral");

// One item of the document. Only the id, project, path and title are always there.
export interface HandoffItem {
  // "project:path".
  id: string;
  project: string;
  path: string;
  title: string;
  // File time and size when the board read it, so a reply can be checked for staleness.
  rev?: string;
  status?: string;
  statusBy?: "rule" | "user";
  severity?: string;
  severityBy?: "auto" | "user";
  importance?: string;
  pinned?: boolean;
  blocks?: boolean;
  why?: string;
  group?: { id: string; name: string };
  waitsOn?: string[];
  waitedOnBy?: string[];
  acceptance?: { done: number; total: number; open: Array<{ line: number; text: string }> };
  evidence?: string[];
  // Research task: the question the document asks.
  question?: string;
}

// One project of the document: the folder name, never a full path.
export interface HandoffProject {
  id: string;
  name: string;
  root: string;
  light?: string;
  reasons?: string[];
  evidence?: Record<string, string>;
}

export interface HandoffInput {
  id: string;
  task: HandoffTask;
  scope: { kind: HandoffScope | "research"; count: number; filters?: string[] };
  profile?: string;
  // Today as YYYY-MM-DD, for the research section heading.
  date: string;
  projects: HandoffProject[];
  items: HandoffItem[];
  // Project-relative path of the saved Markdown file.
  file: string;
}

// A request from the page: a scope and the indexes that name it. Indexes only, never paths.
export interface ScopeRequest {
  kind: HandoffScope;
  i?: number;
  ids?: number[];
}

// The items a request covers, in board order. Unknown indexes are dropped.
export function scopeItems(model: BoardModel, req: ScopeRequest): BoardItem[] {
  const at = (n: number | undefined): BoardItem | undefined => (n === undefined ? undefined : model.items[n]);
  switch (req.kind) {
    case "item":
      return [at(req.i)].filter((x): x is BoardItem => x !== undefined);
    case "chosen": {
      const want = new Set(req.ids ?? []);
      return model.items.filter((x) => want.has(x.id));
    }
    case "group": {
      const it = at(req.i);
      return !it ? [] : it.group ? model.items.filter((x) => x.project === it.project && x.group?.id === it.group?.id) : [it];
    }
    case "project":
      return req.i === undefined ? [] : (model.projects[req.i]?.items ?? []);
    default:
      return model.items;
  }
}

const key = (it: Pick<BoardItem, "project" | "path">): string => `${it.project}:${it.path}`;

function whyBlocks(it: BoardItem, profile: string): string | undefined {
  if (it.status === "red") {
    return "red folder";
  }
  if (it.pinned) {
    return "pinned as critical";
  }
  return it.stopping ? `severity ${it.severity ?? "unknown"} stops the release under ${profile}` : undefined;
}

const REASONS: Record<string, string> = {
  baseline: "scan not accepted as the baseline",
  grey: "documents no rule placed",
  health: "lint or test evidence missing",
  unread: "documents whose text was not read",
};

// The document items and projects for items of the board. `roots` maps a project id to its folder name.
export function fromModel(model: BoardModel, items: BoardItem[], roots: Record<string, string>): { projects: HandoffProject[]; items: HandoffItem[] } {
  const ids = new Set(items.map((x) => x.project));
  const projects = model.projects
    .filter((p) => ids.has(p.id))
    .map((p): HandoffProject => {
      const stopping = p.items.filter((x) => x.status === "red" || x.stopping).length;
      const h = p.health;
      const evidence: Record<string, string> = h ? { lint: h.lint, tests: h.tests, ...(h.build !== undefined ? { build: h.build } : {}), ...(h.deps !== undefined ? { deps: h.deps } : {}) } : {};
      return {
        id: p.id,
        name: p.name,
        root: roots[p.id] ?? p.id,
        light: p.light.toUpperCase(),
        reasons: [...(stopping > 0 ? [`${stopping} item${stopping === 1 ? "" : "s"} block`] : []), ...p.reasons.map((r) => REASONS[r] ?? r)],
        evidence,
      };
    });
  const out = items.map((it): HandoffItem => {
    const waiting = model.items.filter((x) => x.waitsOn.includes(it.id)).map(key);
    const why = whyBlocks(it, model.profile);
    return {
      id: key(it),
      project: it.project,
      path: it.path,
      title: it.title,
      ...(it.rev ? { rev: it.rev } : {}),
      status: it.status,
      statusBy: it.statusByUser ? "user" : "rule",
      ...(it.severity ? { severity: it.severity, severityBy: it.severityByUser ? "user" : "auto" } : {}),
      pinned: it.pinned,
      blocks: why !== undefined,
      ...(why ? { why } : {}),
      ...(it.group ? { group: it.group } : {}),
      waitsOn: it.waitsOn.map((n) => model.items[n]).filter((x): x is BoardItem => x !== undefined).map(key),
      waitedOnBy: waiting,
      ...(it.marks && it.marks.total > 0 ? { acceptance: { done: it.marks.done, total: it.marks.total, open: it.steps ?? [] } } : {}),
      evidence: [...(it.kind ? [`Kind: ${it.kind}`] : []), ...(it.link ? [it.link.detail] : [])],
    };
  });
  return { projects, items: out };
}

// A flagged Future document, as the research hand-off sees it.
export interface ResearchDoc {
  project: string;
  projectName: string;
  root: string;
  path: string;
  title: string;
  importance?: string;
  question?: string;
}

// The document items and projects for a research hand-off.
export function fromResearch(docs: ResearchDoc[]): { projects: HandoffProject[]; items: HandoffItem[] } {
  const projects = [...new Map(docs.map((d) => [d.project, { id: d.project, name: d.projectName, root: d.root }])).values()];
  const items = docs.map((d): HandoffItem => ({ id: `${d.project}:${d.path}`, project: d.project, path: d.path, title: d.title, ...(d.importance ? { importance: d.importance } : {}), question: oneLine(d.question ?? "") || DEFAULT_QUESTION }));
  return { projects, items };
}

// Text removed from every free-text field of the document.
const SECRETS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\b(?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*\S+/gi,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@\S+/gi,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bghp_[A-Za-z0-9]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+)*/g,
  /\b[0-9a-fA-F]{32,}\b/g,
  /\b(?=[A-Za-z0-9+_-]*\d)(?=[A-Za-z0-9+_-]*[A-Z])(?=[A-Za-z0-9+_-]*[a-z])[A-Za-z0-9+_-]{40,}/g,
];
// A home folder, shown as "~". Only at the start of an absolute path: "lib/screens/home/x.dart" stays.
const HOME = /(?<![\w.~-])(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)[^\s/\\`'")]+/g;

// A line with secrets replaced by "[removed]" and home folders by "~".
export function clean(text: string): string {
  return SECRETS.reduce((s, re) => s.replace(re, "[removed]"), text).replace(HOME, "~");
}

// The input with every free-text field cleaned. Ids, paths and file names are exempt: they are
// project-relative, and cleaning would corrupt them ("lib/screens/home/x.dart", a long hand-off id).
function scrubInput(inp: HandoffInput): HandoffInput {
  return {
    ...inp,
    projects: inp.projects.map((p) => ({
      ...p,
      name: clean(p.name),
      ...(p.reasons ? { reasons: p.reasons.map(clean) } : {}),
      ...(p.evidence ? { evidence: Object.fromEntries(Object.entries(p.evidence).map(([k, v]) => [k, clean(v)])) } : {}),
    })),
    items: inp.items.map((it) => ({
      ...it,
      title: clean(it.title),
      ...(it.why !== undefined ? { why: clean(it.why) } : {}),
      ...(it.question !== undefined ? { question: clean(it.question) } : {}),
      ...(it.group ? { group: { id: it.group.id, name: clean(it.group.name) } } : {}),
      ...(it.evidence ? { evidence: it.evidence.map(clean) } : {}),
      ...(it.acceptance ? { acceptance: { ...it.acceptance, open: it.acceptance.open.map((x) => ({ line: x.line, text: clean(x.text) })) } } : {}),
    })),
  };
}

// The finished document in both formats. Secrets and home folders are removed first.
export function buildHandoff(input: HandoffInput): { markdown: string; json: string } {
  const inp = scrubInput(input);
  const json = {
    schema: "saropa.releaseBoard.handoff/1",
    id: inp.id,
    task: inp.task,
    scope: inp.scope,
    ...(inp.profile ? { profile: inp.profile } : {}),
    projects: inp.projects,
    items: inp.items.map((it) => (it.rev || inp.task === "research" ? it : { ...it, noRevision: "cannot be changed by a patch (no revision)" })),
    file: inp.file,
    ...(inp.task === "research" ? {} : { reply: { schema: "saropa.releaseBoard.patch/1", ops: ["setStatus", "setSeverity", "addNeeds", "removeNeeds", "setGroup"] } }),
  };
  return { markdown: markdown(inp), json: JSON.stringify(json, null, 2) + "\n" };
}

// The text of several per-project documents as one: Markdown documents follow one another; JSON
// documents become one valid document, {"projects": [...]}. One document stays as it is.
export function joinHandoffs(docs: ReadonlyArray<{ markdown: string; json: string }>, format: HandoffFormat): string {
  if (format !== "json") {
    return docs.map((d) => d.markdown).join("\n");
  }
  return docs.length === 1 ? docs[0].json : JSON.stringify({ projects: docs.map((d) => JSON.parse(d.json) as unknown) }, null, 2) + "\n";
}

// About one token per four characters; rough on purpose.
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

// "~850" or "~3.2k".
export const tokenLabel = (n: number): string => (n >= 1000 ? `~${(n / 1000).toFixed(1)}k` : `~${n}`);

const two = (n: number): string => String(n).padStart(2, "0");

// "2026-10-30T10-04-12-contacts-fix": UTC time (so the order never shifts with the time zone), a short name of the scope and the task.
export function handoffId(now: Date, name: string, task: HandoffTask): string {
  const stamp = `${now.getUTCFullYear()}-${two(now.getUTCMonth() + 1)}-${two(now.getUTCDate())}T${two(now.getUTCHours())}-${two(now.getUTCMinutes())}-${two(now.getUTCSeconds())}`;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24).replace(/-+$/, "") || "board";
  return `${stamp}-${slug}-${task}`;
}

// The project-relative path of a hand-off file.
export const handoffFile = (id: string, format: HandoffFormat): string => `${HANDOFF_DIR}/${id}.${format}`;

// The short line copied by default: it points an agent at the saved file, or files, one per project.
export function referralLine(files: string | string[]): string {
  const list = Array.isArray(files) ? files : [files];
  return `Read ${list.join(" and ")} and action ${list.length === 1 ? "it" : "them"}.`;
}

// The terminal command with {id} replaced by the hand-off id. With several files (one per
// project), the default file path in the template is replaced by all of them.
export function terminalCommand(template: string, id: string, files?: string[]): string {
  const one = `${HANDOFF_DIR}/{id}.md`;
  // A function replacer, so "$&" and similar in a folder name are never read as replacement patterns.
  const t = files && files.length > 1 && template.includes(one) ? template.replace(one, () => files.join(" and ")).replace(/action it\b/, "action them") : template;
  return t.replace(/\{id\}/g, id);
}

// A hand-off id: UTC stamp first, then the name and task.
const ID_FILE = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-.+)\.(?:md|json)$/;

// Files of hand-offs beyond the newest `keep`, from the names in the folder. Only names that
// are a hand-off id plus ".md" or ".json" count; any other file is left alone. Ids start with
// the date, so they sort by age.
export function staleHandoffFiles(names: string[], keep = KEEP_HANDOFFS): string[] {
  const idOf = (name: string): string | undefined => ID_FILE.exec(name)?.[1];
  const ids = [...new Set(names.map(idOf).filter((x): x is string => x !== undefined))].sort().reverse();
  const drop = new Set(ids.slice(keep));
  return names.filter((n) => drop.has(idOf(n) ?? ""));
}

// Letters, digits, spaces and . _ / @ + = : , ~ - only. The paths of other projects are put inside the user's own
// command (which may be quoted or not, in any shell), so anything a shell reads as more than text (dollar, backtick,
// quotes, backslash, ; & | < > ( ) { } * ? ! # % ^ or a line break) is not allowed; such a folder is never put into a command.
const SAFE_COMMAND_PATH = /^[\p{L}\p{N} ._/@+=:,~-]+$/u;

// The first path that cannot be put into a terminal command safely, or undefined when all can.
export const unsafeCommandPath = (paths: readonly string[]): string | undefined => paths.find((p) => !SAFE_COMMAND_PATH.test(p));
