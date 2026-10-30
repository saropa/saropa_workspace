import * as vscode from "vscode";
import { BoardRun } from "../commands/releaseBoardCommands";
import { BoardModel } from "../board/boardModel";
import { HandoffAct, HandoffFiles, deliver, readHandoffSettings } from "../commands/boardHandoff";
import { HandoffFormat, HandoffScope, HandoffTask, ScopeRequest, asFormat, asScope, asTask, buildHandoff, estimateTokens, fromModel, handoffFile, handoffId, scopeItems, tokenLabel } from "../board/handoff";
import { l10n } from "../i18n/l10n";

// Release Board, hand-off: the host half of the hand-off drawer. The page names a scope by
// indexes into the model it was shown (never a path); the document is built from that model.

const ACTS: readonly string[] = ["copy", "copyFull", "save", "terminal"];
const MAX_CHOSEN = 500;

// What the page asked for.
export interface HandoffRequest {
  scope: ScopeRequest;
  task: HandoffTask;
  format: HandoffFormat;
}

// The request in a page message, or undefined when it is not one.
export function parseRequest(m: Record<string, unknown>): HandoffRequest | undefined {
  const kind = asScope(m.scope);
  if (!kind) {
    return undefined;
  }
  const ids = Array.isArray(m.ids) ? m.ids.filter((x): x is number => Number.isInteger(x)).slice(0, MAX_CHOSEN) : undefined;
  const task = asTask(m.task);
  return { scope: { kind, i: Number.isInteger(m.i) ? (m.i as number) : undefined, ids }, task: task === "research" ? "fix" : task, format: asFormat(m.format) };
}

// The message that opens the drawer on the page for a scope.
export const openMessage = (scope: HandoffScope, i?: number): { type: string; scope: HandoffScope; i?: number } => ({ type: "handoffOpen", scope, i });

// The scope of a project or group menu entry ("project:<index>" or "group:<item id>").
export function scopeOfMenu(id: string): { scope: HandoffScope; i: number } | undefined {
  const [kind, n] = id.split(":");
  const i = Number(n);
  return (kind === "project" || kind === "group") && Number.isInteger(i) ? { scope: kind, i } : undefined;
}

// The last folder name of a project, never its full path.
const folderName = (uri: vscode.Uri): string => uri.path.replace(/\/+$/, "").split("/").pop() ?? "";

// What a request builds: one document per project, each saved in its own project folder.
interface Built {
  files: HandoffFiles[];
  count: number;
  // The scopes the drawer can switch to from this request, with the index each needs.
  avail: Array<{ scope: HandoffScope; i?: number }>;
}

// The last build. Preview, Copy, Save and Run for the same request share it, so the text copied
// is exactly the text previewed and a repeated action reuses the same files.
let last: { model: BoardModel; run: BoardRun; key: string; built: Built | undefined } | undefined;

// The scopes the request can widen or narrow to. "Chosen" is added by the page, which holds the choice.
function available(model: BoardModel, scope: ScopeRequest): Built["avail"] {
  const it = (scope.kind === "item" || scope.kind === "group") && scope.i !== undefined ? model.items[scope.i] : undefined;
  const out: Built["avail"] = [];
  if (it) {
    out.push({ scope: "item", i: scope.i });
    if (it.group) {
      out.push({ scope: "group", i: scope.i });
    }
    const pi = model.projects.findIndex((p) => p.id === it.project);
    if (pi >= 0) {
      out.push({ scope: "project", i: pi });
    }
  } else if (scope.kind === "project") {
    out.push({ scope: "project", i: scope.i });
  }
  return [...out, { scope: "board" }];
}

// The finished documents for a request; undefined when the scope holds no item.
function build(model: BoardModel, run: BoardRun, req: HandoffRequest): Built | undefined {
  const key = JSON.stringify([req.scope.kind, req.scope.i, req.scope.ids, req.task]);
  if (last && last.model === model && last.run === run && last.key === key) {
    return last.built;
  }
  const built = make(model, run, req);
  last = { model, run, key, built };
  return built;
}

function make(model: BoardModel, run: BoardRun, req: HandoffRequest): Built | undefined {
  const items = scopeItems(model, req.scope);
  const roots: Record<string, vscode.Uri> = {};
  for (const p of run.cfg.projects) {
    roots[p.id] = vscode.Uri.parse(p.path);
  }
  const names = Object.fromEntries(Object.entries(roots).map(([id, u]) => [id, folderName(u)]));
  const now = new Date();
  const files: HandoffFiles[] = [];
  let count = 0;
  for (const pid of [...new Set(items.map((x) => x.project))]) {
    const root = roots[pid];
    const mine = items.filter((x) => x.project === pid);
    if (!root) {
      continue;
    }
    const { projects, items: docItems } = fromModel(model, mine, names);
    const id = handoffId(now, pid, req.task);
    const filters = model.hidden ? ["projects:open-only"] : [];
    const doc = buildHandoff({ id, task: req.task, scope: { kind: req.scope.kind, count: mine.length, ...(filters.length > 0 ? { filters } : {}) }, profile: model.profile, date: now.toISOString().slice(0, 10), projects, items: docItems, file: handoffFile(id, "md") });
    files.push({ root, id, ...doc });
    count += mine.length;
  }
  return files.length === 0 ? undefined : { files, count, avail: available(model, req.scope) };
}

// Sends the document text and its estimate to the page.
export function handoffDoc(post: (m: unknown) => void, model: BoardModel | undefined, run: BoardRun | undefined, req: HandoffRequest): void {
  const built = model && run ? build(model, run, req) : undefined;
  if (!built) {
    void vscode.window.showInformationMessage(l10n("releaseBoard.handoff.nothing"));
    return;
  }
  const text = built.files.map((f) => (req.format === "json" ? f.json : f.markdown)).join("\n");
  post({ type: "handoffDoc", text, tokens: tokenLabel(estimateTokens(text)), count: built.count, avail: built.avail });
}

// Does one action of the drawer and tells the page the one-word result.
export async function handoffAct(post: (m: unknown) => void, model: BoardModel | undefined, run: BoardRun | undefined, req: HandoffRequest, act: unknown): Promise<void> {
  const built = model && run && typeof act === "string" && ACTS.includes(act) ? build(model, run, req) : undefined;
  if (!built) {
    void vscode.window.showInformationMessage(l10n("releaseBoard.handoff.nothing"));
    return;
  }
  try {
    post({ type: "handoffStatus", ...(await deliver(act as HandoffAct, built.files, req.format, readHandoffSettings())) });
  } catch (e) {
    post({ type: "handoffStatus", word: l10n("releaseBoard.handoff.failed"), tip: l10n("releaseBoard.handoff.failedTip", { error: e instanceof Error ? e.message : String(e) }) });
  }
}
