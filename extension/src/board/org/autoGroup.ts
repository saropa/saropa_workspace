// Auto-grouping: the user's own groups first, then folders, then file-name stems and numbered
// families, then tags. Pure and deterministic: the same documents give the same groups and
// ids whatever order they arrive in. Ids come from the group's own key (a folder path, a stem,
// a tag), never from one of its members, so fold state and overrides can attach to them.

import { globToRegExp } from "../glob";
import { joinByFiles, makeUnion } from "../groups";
import { assignColours, emojiWhy, isAllowedColour, pickGroupTag } from "./appearance";
import { Layout, layoutFor } from "./layout";
import { cleanName, dedupNames, isContainerOnly } from "./naming";
import type { GroupKind, OrgDoc, OrgGroup, OrgOptions, OrgResult, OrgSource, SeqRange, TagMatch, Why } from "./orgTypes";
import { OrganizeConfig, resolveByPrecedence } from "./overrides";
import { CompiledTags, TagDef, compileTags, hasEffect, matchTags, subjectOf } from "./tags";
import { FileTokens, KIND, fileTokens, logicalFolders, splitWords, stemWord } from "./tokens";

// Internal group while the tree is built.
interface G {
  id: string;
  kind: GroupKind;
  name: string;
  rawName: string;
  folder: string;
  docs: OrgDoc[];
  subs: G[];
  oversize: boolean;
  why: Why;
  range?: SeqRange;
  tagId?: string;
}

interface Env {
  project: string;
  layout: Layout;
  tok: Map<string, FileTokens>;
  matches: Map<string, TagMatch[]>;
  tagById: Map<string, TagDef>;
  hubs: Set<string>;
}

interface Node {
  segs: string[];
  docs: OrgDoc[];
  kids: Map<string, Node>;
  n: number;
}

const byKey = (a: OrgDoc, b: OrgDoc): number => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
// The cleaned name, or the raw text when cleaning leaves nothing (a folder named v2).
const nameOf = (raw: string): string => cleanName(raw) || raw.trim();
const folderOf = (d: OrgDoc): string => logicalFolders(d.path).join("/");
const scoped = (ctx: string, k: string): string => (ctx ? `${ctx}/${k}` : k);

function why(key: string, params: Record<string, string | number>, confidence: Why["confidence"] = "high", source: OrgSource = "inference"): Why {
  return { key: `releaseBoard.org.why.${key}`, params, source, confidence };
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  (m.get(k) ?? m.set(k, []).get(k)!).push(v);
}

// The folder's own name, or its nearest parent when it is only a container (docs, notes).
function folderLabel(folder: string): string {
  const segs = folder.split("/").filter(Boolean);
  return [...segs].reverse().find((s) => !isContainerOnly(s)) ?? segs[segs.length - 1] ?? "";
}

function make(kind: GroupKind, env: Env, key: string, rawName: string, name: string, folder: string, docs: OrgDoc[], w: Why): G {
  return { id: `${env.project}:${kind}:${key}`, kind, name, rawName, folder, docs: [...docs].sort(byKey), subs: [], oversize: false, why: w };
}

function subtree(g: G): OrgDoc[] {
  return [...g.docs, ...g.subs.flatMap(subtree)];
}

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
    { sep: "/", of: (d) => logicalFolders(d.path)[depth], label: nameOf },
    { sep: "+", of: wordAt, label: nameOf },
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

// Sequence families, shared stem word, tag theme, shared source files, links; then over-size stem and tag groups are split.
// `prior` are the groups made at lower levels, which a loose document may join through its links.
function nameLayer(env: Env, docs: OrgDoc[], ctx: string, prior: G[] = []): { groups: G[]; rest: OrgDoc[] } {
  const { min, max } = env.layout;
  const groups: G[] = [];
  const taken = new Set<string>();
  const add = (g: G): void => {
    g.docs.forEach((d) => taken.add(d.key));
    groups.push(g);
  };
  const free = (): OrgDoc[] => docs.filter((d) => !taken.has(d.key));
  const loose = (): OrgDoc[] => free().filter((d) => !env.hubs.has(d.key));

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
    const name = nameOf(stem.replace(/_/g, " "));
    const g = make("seq", env, scoped(folder, stem), stem, name, folder, [...same, ...plain], why("sequence", { stem, count: same.length + plain.length }));
    g.range = { label, from: Math.min(...ns), to: Math.max(...ns) };
    add(g);
  }

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
      const g = make("stem", env, scoped(ctx, w), w, nameOf(w), ctx, list, why("stem", { word: w, count: list.length }));
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
  return { groups: settled, rest: free() };
}

