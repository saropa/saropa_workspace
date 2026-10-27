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
  return over ? { ...DEFAULT_SEVERITY, ...over } : DEFAULT_SEVERITY;
}

function count(text: string, phrase: string, negation: string[]): number {
  const t = text.toLowerCase();
  const p = phrase.toLowerCase();
  let n = 0;
  for (let i = t.indexOf(p); i >= 0; i = t.indexOf(p, i + p.length)) {
    const pre = t.slice(Math.max(0, i - 12), i);
    if (!negation.some((x) => pre.endsWith(x) || pre.slice(-(x.length + 2)).includes(x))) {
      n += 1;
    }
  }
  return n;
}

export function scoreDocument(text: string, path: string, dict: SeverityDict = DEFAULT_SEVERITY): { severity: Severity; audience: Audience } {
  const stripped = text.replace(/```[\s\S]*?```/g, "");
  const lines = stripped.split(/\r?\n/);
  const name = path.slice(path.lastIndexOf("/") + 1);
  const title = name.replace(/[_-]/g, " ") + " " + (lines[0] ?? "");
  const head = lines.slice(1, 20).join("\n");
  const body = lines.slice(20).join("\n");
  const words = Math.max(1, stripped.split(/\s+/).filter(Boolean).length);
  const w = dict.weights;
  const totals: Record<string, number> = {};
  for (const [level, phrases] of Object.entries(dict.phrases)) {
    let s = 0;
    for (const ph of phrases ?? []) {
      const a = Math.min(count(title, ph, dict.negation), w.perPhraseCap) * w.title + Math.min(count(head, ph, dict.negation), w.perPhraseCap) * w.head;
      const b = count(body, ph, dict.negation);
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
  const audience: Audience = dict.audience.pro.some((p) => lower.includes(p)) ? "pro" : "all";
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
  return STOPS[profile].has(level);
}
