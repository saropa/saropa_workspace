// What a project's `organize` key (the rules file) changes in the engines: the tag dictionary, the "waits on"
// phrases and the naming rules. Values that fail the editor's checks are dropped (stateFromOrganize), so a
// hand-edited file can never break a run. Precedence stays: user override (assign/untag/groups) > rules file
// (this key) > front matter > inference; the engines apply the first three, this file supplies the second.

import { isObject } from "../ruleAssign";
import { DEFAULT_LINK_PHRASES, ID, LIMITS, cleanGroupOverride, groupIdOk, pinOk, stateFromOrganize, tagOfRow } from "./organizeEdit";
import type { GroupOverride, OrganizeConfig } from "./overrides";
import type { OrgOptions } from "./orgTypes";
import { TagDef, compileTags, matchTags, subjectOf } from "./tags";

export interface OrgSettings {
  // The dictionary in priority order, turned-off tags left out (organize()'s `tags`).
  tags: TagDef[];
  // The "waits on" phrases turned on (InferOptions.phrases).
  linkPhrases: string[];
  // OrgOptions.naming.
  naming: NonNullable<OrgOptions["naming"]>;
}

export function settingsOf(organize: unknown): OrgSettings {
  const s = stateFromOrganize(organize);
  return {
    tags: s.tags.filter((r) => !r.off).map(tagOfRow),
    linkPhrases: [...DEFAULT_LINK_PHRASES.filter((p) => !s.linkWords.off.includes(p)), ...s.linkWords.add],
    naming: { dates: s.naming.dates, prefixes: new Set(s.naming.prefixes), acronyms: s.naming.acronyms },
  };
}

// The hand-made part of the `organize` key (group name, emoji and colour changes, placements, removed tags) as
// organize()'s 4th argument. Entries that fail the editor's checks are dropped, so a hand-edited file never throws.
export function overridesOf(organize: unknown): OrganizeConfig {
  const o = isObject(organize) ? organize : {};
  const groups: Record<string, GroupOverride> = {};
  if (isObject(o.groups)) {
    for (const id of Object.keys(o.groups)) {
      const g = groupIdOk(id) ? cleanGroupOverride(o.groups[id]) : undefined;
      if (g && Object.keys(g).length) {
        groups[id] = g;
      }
    }
  }
  const list = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v.filter((e): e is Record<string, unknown> => isObject(e) && pinOk(e as { project: string; path: string })) : []);
  const assign = list(o.assign)
    .filter((a) => groupIdOk(a.group))
    .map((a) => ({ project: a.project as string, path: a.path as string, group: a.group as string }));
  const untag = list(o.untag)
    .filter((u) => typeof u.tag === "string" && u.tag.length <= LIMITS.id && ID.test(u.tag))
    .map((u) => ({ project: u.project as string, path: u.path as string, tag: u.tag as string }));
  return { groups, assign, untag };
}

// Ids of the tags that match any of the documents, in dictionary order (what "Edit tags" highlights).
export function matchedTagIds(docs: ReadonlyArray<{ path: string; title: string }>, tags: TagDef[]): string[] {
  const compiled = compileTags(tags);
  const hit = new Set(docs.flatMap((d) => matchTags(subjectOf(d.path, d.title), compiled).map((m) => m.tagId)));
  return tags.map((t) => t.id).filter((id) => hit.has(id));
}
