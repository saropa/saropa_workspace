import defaultDict from "./severity.json";

// Severity of a document, from a phrase dictionary. No AI: phrases found in the title
// (weight 3), the first lines (weight 2) and, when dense enough, the body (weight 1).
// Negated phrases ("no refund") do not count; code fences are stripped. Ported from the
// prototype (scripts/release-board/score.py), which the golden test compares against.

export type Severity = "extreme" | "critical" | "high" | "medium" | "low";
export type Audience = "pro" | "all";

export interface SeverityDict {
  threshold: number;
  weights: { title: number; head: number; body: number; perPhraseCap: number };
  minBodyDensity: number;
  negation: string[];
  phrases: Partial<Record<Severity, string[]>>;
  audience: { pro: string[] };
}

export const DEFAULT_SEVERITY: SeverityDict = defaultDict as unknown as SeverityDict;

// A user dictionary may replace any section; the rest stays as shipped.
export function mergeDict(over?: Partial<SeverityDict>): SeverityDict {
  if (!over || typeof over !== "object") {
    return DEFAULT_SEVERITY;
  }
  return {
    ...DEFAULT_SEVERITY,
    ...over,
    weights: { ...DEFAULT_SEVERITY.weights, ...(over.weights ?? {}) },
    audience: { ...DEFAULT_SEVERITY.audience, ...(over.audience ?? {}) },
    phrases: { ...DEFAULT_SEVERITY.phrases, ...(over.phrases ?? {}) },
  };
}

export function asProfile(v: unknown): Profile {
  return v === "rush" || v === "deliberate" || v === "zero" ? v : "deliberate";
}

const escapeRe = (s: string): string => s.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");

// "no refund" is negated, "casino refund" is not: a negation word must stand alone.
function negationRes(negation: string[]): RegExp[] {
  return negation.map((x) => {
    const w = escapeRe(x.trim());
    return new RegExp(x.trim().startsWith("n't") ? `${w}\\s+$` : `(?:^|[^a-z0-9])${w}\\s+$`);
  });
}

// A phrase must start at a word boundary ("rating" is not in "generating"); it may end
// inside a word so stems such as "overwrit" still match.
function count(text: string, phrase: string, negation: RegExp[]): number {
  const t = text.toLowerCase();
  const p = phrase.toLowerCase();
  let n = 0;
  for (let i = t.indexOf(p); i >= 0; i = t.indexOf(p, i + p.length)) {
    if (i > 0 && /[a-z0-9]/.test(t[i - 1])) {
      continue;
    }
    const pre = t.slice(Math.max(0, i - 14), i);
    if (!negation.some((re) => re.test(pre))) {
      n += 1;
    }
  }
  return n;
}

export function scoreDocument(text: string, path: string, dict: SeverityDict = DEFAULT_SEVERITY): { severity: Severity; audience: Audience } {
  const stripped = text.replace(/```[\s\S]*?```/g, "");
  // Front matter and blank lines are not the title.
  const lines = stripped.replace(/^\uFEFF?(?:---\r?\n[\s\S]*?\r?\n---\r?\n)?/, "").replace(/^(?:\s*\r?\n)+/, "").split(/\r?\n/);
  const name = path.slice(path.lastIndexOf("/") + 1);
  const title = name.replace(/[_-]/g, " ") + " " + (lines[0] ?? "");
  const head = lines.slice(1, 20).join("\n");
  const body = lines.slice(20).join("\n");
  const words = Math.max(1, stripped.split(/\s+/).filter(Boolean).length);
  const w = dict.weights;
  const neg = negationRes(dict.negation);
  const totals: Record<string, number> = {};
  for (const [level, phrases] of Object.entries(dict.phrases)) {
    let s = 0;
    for (const ph of phrases ?? []) {
      const a = Math.min(count(title, ph, neg), w.perPhraseCap) * w.title + Math.min(count(head, ph, neg), w.perPhraseCap) * w.head;
      const b = count(body, ph, neg);
      s += a + ((b * 1000) / words >= dict.minBodyDensity ? Math.min(b, w.perPhraseCap) * w.body : 0);
    }
    totals[level] = s;
  }
  let severity: Severity = "medium";
  const top = (["extreme", "critical", "high"] as Severity[]).find((l) => (totals[l] ?? 0) >= dict.threshold);
  if (top) {
    severity = top;
  } else if ((totals.low ?? 0) >= dict.threshold && (totals.low ?? 0) > Math.max(totals.extreme ?? 0, totals.critical ?? 0, totals.high ?? 0)) {
    severity = "low";
  }
  const lower = stripped.toLowerCase();
  const audience: Audience = dict.audience.pro.some((p) => lower.includes(p.toLowerCase())) ? "pro" : "all";
  return { severity, audience };
}

// Profiles decide which severities stop a release.
export type Profile = "rush" | "deliberate" | "zero";

const STOPS: Record<Profile, ReadonlySet<Severity>> = {
  rush: new Set<Severity>(["extreme", "critical"]),
  deliberate: new Set<Severity>(["extreme", "critical", "high"]),
  zero: new Set<Severity>(["extreme", "critical", "high", "medium"]),
};

export function stops(profile: Profile, level: Severity): boolean {
  return (STOPS[asProfile(profile)]).has(level);
}
