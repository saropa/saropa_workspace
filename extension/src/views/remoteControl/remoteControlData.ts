// The wire model behind the Mobile Remote Control panel (MOBILE_REMOTE_CONTROL_PLAN
// section 3, build-order step 3): turns the inert catalog in model/adbCommandCatalog.ts
// into the exact JSON the webview renders — resolved English (never l10n KEYS), one
// bucket per group, in catalog order.
//
// Pure by design, the same reason the catalog itself is: no vscode import, no process,
// no panel state. remoteControlPanel.ts is the only thing here that touches the host,
// so everything that decides WHAT is shown can be unit tested under `node --test`,
// while the webview host/protocol glue stays untested and trivial.
//
// The l10n boundary is deliberate: the catalog stores `labelKey`/`descriptionKey`, and
// they are resolved HERE, host-side, before anything is posted. The webview receives
// plain strings only — it holds no key, no catalog and no display text of its own
// (same rule the launcher and Configure Run clients follow).
//
// Two things this module now decides, both pure and both unit tested:
//   - the DRY-RUN PREVIEW. Every row carries `command`, the fully substituted string
//     (model/adbCommandSubstitution.ts) that this row would actually run, alongside the
//     raw `commandTemplate` it came from. The panel shows the former; the confirm dialog
//     the host raises before running repeats it verbatim.
//   - RECENT/FREQUENT RANKING. Recency and lifetime counts arrive as plain data
//     (exec/adbRunHistory.ts reads them from globalState; nothing here touches storage),
//     and the top few become a "Recent" pseudo-group rendered ABOVE the real groups —
//     the same arrangement the Shortcuts tree uses, where a Recent root sits above the
//     scope roots and its rows duplicate entries that also appear below.
//
// Execution itself (the confirm step, the prompt resolution and the terminal) lives in
// remoteControlActions.ts: it needs vscode, so it stays out of this pure module.

import {
  ADB_COMMAND_CATALOG,
  AdbCommandEntry,
  AdbCommandGroup,
  adbGroupDescriptionKey,
  adbGroupLabelKey,
  filterAdbCatalog,
  groupAdbCatalog,
} from "../../model/adbCommandCatalog";
import { AndroidProjectProfile } from "../../model/androidProjectProfile";
import { substituteAdbCommand } from "../../model/adbCommandSubstitution";
import { l10n } from "../../i18n/l10n";

// The synthetic group id of the "Recent" pseudo-group. Not an AdbCommandGroup — it is an
// arrangement, not a catalog bucket — so it is spelled out here and widens the wire
// type's `id` rather than polluting ADB_COMMAND_GROUPS (a Recent entry must still appear
// in its real group below).
export const RECENT_GROUP_ID = "recent";

// How many recently-run commands the pseudo-group shows. Small on purpose: it is a
// shortcut back to what you just did, not a second copy of the catalog.
const RECENT_GROUP_SIZE = 5;

// One rendered command row. Flags travel as booleans rather than as pre-rendered badge
// text so the client can style the destructive marker differently from the informational
// ones; the badge WORDS come from `strings` below, once per payload instead of once per
// row.
export interface RemoteControlCommandWire {
  id: string;
  label: string;
  description: string;
  // The raw template, `{token}` placeholders included. Kept so a row can still explain
  // where its command came from; the client renders `command`, not this.
  commandTemplate: string;
  // The DRY-RUN PREVIEW: the same template after profile substitution, with anything the
  // profile could not answer rewritten as this extension's `${prompt:...}` /
  // `${pick:...}` run-parameter tokens. Never contains a `{token}`, so what the row shows
  // is always a runnable command line.
  command: string;
  // Token names the profile auto-filled — what "we already know your package id" is
  // claiming, in a form the client can name rather than imply.
  autoFilled: string[];
  // True when running this row will ask the user for something first.
  prompts: boolean;
  // True when a token the PROJECT should have answered (an application id, a deep-link
  // scheme) had no value — i.e. there is no Android project here. The row still runs, by
  // asking; this is what lets the panel say why.
  missingProject: boolean;
  requiresDevice: boolean;
  destructive: boolean;
  minSdk?: number;
}

// One collapsible section: a group's own heading/blurb plus its surviving rows. A group
// with no surviving row is never emitted (groupAdbCatalog drops it), so the panel can
// never render an empty, expandable header.
export interface RemoteControlGroupWire {
  id: AdbCommandGroup | typeof RECENT_GROUP_ID;
  label: string;
  description: string;
  commands: RemoteControlCommandWire[];
}

