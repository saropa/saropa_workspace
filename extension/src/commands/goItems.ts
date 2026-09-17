// The pure data layer behind the "Saropa: Go" omni-QuickPick
// (MOBILE_REMOTE_CONTROL_PLAN, "UI restructure" item 4: "One omni-entry point:
// saropaWorkspace.go").
//
// The plan's point is that the trees stop being the discovery mechanism: one flat,
// fuzzy-matched list spans shortcuts, recipes, scripts, notes, watches and adb catalog
// commands, with a separator per category and recently-run entries on top. Everything
// that decides WHAT is in that list — category order, recency ordering, the `>` prefix
// drill-down — lives here as pure functions over already-loaded data, so it unit-tests
// under node --test with no extension host. This file therefore imports no vscode and no
// store: goQuickPick.ts is the glue that loads the data, maps it in, and dispatches the
// chosen row to the same command the item's own tree row would have run.

/** The categories the Go list spans, in the order their sections are rendered. */
export const GO_CATEGORIES = [
  "shortcut",
  "recipe",
  "script",
  "note",
  "watch",
  "adb",
] as const;

export type GoCategory = (typeof GO_CATEGORIES)[number];

// One candidate, already resolved to display text by the caller. `id` is unique only
// WITHIN a category (a shortcut id and a catalog entry id can collide), so recency is
// keyed by goKey() rather than by id alone.
export interface GoSource {
  readonly category: GoCategory;
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly detail?: string;
}

// A row of the rendered list. `kind` mirrors vscode.QuickPickItemKind so the glue maps
// it with a single ternary; a separator carries no `source` and is never selectable.
export interface GoRow {
  readonly kind: "item" | "separator";
  readonly label: string;
  readonly description?: string;
  readonly detail?: string;
  readonly source?: GoSource;
}

/** Human labels for the section separators, supplied by the caller (l10n lives in glue). */
export interface GoLabels {
  readonly recent: string;
  readonly categories: Readonly<Record<GoCategory, string>>;
}

export interface GoBuildOptions {
  // Recency keys (goKey() form), most-recently-used first. Entries naming something not
  // in `sources` are ignored, so a stale history record never paints a dead row.
  readonly recent?: readonly string[];
  // When set, the list is narrowed to this one category (the `>` drill-down) and no
  // Recent section is rendered — inside a single category the recents simply sort first.
  readonly category?: GoCategory;
  // How many entries the Recent section shows at most. The full list stays reachable
  // below, so this only bounds the shortcut-to-the-top, not discovery.
  readonly recentLimit?: number;
}

const DEFAULT_RECENT_LIMIT = 6;

/** The recency key for a source: the id alone is not unique across categories. */
export function goKey(category: GoCategory, id: string): string {
  return `${category}:${id}`;
}

// Build the rendered row list.
//
// Flat form: a Recent section (most-recent-first, bounded) followed by one section per
// category in GO_CATEGORIES order. A recent entry appears ONLY in the Recent section and
// is omitted from its category section, so the list never shows the same row twice.
// Empty categories contribute no separator.
//
// Drilled-down form (`category` set): that category's entries only, its recents first,
// under a single separator — the same rows, just narrowed.
export function buildGoRows(
  sources: readonly GoSource[],
  labels: GoLabels,
  options: GoBuildOptions = {}
): GoRow[] {
  const recent = options.recent ?? [];
  const rank = new Map<string, number>();
  recent.forEach((key, index) => {
    if (!rank.has(key)) {
      rank.set(key, index);
    }
  });

  if (options.category) {
    const inCategory = sources.filter((s) => s.category === options.category);
    if (inCategory.length === 0) {
      return [];
    }
    return [
      separator(labels.categories[options.category]),
      ...sortByRecency(inCategory, rank).map(itemRow),
    ];
  }

  const limit = options.recentLimit ?? DEFAULT_RECENT_LIMIT;
  const byKey = new Map(sources.map((s) => [goKey(s.category, s.id), s]));
  const recentSources: GoSource[] = [];
  for (const key of recent) {
    const hit = byKey.get(key);
    if (hit && !recentSources.includes(hit)) {
      recentSources.push(hit);
      if (recentSources.length >= limit) {
        break;
      }
    }
  }
  const promoted = new Set(recentSources.map((s) => goKey(s.category, s.id)));

  const rows: GoRow[] = [];
  if (recentSources.length > 0) {
    rows.push(separator(labels.recent), ...recentSources.map(itemRow));
  }
  for (const category of GO_CATEGORIES) {
    const members = sources.filter(
      (s) => s.category === category && !promoted.has(goKey(s.category, s.id))
    );
    if (members.length === 0) {
      continue;
    }
    rows.push(separator(labels.categories[category]), ...members.map(itemRow));
  }
  return rows;
}

