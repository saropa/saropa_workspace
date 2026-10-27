import { globToRegExp } from "./glob";

// Groups: documents that belong together appear under one heading. A group is formed by
// the first rule that matches:
//   1. a group listed by hand in the rule file;
//   2. the same project and the same file-name prefix (OWNER_*, HANDOVER_*), once the
//      date prefix is removed;
//   3. two or more shared source files. A hub (a very large document, or one naming many
//      other documents) never merges groups by shared files: it links to them instead.

export interface GroupInput {
  key: string;
  project: string;
  path: string;
  words: number;
  docRefs: number;
  sourceFiles: string[];
}

export interface ManualGroup {
  name: string;
  // Globs matched against "project/path".
  match: string[];
}

export interface GroupOptions {
  manual?: ManualGroup[];
  // Globs of "project/path" that are never grouped.
  ungrouped?: string[];
  // A document is a hub at or above either limit.
  hubWords?: number;
  hubDocRefs?: number;
  // File-name prefixes too generic to mean "belong together" (every plan starts PLAN_).
  genericPrefixes?: string[];
  // Most documents one source-file group may hold.
  maxFileGroup?: number;
}

const DEFAULT_GENERIC = ["PLAN", "BUG", "DOC", "DOCS", "NOTES", "NOTE", "TODO", "README", "INDEX", "REPORT", "SPEC", "GUIDE", "DRAFT", "ANALYSIS"];

export interface GroupResult {
  // Item key to its group (a unique id and the heading), for items in a group of two or more.
  groupOf: Map<string, { id: string; name: string }>;
  hubs: Set<string>;
}

function prefixOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1).replace(/^\d{8}_/, "").replace(/\.\w+$/, "");
  return base.split("_")[0].toUpperCase();
}

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

// A union-find over item keys: documents joined here end up in one group.
function makeUnion(keys: string[]): { find: (k: string) => string; union: (a: string, b: string) => void } {
  const parent = new Map<string, string>(keys.map((k) => [k, k]));
  const find = (k: string): string => {
    while (parent.get(k) !== k) {
      parent.set(k, parent.get(parent.get(k)!)!);
      k = parent.get(k)!;
    }
    return k;
  };
  return { find, union: (a, b) => void parent.set(find(a), find(b)) };
}

type Union = ReturnType<typeof makeUnion>;

// 1. Manual groups: the first group whose globs match a document claims it. Returns key to group name.
function joinManual(pool: GroupInput[], manual: Array<{ name: string; res: RegExp[] }>, u: Union): Map<string, string> {
  const manualOf = new Map<string, string>();
  for (const g of manual) {
    const members = pool.filter((i) => g.res.some((r) => r.test(i.project + "/" + i.path)) && !manualOf.has(i.key));
    members.forEach((m) => manualOf.set(m.key, g.name));
    members.slice(1).forEach((m) => u.union(members[0].key, m.key));
  }
  return manualOf;
}

// 2. Same project, same prefix (a generic prefix such as PLAN_ says nothing). Returns the prefix buckets.
function joinByPrefix(pool: GroupInput[], manualOf: Map<string, string>, generic: Set<string>, u: Union): Map<string, GroupInput[]> {
  const byPrefix = new Map<string, GroupInput[]>();
  for (const i of pool) {
    if (!manualOf.has(i.key) && !generic.has(prefixOf(i.path))) {
      const k = i.project + "\t" + prefixOf(i.path);
      (byPrefix.get(k) ?? byPrefix.set(k, []).get(k)!).push(i);
    }
  }
  for (const members of byPrefix.values()) {
    if (members.length >= 2) {
      members.slice(1).forEach((m) => u.union(members[0].key, m.key));
    }
  }
  return byPrefix;
}

