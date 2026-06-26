import * as vscode from "vscode";
import { Pin, PinKind, pinKind } from "../model/pin";
import { l10n } from "../i18n/l10n";

// The active filter applied to the Pins tree (WOW #28, "find it now" bar). Each
// facet narrows the visible set; an empty filter shows everything. This is the
// SHARED filter mechanism: #17 (workspace focus tags) adds a `tag` facet to this
// same state shape and predicate rather than building a second, parallel filter
// (see plans/wow/README.md). When that lands it adds one optional field here and
// one branch in pinMatchesFilter — nothing else changes.
export interface PinFilter {
  // Case-insensitive substring matched against a pin's label, path, and (for an
  // action pin) its shell command / url / command id. Undefined or empty = the
  // text facet is off.
  text?: string;
  // When non-empty, a pin shows only when its kind is in this set. The two chips
  // map to disjoint kind groups: the Files chip is ["file"], the Scripts chip is
  // the action kinds (SCRIPT_KINDS). Undefined/empty = no kind facet (both off).
  kinds?: PinKind[];
  // When true, a pin shows only when its last background run THIS SESSION failed
  // (the run-status registry is in-memory and per-session, so a fresh window has
  // no failures to filter on until something runs and fails).
  failedOnly?: boolean;
}

// The action ("script") kinds, filtered as a unit behind the Scripts chip. A
// file pin is the Files chip; everything a pin can DO without a target file is a
// Script. This is the model's PinKind partitioned cleanly so the chip mapping has
// a single source of truth.
const SCRIPT_KINDS: readonly PinKind[] = ["shell", "url", "command", "macro", "routine"];

// Persisted per-workspace so a filter survives a reload (the user set it for a
// reason; losing it on every window reload would read as the filter "forgetting").
const FILTER_STATE_KEY = "saropaWorkspace.pinFilter";

// True when any facet is set, so the view shows the "filter active" affordances
// (the filled title icon, the Clear button, the always-visible message).
export function isFilterActive(filter: PinFilter): boolean {
  return (
    (filter.text?.length ?? 0) > 0 ||
    (filter.kinds?.length ?? 0) > 0 ||
    filter.failedOnly === true
  );
}

// Whether the Scripts chip is lit: the filter restricts to (at least one of) the
// action kinds. Used to render the chip's toggled state and the message.
export function isScriptsChipOn(filter: PinFilter): boolean {
  return SCRIPT_KINDS.some((k) => filter.kinds?.includes(k) ?? false);
}

// Whether the Files chip is lit: the filter restricts to file pins.
export function isFilesChipOn(filter: PinFilter): boolean {
  return filter.kinds?.includes("file") ?? false;
}

// Whether a single pin passes the filter. `failed` is the pin's last-run-failed
// state, resolved by the caller from the run-status registry, so this stays a
// pure function that both the tree provider and the hidden-count helper can call
// without each reaching into session state.
export function pinMatchesFilter(
  pin: Pin,
  filter: PinFilter,
  failed: boolean
): boolean {
  if (filter.text && filter.text.length > 0) {
    const needle = filter.text.toLowerCase();
    // Match against the same fields the row surfaces (name, path, and the action's
    // command/target), so a search hits what the user can see on the row.
    const haystack = [
      pin.label ?? "",
      pin.path,
      pin.action?.shellCommand ?? "",
      pin.action?.url ?? "",
      pin.action?.commandId ?? "",
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
    !filter.kinds.includes(pinKind(pin))
  ) {
    return false;
  }
  if (filter.failedOnly && !failed) {
    return false;
  }
  return true;
}

// How many pins the active filter hides, for the "N hidden" affordance. Operates
// on the full tree pin set (project non-recipe pins + global pins) the caller
// passes in, so the count matches what the tree would otherwise show. Zero when
// no facet is set.
export function countHidden(
  allPins: readonly Pin[],
  filter: PinFilter,
  failed: (id: string) => boolean
): number {
  if (!isFilterActive(filter)) {
    return 0;
  }
  return allPins.filter((p) => !pinMatchesFilter(p, filter, failed(p.id))).length;
}

// One-line summary of the active facets, e.g. `"redis" · Scripts · Failed`, for
// the always-visible filter message. Empty string when no facet is set (callers
// only build the message while active).
export function filterSummary(filter: PinFilter): string {
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
  return parts.join(" · ");
}

// The TreeView.message shown while filtering. Always names the active facets and
// the hidden count and points at the Clear action, so a filtered (possibly empty-
// looking) tree never reads as "my pins vanished" — the never-silently-empty
// guarantee shared with #17.
export function filterMessage(filter: PinFilter, hidden: number): string {
  return l10n("filter.message", { summary: filterSummary(filter), hidden });
}

// Holds the active filter, persists it per-workspace, and notifies the view on
// any change. The mutators are the single place each facet is flipped, so the
// title commands and the find-bar buttons share one code path.
export class PinFilterState {
  private filter: PinFilter;
  private readonly _onDidChange = new vscode.EventEmitter<void>();

  // Fires whenever a facet changes, so the provider repaints and extension.ts
  // re-syncs the message and the chip context keys.
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.filter = context.workspaceState.get<PinFilter>(FILTER_STATE_KEY, {});
  }

  get(): PinFilter {
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
    const kinds = new Set<PinKind>(this.filter.kinds ?? []);
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
    const kinds = new Set<PinKind>(this.filter.kinds ?? []);
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

  clear(): void {
    this.update({});
  }

  private update(next: PinFilter): void {
    this.filter = next;
    void this.context.workspaceState.update(FILTER_STATE_KEY, next);
    this._onDidChange.fire();
  }
}

// Collapse an empty kind set to undefined so an inactive kind facet carries no
// empty array (isFilterActive and the persisted state both read cleaner).
function normalizeKinds(kinds: Set<PinKind>): PinKind[] | undefined {
  return kinds.size > 0 ? [...kinds] : undefined;
}