// The header chip describing the workspace the panel is pointed at. Present only when a
// profile was resolved; `undefined` means "no Android project here", which the client
// renders as the explanatory empty-state line rather than silently omitting the chip.
export interface RemoteControlProjectWire {
  hasAndroidProject: boolean;
  isFlutterProject: boolean;
  // The default target package, when build.gradle yielded one.
  applicationId?: string;
  // How many variants resolve to a package id — the flavor picker's future input; shown
  // now only as a count so a multi-flavor project is visibly multi-flavor.
  variantCount: number;
}

// Every display string the client needs, resolved once per payload. The client carries
// none of its own, so a locale switch is a host-side concern only.
export interface RemoteControlStrings {
  run: string;
  pin: string;
  pinTitle: string;
  prompts: string;
  promptsTitle: string;
  missingProject: string;
  missingProjectTitle: string;
  autoFilled: string;
  destructive: string;
  destructiveTitle: string;
  requiresDevice: string;
  minSdk: string;
  empty: string;
  count: string;
  countFiltered: string;
  projectPackage: string;
  projectFlutter: string;
  projectNone: string;
  projectVariants: string;
}

// The single message the panel posts to the webview: the filtered, grouped, resolved
// catalog plus the counts the search box badge shows. `total` is the whole catalog, not
// the filtered slice, so "7/38" reads as "7 of everything" the way the launcher's badge
// does.
export interface RemoteControlPayload {
  query: string;
  groups: RemoteControlGroupWire[];
  shown: number;
  total: number;
  project?: RemoteControlProjectWire;
  strings: RemoteControlStrings;
}

export interface RemoteControlPayloadOptions {
  // Defaults to the shipped catalog; injectable so a test (and, later, a
  // profile-filtered caller) can pass its own list.
  catalog?: AdbCommandEntry[];
  query?: string;
  profile?: AndroidProjectProfile;
  // Catalog entry ids, most-recently-run first (exec/adbRunHistory.recent()). Passed as
  // data so this module stays pure and the ranking is asserted without globalState.
  recent?: string[];
  // Lifetime run counts by entry id (exec/adbRunHistory.counts()), the tie-breaker
  // within the Recent group's recency order.
  counts?: Record<string, number>;
}

// Resolve one entry's l10n keys into the row the webview renders, and substitute its
// template against the project profile so the row previews what it would really run.
export function resolveAdbCommand(
  entry: AdbCommandEntry,
  profile?: AndroidProjectProfile
): RemoteControlCommandWire {
  const substitution = substituteAdbCommand(entry, profile);
  return {
    id: entry.id,
    label: l10n(entry.labelKey),
    description: l10n(entry.descriptionKey),
    commandTemplate: entry.commandTemplate,
    command: substitution.command,
    autoFilled: Object.keys(substitution.resolved),
    prompts: substitution.interactive.length > 0,
    missingProject: substitution.missingFromProfile.length > 0,
    requiresDevice: entry.requiresDevice,
    destructive: entry.destructive,
    ...(entry.minSdk === undefined ? {} : { minSdk: entry.minSdk }),
  };
}

// The Recent pseudo-group's members: entries the user has actually run, most recent
// first, bounded to RECENT_GROUP_SIZE. Only entries still present in `catalog` qualify,
// so a filtered search never surfaces a Recent row the search excluded (and a renamed /
// removed catalog entry cannot resurrect itself from history).
//
// `counts` breaks ties only for entries history remembers with the SAME position — in
// practice it orders nothing on its own, because `recent` is already strictly ordered; it
// is consulted for entries absent from the recency window but with a lifetime count, so a
// command run twenty times last month still outranks one never run at all.
export function rankRecentAdbEntries(
  catalog: AdbCommandEntry[],
  recent: string[] = [],
  counts: Record<string, number> = {},
  limit: number = RECENT_GROUP_SIZE
): AdbCommandEntry[] {
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const picked: AdbCommandEntry[] = [];
  for (const id of recent) {
    const entry = byId.get(id);
    if (entry && !picked.includes(entry)) {
      picked.push(entry);
    }
  }
  if (picked.length < limit) {
    const frequent = catalog
      .filter((e) => (counts[e.id] ?? 0) > 0 && !picked.includes(e))
      .sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0));
    picked.push(...frequent);
  }
  return picked.slice(0, limit);
}

