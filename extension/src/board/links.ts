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
  | "ambiguous";

export interface Link {
  fromProject: string;
  fromPath: string;
  target: string;
  state: LinkState;
  toProject?: string;
  toPath?: string;
}

const key = (project: string, path: string): string => project + "\t" + path;

function stripRelative(t: string): string {
  return t.replace(/^(\.\.?\/)+/, "").replace(/^\//, "");
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
      t = stripRelative(t.trim());
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
      if (hits.length > 1) {
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
  const waitsOn = new Map<string, string[]>();
  const blocks = new Map<string, string[]>();
  const nodes = new Map<string, ChainNode>();
  for (const l of links) {
    if (l.state !== "open" || !l.toProject || !l.toPath) {
      continue;
    }
    const a = key(l.fromProject, l.fromPath);
    const b = key(l.toProject, l.toPath);
    nodes.set(a, { project: l.fromProject, path: l.fromPath });
    nodes.set(b, { project: l.toProject, path: l.toPath });
    (waitsOn.get(a) ?? waitsOn.set(a, []).get(a)!).push(b);
    (blocks.get(b) ?? blocks.set(b, []).get(b)!).push(a);
  }
  const chains: ChainNode[][] = [];
  const roots = [...nodes.keys()].filter((k) => !waitsOn.has(k)).sort();
  for (const root of roots) {
    // Depth-first along "blocks" edges; each leaf-ending path is one chain. A visited
    // set keeps a cycle from looping.
    const walk = (k: string, trail: string[]): void => {
      const next = (blocks.get(k) ?? []).filter((n) => !trail.includes(n)).sort();
      if (next.length === 0) {
        if (trail.length > 1) {
          chains.push(trail.map((t) => nodes.get(t)!));
        }
        return;
      }
      for (const n of next) {
        walk(n, [...trail, n]);
      }
    };
    walk(root, [root]);
  }
  // Documents in a cycle have no root; list them once so a loop is visible, not hidden.
  const covered = new Set(chains.flat().map((n) => key(n.project, n.path)));
  const loop = [...nodes.keys()].filter((k) => !covered.has(k)).sort();
  if (loop.length > 1) {
    chains.push(loop.map((k) => nodes.get(k)!));
  }
  return chains;
}
