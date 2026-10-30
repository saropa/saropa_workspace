import { l10n } from "../i18n/l10n";
import { globToRegExp } from "./glob";
import { Link } from "./links";
import { ScanSnapshot } from "./scanner";
import { BoardConfig, Classified } from "./types";
import { GroupView, OPEN, factsFor, itemKey } from "./boardModelParts";
import { organize } from "./org/autoGroup";
import type { OrgResult } from "./org/orgTypes";
import { COLOUR_HEX } from "./org/appearance";
import { Layout, layoutFor } from "./org/layout";
import { clipName, displayName } from "./org/naming";
import { overridesOf, settingsOf } from "./org/settings";
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

// The engine's answer for the last documents, groups and saved layouts it saw. The board is built many times
// (every repaint) from the same scan; the engine runs again only when one of them changed.
let last: { key: string; res: OrgResult } | undefined;

function organizeCached(docs: OrgDoc[], cfg: BoardConfig, previous: OrgPrevious | undefined): OrgResult {
  // The settings go in by content (settingsOf builds fresh arrays), so a Save changes the board without a document change.
  const s = settingsOf(cfg.organize);
  const overrides = overridesOf(cfg.organize);
  const key = JSON.stringify([docs, cfg.groups, previous, s.tags, s.naming.dates, [...(s.naming.prefixes ?? [])], s.naming.acronyms, overrides]);
  if (last?.key !== key) {
    last = { key, res: organize(docs, s.tags, { manual: cfg.groups, previous, naming: s.naming }, overrides) };
  }
  return last.res;
}

// Forgets the cached answer (tests that time the engine).
export function resetOrgCache(): void {
  last = undefined;
}

// A palette name maps to its hex; a hex a tag brought (already contrast-checked) passes as is. Nothing else reaches a style.
function colourOf(c: string): string | undefined {
  return /^#[0-9a-f]{6}$/i.test(c) ? c : COLOUR_HEX[c as OrgColour];
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
  const res = organizeCached(docs, cfg, previous);
  // One layout for the whole board: the documents of every project shown count together.
  const first = Object.values(res.layouts)[0];
  const layout = layoutFor(docs.length, first?.band, first?.max);
  const layouts: Record<string, Layout> = {};
  for (const project of new Set(docs.map((d) => d.project))) {
    layouts[project] = layout;
  }
  const byId = new Map(res.groups.map((g) => [g.id, g]));
  const views = new Map<string, GroupView>();
  const viewOf = (id: string): GroupView => {
    const have = views.get(id);
    if (have) {
      return have;
    }
    const g = byId.get(id)!;
    const fold = layout.foldWhy ? l10n(layout.foldWhy.key, layout.foldWhy.params) : undefined;
    const v: GroupView = {
      id,
      name: clipName(displayName(g, l10n)),
      ...(g.stored !== undefined ? { stored: g.stored } : {}),
      emoji: g.emoji,
      colour: colourOf(g.colour),
      why: whyLines(g),
      ...(g.kind === "manual" || g.edited ? { byUser: true as const } : {}),
      ...(g.parent && byId.has(g.parent) ? { parent: g.parent, parentView: viewOf(g.parent) } : {}),
      ...(!layout.headers ? { flat: true as const } : {}),
      ...(fold ? { fold } : {}),
    };
    views.set(id, v);
    return v;
  };
  const groupOf = new Map<string, GroupView>();
  for (const [key, id] of res.groupOf) {
    groupOf.set(key, viewOf(id));
  }
  return { groupOf, hubs: res.hubs, layouts };
}
