import { globToRegExp } from "./glob";
import {
  BoardConfig,
  BoardStatus,
  Classified,
  ParamValue,
  ProjectDef,
  Rule,
  ScanFile,
  StatusLineConfig,
} from "./types";

// The rule engine: turns (config, project, files) into one Classified row per file.
// Pure and synchronous. It knows no folder names; every name comes from rule params.
// First matching rule wins. A project's own rules run before its rule sets' rules.

interface CompiledRule {
  ruleSet: string;
  rule: Rule;
  path?: RegExp;
  name?: RegExp;
}

// A rule the user confirmed from the board to win. It counts only when it names its project, so a
// rule set copied from elsewhere cannot make itself win in every project.
function isFinal(rule: Rule): boolean {
  return rule.set.final === true && rule.when.project !== undefined;
}

// A project with its rules turned into patterns, in the order they are tried.
export interface CompiledProject {
  project: ProjectDef;
  rules: CompiledRule[];
  statusLine?: StatusLineConfig;
}

function expandParams(text: string, params: Record<string, ParamValue>): string {
  return text.replace(/\$(\w+)/g, (_m, key: string) => {
    const v = params[key];
    if (v === undefined) {
      return "";
    }
    return Array.isArray(v) ? v.join(",") : v;
  });
}

// Merge the params of every rule set the project uses (later sets win), then the
// project's own params (which win over all).
function projectParams(cfg: BoardConfig, p: ProjectDef): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const name of p.ruleSets) {
    Object.assign(out, cfg.ruleSets[name]?.params ?? {});
  }
  return Object.assign(out, p.params ?? {});
}

// Turns a project's own rules and its rule sets into patterns, filling in parameters.
export function compileProject(cfg: BoardConfig, p: ProjectDef): CompiledProject {
  const params = projectParams(cfg, p);
  const ordered: Array<{ ruleSet: string; rule: Rule }> = [];
  for (const r of p.rules ?? []) {
    ordered.push({ ruleSet: "project", rule: r });
  }
  let statusLine: StatusLineConfig | undefined;
  for (const name of p.ruleSets) {
    const set = cfg.ruleSets[name];
    if (!set) {
      continue;
    }
    if (set.statusLine) {
      statusLine = set.statusLine;
    }
    for (const r of set.rules ?? []) {
      ordered.push({ ruleSet: name, rule: r });
    }
  }
  // A rule the user confirmed from the board to win comes before every other rule, whichever list it sits in.
  ordered.sort((a, b) => Number(isFinal(b.rule)) - Number(isFinal(a.rule)));
  const rules = ordered.map(({ ruleSet, rule }) => ({
    ruleSet,
    rule,
    path: rule.when.path ? globToRegExp(expandParams(rule.when.path, params)) : undefined,
    name: rule.when.name ? globToRegExp(expandParams(rule.when.name, params)) : undefined,
  }));
  return { project: p, rules, statusLine };
}

// The first 20 lines of a document are enough to find a Status line.
// A real Status line has a colon: "Status: WIP", "**Status:** done", "> Status: fixed".
// Table rows ("| Status | Fixed |") and prose ("Status of the work") do not match, and a
// word followed by "?" is a question, not a state.
const STATUS_LINE_RE = /^[>\s*_#-]*status\**\s*:\s*\**\s*([A-Za-z]+)(?![A-Za-z?])/im;

// The word of a Status line in the head of a document, in lower case, or undefined.
export function findStatusWord(head: string): string | undefined {
  const m = STATUS_LINE_RE.exec(head);
  if (!m) {
    return undefined;
  }
  return m[1].toLowerCase();
}

// The ignore globs of the rules file as patterns.
export function compileIgnore(cfg: BoardConfig): RegExp[] {
  return cfg.ignore.map(globToRegExp);
}

// Classify one file. `statusWord` is the Status-line word read from the file (the
// caller reads it, only when `needsStatusWord` said so, and caches it by size and
// modified time); undefined when the file has none.
export function classifyFile(
  cp: CompiledProject,
  file: ScanFile,
  statusWord: string | undefined
): Classified {
  const base = file.path.slice(file.path.lastIndexOf("/") + 1);
  let status: BoardStatus = "grey";
  let kind = "";
  let note = "";
  let rule: string | undefined;
  let ruleSet: string | undefined;
  let final = false;
  for (const c of cp.rules) {
    if (c.rule.when.project !== undefined && c.rule.when.project !== cp.project.id) {
      continue;
    }
    if (c.path && !c.path.test(file.path)) {
      continue;
    }
    if (c.name && !c.name.test(base)) {
      continue;
    }
    status = c.rule.set.status;
    kind = c.rule.set.kind ?? "";
    note = c.rule.set.note ?? "";
    rule = c.rule.id;
    ruleSet = c.ruleSet;
    final = isFinal(c.rule);
    break;
  }
  let usedWord: string | undefined;
  if (!final && statusWord && cp.statusLine && cp.statusLine.appliesTo.includes(status)) {
    const to = cp.statusLine.words[statusWord];
    if (to) {
      status = to;
      rule = (rule ?? "?") + " > status line";
      usedWord = statusWord;
    }
  }
  return {
    project: cp.project.id,
    path: file.path,
    status,
    kind,
    note,
    rule,
    ruleSet,
    statusWord: usedWord,
  };
}

// True when a file's state could be moved by a Status line, so the scanner has to
// read its head. Only Markdown has one.
export function needsStatusWord(cp: CompiledProject, file: ScanFile): boolean {
  if (!cp.statusLine || !file.path.toLowerCase().endsWith(".md")) {
    return false;
  }
  // The state before the Status line decides whether it applies; classify without it.
  const before = classifyFile(cp, file, undefined);
  return cp.statusLine.appliesTo.includes(before.status);
}
