import * as vscode from "vscode";
import { Shortcut, ShortcutKind, shortcutKind } from "../model/shortcut";
import { l10n } from "../i18n/l10n";

// The active filter applied to the Shortcuts tree (WOW #28, "find it now" bar). Each
// facet narrows the visible set; an empty filter shows everything. This is the
// SHARED filter mechanism: #17 (workspace focus tags) adds a `tag` facet to this
// same state shape and predicate rather than building a second, parallel filter
// (see plans/wow/README.md). When that lands it adds one optional field here and
// one branch in shortcutMatchesFilter — nothing else changes.
export interface ShortcutFilter {
  // Case-insensitive substring matched against a shortcut's label, path, and (for an
  // action shortcut) its shell command / url / command id. Undefined or empty = the
  // text facet is off.
  text?: string;
  // When non-empty, a shortcut shows only when its kind is in this set. The two chips
  // map to disjoint kind groups: the Files chip is ["file"], the Scripts chip is
  // the action kinds (SCRIPT_KINDS). Undefined/empty = no kind facet (both off).
  kinds?: ShortcutKind[];
  // When true, a shortcut shows only when its last background run THIS SESSION failed
  // (the run-status registry is in-memory and per-session, so a fresh window has
  // no failures to filter on until something runs and fails).
  failedOnly?: boolean;
  // The active "mode" tag (WOW #17): a single freeform lowercase tag without the
  // leading '#'. When set, a shortcut shows only when its `tags` include it — the
  // workspace-focus facet, composed into the same predicate as the text/kind/
  // failed facets above. Undefined = no tag facet (all modes shown).
  tag?: string;
}

// The action ("script") kinds, filtered as a unit behind the Scripts chip. A
// file shortcut is the Files chip; everything a shortcut can DO without a target file is a
// Script. This is the model's ShortcutKind partitioned cleanly so the chip mapping has
// a single source of truth.
const SCRIPT_KINDS: readonly ShortcutKind[] = ["shell", "url", "command", "macro", "routine"];

// Persisted per-workspace so a filter survives a reload (the user set it for a
// reason; losing it on every window reload would read as the filter "forgetting").
const FILTER_STATE_KEY = "saropaWorkspace.pinFilter";

// True when any facet is set, so the view shows the "filter active" affordances
// (the filled title icon, the Clear button, the always-visible message).
export function isFilterActive(filter: ShortcutFilter): boolean {
  return (
    (filter.text?.length ?? 0) > 0 ||
    (filter.kinds?.length ?? 0) > 0 ||
    filter.failedOnly === true ||
    (filter.tag?.length ?? 0) > 0
  );
}

// Whether the Scripts chip is lit: the filter restricts to (at least one of) the
// action kinds. Used to render the chip's toggled state and the message.
export function isScriptsChipOn(filter: ShortcutFilter): boolean {
  return SCRIPT_KINDS.some((k) => filter.kinds?.includes(k) ?? false);
}

// Whether the Files chip is lit: the filter restricts to file shortcuts.
export function isFilesChipOn(filter: ShortcutFilter): boolean {
  return filter.kinds?.includes("file") ?? false;
}

// Whether a single shortcut passes the filter. `failed` is the shortcut's last-run-failed
// state, resolved by the caller from the run-status registry, so this stays a
// pure function that both the tree provider and the hidden-count helper can call
// without each reaching into session state.
export function shortcutMatchesFilter(
  shortcut: Shortcut,
  filter: ShortcutFilter,
  failed: boolean
): boolean {
  if (filter.text && filter.text.length > 0) {
    const needle = filter.text.toLowerCase();
    // Match against the same fields the row surfaces (name, path, and the action's
    // command/target), so a search hits what the user can see on the row.
    const haystack = [
      shortcut.label ?? "",
      shortcut.path,
      shortcut.action?.shellCommand ?? "",
      shortcut.action?.url ?? "",
      shortcut.action?.commandId ?? "",
    ]
      .join("\n")
      .toLowerCase();
    if (!haystack.includes(needle)) {
      return false;
    }
  }
  if (
    filter.kinds &&
    filter.kinds.length > 0 &&
    !filter.kinds.includes(shortcutKind(shortcut))
  ) {
    return false;
  }
  if (filter.failedOnly && !failed) {
    return false;
  }
  // Tag mode (WOW #17): a shortcut must carry the active tag. An untagged shortcut (no
  // `tags`, the common case) never matches a tag filter — which is the point of
  // "show only #ops": everything else collapses away.
  if (filter.tag && !(shortcut.tags?.includes(filter.tag) ?? false)) {
    return false;
  }
  return true;
}

