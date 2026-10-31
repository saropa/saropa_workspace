// Auto-grouping: the user's own groups first, then folders, then file-name stems and numbered
// families, then tags. Pure and deterministic: the same documents give the same groups and
// ids whatever order they arrive in. Ids come from the group's own key (a folder path, a stem,
// a tag), never from one of its members, so fold state and overrides can attach to them.

import { globToRegExp } from "../glob";
import { tidyGroupName } from "../groups";
import { assignColours, emojiWhy, isAllowedColour, pickGroupTag } from "./appearance";
import { Env, G, Node, byKey, cleanerOf, folderLabel, make, push, subtree, why } from "./autoGroupTypes";
import { nameLayer } from "./autoGroupName";
import { layoutFor } from "./layout";
import { dedupNames } from "./naming";
import type { OrgDoc, OrgGroup, OrgOptions, OrgResult, OrgSource } from "./orgTypes";
import { OrganizeConfig, resolveByPrecedence } from "./overrides";
import { CompiledTags, TagDef, compileTags, hasEffect, matchTags, subjectOf } from "./tags";
import { fileTokens, logicalFolders, splitWords, stemWord } from "./tokens";


// The leftovers of an over-size level: one "Other" group once there are more than MAX, else loose rows.
function other(env: Env, rest: OrgDoc[], folder: string): G {
  const label = folderLabel(folder);
  const g = make("other", env, folder, label, label === "" ? "" : env.nameOf(label), folder, rest, why("other", { folder: label }, "low"));
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
    const folderGroup = (docsIn: OrgDoc[]): G => make("folder", env, folder, label, env.nameOf(label), folder, docsIn, why("folder", { folder, count: node.n }));
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

const manualName = (id: string): string => tidyGroupName(id.slice(id.indexOf(":manual:") + 8));

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
  const nameOf = cleanerOf(opt.naming);
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

  // The size of the board decides the layout: every project shown counts, so the groups of one project never fold differently from another's.
  const layout = layoutFor(docs.length, Object.values(opt.previous ?? {})[0]?.band, Object.values(opt.previous ?? {})[0]?.max);

  // 1. Explicit layer, across all projects: a placement by hand, then a rules-file group, then a group named in front matter.
  // A group listed by hand stays one group when its globs name several projects; names equal after tidying are one group.
  const explicit = new Map<string, { name: string; docs: OrgDoc[]; sources: Set<OrgSource> }>();
  const forced = new Map<string, string>();
  const poolOf = new Map<string, OrgDoc[]>();
  for (const d of docs) {
    const placed = assignOf.get(`${d.project}\t${d.path}`);
    const rules = manual.find((g) => g.res.some((r) => r.test(d.project + "/" + d.path)))?.name;
    const claim = resolveByPrecedence<string>({
      override: placed?.includes(":manual:") ? manualName(placed) : undefined,
      rules: rules === undefined ? undefined : tidyGroupName(rules),
      frontMatter: d.group ? tidyGroupName(d.group) || undefined : undefined,
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
      push(poolOf, d.project, d);
    }
  }

  for (const project of projects) {
    const mine = docs.filter((d) => d.project === project);
    result.layouts[project] = { band: layout.band, min: layout.min, max: layout.max };
    const env: Env = { project, layout, tok, matches, tagById, hubs, nameOf };
    const pool = poolOf.get(project) ?? [];

    const tree = buildTree(env, pool);
    const roots: G[] = [...tree.groups];
    for (const e of [...explicit.values()].sort((a, b) => (a.name < b.name ? -1 : 1))) {
      // The group sits in the first project (by id) of its documents.
      if (e.docs.map((d) => d.project).sort()[0] !== project) {
        continue;
      }
      const source = (["override", "rules", "frontMatter"] as OrgSource[]).find((s) => e.sources.has(s))!;
      const g = make("manual", env, e.name, e.name, e.name, "", e.docs, why("manual", { name: e.name }, "high", source));
      roots.push(g);
    }
    const flat: Array<{ g: G; parent?: string }> = [];
    roots.forEach((g) => flatten(g, flat));

    // A placement by hand into a group the engine made.
    const byId = new Map(flat.map((f) => [f.g.id, f.g]));
    for (const [key, target] of [...forced].sort()) {
      const d = mine.find((x) => x.key === key);
      if (!d) {
        continue;
      }
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
    const names = dedupNames(live.map(({ g }) => ({ id: g.id, name: g.name, kind: g.kind, folder: g.folder, range: g.range })), nameOf);
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
        ...(g.kind === "manual" && { stored: g.rawName }),
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
