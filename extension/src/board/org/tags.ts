// The tag dictionary: shipped defaults, the merge with a project's `organize.tags`, and matching with explanations.

import defaultDict from "./organize-dictionary.json";
import { isAllowedColour } from "./appearance";
import type { OrgColour, TagHit, TagMatch } from "./orgTypes";
import { baseName, logicalFolders, splitWords, stemWord, titleWords } from "./tokens";

export type TagWhere = "folder" | "file" | "title";
export type TagEffect = "group" | "name" | "emoji" | "colour";

export interface TagDef {
  id: string;
  label: string;
  emoji: string;
  // One of the eight names, or a hex that is not red.
  colour: OrgColour | string;
  // Whole words; matched after the plural and -ing/-ed strip, on both sides.
  patterns: string[];
  // Default: all three.
  where?: TagWhere[];
  // Default: all four.
  effects?: TagEffect[];
}

// A project's changes to the dictionary (the `organize.tags` key of the rules file).
export interface TagsConfig {
  add?: TagDef[];
  replace?: Record<string, Partial<TagDef>>;
  off?: string[];
  // Tag ids in priority order; they win ties.
  order?: string[];
}

export interface Refused {
  id: string;
  reason: "colour" | "emoji" | "invalid";
}

export const DEFAULT_TAGS: TagDef[] = defaultDict as TagDef[];

const RED_EMOJI = ["🔴", "❗", "🚨", "⛔", "🛑", "🔥", "🐞"];

// Hue in degrees of "#rrggbb"; undefined for greys.
function hueOf(hex: string): number | undefined {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0 || max === 0) {
    return undefined;
  }
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function refusal(t: TagDef): Refused["reason"] | undefined {
  if (!t.id || !t.label || !Array.isArray(t.patterns)) {
    return "invalid";
  }
  if (RED_EMOJI.some((e) => t.emoji.includes(e))) {
    return "emoji";
  }
  if (isAllowedColour(t.colour)) {
    return undefined;
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(t.colour)) {
    return "colour";
  }
  const h = hueOf(t.colour);
  if (h !== undefined && (h >= 330 || h <= 20)) {
    return "colour";
  }
  // Readable on white and on #1e1e1e: luminance between 0.139 and 0.30 gives 3:1 against both.
  const l = luminance(t.colour);
  return l < 0.139 || l > 0.3 ? "colour" : undefined;
}

// Shipped tags with a project's changes applied. Order: the user's `order`, then the user's own tags, then shipped tags.
export function mergeDictionary(cfg: TagsConfig = {}, shipped: TagDef[] = DEFAULT_TAGS): { tags: TagDef[]; refused: Refused[] } {
  const refused: Refused[] = [];
  const off = new Set(cfg.off ?? []);
  const accept = (t: TagDef, fallback?: TagDef): TagDef | undefined => {
    const reason = refusal(t);
    if (reason) {
      refused.push({ id: t.id, reason });
      return fallback;
    }
    return t;
  };
  const base = shipped.filter((t) => !off.has(t.id)).map((t) => {
    const patch = cfg.replace?.[t.id];
    return patch ? accept({ ...t, ...patch, id: t.id }, t) : t;
  }).filter((t): t is TagDef => t !== undefined);
  const own = (cfg.add ?? []).filter((t) => !off.has(t.id) && !base.some((b) => b.id === t.id)).map((t) => accept(t)).filter((t): t is TagDef => t !== undefined);
  const rest = [...own, ...base];
  const first = (cfg.order ?? []).map((id) => rest.find((t) => t.id === id)).filter((t): t is TagDef => t !== undefined);
  return { tags: [...first, ...rest.filter((t) => !first.includes(t))], refused };
}

export interface CompiledTags {
  tags: TagDef[];
  // Stemmed pattern to the tags (by position) that hold it.
  index: Map<string, number[]>;
}

export function compileTags(tags: TagDef[]): CompiledTags {
  const index = new Map<string, number[]>();
  tags.forEach((t, i) => {
    for (const p of t.patterns) {
      const k = stemWord(p);
      const list = index.get(k) ?? index.set(k, []).get(k)!;
      if (!list.includes(i)) {
        list.push(i);
      }
    }
  });
  return { tags, index };
}

export interface TagSubject {
  folder: string[];
  file: string[];
  title: string[];
}

export function subjectOf(path: string, title?: string): TagSubject {
  return {
    folder: logicalFolders(path).flatMap(splitWords).map(stemWord),
    file: splitWords(baseName(path)).map(stemWord),
    title: titleWords(title),
  };
}

const WEIGHT: Record<TagWhere, number> = { folder: 3, file: 3, title: 2 };
// A tag applies to a document at this score.
export const APPLY_SCORE = 3;

// Tags that apply to a subject, best first; ties go to the tag listed first. Each distinct word counts once, at its best place.
// `named` are tags the author wrote down (front matter): they apply at once.
export function matchTags(subject: TagSubject, c: CompiledTags, named: string[] = []): TagMatch[] {
  const hits = new Map<number, TagHit[]>();
  const add = (where: TagWhere, words: string[]): void => {
    for (const w of words) {
      for (const i of c.index.get(w) ?? []) {
        if ((c.tags[i].where ?? ["folder", "file", "title"]).includes(where)) {
          (hits.get(i) ?? hits.set(i, []).get(i)!).push({ where, word: w });
        }
      }
    }
  };
  add("folder", subject.folder);
  add("file", subject.file);
  add("title", subject.title);
  const out: Array<TagMatch & { pos: number }> = [];
  const wanted = new Set(named.map((n) => n.toLowerCase()));
  c.tags.forEach((t, pos) => {
    const h = hits.get(pos) ?? [];
    const best = new Map<string, number>();
    h.forEach((x) => best.set(x.word, Math.max(best.get(x.word) ?? 0, WEIGHT[x.where])));
    const score = [...best.values()].reduce((a, b) => a + b, 0);
    const byAuthor = wanted.has(t.id.toLowerCase()) || wanted.has(t.label.toLowerCase());
    if (byAuthor) {
      out.push({ tagId: t.id, score: 10, hits: h, pos, why: { key: "releaseBoard.org.why.frontMatterTag", params: { tag: t.label }, source: "frontMatter", confidence: "high" } });
    } else if (score >= APPLY_SCORE) {
      const words = h.map((x) => `${x.where}: ${x.word}`).join(", ");
      out.push({ tagId: t.id, score, hits: h, pos, why: { key: "releaseBoard.org.tag.matched", params: { tag: t.label, words }, source: "inference", confidence: score >= 6 ? "high" : "medium" } });
    }
  });
  return out.sort((a, b) => b.score - a.score || a.pos - b.pos).map(({ pos: _pos, ...m }) => m);
}

export function hasEffect(t: TagDef, e: TagEffect): boolean {
  return (t.effects ?? ["group", "name", "emoji", "colour"]).includes(e);
}

