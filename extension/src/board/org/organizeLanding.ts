// The Tags editor, group landing: runs the grouping engine twice over the same documents, once with the saved
// dictionary and once with the draft, so the preview can say which group each tag's documents land in and how
// many documents a save would move. Pure: nothing here reads or writes a file.

import { organize } from "./autoGroup";
import { EditorState, tagOfRow } from "./organizeEditCore";
import type { OrganizeConfig } from "./overrides";
import type { OrgDoc, OrgOptions, OrgResult } from "./orgTypes";

// Where one tag's documents land under the draft: the group most of them sit in, and how many do.
export interface LandingSummary {
  group: string;
  count: number;
}

// The effect of a draft dictionary on the board's groups, as the Tags tab shows it before the owner saves.
export interface Landing {
  // Tag id to its main landing group; a tag no document matches is absent.
  byTag: Record<string, LandingSummary>;
  // Documents whose innermost group differs between the saved dictionary and the draft.
  moved: number;
}

// The board's own manual groups and hand-made overrides go into both runs, so the only difference between them
// is the draft; the layout memory is left out of both for the same reason.
export interface LandingBase {
  manual?: OrgOptions["manual"];
  overrides?: OrganizeConfig;
}

// One engine run for a dictionary and naming rules taken from an editor state.
function run(docs: OrgDoc[], s: EditorState, base: LandingBase): OrgResult {
  const tags = s.tags.filter((r) => !r.off).map(tagOfRow);
  const naming = { dates: s.naming.dates, prefixes: new Set(s.naming.prefixes), acronyms: s.naming.acronyms };
  // Thread the inference and folder constants so the preview reflects draft changes.
  const kinds = new Set(s.inference.kinds);
  const seqWords = s.inference.seqWords;
  const statusWords = new Set(s.folders.statusWords);
  const containerWords = new Set(s.folders.containerWords);
  return organize(docs, tags, { manual: base.manual, naming, kinds, seqWords, statusWords, containerWords }, base.overrides ?? {});
}

// Compares the saved state with the draft. A document one run drops (ungrouped) is not counted as moved.
export function groupLanding(docs: readonly OrgDoc[], saved: EditorState, draft: EditorState, base: LandingBase = {}): Landing {
  const list = [...docs];
  const before = run(list, saved, base);
  const after = run(list, draft, base);
  let moved = 0;
  for (const [key, id] of after.groupOf) {
    const was = before.groupOf.get(key);
    if (was !== undefined && was !== id) {
      moved += 1;
    }
  }
  const nameOf = new Map(after.groups.map((g) => [g.id, g.name]));
  const tally = new Map<string, Map<string, number>>();
  for (const [key, matches] of after.tagsOf) {
    const id = after.groupOf.get(key);
    if (id === undefined) {
      continue;
    }
    for (const m of matches) {
      const per = tally.get(m.tagId) ?? tally.set(m.tagId, new Map()).get(m.tagId)!;
      per.set(id, (per.get(id) ?? 0) + 1);
    }
  }
  const byTag: Record<string, LandingSummary> = {};
  for (const [tagId, per] of tally) {
    // The most common group wins; a tie goes to the smaller id so the answer never flips between runs.
    const [top, count] = [...per].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    byTag[tagId] = { group: (nameOf.get(top) ?? "").slice(0, 60), count };
  }
  return { byTag, moved };
}