// The leftovers of an over-size level: one "Other" group once there are more than MAX, else loose rows.
function other(env: Env, rest: OrgDoc[], folder: string): G {
  const label = folderLabel(folder);
  const g = make("other", env, folder, label, label === "" ? "" : nameOf(label), folder, rest, why("other", { folder: label }, "low"));
  g.oversize = rest.length > env.layout.max;
  return g;
}

function buildTree(env: Env, docs: OrgDoc[]): { groups: G[]; loose: OrgDoc[] } {
  const { min, max, levels } = env.layout;
  const root: Node = { segs: [], docs: [], kids: new Map(), n: 0 };
  for (const d of docs) {
    let node = root;
    const segs = logicalFolders(d.path);
    segs.forEach((s, i) => {
      node = node.kids.get(s) ?? node.kids.set(s, { segs: segs.slice(0, i + 1), docs: [], kids: new Map(), n: 0 }).get(s)!;
    });
    node.docs.push(d);
  }
  const count = (n: Node): number => (n.n = n.docs.length + [...n.kids.values()].reduce((a, k) => a + count(k), 0));
  count(root);
  const all = (n: Node): OrgDoc[] => [...n.docs, ...[...n.kids.values()].flatMap(all)];
  // A folder with no documents of its own and one child is the same place as the child.
  const squash = (n: Node): Node => {
    let k = n;
    while (k.docs.length === 0 && k.kids.size === 1) {
      k = [...k.kids.values()][0];
    }
    return k;
  };

  const build = (node: Node, isRoot: boolean): { groups: G[]; loose: OrgDoc[] } => {
    const kids = [...node.kids.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, k]) => build(squash(k), false));
    const folder = node.segs.join("/");
    const childGroups = kids.flatMap((r) => r.groups);
    const loose = [...node.docs, ...kids.flatMap((r) => r.loose)];
    if (isRoot) {
      return { groups: childGroups, loose };
    }
    if (node.n < min) {
      return { groups: [], loose: all(node) };
    }
    const label = folderLabel(folder);
    const folderGroup = (docsIn: OrgDoc[]): G => make("folder", env, folder, label, nameOf(label), folder, docsIn, why("folder", { folder, count: node.n }));
    if (node.n <= max) {
      return { groups: [folderGroup(all(node))], loose: [] };
    }
    // Over MAX: its child groups become sub-groups and its own loose documents go through the name layer.
    const named = nameLayer(env, loose, folder, childGroups);
    const subs = [...childGroups, ...named.groups];
    if (subs.length === 0) {
      const g = folderGroup(all(node));
      g.oversize = true;
      g.why = why("oversize", { max }, "low");
      return { groups: [g], loose: [] };
    }
    if (levels >= 2 && !childGroups.some((c) => c.subs.length > 0)) {
      const spill = named.rest.length > max;
      const parent = folderGroup(spill ? [] : named.rest);
      parent.subs = spill ? [...subs, other(env, named.rest, folder)] : subs;
      return { groups: [parent], loose: [] };
    }
    if (named.rest.length > max) {
      return { groups: [...subs, other(env, named.rest, folder)], loose: [] };
    }
    return { groups: subs, loose: named.rest };
  };

  const top = build(root, true);
  const named = nameLayer(env, top.loose, "", top.groups);
  const groups = [...top.groups, ...named.groups];
  if (named.rest.length > max) {
    return { groups: [...groups, other(env, named.rest, "")], loose: [] };
  }
  return { groups, loose: named.rest };
}

function flatten(g: G, out: Array<{ g: G; parent?: string }>, parent?: string): void {
  out.push({ g, parent });
  g.subs.forEach((s) => flatten(s, out, g.id));
}

const manualName = (id: string): string => id.slice(id.indexOf(":manual:") + 8);

