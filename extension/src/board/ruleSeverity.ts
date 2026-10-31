import { Severity } from "./severity";
import { AssignRefusal, OVERRIDE_RULE_SET, docGlob, isObject, parseForEdit, serialize } from "./ruleAssign";

// The severity half of the rules-file editing: the levels a person can set by hand, the entries
// that hold them, and the status rules the board writes for single documents. Pure text in, text
// out, like ruleAssign, which re-exports everything here so existing imports keep working.

// The levels a document's severity can be set to by hand, most severe first.
export const SEVERITY_LEVELS: readonly Severity[] = ["extreme", "critical", "high", "medium", "low"];

// The key of the rules file that holds severities chosen for single documents.
export const SEVERITY_KEY = "severityOverrides";

// A severity chosen by hand for one document of one project. The path is exact, never a glob.
export interface SeverityOverride {
  project: string;
  path: string;
  severity: Severity;
}

// The key of a document in the lookup maps: project, tab, path (a tab cannot be part of an id).
export const overrideKey = (project: string, path: string): string => `${project}\t${path}`;

// The severities chosen by hand, from a rules file's parsed content. An entry of the wrong shape,
// with an unknown level or with a wildcard in its path is ignored; the first entry of a document wins.
export function severityOverrides(cfg: { severityOverrides?: unknown }): Map<string, Severity> {
  const out = new Map<string, Severity>();
  const list = cfg.severityOverrides;
  for (const e of Array.isArray(list) ? list : []) {
    if (!isObject(e) || typeof e.project !== "string" || typeof e.path !== "string" || docGlob(e.path) === undefined) {
      continue;
    }
    const level = SEVERITY_LEVELS.find((l) => l === e.severity);
    const key = overrideKey(e.project, e.path);
    if (level && !out.has(key)) {
      out.set(key, level);
    }
  }
  return out;
}

// The outcome of a severity or status edit: the new file text, or why the file was left alone.
export type SeverityResult = { ok: true; text: string } | { ok: false; reason: AssignRefusal };

// Sets the severity of one document, or (severity undefined) takes the entry away so the
// computed one applies again. Same refusals as a rule: text that does not parse, has the wrong
// shape, has a key twice, or a path that holds a wildcard. Taking away what is not there is
// refused as "none" and nothing is written.
export function setDocSeverity(text: string | undefined, a: { project: string; path: string; severity: Severity | undefined }): SeverityResult {
  if (docGlob(a.path) === undefined || (a.severity !== undefined && !SEVERITY_LEVELS.includes(a.severity))) {
    return { ok: false, reason: "glob" };
  }
  const parsed = parseForEdit(text);
  if (!parsed.ok) {
    return parsed;
  }
  const doc = parsed.doc;
  if (doc[SEVERITY_KEY] !== undefined && !Array.isArray(doc[SEVERITY_KEY])) {
    return { ok: false, reason: "shape" };
  }
  const list = (Array.isArray(doc[SEVERITY_KEY]) ? doc[SEVERITY_KEY] : []) as unknown[];
  const same = (e: unknown): boolean => isObject(e) && e.project === a.project && e.path === a.path;
  const kept = list.filter((e) => !same(e));
  if (a.severity === undefined) {
    if (kept.length === list.length) {
      return { ok: false, reason: "none" };
    }
  } else {
    kept.push({ project: a.project, path: a.path, severity: a.severity });
  }
  if (kept.length === 0) {
    delete doc[SEVERITY_KEY];
  } else {
    doc[SEVERITY_KEY] = kept;
  }
  return { ok: true, text: serialize(parsed) };
}

// True when a rule is one the board wrote for a single document's status: an id that starts with
// "status-", a final rule, and an exact path with a project. With `project` and `path` it must name them.
function isDocStatusRule(r: unknown, project?: string, path?: string): r is { id: string; when: { path: string; project: string } } {
  if (!isObject(r) || typeof r.id !== "string" || !r.id.startsWith("status-") || !isObject(r.when) || !isObject(r.set) || r.set.final !== true) {
    return false;
  }
  const w = r.when;
  return typeof w.path === "string" && typeof w.project === "string" && docGlob(w.path) !== undefined && (project === undefined || w.project === project) && (path === undefined || w.path === path);
}

// The rule lists the board writes status rules into: the rules of the project (every project when
// none is named) and the "my-overrides" rule set.
function statusRuleLists(doc: { projects?: unknown; ruleSets?: unknown }, project?: string): unknown[][] {
  const lists: unknown[][] = [];
  if (Array.isArray(doc.projects)) {
    for (const p of doc.projects) {
      if (isObject(p) && (project === undefined || p.id === project) && Array.isArray(p.rules)) {
        lists.push(p.rules);
      }
    }
  }
  const set = isObject(doc.ruleSets) ? doc.ruleSets[OVERRIDE_RULE_SET] : undefined;
  if (isObject(set) && Array.isArray(set.rules)) {
    lists.push(set.rules);
  }
  return lists;
}

// The documents (as overrideKey) that have a status chosen from the board, from the rules file's
// parsed content. The same test as the one Back to automatic uses to take them away.
export function docStatusKeys(cfg: { projects?: unknown; ruleSets?: unknown }): Set<string> {
  const out = new Set<string>();
  for (const rules of statusRuleLists(cfg)) {
    for (const r of rules) {
      if (isDocStatusRule(r)) {
        out.add(overrideKey(r.when.project, r.when.path));
      }
    }
  }
  return out;
}

// Takes away the status chosen by hand for one document: the rules the board wrote for its exact
// path (ids that start with "status-", in the project's own rules or in the "my-overrides" set).
export function clearDocStatus(text: string | undefined, a: { project: string; path: string }): SeverityResult {
  const glob = docGlob(a.path);
  if (glob === undefined) {
    return { ok: false, reason: "glob" };
  }
  const parsed = parseForEdit(text);
  if (!parsed.ok) {
    return parsed;
  }
  let removed = 0;
  for (const rules of statusRuleLists(parsed.doc, a.project)) {
    for (let i = rules.length - 1; i >= 0; i--) {
      if (isDocStatusRule(rules[i], a.project, glob)) {
        rules.splice(i, 1);
        removed += 1;
      }
    }
  }
  return removed === 0 ? { ok: false, reason: "none" } : { ok: true, text: serialize(parsed) };
}
