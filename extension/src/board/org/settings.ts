// What a project's `organize` key (the rules file) changes in the engines: the tag dictionary, the "waits on"
// phrases and the naming rules. Values that fail the editor's checks are dropped (stateFromOrganize), so a
// hand-edited file can never break a run. Precedence stays: user override (assign/untag/groups) > rules file
// (this key) > front matter > inference; the engines apply the first three, this file supplies the second.

import { DEFAULT_LINK_PHRASES, stateFromOrganize, tagOfRow } from "./organizeEdit";
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

// Ids of the tags that match any of the documents, in dictionary order (what "Edit tags" highlights).
export function matchedTagIds(docs: ReadonlyArray<{ path: string; title: string }>, tags: TagDef[]): string[] {
  const compiled = compileTags(tags);
  const hit = new Set(docs.flatMap((d) => matchTags(subjectOf(d.path, d.title), compiled).map((m) => m.tagId)));
  return tags.map((t) => t.id).filter((id) => hit.has(id));
}
