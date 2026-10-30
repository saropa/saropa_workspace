// Path-list fixtures and helpers for the auto-organization tests.

import assert from "node:assert/strict";
import { layoutFor } from "../../../board/org/layout";
import enJson from "../../../i18n/locales/en.json";
import { OrgDoc, OrgGroup, OrgResult } from "../../../board/org/orgTypes";
import { organize } from "../../../board/org/autoGroup";
import { OrgOptions } from "../../../board/org/orgTypes";
import { OrganizeConfig } from "../../../board/org/overrides";
import { DEFAULT_TAGS, TagDef } from "../../../board/org/tags";

export function doc(project: string, p: string, extra: Partial<OrgDoc> = {}): OrgDoc {
  return { key: `${project}\t${p}`, project, path: p, words: 100, docRefs: 0, sourceFiles: [], ...extra };
}

export const docs = (project: string, paths: string[]): OrgDoc[] => paths.map((p) => doc(project, p));

const en = enJson as Record<string, string>;
export const enKeys = new Set(Object.keys(en));

// Fills {param} placeholders from en.json, like the real translator.
export function t(key: string, params: Record<string, string | number> = {}): string {
  return (en[key] ?? key).replace(/\{(\w+)\}/g, (_m, k: string) => String(params[k] ?? ""));
}

export function run(input: OrgDoc[], opt: OrgOptions = {}, cfg: OrganizeConfig = {}, tags: TagDef[] = DEFAULT_TAGS): OrgResult {
  return organize(input, tags, opt, cfg);
}

export const byId = (r: OrgResult, id: string): OrgGroup | undefined => r.groups.find((g) => g.id === id);

// Tiny deterministic generator so fixtures never use Math.random.
export function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function shuffled<T>(list: T[], seed: number): T[] {
  const rnd = lcg(seed);
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Rules that hold for every result: one group per document at most, no group under the minimum, every result explained.
export function checkProperties(r: OrgResult, input: OrgDoc[]): void {
  const seen = new Set<string>();
  const perProject = new Map<string, number>();
  input.forEach((d) => perProject.set(d.project, (perProject.get(d.project) ?? 0) + 1));
  for (const g of r.groups) {
    for (const m of g.members) {
      assert.equal(seen.has(m), false, `${m} is in two groups`);
      seen.add(m);
    }
    const min = layoutFor(perProject.get(g.project)!).min;
    if (g.kind === "seq") {
      assert.ok(g.total >= 2, `${g.id} is a group of one`);
    } else if (g.kind !== "manual" && g.kind !== "other") {
      assert.ok(g.total >= min, `${g.id} has ${g.total}, under ${min}`);
    }
    for (const w of [g.why, g.nameWhy, g.emojiWhy, g.colourWhy]) {
      assert.ok(enKeys.has(w.key), `missing text for ${w.key}`);
    }
    assert.ok(g.id.startsWith(g.project + ":"));
    if (g.parent) {
      assert.equal(r.groups.find((p) => p.id === g.parent)?.parent, undefined, "more than two levels");
    }
  }
  for (const ms of r.tagsOf.values()) {
    ms.forEach((m) => assert.ok(enKeys.has(m.why.key)));
  }
}


// Generated documents; `projects` is how many projects they spread over (1 puts all of them in one).
export function generated(n: number, projects = 3): OrgDoc[] {
  const rnd = lcg(7);
  const words = ["payments", "sync", "login", "release", "theme", "backup", "search", "share", "export", "import", "cache", "alert"];
  const kinds = ["PLAN", "BUG", "SPEC", "REPORT"];
  const out: OrgDoc[] = [];
  for (let i = 0; i < n; i++) {
    const project = ["app", "web", "db"][i % projects];
    const area = `area${Math.floor(rnd() * 12)}`;
    const sub = `sub${Math.floor(rnd() * 8)}`;
    const status = rnd() < 0.2 ? "/done" : "";
    const w = words[Math.floor(rnd() * words.length)];
    const seq = rnd() < 0.2 ? `_phase${1 + Math.floor(rnd() * 4)}` : "";
    out.push(doc(project, `docs/${area}/${sub}${status}/${kinds[i % 4]}_${w}${i % 50}${seq}_i${i}.md`, { sourceFiles: rnd() < 0.3 ? [`lib/f${Math.floor(rnd() * 40)}.dart`, `lib/g${Math.floor(rnd() * 40)}.dart`] : [], title: `${w} notes ${i}` }));
  }
  return out;
}

// Best time in milliseconds of `runs` calls after one warm-up call: a slow machine moment cannot fail a budget test.
export function bestMs(fn: () => void, runs = 3): number {
  fn();
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    fn();
    best = Math.min(best, performance.now() - started);
  }
  return best;
}
