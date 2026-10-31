// Auto-grouping, the name layer: groups made from file names (sequence families, shared stem words), tags, shared
// source files and links, and the split of an over-size stem or tag group.

import { joinByFiles, makeUnion } from "../groups";
import { Env, G, byKey, folderOf, make, push, scoped, why } from "./autoGroupTypes";
import type { OrgDoc } from "./orgTypes";
import { hasEffect } from "./tags";
import { KIND, logicalFolders } from "./tokens";

// Splits an over-size stem or tag group by child folder, then another stem word, then another tag. The parts become
// siblings (never a third level). A part under MIN goes back to the loose documents; what no split can cut stays flagged.
function splitOver(env: Env, g: G, ctx: string): { parts: G[]; released: OrgDoc[] } {
  const { min, max } = env.layout;
  const depth = ctx === "" ? 0 : ctx.split("/").length;
  const key = g.id.slice(`${env.project}:${g.kind}:`.length);
  const topTag = (d: OrgDoc): string | undefined => env.matches.get(d.key)?.find((m) => m.tagId !== g.tagId && hasEffect(env.tagById.get(m.tagId)!, "group"))?.tagId;
  const wordAt = (d: OrgDoc): string | undefined => {
    const w = env.tok.get(d.key)!.words[g.kind === "stem" ? 1 : 0];
    return w && w.length >= 3 && !KIND.has(w) ? w : undefined;
  };
  const signals: Array<{ sep: string; of: (d: OrgDoc) => string | undefined; label: (b: string) => string }> = [
    { sep: "/", of: (d) => logicalFolders(d.path)[depth], label: env.nameOf },
    { sep: "+", of: wordAt, label: env.nameOf },
    { sep: "#", of: topTag, label: (b) => env.tagById.get(b)?.label ?? b },
  ];
  const flag = (x: G): void => {
    x.oversize = x.docs.length > max;
    if (x.oversize) {
      x.why = why("oversize", { max }, "low");
    }
  };
  for (const sig of signals) {
    const buckets = new Map<string, OrgDoc[]>();
    g.docs.forEach((d) => {
      const b = sig.of(d);
      if (b) {
        push(buckets, b, d);
      }
    });
    const big = [...buckets].filter(([, l]) => l.length >= min && l.length < g.docs.length).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    if (big.length === 0) {
      continue;
    }
    const parts = big.map(([b, list]) => {
      const p = make(g.kind, env, key + sig.sep + b, g.rawName + " " + b, `${g.name} · ${sig.label(b)}`, ctx, list, { ...g.why, params: { ...g.why.params, count: list.length } });
      p.tagId = g.tagId;
      flag(p);
      return p;
    });
    const gone = new Set(parts.flatMap((p) => p.docs.map((d) => d.key)));
    const remainder = g.docs.filter((d) => !gone.has(d.key));
    if (remainder.length >= min) {
      g.docs = remainder;
      g.why = { ...g.why, params: { ...g.why.params, count: remainder.length } };
      flag(g);
      return { parts: [g, ...parts], released: [] };
    }
    return { parts, released: remainder };
  }
  flag(g);
  return { parts: [g], released: [] };
}

// The state one run of the name layer shares: the groups made so far, the documents they took, and the views of the
// documents still free (`loose` leaves out the hubs, which never pull documents together).
interface Layer {
  env: Env;
  ctx: string;
  groups: G[];
  taken: Set<string>;
  add: (g: G) => void;
  free: () => OrgDoc[];
  loose: () => OrgDoc[];
}

function newLayer(env: Env, docs: OrgDoc[], ctx: string): Layer {
  const groups: G[] = [];
  const taken = new Set<string>();
  const add = (g: G): void => {
    g.docs.forEach((d) => taken.add(d.key));
    groups.push(g);
  };
  const free = (): OrgDoc[] => docs.filter((d) => !taken.has(d.key));
  const loose = (): OrgDoc[] => free().filter((d) => !env.hubs.has(d.key));
  return { env, ctx, groups, taken, add, free, loose };
}

// Step 1 of the name layer.
function sequenceFamilies({ env, add, loose }: Layer): void {
  // 1. Sequence family: same folder, same stem, differing only in the sequence token. Two members are enough.
  const fam = new Map<string, OrgDoc[]>();
  for (const d of loose()) {
    const t = env.tok.get(d.key)!;
    if (t.seq && t.stem) {
      push(fam, folderOf(d) + "\t" + t.stem, d);
    }
  }
  for (const [k, list] of [...fam].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (list.length < 2) {
      continue;
    }
    const [folder, stem] = k.split("\t");
    // The most common label names the family (a tie goes to the label that sorts first); members with another label stay loose.
    const tally = new Map<string, number>();
    list.forEach((d) => tally.set(env.tok.get(d.key)!.seq!.label, (tally.get(env.tok.get(d.key)!.seq!.label) ?? 0) + 1));
    const label = [...tally].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
    const same = list.filter((d) => env.tok.get(d.key)!.seq!.label === label);
    if (same.length < 2) {
      continue;
    }
    const plain = loose().filter((d) => !env.tok.get(d.key)!.seq && env.tok.get(d.key)!.stem === stem && folderOf(d) === folder);
    const ns = same.map((d) => env.tok.get(d.key)!.seq!.n);
    const name = env.nameOf(stem.replace(/_/g, " "));
    const g = make("seq", env, scoped(folder, stem), stem, name, folder, [...same, ...plain], why("sequence", { stem, count: same.length + plain.length }));
    g.range = { label, from: Math.min(...ns), to: Math.max(...ns) };
    add(g);
  }
}