// Search across BOTH halves of a catalog row: the raw fields (id, group, tags) via the
// catalog's own filterAdbCatalog, and the resolved English (label, description) which
// that helper deliberately cannot see, since it holds keys rather than text. Typing
// "wipe" hits a tag; typing "force" hits a label; both must work, and neither half alone
// does.
//
// Order is always the catalog's own — ranking by recency is step 6's job — and an empty
// query returns a copy of the whole list.
export function searchAdbCatalog(
  catalog: AdbCommandEntry[],
  query: string
): AdbCommandEntry[] {
  const needle = (query ?? "").trim().toLowerCase();
  if (needle === "") {
    return [...catalog];
  }
  const byField = new Set(filterAdbCatalog(catalog, needle).map((e) => e.id));
  return catalog.filter(
    (e) =>
      byField.has(e.id) ||
      l10n(e.labelKey).toLowerCase().includes(needle) ||
      l10n(e.descriptionKey).toLowerCase().includes(needle)
  );
}

// The header chip for a resolved profile. A workspace with no Android project yields
// undefined: the panel still opens (every connection/shell command works without one),
// but it says so instead of showing a blank package chip.
export function buildProjectWire(
  profile: AndroidProjectProfile | undefined
): RemoteControlProjectWire | undefined {
  if (!profile || !profile.hasAndroidProject) {
    return undefined;
  }
  return {
    hasAndroidProject: true,
    isFlutterProject: profile.isFlutterProject,
    ...(profile.defaultApplicationId
      ? { applicationId: profile.defaultApplicationId }
      : {}),
    variantCount: profile.applicationIds.length,
  };
}

export function remoteControlStrings(): RemoteControlStrings {
  return {
    run: l10n("remoteControl.run"),
    pin: l10n("remoteControl.pin"),
    pinTitle: l10n("remoteControl.pinTitle"),
    prompts: l10n("remoteControl.badge.prompts"),
    promptsTitle: l10n("remoteControl.badge.promptsTitle"),
    missingProject: l10n("remoteControl.badge.missingProject"),
    missingProjectTitle: l10n("remoteControl.badge.missingProjectTitle"),
    autoFilled: l10n("remoteControl.badge.autoFilled"),
    destructive: l10n("remoteControl.badge.destructive"),
    destructiveTitle: l10n("remoteControl.badge.destructiveTitle"),
    requiresDevice: l10n("remoteControl.badge.requiresDevice"),
    minSdk: l10n("remoteControl.badge.minSdk"),
    empty: l10n("remoteControl.empty"),
    count: l10n("remoteControl.count"),
    countFiltered: l10n("remoteControl.countFiltered"),
    projectPackage: l10n("remoteControl.project.package"),
    projectFlutter: l10n("remoteControl.project.flutter"),
    projectNone: l10n("remoteControl.project.none"),
    projectVariants: l10n("remoteControl.project.variants"),
  };
}

// Assemble the whole webview payload: rank, search, group, resolve, substitute, count.
// The one function the panel calls, and the one the unit tests exercise.
//
// The project profile SUBSTITUTES (every row previews its resolved command) but does not
// FILTER: hiding a group because a dependency is absent is the plan's "show/hide by
// relevance", which needs the connected device's API level too and belongs with the
// discovery step. `shown`/`total` therefore still count the catalog, not the rendered
// rows — the Recent pseudo-group duplicates rows rather than adding commands.
export function buildRemoteControlPayload(
  options: RemoteControlPayloadOptions = {}
): RemoteControlPayload {
  const catalog = options.catalog ?? ADB_COMMAND_CATALOG;
  const query = options.query ?? "";
  const matched = searchAdbCatalog(catalog, query);
  const groups: RemoteControlGroupWire[] = [];
  // The Recent pseudo-group first, when there is any history to show. It duplicates rows
  // that also render in their real group below — deliberately, and the same way the
  // Shortcuts tree's Recent root does: recency is a second route to a command, not a
  // relocation of it.
  const recentEntries = rankRecentAdbEntries(matched, options.recent, options.counts);
  if (recentEntries.length > 0) {
    groups.push({
      id: RECENT_GROUP_ID,
      label: l10n("adb.group.recent.label"),
      description: l10n("adb.group.recent.description"),
      commands: recentEntries.map((e) => resolveAdbCommand(e, options.profile)),
    });
  }
  for (const [group, entries] of groupAdbCatalog(matched)) {
    groups.push({
      id: group,
      label: l10n(adbGroupLabelKey(group)),
      description: l10n(adbGroupDescriptionKey(group)),
      commands: entries.map((e) => resolveAdbCommand(e, options.profile)),
    });
  }
  const project = buildProjectWire(options.profile);
  return {
    query,
    groups,
    shown: matched.length,
    total: catalog.length,
    ...(project ? { project } : {}),
    strings: remoteControlStrings(),
  };
}