// 3. Two or more shared source files. Not transitive: a seed document takes the
//    ungrouped documents that share two files with it, so a chain of overlaps cannot
//    grow into one giant group. Documents already grouped by prefix or by hand are left.
function joinByFiles(free: GroupInput[], filesOf: Map<string, Set<string>>, maxFileGroup: number, u: Union): void {
  const taken = new Set<string>();
  const sharedCount = (a: GroupInput, b: GroupInput): number => {
    let n = 0;
    for (const f of filesOf.get(a.key)!) {
      if (filesOf.get(b.key)!.has(f)) {
        n += 1;
      }
    }
    return n;
  };
  // Index by source file so a seed only looks at documents that share a file with it.
  const byFile = new Map<string, GroupInput[]>();
  for (const i of free) {
    for (const f of filesOf.get(i.key)!) {
      (byFile.get(f) ?? byFile.set(f, []).get(f)!).push(i);
    }
  }
  for (const seed of free) {
    if (taken.has(seed.key)) {
      continue;
    }
    const cands = new Set<GroupInput>();
    for (const f of filesOf.get(seed.key)!) {
      byFile.get(f)!.forEach((o) => cands.add(o));
    }
    const mates = free.filter((o) => cands.has(o) && o.key !== seed.key && o.project === seed.project && !taken.has(o.key) && sharedCount(seed, o) >= 2).slice(0, maxFileGroup - 1);
    if (mates.length > 0) {
      taken.add(seed.key);
      mates.forEach((m) => {
        taken.add(m.key);
        u.union(seed.key, m.key);
      });
    }
  }
}

// Gathers the joined documents into groups of two or more and names each group.
function nameGroups(pool: GroupInput[], manualOf: Map<string, string>, generic: Set<string>, u: Union): GroupResult["groupOf"] {
  const members = new Map<string, string[]>();
  for (const i of pool) {
    const r = u.find(i.key);
    (members.get(r) ?? members.set(r, []).get(r)!).push(i.key);
  }
  const poolByKey = new Map(pool.map((i) => [i.key, i]));
  const groupOf = new Map<string, { id: string; name: string }>();
  for (const [root, keys] of members) {
    if (keys.length < 2) {
      continue;
    }
    const manualName = keys.map((k) => manualOf.get(k)).find(Boolean);
    const first = poolByKey.get(keys[0])!;
    const same = keys.every((k) => {
      const i = poolByKey.get(k)!;
      return i.project === first.project && prefixOf(i.path) === prefixOf(first.path);
    });
    const meaningful = same && !generic.has(prefixOf(first.path));
    const name = manualName ?? (meaningful ? titleCase(prefixOf(first.path)) + " documents" : "Related documents");
    keys.forEach((k) => groupOf.set(k, { id: root, name }));
  }
  return groupOf;
}

// Puts related documents under one heading and finds the hubs. See the rules at the top of this file.
export function buildGroups(items: GroupInput[], opt: GroupOptions = {}): GroupResult {
  const hubWords = opt.hubWords ?? 20000;
  const hubDocRefs = opt.hubDocRefs ?? 30;
  const ungrouped = (opt.ungrouped ?? []).map(globToRegExp);
  const manual = (opt.manual ?? []).map((g) => ({ name: g.name, res: g.match.map(globToRegExp) }));
  const pool = items.filter((i) => !ungrouped.some((r) => r.test(i.project + "/" + i.path)));
  const u = makeUnion(pool.map((i) => i.key));
  const hubs = new Set(pool.filter((i) => i.words >= hubWords || i.docRefs >= hubDocRefs).map((i) => i.key));
  const manualOf = joinManual(pool, manual, u);
  const generic = new Set((opt.genericPrefixes ?? DEFAULT_GENERIC).map((g) => g.toUpperCase()));
  const byPrefix = joinByPrefix(pool, manualOf, generic, u);
  const filesOf = new Map(pool.map((i) => [i.key, new Set(i.sourceFiles)]));
  const free = pool
    .filter((i) => !hubs.has(i.key) && !manualOf.has(i.key) && u.find(i.key) === i.key && !byPrefix.get(i.project + "\t" + prefixOf(i.path))?.slice(1).length)
    .sort((a, b) => b.sourceFiles.length - a.sourceFiles.length || a.key.localeCompare(b.key));
  joinByFiles(free, filesOf, opt.maxFileGroup ?? 12, u);
  return { groupOf: nameGroups(pool, manualOf, generic, u), hubs };
}