// How many shortcuts the active filter hides, for the "N hidden" affordance. Operates
// on the full tree shortcut set (project non-recipe shortcuts + global shortcuts) the caller
// passes in, so the count matches what the tree would otherwise show. Zero when
// no facet is set.
export function countHidden(
  allShortcuts: readonly Shortcut[],
  filter: ShortcutFilter,
  failed: (id: string) => boolean
): number {
  if (!isFilterActive(filter)) {
    return 0;
  }
  return allShortcuts.filter((s) => !shortcutMatchesFilter(s, filter, failed(s.id))).length;
}

// One-line summary of the active facets, e.g. `"redis" · Scripts · Failed`, for
// the always-visible filter message. Empty string when no facet is set (callers
// only build the message while active).
export function filterSummary(filter: ShortcutFilter): string {
  const parts: string[] = [];
  if (filter.text) {
    parts.push(l10n("filter.facet.text", { text: filter.text }));
  }
  if (isScriptsChipOn(filter)) {
    parts.push(l10n("filter.facet.scripts"));
  }
  if (isFilesChipOn(filter)) {
    parts.push(l10n("filter.facet.files"));
  }
  if (filter.failedOnly) {
    parts.push(l10n("filter.facet.failed"));
  }
  if (filter.tag) {
    parts.push(l10n("filter.facet.tag", { tag: filter.tag }));
  }
  return parts.join(" · ");
}

// The TreeView.message shown while filtering. Always names the active facets and
// the hidden count and points at the Clear action, so a filtered (possibly empty-
// looking) tree never reads as "my shortcuts vanished" — the never-silently-empty
// guarantee shared with #17.
export function filterMessage(filter: ShortcutFilter, hidden: number): string {
  return l10n("filter.message", { summary: filterSummary(filter), hidden });
}

// Holds the active filter, persists it per-workspace, and notifies the view on
// any change. The mutators are the single place each facet is flipped, so the
// title commands and the find-bar buttons share one code path.
export class ShortcutFilterState {
  private filter: ShortcutFilter;
  private readonly _onDidChange = new vscode.EventEmitter<void>();

  // Fires whenever a facet changes, so the provider repaints and extension.ts
  // re-syncs the message and the chip context keys.
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.filter = context.workspaceState.get<ShortcutFilter>(FILTER_STATE_KEY, {});
  }

  get(): ShortcutFilter {
    return this.filter;
  }

  isActive(): boolean {
    return isFilterActive(this.filter);
  }

  setText(text: string | undefined): void {
    const trimmed = text?.trim();
    this.update({
      ...this.filter,
      text: trimmed && trimmed.length > 0 ? trimmed : undefined,
    });
  }

  // Flip the Files chip: add or remove "file" from the kind set, leaving the
  // Scripts kinds untouched so the two chips compose (both on = file + actions).
  toggleFiles(): void {
    const kinds = new Set<ShortcutKind>(this.filter.kinds ?? []);
    if (kinds.has("file")) {
      kinds.delete("file");
    } else {
      kinds.add("file");
    }
    this.update({ ...this.filter, kinds: normalizeKinds(kinds) });
  }

  // Flip the Scripts chip: add or remove ALL action kinds as a unit, leaving the
  // Files kind untouched.
  toggleScripts(): void {
    const kinds = new Set<ShortcutKind>(this.filter.kinds ?? []);
    const on = SCRIPT_KINDS.some((k) => kinds.has(k));
    for (const k of SCRIPT_KINDS) {
      if (on) {
        kinds.delete(k);
      } else {
        kinds.add(k);
      }
    }
    this.update({ ...this.filter, kinds: normalizeKinds(kinds) });
  }

  toggleFailed(): void {
    this.update({
      ...this.filter,
      failedOnly: this.filter.failedOnly ? undefined : true,
    });
  }

  // The active mode tag, or undefined when no tag facet is set. Lets the mode
  // picker mark the current choice and the title affordance read it.
  getTag(): string | undefined {
    return this.filter.tag;
  }

  // Set (or clear, with undefined) the active mode tag (WOW #17). Normalized to
  // lowercase so it matches the canonical stored tag form; only this facet
  // changes, so a tag mode composes with any active text/chip facets.
  setTag(tag: string | undefined): void {
    const next =
      tag && tag.trim().length > 0 ? tag.trim().toLowerCase() : undefined;
    this.update({ ...this.filter, tag: next });
  }

  // Clear only the tag facet, leaving any text/kind/failed facets in place — the
  // "exit this mode" action, distinct from clear() which drops every facet.
  clearTag(): void {
    this.setTag(undefined);
  }

  clear(): void {
    this.update({});
  }

  private update(next: ShortcutFilter): void {
    this.filter = next;
    void this.context.workspaceState.update(FILTER_STATE_KEY, next);
    this._onDidChange.fire();
  }
}

// Collapse an empty kind set to undefined so an inactive kind facet carries no
// empty array (isFilterActive and the persisted state both read cleaner).
function normalizeKinds(kinds: Set<ShortcutKind>): ShortcutKind[] | undefined {
  return kinds.size > 0 ? [...kinds] : undefined;
}
