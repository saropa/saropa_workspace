// Overrides: what the user wrote down (the `organize` key of the rules file), which source wins,
// and how an override follows a file or folder that moved.

import type { OrgSource } from "./orgTypes";
import type { TagsConfig } from "./tags";

export interface GroupOverride {
  name?: string;
  emoji?: string;
  colour?: string;
}

export interface OrganizeConfig {
  tags?: TagsConfig;
  linkWords?: Record<string, unknown>;
  naming?: Record<string, unknown>;
  // By stable group id.
  groups?: Record<string, GroupOverride>;
  // A document placed in a group by hand.
  assign?: Array<{ project: string; path: string; group: string }>;
  // A tag removed from one document.
  untag?: Array<{ project: string; path: string; tag: string }>;
}

const ORDER: OrgSource[] = ["override", "rules", "frontMatter", "inference"];

// The value of the strongest source that has one: override, rules file, front matter, inference.
export function resolveByPrecedence<T>(candidates: Partial<Record<OrgSource, T>>): { value: T; source: OrgSource } | undefined {
  const source = ORDER.find((s) => candidates[s] !== undefined);
  return source ? { value: candidates[source] as T, source } : undefined;
}

export interface Relocation {
  config: OrganizeConfig;
  moved: Array<{ from: string; to: string }>;
  stale: Array<{ kind: "assign" | "untag" | "group"; ref: string }>;
}

const fileOf = (path: string): string => path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);

// Share of the old file names a current group still holds, at which a folder group's overrides follow it.
const FOLDER_FOLLOW = 0.8;

// An override whose file is gone moves to the one new document with the same file name and no override of its own.
// Several or none: it is reported as stale. A group override whose id is gone moves to the current folder group
// that holds at least 80 percent of the same file names (`previousFiles`: old group id to its file names).
export function relocateOverrides(
  cfg: OrganizeConfig,
  docs: Array<{ project: string; path: string }>,
  currentGroups: Array<{ id: string; files: string[] }> = [],
  previousFiles: Record<string, string[]> = {},
): Relocation {
  const moved: Relocation["moved"] = [];
  const stale: Relocation["stale"] = [];
  const have = new Set(docs.map((d) => d.project + "\t" + d.path));
  const claimed = new Set([...(cfg.assign ?? []), ...(cfg.untag ?? [])].map((o) => o.project + "\t" + o.path));
  const byName = new Map<string, string[]>();
  docs.forEach((d) => (byName.get(d.project + "\t" + fileOf(d.path)) ?? byName.set(d.project + "\t" + fileOf(d.path), []).get(d.project + "\t" + fileOf(d.path))!).push(d.path));

  const follow = <T extends { project: string; path: string }>(list: T[] | undefined, kind: "assign" | "untag"): T[] | undefined =>
    list?.flatMap((o) => {
      if (have.has(o.project + "\t" + o.path)) {
        return [o];
      }
      const found = (byName.get(o.project + "\t" + fileOf(o.path)) ?? []).filter((p) => !claimed.has(o.project + "\t" + p));
      if (found.length === 1) {
        claimed.add(o.project + "\t" + found[0]);
        moved.push({ from: o.path, to: found[0] });
        return [{ ...o, path: found[0] }];
      }
      stale.push({ kind, ref: o.path });
      return [o];
    });

  const liveIds = new Set(currentGroups.map((g) => g.id));
  const groupMap = new Map<string, string>();
  const ids = new Set([...Object.keys(cfg.groups ?? {}), ...(cfg.assign ?? []).map((a) => a.group)]);
  for (const id of [...ids].sort()) {
    if (liveIds.has(id) || !id.includes(":folder:")) {
      continue;
    }
    const old = previousFiles[id];
    const project = id.slice(0, id.indexOf(":"));
    const best = old?.length
      ? currentGroups
          .filter((g) => g.id.startsWith(project + ":folder:"))
          .map((g) => ({ id: g.id, share: old.filter((f) => g.files.includes(f)).length / old.length }))
          .filter((c) => c.share >= FOLDER_FOLLOW)
          .sort((a, b) => b.share - a.share || (a.id < b.id ? -1 : 1))[0]
      : undefined;
    if (best) {
      groupMap.set(id, best.id);
      moved.push({ from: id, to: best.id });
    } else {
      stale.push({ kind: "group", ref: id });
    }
  }
  const assign = follow(cfg.assign, "assign")?.map((a) => ({ ...a, group: groupMap.get(a.group) ?? a.group }));
  const untag = follow(cfg.untag, "untag");
  const groups = cfg.groups && Object.fromEntries(Object.entries(cfg.groups).map(([k, v]) => [groupMap.get(k) ?? k, v]));
  return { config: { ...cfg, ...(assign && { assign }), ...(untag && { untag }), ...(groups && { groups }) }, moved, stale };
}
