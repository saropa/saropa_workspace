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
// Not implemented here, by plan: execution, dry-run substitution, destructive
// confirmation and recent/frequent ranking (step 4+). A command's `commandTemplate` is
// carried through verbatim, placeholders and all, so the panel can show what WOULD run
// without pretending to resolve it.

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
import { l10n } from "../../i18n/l10n";

// One rendered command row. Flags travel as booleans rather than as pre-rendered badge
// text so the client can style the destructive marker differently from the informational
// ones; the badge WORDS come from `strings` below, once per payload instead of once per
// row.
export interface RemoteControlCommandWire {
  id: string;
  label: string;
  description: string;
  // The raw template, placeholders included. Shown as the row's monospace sub line so a
  // user can see exactly which adb invocation a row stands for.
  commandTemplate: string;
  requiresDevice: boolean;
  destructive: boolean;
  minSdk?: number;
}

// One collapsible section: a group's own heading/blurb plus its surviving rows. A group
// with no surviving row is never emitted (groupAdbCatalog drops it), so the panel can
// never render an empty, expandable header.
export interface RemoteControlGroupWire {
  id: AdbCommandGroup;
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
}

// Resolve one entry's l10n keys into the row the webview renders.
export function resolveAdbCommand(entry: AdbCommandEntry): RemoteControlCommandWire {
  return {
    id: entry.id,
    label: l10n(entry.labelKey),
    description: l10n(entry.descriptionKey),
    commandTemplate: entry.commandTemplate,
    requiresDevice: entry.requiresDevice,
    destructive: entry.destructive,
    ...(entry.minSdk === undefined ? {} : { minSdk: entry.minSdk }),
  };
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

// Assemble the whole webview payload: search, group, resolve, count. The one function
// the panel calls, and the one the unit tests exercise.
//
// The project profile is accepted and reported but NOT used to filter: hiding a group
// because a dependency is absent is the plan's "show/hide by relevance", which needs the
// device's API level too and belongs with the execution step. Passing it through now is
// what lets that land without changing this signature.
export function buildRemoteControlPayload(
  options: RemoteControlPayloadOptions = {}
): RemoteControlPayload {
  const catalog = options.catalog ?? ADB_COMMAND_CATALOG;
  const query = options.query ?? "";
  const matched = searchAdbCatalog(catalog, query);
  const groups: RemoteControlGroupWire[] = [];
  for (const [group, entries] of groupAdbCatalog(matched)) {
    groups.push({
      id: group,
      label: l10n(adbGroupLabelKey(group)),
      description: l10n(adbGroupDescriptionKey(group)),
      commands: entries.map(resolveAdbCommand),
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