// Groups the documents of every project. `tags` is the merged dictionary (mergeDictionary).
export function organize(input: OrgDoc[], tags: TagDef[], opt: OrgOptions = {}, cfg: OrganizeConfig = {}): OrgResult {
  const ungrouped = (opt.ungrouped ?? []).map(globToRegExp);
  const manual = (opt.manual ?? []).map((g) => ({ name: g.name, res: g.match.map(globToRegExp) }));
  // Paths are read with "/" everywhere below, so Windows separators are turned into "/" here (keys stay as given).
  const slashed = (p: string): string => p.replace(/\\/g, "/");
  const docs = input
    .map((d) => (d.path.includes("\\") ? { ...d, path: slashed(d.path) } : d))
    .filter((d) => !ungrouped.some((r) => r.test(d.project + "/" + d.path)))
    .sort(byKey);
  const hubWords = opt.hubWords ?? 20000;
  const hubDocRefs = opt.hubDocRefs ?? 30;
  const hubs = new Set(docs.filter((d) => d.words >= hubWords || d.docRefs >= hubDocRefs).map((d) => d.key));
  const compiled: CompiledTags = compileTags(tags);
  const tagById = new Map(tags.map((t) => [t.id, t]));
  const untag = new Set((cfg.untag ?? []).map((u) => `${u.project}\t${slashed(u.path)}\t${u.tag.toLowerCase()}`));
  const known = new Set(tags.flatMap((t) => [t.id.toLowerCase(), t.label.toLowerCase()]));
  const unknownTags = docs.flatMap((d) => (d.tags ?? []).filter((n) => !known.has(n.toLowerCase())).map((tag) => ({ key: d.key, tag })));
  const tok = new Map(docs.map((d) => [d.key, fileTokens(d.path)]));
  const matches = new Map(
    docs.map((d) => [d.key, matchTags(subjectOf(d.path, d.title), compiled, d.tags).filter((m) => !untag.has(`${d.project}\t${d.path}\t${m.tagId.toLowerCase()}`))]),
  );
  const result: OrgResult = { groups: [], groupOf: new Map(), tagsOf: matches, docWhy: new Map(), hubs, stale: [], layouts: {}, unknownTags };
  const assignOf = new Map((cfg.assign ?? []).map((a) => [`${a.project}\t${slashed(a.path)}`, a.group]));
  const projects = [...new Set(docs.map((d) => d.project))].sort();

  for (const project of projects) {
    const mine = docs.filter((d) => d.project === project);
    const layout = layoutFor(mine.length, opt.previous?.[project]?.band, opt.previous?.[project]?.max);
    result.layouts[project] = { band: layout.band, min: layout.min, max: layout.max };
    const env: Env = { project, layout, tok, matches, tagById, hubs };

    // 1. Explicit layer: a placement by hand, then a rules-file group, then a group named in front matter.
    const explicit = new Map<string, { name: string; docs: OrgDoc[]; sources: Set<OrgSource> }>();
    const forced = new Map<string, string>();
    const pool: OrgDoc[] = [];
    for (const d of mine) {
      const placed = assignOf.get(`${d.project}\t${d.path}`);
      const rules = manual.find((g) => g.res.some((r) => r.test(d.project + "/" + d.path)))?.name;
      const claim = resolveByPrecedence<string>({
        override: placed?.includes(":manual:") ? manualName(placed) : undefined,
        rules,
        frontMatter: d.group?.trim() || undefined,
      });
      if (placed && !placed.includes(":manual:")) {
        forced.set(d.key, placed);
      }
      if (claim && !(placed && !placed.includes(":manual:"))) {
        const e = explicit.get(claim.value) ?? explicit.set(claim.value, { name: claim.value, docs: [], sources: new Set() }).get(claim.value)!;
        e.docs.push(d);
        e.sources.add(claim.source);
        if (claim.source === "frontMatter") {
          result.docWhy.set(d.key, why("frontMatterGroup", { group: claim.value }, "high", "frontMatter"));
        } else if (claim.source === "override") {
          result.docWhy.set(d.key, why("setByYou", {}, "high", "override"));
        }
      } else {
        pool.push(d);
      }
    }

    const tree = buildTree(env, pool);
    const roots: G[] = [...tree.groups];
    for (const e of [...explicit.values()].sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const source = (["override", "rules", "frontMatter"] as OrgSource[]).find((s) => e.sources.has(s))!;
      const g = make("manual", env, e.name, e.name, e.name, "", e.docs, why("manual", { name: e.name }, "high", source));
      roots.push(g);
    }
    const flat: Array<{ g: G; parent?: string }> = [];
    roots.forEach((g) => flatten(g, flat));

    // A placement by hand into a group the engine made.
    const byId = new Map(flat.map((f) => [f.g.id, f.g]));
    for (const [key, target] of [...forced].sort()) {
      const d = mine.find((x) => x.key === key)!;
      let dest = byId.get(target);
      if (!dest && target.startsWith(project + ":manual:")) {
        dest = make("manual", env, manualName(target), manualName(target), manualName(target), "", [], why("manual", { name: manualName(target) }, "high", "override"));
        byId.set(dest.id, dest);
        flat.push({ g: dest });
      }
      if (!dest) {
        result.stale.push({ kind: "assign", ref: d.path });
        continue;
      }
      flat.forEach((f) => (f.g.docs = f.g.docs.filter((x) => x.key !== key)));
      dest.docs.push(d);
      dest.docs.sort(byKey);
      result.docWhy.set(key, why("setByYou", {}, "high", "override"));
    }
    const live = flat.filter((f) => subtree(f.g).length > 0);

    // Names, tags, emoji and colour.
    const names = dedupNames(live.map(({ g }) => ({ id: g.id, name: g.name, kind: g.kind, folder: g.folder, range: g.range })));
    const picked = live.map(({ g }) => {
      const members = subtree(g).map((m) => matches.get(m.key) ?? []);
      if (g.tagId) {
        return pickGroupTag(members.map((ms) => ms.filter((m) => m.tagId === g.tagId)), [], compiled);
      }
      return pickGroupTag(members, matchTags({ folder: [], file: splitWords(g.rawName).map(stemWord), title: [] }, compiled), compiled);
    });
    const colours = assignColours(
      live.map(({ g, parent }, i) => {
        const t = picked[i]?.tag;
        return { id: g.id, parent: parent ?? project, tagColour: t && hasEffect(t, "colour") ? t.colour : undefined, tagLabel: t?.label };
      }),
    );
    live.forEach(({ g, parent }, i) => {
      const t = picked[i];
      const tag = t && hasEffect(t.tag, "emoji") ? t : undefined;
      const e = emojiWhy(tag, g.kind === "seq" ? "🔗" : "📁");
      const ov = cfg.groups?.[g.id];
      const clean = nameOf(g.rawName);
      const changed = ["folder", "other"].includes(g.kind) && clean.toLowerCase() !== g.rawName.toLowerCase().replace(/[_\-.]+/g, " ");
      const nameWhy = g.kind === "manual" ? why("manual", { name: g.name }, "high", g.why.source) : why(`name.${g.kind}${changed ? "Cleaned" : ""}`, { raw: g.rawName }, "medium");
      const col = colours.get(g.id)!;
      const members = subtree(g);
      const out: OrgGroup = {
        id: g.id,
        kind: g.kind,
        project,
        name: ov?.name ?? names.get(g.id)!,
        ...(g.range && { range: g.range }),
        folder: g.folder,
        ...(parent && { parent }),
        members: g.docs.map((d) => d.key),
        total: members.length,
        emoji: ov?.emoji ?? e.emoji,
        colour: ov?.colour && isAllowedColour(ov.colour) ? ov.colour : col.colour,
        ...(t && { tag: t.tag.id }),
        edited: Boolean(ov?.name || ov?.emoji || (ov?.colour && isAllowedColour(ov.colour))),
        oversize: g.oversize,
        why: g.why,
        nameWhy: ov?.name ? why("setByYou", {}, "high", "override") : nameWhy,
        emojiWhy: ov?.emoji ? why("setByYou", {}, "high", "override") : e.why,
        colourWhy: ov?.colour && isAllowedColour(ov.colour) ? why("setByYou", {}, "high", "override") : col.why,
      };
      result.groups.push(out);
      g.docs.forEach((d) => result.groupOf.set(d.key, g.id));
    });
  }
  for (const id of Object.keys(cfg.groups ?? {})) {
    if (!result.groups.some((g) => g.id === id)) {
      result.stale.push({ kind: "group", ref: id });
    }
  }
  for (const u of cfg.untag ?? []) {
    if (!docs.some((d) => d.project === u.project && d.path === slashed(u.path))) {
      result.stale.push({ kind: "untag", ref: u.path });
    }
  }
  result.groups.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return result;
}
