import defaultDict from "./needs-dictionary.json";

// Contexts: what the owner needs in hand to do a step (a phone, a computer, a console).
// A phrase dictionary maps words to contexts, like severity.json maps words to severity.
// No AI: every tag comes from a readable list the owner can edit in the rules file.
//
// A phrase names the contexts that can satisfy it ("testflight": iPhone or Mac). A step
// that matches several phrases needs one context from each phrase.

export interface NeedsContext {
  id: string;
  label: string;
  // Default time for a step that needs this context and gives no time of its own.
  minutes?: number;
}

export interface NeedsDict {
  version: number;
  defaultMinutes: number;
  contexts: NeedsContext[];
  // Lower-case phrase to context ids; an empty list switches a shipped phrase off.
  phrases: Record<string, string[]>;
}

export const DEFAULT_NEEDS: NeedsDict = defaultDict as unknown as NeedsDict;

// A team's dictionary may add or replace contexts (by id) and phrases (by phrase).
export function mergeNeeds(over?: Partial<NeedsDict>): NeedsDict {
  if (!over || typeof over !== "object") {
    return DEFAULT_NEEDS;
  }
  const byId = new Map(DEFAULT_NEEDS.contexts.map((c) => [c.id, c]));
  for (const c of Array.isArray(over.contexts) ? over.contexts : []) {
    if (c && typeof c.id === "string" && typeof c.label === "string") {
      const minutes = typeof c.minutes === "number" && Number.isFinite(c.minutes) && c.minutes > 0 ? c.minutes : undefined;
      byId.set(c.id, { ...byId.get(c.id), id: c.id, label: c.label, minutes: minutes ?? byId.get(c.id)?.minutes });
    }
  }
  const phrases: Record<string, string[]> = { ...DEFAULT_NEEDS.phrases };
  for (const [p, ids] of Object.entries(over.phrases && typeof over.phrases === "object" ? over.phrases : {})) {
    if (p.trim() !== "" && Array.isArray(ids)) {
      phrases[p.toLowerCase()] = ids.filter((x): x is string => typeof x === "string");
    }
  }
  const mins = typeof over.defaultMinutes === "number" && over.defaultMinutes > 0 ? over.defaultMinutes : DEFAULT_NEEDS.defaultMinutes;
  return { version: DEFAULT_NEEDS.version, defaultMinutes: mins, contexts: [...byId.values()], phrases };
}

// One group: the contexts of which at least one must be in hand.
export type NeedGroup = string[];

// A hyphen joins words ("pixel-perfect"), so it is part of a word.
const isWordChar = (c: string | undefined): boolean => c !== undefined && /[a-z0-9-]/.test(c);

// Where the phrase stands as whole words in the text ("mac" is not in "machine").
function findPhrase(text: string, phrase: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (phrase === "") {
    return out;
  }
  for (let i = text.indexOf(phrase); i >= 0; i = text.indexOf(phrase, i + 1)) {
    if (!isWordChar(text[i - 1]) && !isWordChar(text[i + phrase.length])) {
      out.push([i, i + phrase.length]);
    }
  }
  return out;
}

// Drops a group when another group is a subset of it: satisfying the smaller one already
// satisfies the larger ("iPhone" makes "iPhone or Mac" redundant).
function reduce(groups: NeedGroup[]): NeedGroup[] {
  const uniq = new Map(groups.map((g) => [[...g].sort().join("|"), [...g].sort()]));
  const all = [...uniq.values()];
  return all.filter((g) => !all.some((o) => o !== g && o.every((x) => g.includes(x))));
}

// The groups a text needs. Only context ids the dictionary knows are kept. Phrases joined
// by "or" or "/" ("iPhone or Android") form one group: either one will do.
export function matchNeeds(text: string, dict: NeedsDict = DEFAULT_NEEDS): NeedGroup[] {
  const t = text.toLowerCase();
  const known = new Set(dict.contexts.map((c) => c.id));
  const found: Array<{ start: number; end: number; ids: string[] }> = [];
  for (const [phrase, ids] of Object.entries(dict.phrases)) {
    const g = ids.filter((id) => known.has(id));
    if (g.length > 0) {
      for (const [start, end] of findPhrase(t, phrase.trim().toLowerCase())) {
        found.push({ start, end, ids: g });
      }
    }
  }
  found.sort((a, b) => a.start - b.start || a.end - b.end);
  const groups: NeedGroup[] = [];
  let prev: { end: number } | undefined;
  for (const f of found) {
    if (prev && groups.length > 0 && /^\s*(?:or|\/)\s*$/.test(t.slice(prev.end, Math.max(prev.end, f.start))) && f.start >= prev.end) {
      groups[groups.length - 1] = [...new Set([...groups[groups.length - 1], ...f.ids])];
    } else {
      groups.push([...f.ids]);
    }
    prev = f;
  }
  return reduce(groups);
}

// The groups of one step. A "Needs" table cell is read first and alone; else the step's
// own text; else the heading it sits under (a document often groups its steps by sitting).
export function stepNeeds(step: { text: string; heading: string; needsCell?: string }, dict: NeedsDict = DEFAULT_NEEDS): NeedGroup[] {
  if (step.needsCell) {
    const direct = matchNeeds(step.needsCell, dict);
    if (direct.length > 0) {
      return direct;
    }
  }
  const own = matchNeeds(step.text, dict);
  return own.length > 0 ? own : matchNeeds(step.heading, dict);
}

// "4-minute wait", "about 30 min", "1.5 hours": the minutes a step says it takes.
export function timeHint(text: string): number | undefined {
  const m = /(\d+(?:\.\d+)?)\s*-?\s*(minutes?|mins?|hours?|hrs?)\b/i.exec(text);
  if (!m) {
    return undefined;
  }
  const n = parseFloat(m[1]);
  return Math.round(/^h/i.test(m[2]) ? n * 60 : n);
}

// Minutes for a step: its own hint, else the longest default among the contexts it needs
// (for each group, the quickest context that can satisfy it), else the dictionary default.
export function stepMinutes(text: string, groups: NeedGroup[], dict: NeedsDict = DEFAULT_NEEDS): number {
  const hint = timeHint(text);
  if (hint !== undefined) {
    return hint;
  }
  const mins = new Map(dict.contexts.map((c) => [c.id, c.minutes ?? dict.defaultMinutes]));
  const per = groups.map((g) => Math.min(...g.map((id) => mins.get(id) ?? dict.defaultMinutes)));
  return per.length > 0 ? Math.max(...per) : dict.defaultMinutes;
}

// A step can be done when every group has a context in hand.
export function canDo(groups: NeedGroup[], have: ReadonlySet<string>): boolean {
  return groups.every((g) => g.some((id) => have.has(id)));
}
