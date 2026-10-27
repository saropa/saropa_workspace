import { posix } from "node:path";
import { Classified, ProjectDef } from "./types";

// Linkages between documents, from the "Needs:" lines they carry. A linked item is
// never shown alone: the board draws the chain.

export type LinkState =
  // The target is not finished.
  | "open"
  // The target is in a finished folder (green) or is reference: the link is satisfied,
  // and the Needs line can be removed.
  | "done"
  // No document matches the target.
  | "missing"
  // More than one document matches the target; say which with a path.
  | "ambiguous"
  // The document names itself.
  | "self";

export interface Link {
  fromProject: string;
  fromPath: string;
  target: string;
  state: LinkState;
  toProject?: string;
  toPath?: string;
}

const key = (project: string, path: string): string => project + "\t" + path;

// A target is resolved from the folder of the document that names it when it starts with
// "./" or "../"; otherwise it is project-relative. "#anchor" and "?query" are dropped.
function normalizeTarget(t: string, fromPath: string): string {
  const bare = t.replace(/[#?].*$/, "");
  if (/^\.\.?\//.test(bare)) {
    const dir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : "";
    return posix.normalize(dir ? dir + "/" + bare : bare).replace(/^(\.\.\/)+/, "");
  }
  return bare.replace(/^\//, "");
}

// Resolve every Needs target to a document. `needs` maps "project\tpath" of the waiting
// document to its raw targets. Targets resolve, in order: "project:path" (the project id
// or name); an exact project-relative path in the same project; a path or file name that
// matches exactly one document in the same project; then one document in any project.
export function resolveLinks(
  rows: Classified[],
  needs: Map<string, string[]>,
  projects: ProjectDef[]
): Link[] {
  const byBase = new Map<string, Classified[]>();
  const byKey = new Map<string, Classified>();
  for (const r of rows) {
    byKey.set(key(r.project, r.path), r);
    const base = r.path.slice(r.path.lastIndexOf("/") + 1).toLowerCase();
    (byBase.get(base) ?? byBase.set(base, []).get(base)!).push(r);
  }
  const projectIds = new Map<string, string>();
  for (const p of projects) {
    projectIds.set(p.id.toLowerCase(), p.id);
    if (p.name) {
      projectIds.set(p.name.toLowerCase(), p.id);
    }
  }
  const out: Link[] = [];
  for (const [from, targets] of needs) {
    const [fromProject, fromPath] = from.split("\t");
    for (const raw of targets) {
      let project: string | undefined;
      let t = raw;
      const colon = /^([A-Za-z][\w .-]*):(?!\/)(.+)$/.exec(raw);
      if (colon && projectIds.has(colon[1].toLowerCase())) {
        project = projectIds.get(colon[1].toLowerCase());
        t = colon[2];
      }
      t = normalizeTarget(t.trim(), fromPath);
      const scoped = project ?? fromProject;
      let hits: Classified[] = [];
      const exact = byKey.get(key(scoped, t));
      if (exact) {
        hits = [exact];
      } else {
        const base = t.slice(t.lastIndexOf("/") + 1).toLowerCase();
        const same = (byBase.get(base) ?? []).filter(
          (r) => r.project === scoped && (r.path === t || r.path.endsWith("/" + t))
        );
        hits = same.length > 0 ? same : project ? [] : (byBase.get(base) ?? []).filter((r) => r.path === t || r.path.endsWith("/" + t));
      }
      const link: Link = { fromProject, fromPath, target: raw, state: "missing" };
      if (hits.length === 1 && hits[0].project === fromProject && hits[0].path === fromPath) {
        link.state = "self";
      } else if (hits.length > 1) {
        link.state = "ambiguous";
      } else if (hits.length === 1) {
        const h = hits[0];
        link.toProject = h.project;
        link.toPath = h.path;
        link.state = h.status === "green" || h.status === "reference" ? "done" : "open";
      }
      out.push(link);
    }
  }
  return out;
}

// A chain: documents in the order they must be finished, first to last. Built from the
// open links, following "waits on" edges to the roots and then the documents that wait
// on a root, so the first line of a chain is the thing to do first.
export interface ChainNode {
  project: string;
  path: string;
}

export function buildChains(links: Link[]): ChainNode[][] {
  const waitsOn = new Map<string, Set<string>>();
  const adj = new Map<string, Set<string>>();
  const nodes = new Map<string, ChainNode>();
  const add = (m: Map<string, Set<string>>, a: string, b: string): void => {
    (m.get(a) ?? m.set(a, new Set()).get(a)!).add(b);
  };
  for (const l of links) {
    if (l.state !== "open" || !l.toProject || !l.toPath) {
      continue;
    }
    const a = key(l.fromProject, l.fromPath);
    const b = key(l.toProject, l.toPath);
    nodes.set(a, { project: l.fromProject, path: l.fromPath });
    nodes.set(b, { project: l.toProject, path: l.toPath });
    add(waitsOn, a, b);
    add(adj, a, b);
    add(adj, b, a);
  }
  // One chain per connected part, so a ladder of shared prerequisites is one list, not
  // one list per path. Within a part, what must be finished first comes first (Kahn's
  // order, ties by key); documents left in a loop follow, sorted.
  const chains: ChainNode[][] = [];
  const seen = new Set<string>();
  for (const start of [...nodes.keys()].sort()) {
    if (seen.has(start)) {
      continue;
    }
    const part: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const k = stack.pop()!;
      part.push(k);
      for (const n of adj.get(k) ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    const left = new Map(part.map((k) => [k, waitsOn.get(k)?.size ?? 0]));
    const order: string[] = [];
    const ready = part.filter((k) => left.get(k) === 0).sort();
    while (ready.length > 0) {
      const k = ready.shift()!;
      order.push(k);
      left.delete(k);
      for (const [w, set] of waitsOn) {
        if (set.has(k) && left.has(w)) {
          left.set(w, left.get(w)! - 1);
          if (left.get(w) === 0) {
            ready.push(w);
            ready.sort();
          }
        }
      }
    }
    order.push(...[...left.keys()].sort());
    chains.push(order.map((k) => nodes.get(k)!));
  }
  return chains;
}