// Steps 2 and 3 of the name layer.
function wordAndTagGroups({ env, ctx, add, loose }: Layer): void {
  const { min, max } = env.layout;
  // 2. Shared stem word (kind words such as PLAN are skipped, not counted).
  const byWord = new Map<string, OrgDoc[]>();
  for (const d of loose()) {
    const w = env.tok.get(d.key)!.words[0];
    if (w && w.length >= 3 && !KIND.has(w)) {
      push(byWord, w, d);
    }
  }
  for (const [w, list] of [...byWord].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (list.length >= min) {
      const g = make("stem", env, scoped(ctx, w), w, env.nameOf(w), ctx, list, why("stem", { word: w, count: list.length }));
      g.oversize = list.length > max;
      add(g);
    }
  }

  // 3. Theme: the best tag of each document.
  const byTag = new Map<string, OrgDoc[]>();
  for (const d of loose()) {
    // A word that only the folder name holds says nothing about this document against its neighbours.
    const top = env.matches.get(d.key)?.find((m) => hasEffect(env.tagById.get(m.tagId)!, "group") && (m.why.source === "frontMatter" || m.hits.some((h) => h.where !== "folder")));
    if (top) {
      push(byTag, top.tagId, d);
    }
  }
  for (const [id, list] of [...byTag].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (list.length >= min) {
      const label = env.tagById.get(id)!.label;
      const words = [...new Set(list.flatMap((d) => env.matches.get(d.key)!.find((m) => m.tagId === id)!.hits.map((h) => h.word)))].sort().slice(0, 3).join(", ");
      const g = make("tag", env, scoped(ctx, id), label, label, ctx, list, why("tag", { tag: label, count: list.length, words }, "medium"));
      g.oversize = list.length > max;
      g.tagId = id;
      add(g);
    }
  }
}

// Step 4 of the name layer.
function sourceFileGroups({ env, ctx, add, loose }: Layer): void {
  const { min } = env.layout;
  // 4. Shared source files; hubs never pull documents together.
  const withFiles = loose().filter((d) => d.sourceFiles.length > 0).sort((a, b) => b.sourceFiles.length - a.sourceFiles.length || byKey(a, b));
  if (withFiles.length > 1) {
    const u = makeUnion(withFiles.map((d) => d.key));
    joinByFiles(withFiles, new Map(withFiles.map((d) => [d.key, new Set(d.sourceFiles)])), 12, u);
    const clusters = new Map<string, OrgDoc[]>();
    withFiles.forEach((d) => push(clusters, u.find(d.key), d));
    const made: G[] = [];
    for (const list of clusters.values()) {
      if (list.length >= min) {
        const uses = new Map<string, number>();
        list.forEach((d) => d.sourceFiles.forEach((f) => uses.set(f, (uses.get(f) ?? 0) + 1)));
        const top = [...uses].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
        const file = top.slice(top.lastIndexOf("/") + 1);
        // The id comes from the cluster's first document, so two clusters whose top file is index.ts never meet.
        made.push(make("files", env, scoped(ctx, [...list].sort(byKey)[0].path), file, file, ctx, list, why("files", { count: list.length }, "low")));
      }
    }
    made.sort((a, b) => (a.id < b.id ? -1 : 1)).forEach(add);
  }
}

// Step 5 of the name layer.
function linkJoins({ taken, groups, loose }: Layer, prior: G[]): void {
  // 5. Links: a loose document whose open links all point into one group joins it.
  const groupOf = new Map<string, G>();
  const index = (g: G): void => {
    g.docs.forEach((d) => groupOf.set(d.key, g));
    g.subs.forEach(index);
  };
  [...prior, ...groups].forEach(index);
  for (const d of loose().sort(byKey)) {
    const targets = new Set((d.needs ?? []).map((k) => groupOf.get(k)));
    if ((d.needs?.length ?? 0) > 0 && targets.size === 1 && !targets.has(undefined)) {
      const g = [...targets][0]!;
      g.docs.push(d);
      g.docs.sort(byKey);
      if (typeof g.why.params.count === "number") {
        g.why = { ...g.why, params: { ...g.why.params, count: g.why.params.count + 1 } };
      }
      groupOf.set(d.key, g);
      taken.add(d.key);
    }
  }
}

// Step 6 of the name layer.
function cutOversize({ env, ctx, groups, taken }: Layer): G[] {
  const { max } = env.layout;
  // 6. A stem or tag group over MAX is cut by the next signal.
  const settled: G[] = [];
  for (const g of groups) {
    if ((g.kind === "stem" || g.kind === "tag") && g.docs.length > max) {
      const cut = splitOver(env, g, ctx);
      cut.released.forEach((d) => taken.delete(d.key));
      settled.push(...cut.parts);
    } else {
      settled.push(g);
    }
  }
  return settled;
}

// Sequence families, shared stem word, tag theme, shared source files, links; then over-size stem and tag groups are split.
// `prior` are the groups made at lower levels, which a loose document may join through its links.
export function nameLayer(env: Env, docs: OrgDoc[], ctx: string, prior: G[] = []): { groups: G[]; rest: OrgDoc[] } {
  const layer = newLayer(env, docs, ctx);
  sequenceFamilies(layer);
  wordAndTagGroups(layer);
  sourceFileGroups(layer);
  linkJoins(layer, prior);
  return { groups: cutOversize(layer), rest: layer.free() };
}
