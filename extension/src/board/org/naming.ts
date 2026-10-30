// Group names: clean a folder, stem or tag text into a short sentence-case title, then make names unique.

import type { SeqRange } from "./orgTypes";
import { CONTAINER, KIND } from "./tokens";

export const ACRONYMS = ["API", "UI", "UX", "iOS", "SQL", "AI", "MCP", "PR", "CI", "QA", "GDPR", "IAP"];
export const MAX_NAME = 32;

const DATE = /(?<!\d)(?:\d{4}[-_]\d{2}[-_]\d{2}|\d{8}|(?:19|20)\d{2}(?:[-_]\d{2})?)(?!\d)/g;
const SEQ = /\b(?:v\d+|m\d+|(?:phase|part|pt|step|stage)\s?(?:\d+|[a-z]))\b/gi;

export function isContainerOnly(name: string): boolean {
  return CONTAINER.has(name.trim().toLowerCase());
}

// Dates, leading order numbers, leading kind words and version or sequence tokens removed; sentence case; acronyms kept.
export function cleanName(raw: string, acronyms: string[] = ACRONYMS): string {
  const canon = new Map(acronyms.map((a) => [a.toLowerCase(), a]));
  // A whole word that is a known acronym (iOS) is kept before the camel-case split can break it.
  const spaced = raw
    .replace(DATE, " ")
    .replace(/[[\](){}]/g, " ")
    .replace(/[_\-.]+/g, " ")
    .split(/\s+/)
    .map((w) => (canon.has(w.toLowerCase()) ? w : w.replace(/([\p{Ll}\d])(\p{Lu})/gu, "$1 $2")))
    .join(" ");
  const stripped = spaced.replace(SEQ, " ").replace(/^\s*\d{1,3}\s+(?=\D)/, "");
  const words = stripped.split(/\s+/).filter(Boolean);
  while (words.length > 1 && KIND.has(words[0].toLowerCase())) {
    words.shift();
  }
  const cased = words.map((w, i) => {
    const known = canon.get(w.toLowerCase());
    if (known) {
      return known;
    }
    if (/^\p{Lu}{2,5}$/u.test(w)) {
      return w;
    }
    const lower = w.toLowerCase();
    return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
  });
  return cased.join(" ");
}

export function clipName(s: string, max = MAX_NAME): string {
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, max - 1).join("") + "…";
}

type Translate = (key: string, params: Record<string, string | number>) => string;

// The name as shown: files groups read "Touches x", sequence families carry their range ("Share keys · phases 1-4"). Not clipped.
export function displayName(g: { name: string; kind: string; range?: SeqRange }, t: Translate): string {
  const base = g.kind === "files" ? t("releaseBoard.org.name.touches", { file: g.name }) : g.kind === "other" ? t(g.name === "" ? "releaseBoard.org.name.otherRoot" : "releaseBoard.org.name.other", { folder: g.name }) : g.name;
  return g.range ? `${base} · ${t(`releaseBoard.org.range.${g.range.label}`, { from: g.range.from, to: g.range.to })}` : base;
}

export interface NameItem {
  id: string;
  name: string;
  kind: string;
  folder: string;
  range?: SeqRange;
}

// Equal names inside a project get the nearest differing parent folder after a middle dot, then a number. Never brackets.
export function dedupNames(items: NameItem[]): Map<string, string> {
  const out = new Map(items.map((i) => [i.id, i.name]));
  const sig = (i: NameItem): string => `${out.get(i.id)!.toLowerCase()}|${i.kind === "files" || i.kind === "other" ? i.kind : ""}${i.range ? i.range.label + i.range.from + "-" + i.range.to : ""}`;
  const clashes = (): NameItem[][] => {
    const by = new Map<string, NameItem[]>();
    items.forEach((i) => (by.get(sig(i)) ?? by.set(sig(i), []).get(sig(i))!).push(i));
    return [...by.values()].filter((l) => l.length > 1).map((l) => l.sort((a, b) => (a.id < b.id ? -1 : 1)));
  };
  for (const list of clashes()) {
    const segs = (i: NameItem): string[] => i.folder.split("/").filter(Boolean);
    for (let k = 1; k <= 6; k++) {
      const pick = (i: NameItem): string => {
        const s = segs(i);
        return cleanName(s[s.length - k - (i.kind === "folder" ? 1 : 0)] ?? "");
      };
      const picks = list.map(pick);
      if (picks.some((p) => p !== picks[0])) {
        list.forEach((i, n) => picks[n] !== "" && out.set(i.id, `${out.get(i.id)} · ${picks[n]}`));
        break;
      }
    }
  }
  const used = new Set([...out.values()].map((v) => v.toLowerCase()));
  for (const list of clashes()) {
    for (const i of list.slice(1)) {
      let n = 2;
      while (used.has(`${out.get(i.id)} ${n}`.toLowerCase())) {
        n += 1;
      }
      out.set(i.id, `${out.get(i.id)} ${n}`);
      used.add(out.get(i.id)!.toLowerCase());
    }
  }
  return out;
}
