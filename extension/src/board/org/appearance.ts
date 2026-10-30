// Emoji and colour of a group: from its tag when it has one, else a stable colour from its id.

import type { OrgColour, TagMatch, Why } from "./orgTypes";
import type { CompiledTags, TagDef } from "./tags";

// Eight hues, none red (red is for blockers), each at least 3:1 against white and #1e1e1e.
export const COLOUR_HEX: Record<OrgColour, string> = {
  teal: "#138a7e",
  sky: "#1a7fb0",
  indigo: "#5a64c8",
  orchid: "#9b5bbf",
  olive: "#6f7d1c",
  ochre: "#9a6a12",
  slate: "#5f7184",
  pine: "#3d8a4a",
};
const NAMES = Object.keys(COLOUR_HEX) as OrgColour[];

export function isAllowedColour(c: string): c is OrgColour {
  return Object.prototype.hasOwnProperty.call(COLOUR_HEX, c);
}

// Stable 32-bit hash (FNV-1a).
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

export interface GroupTag {
  tag: TagDef;
  count: number;
  total: number;
  word: string;
}

// The tag that applies to at least half the members, else the tag of the group's name, else none.
export function pickGroupTag(memberMatches: TagMatch[][], nameMatches: TagMatch[], c: CompiledTags): GroupTag | undefined {
  const total = memberMatches.length;
  const count = new Map<string, number>();
  const words = new Map<string, Map<string, number>>();
  for (const ms of memberMatches) {
    for (const m of ms) {
      count.set(m.tagId, (count.get(m.tagId) ?? 0) + 1);
      const w = words.get(m.tagId) ?? words.set(m.tagId, new Map()).get(m.tagId)!;
      for (const h of m.hits) {
        w.set(h.word, (w.get(h.word) ?? 0) + 1);
      }
    }
  }
  const topWord = (id: string): string => [...(words.get(id) ?? [])].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
  const ranked = c.tags.map((t, pos) => ({ t, pos, n: count.get(t.id) ?? 0 })).filter((x) => x.n * 2 >= total && x.n > 0).sort((a, b) => b.n - a.n || a.pos - b.pos);
  if (ranked.length > 0) {
    return { tag: ranked[0].t, count: ranked[0].n, total, word: topWord(ranked[0].t.id) };
  }
  const byName = nameMatches[0] && c.tags.find((t) => t.id === nameMatches[0].tagId);
  return byName ? { tag: byName, count: 0, total, word: nameMatches[0].hits[0]?.word ?? "" } : undefined;
}

export function emojiWhy(g: GroupTag | undefined, fallback: string): { emoji: string; why: Why } {
  if (!g) {
    return { emoji: fallback, why: { key: "releaseBoard.org.emoji.default", params: { emoji: fallback }, source: "inference", confidence: "low" } };
  }
  return { emoji: g.tag.emoji, why: { key: "releaseBoard.org.emoji.tag", params: { emoji: g.tag.emoji, tag: g.tag.label, word: g.word, count: g.count, total: g.total }, source: "inference", confidence: "medium" } };
}

// Colours for groups that share a parent: a tag's colour as it is; otherwise a hash of the id, moved to the next hue no sibling uses.
export function assignColours(groups: Array<{ id: string; parent: string; tagColour?: string; tagLabel?: string }>): Map<string, { colour: string; why: Why }> {
  const out = new Map<string, { colour: string; why: Why }>();
  const siblings = new Map<string, typeof groups>();
  for (const g of [...groups].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    (siblings.get(g.parent) ?? siblings.set(g.parent, []).get(g.parent)!).push(g);
  }
  for (const list of siblings.values()) {
    const used = new Set(list.map((g) => g.tagColour).filter(Boolean));
    for (const g of list) {
      if (g.tagColour) {
        out.set(g.id, { colour: g.tagColour, why: { key: "releaseBoard.org.colour.tag", params: { tag: g.tagLabel ?? "" }, source: "inference", confidence: "medium" } });
        continue;
      }
      let i = hash(g.id) % NAMES.length;
      for (let step = 0; step < NAMES.length && used.has(NAMES[i]); step++) {
        i = (i + 1) % NAMES.length;
      }
      used.add(NAMES[i]);
      out.set(g.id, { colour: NAMES[i], why: { key: "releaseBoard.org.colour.auto", params: {}, source: "inference", confidence: "low" } });
    }
  }
  return out;
}