// Stable-sort helper: entries carrying a recency rank come first in that order, the rest
// keep the order the caller supplied (which is each source's own tree order).
function sortByRecency(
  sources: readonly GoSource[],
  rank: ReadonlyMap<string, number>
): GoSource[] {
  const ranked: GoSource[] = [];
  const rest: GoSource[] = [];
  for (const source of sources) {
    if (rank.has(goKey(source.category, source.id))) {
      ranked.push(source);
    } else {
      rest.push(source);
    }
  }
  ranked.sort(
    (a, b) =>
      (rank.get(goKey(a.category, a.id)) ?? 0) - (rank.get(goKey(b.category, b.id)) ?? 0)
  );
  return [...ranked, ...rest];
}

function separator(label: string): GoRow {
  return { kind: "separator", label };
}

function itemRow(source: GoSource): GoRow {
  return {
    kind: "item",
    label: source.label,
    description: source.description,
    detail: source.detail,
    source,
  };
}

// ---------------------------------------------------------------------------
// `>` drill-down
// ---------------------------------------------------------------------------

/** A resolved drill-down: the category typed, plus the search text that followed it. */
export interface GoPrefix {
  readonly category: GoCategory;
  readonly remainder: string;
  /** True once the category token is terminated by a space, e.g. `>adb `. False while
   * still being typed (`>adb`), so a caller can wait for this before consuming the token
   * out of the search box — otherwise characters typed right after resolution (`>note`
   * resolving before the trailing `e` lands) get eaten as leftover search text. */
  readonly terminated: boolean;
}

// Parse a leading `>category ` token out of the search box.
//
// Deliberately the simplest thing that satisfies "can narrow to one category": the token
// is matched by PREFIX, so `>a` is adb and `>rec` is recipe, and it resolves only when
// the typed text picks exactly one category — `>s` matches both shortcut and script, so it
// narrows nothing until the next character. Ambiguity is decided against the live category
// list rather than a hand-maintained abbreviation table. A token still being typed (no
// trailing space) resolves too, so the list narrows as the user types rather than only
// once they hit space.
//
// Returns undefined when the value is not a drill-down or the token matches no single
// category, which the caller renders as the normal flat list.
export function parseGoPrefix(value: string): GoPrefix | undefined {
  if (!value.startsWith(">")) {
    return undefined;
  }
  const afterMarker = value.slice(1);
  const spaceAt = afterMarker.indexOf(" ");
  const token = (spaceAt === -1 ? afterMarker : afterMarker.slice(0, spaceAt))
    .trim()
    .toLowerCase();
  if (token.length === 0) {
    return undefined;
  }
  const matches = GO_CATEGORIES.filter((c) => c.startsWith(token));
  // An exact token wins over the prefix set, so `>note` is not blocked by a future
  // `>notes`-style sibling; otherwise the match must be unambiguous.
  const exact = matches.find((c) => c === token);
  const category = exact ?? (matches.length === 1 ? matches[0] : undefined);
  if (!category) {
    return undefined;
  }
  return {
    category,
    remainder: spaceAt === -1 ? "" : afterMarker.slice(spaceAt + 1).trimStart(),
    terminated: spaceAt !== -1,
  };
}
