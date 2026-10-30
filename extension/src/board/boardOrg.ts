import { l10n } from "../i18n/l10n";
import { globToRegExp } from "./glob";
import { Link } from "./links";
import { ScanSnapshot } from "./scanner";
import { BoardConfig, Classified } from "./types";
import { GroupView, OPEN, factsFor, itemKey } from "./boardModelParts";
import { organize } from "./org/autoGroup";
import { COLOUR_HEX } from "./org/appearance";
import { Layout, layoutFor } from "./org/layout";
import { clipName, displayName } from "./org/naming";
import { mergeDictionary } from "./org/tags";
import type { OrgColour, OrgDoc, OrgGroup, Why } from "./org/orgTypes";

// Wires the auto-organization engine into the board model: the documents go in, and each open
// item comes out with the group it sits under, ready to draw. Pure apart from the l10n lookup.

// Band and MAX of each project from the previous run, kept in workspace state so layouts stay stable.
export type OrgPrevious = Record<string, { band: number; max: number }>;

export interface OrgBuilt {
  // Item key to its innermost group.
  groupOf: Map<string, GroupView>;
  hubs: Set<string>;
  layouts: Record<string, Layout>;
}

const text = (w: Why): string => l10n(w.key, w.params);

// The reasons for a group's place, name, emoji and colour, one per line, without repeats.
function whyLines(g: OrgGroup): string {
  return [...new Set([g.why, g.nameWhy, g.emojiWhy, g.colourWhy].map(text))].join("\n");
}

// The documents of every project that count for grouping: open and finished ones.
export function buildOrg(rows: Classified[], snapshot: ScanSnapshot | undefined, cfg: BoardConfig, links: Link[], previous?: OrgPrevious): OrgBuilt {
  const ungrouped = (cfg.ungrouped ?? []).map(globToRegExp);
  const waits = new Map<string, string[]>();
  for (const l of links) {
    if (l.state === "open" && l.toProject && l.toPath) {
      const from = itemKey(l.fromProject, l.fromPath);
      (waits.get(from) ?? waits.set(from, []).get(from)!).push(itemKey(l.toProject, l.toPath));
    }
  }
  const docs: OrgDoc[] = [];
  for (const r of rows) {
    if ((OPEN.has(r.status) || r.status === "green") && !ungrouped.some((re) => re.test(r.project + "/" + r.path))) {
      const f = factsFor(snapshot, r.project, r.path);
      const key = itemKey(r.project, r.path);
      docs.push({
        key,
        project: r.project,
        path: r.path,
        words: f?.words ?? 0,
        docRefs: f?.docRefs ?? 0,
        sourceFiles: f?.sourceFiles ?? [],
        title: f?.title,
        needs: waits.get(key),
        tags: f?.tags,
        group: f?.group,
      });
    }
  }
  const res = organize(docs, mergeDictionary().tags, { manual: cfg.groups, previous });
  const count = new Map<string, number>();
  docs.forEach((d) => count.set(d.project, (count.get(d.project) ?? 0) + 1));
  const layouts: Record<string, Layout> = {};
  for (const [project, n] of count) {
    layouts[project] = layoutFor(n, res.layouts[project]?.band, res.layouts[project]?.max);
  }
  const byId = new Map(res.groups.map((g) => [g.id, g]));
  const views = new Map<string, GroupView>();
  const groupOf = new Map<string, GroupView>();
  for (const [key, id] of res.groupOf) {
    const g = byId.get(id)!;
    let v = views.get(id);
    if (!v) {
      const layout = layouts[g.project];
      const fold = layout?.foldWhy ? l10n(layout.foldWhy.key, layout.foldWhy.params) : undefined;
      v = {
        id,
        name: clipName(displayName(g, l10n)),
        emoji: g.emoji,
        colour: COLOUR_HEX[g.colour as OrgColour],
        why: whyLines(g),
        ...(g.kind === "manual" || g.edited ? { byUser: true as const } : {}),
        ...(g.parent ? { parent: g.parent } : {}),
        ...(layout && !layout.headers ? { flat: true as const } : {}),
        ...(fold ? { fold } : {}),
      };
      views.set(id, v);
    }
    groupOf.set(key, v);
  }
  return { groupOf, hubs: res.hubs, layouts };
}
