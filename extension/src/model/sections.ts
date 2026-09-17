import type { AndroidProjectProfile } from "./androidProjectProfile";

// The section registry (MOBILE_REMOTE_CONTROL_PLAN, "UI restructure" item 1) — one
// typed descriptor per capability the extension exposes as a surface of its own.
//
// The plan's structural diagnosis is that this extension has no notion of a
// "section" as a first-class object: every capability has paid its way in by
// registering a permanent tree view, a handful of palette commands and a slice of a
// context menu, and nothing anywhere knows what sections exist or whether one is
// relevant to the project in front of the user. This file is that missing list. It
// is the unit that progressive disclosure, relevance and usage tracking all key off,
// so nothing else in the UI should ever hard-code the list of sections again.
//
// DELIBERATELY PURE DATA. No `vscode` import, no view registration, no `setContext`
// call: a descriptor describes a section, it does not create one. The activation
// layer (activation/sectionContext.ts) publishes the context keys, and a later step
// builds the Control Center index view on top of this list. That split is what lets
// the whole registry be unit-tested with plain object fixtures.
//
// THIS STEP IS ADDITIVE ONLY. Registering a descriptor here changes nothing on
// screen: the six existing activity-bar views keep their unconditional
// contributions in package.json, and nothing is hidden. Items 2 and 4 of the plan
// (the Control Center view and the `go` omni-entry) are what consume this.

/**
 * How prominent a section should be for the project currently open.
 *
 * - `primary` — offer it up front; this project is what the section is for.
 * - `available` — keep it reachable (palette, Control Center index, search) but do
 *   not give it a default-prominent slot.
 * - `hidden` — do not surface it at all. Reserved for sections that would be
 *   actively meaningless; no descriptor returns it today, and a relevance function
 *   should prefer `available` whenever "the user might still want this" is
 *   plausible. Discoverability loss is the harder failure to notice.
 */
export type SectionRelevance = "primary" | "available" | "hidden";

/** One capability, described once, for everything that needs to reason about it. */
export interface SectionDescriptor {
  // Stable identity. Keys persistence (per-section usage tracking, user pinning) and
  // is never shown to a user, so it must not be renamed once shipped.
  id: string;
  // Runtime l10n key (i18n/locales/en.json), not a manifest %key% — the consumers of
  // this registry render from code, not from package.json.
  titleKey: string;
  // Codicon name, no "$(...)" wrapper, so a caller can use it as a ThemeIcon id or
  // interpolate it into webview markup as it needs.
  icon: string;
  // Is this section worth offering for the project in front of the user? Takes the
  // Android/Flutter profile because that is the only project signal that exists
  // today; `undefined` means "not resolved yet / no workspace folder", and every
  // implementation must treat that as "do not know" rather than "no".
  relevance: (profile: AndroidProjectProfile | undefined) => SectionRelevance;
  // The command that opens or reveals this section's surface. For a tree view this
  // is VS Code's generated `<viewId>.focus` command; for a webview panel it is the
  // section's own open command.
  entryCommand: string;
  // Free-text search terms, for the cross-section `go` QuickPick (plan item 4) and
  // the Control Center's filter. Lower-case, no punctuation.
  tags: string[];
}

// Most sections are project-agnostic: Shortcuts, Notes and the rest apply to any
// workspace, and this step is not the place to invent heuristics ("Watches only when
// watches exist", "Scripts only when a library entry is satisfiable") for
// capabilities it is not redesigning. Those land with the sections themselves; until
// then a constant `primary` keeps behavior identical to today.
const alwaysPrimary = (): SectionRelevance => "primary";

/**
 * Mobile Remote Control's relevance: front-and-center on an Android/Flutter project,
 * still reachable everywhere else.
 *
 * Never `hidden`, on purpose. An adb catalog is useful against a connected device
 * from any workspace (a repo of scripts, a docs folder, a project whose android/
 * directory has not been generated yet), and a user who cannot find the section at
 * all has no way to learn it exists. An unresolved profile (`undefined`) reads the
 * same as "no Android project": available, not promoted.
 */
export function mobileRemoteControlRelevance(
  profile: AndroidProjectProfile | undefined
): SectionRelevance {
  return profile?.hasAndroidProject === true ? "primary" : "available";
}

/**
 * Every section the extension exposes. Order is the default presentation order for
 * an index that has no usage data to sort by (plan item 7 adds that later).
 */
export const SECTION_REGISTRY: SectionDescriptor[] = [
  {
    id: "shortcuts",
    titleKey: "section.shortcuts.title",
    icon: "pin",
    relevance: alwaysPrimary,
    entryCommand: "saropaWorkspace.pins.focus",
    tags: ["shortcuts", "pins", "favorites", "files", "commands"],
  },
  {
    id: "recipes",
    titleKey: "section.recipes.title",
    icon: "lightbulb",
    relevance: alwaysPrimary,
    entryCommand: "saropaWorkspace.recipes.focus",
    tags: ["recipes", "suggestions", "detected", "tasks"],
  },
  {
    id: "watches",
    titleKey: "section.watches.title",
    icon: "eye",
    relevance: alwaysPrimary,
    entryCommand: "saropaWorkspace.watches.focus",
    tags: ["watches", "folders", "files", "changes"],
  },
  {
    id: "projectFiles",
    titleKey: "section.projectFiles.title",
    icon: "files",
    relevance: alwaysPrimary,
    entryCommand: "saropaWorkspace.projectFiles.focus",
    tags: ["project", "files", "versions", "manifests"],
  },
  {
    id: "scripts",
    titleKey: "section.scripts.title",
    icon: "terminal",
    relevance: alwaysPrimary,
    entryCommand: "saropaWorkspace.scripts.focus",
    tags: ["scripts", "library", "shell", "automation"],
  },
  {
    id: "notes",
    titleKey: "section.notes.title",
    icon: "note",
    relevance: alwaysPrimary,
    entryCommand: "saropaWorkspace.notes.focus",
    tags: ["notes", "scratch", "todo"],
  },
  {
    id: "dashboard",
    titleKey: "section.dashboard.title",
    icon: "dashboard",
    relevance: alwaysPrimary,
    entryCommand: "saropaWorkspace.openDashboard",
    tags: ["dashboard", "analytics", "trends", "processes"],
  },
  {
    id: "schedule",
    titleKey: "section.schedule.title",
    icon: "calendar",
    relevance: alwaysPrimary,
    entryCommand: "saropaWorkspace.openSchedule",
    tags: ["schedule", "timers", "cron", "recurring"],
  },
  {
    id: "planner",
    titleKey: "section.planner.title",
    icon: "checklist",
    relevance: alwaysPrimary,
    entryCommand: "saropaWorkspace.openPlanner",
    tags: ["planner", "routines", "sequence", "plan"],
  },
  {
    id: "mobileRemoteControl",
    titleKey: "section.mobileRemoteControl.title",
    icon: "device-mobile",
    relevance: mobileRemoteControlRelevance,
    entryCommand: "saropaWorkspace.openRemoteControl",
    tags: ["adb", "android", "device", "emulator", "mobile", "flutter"],
  },
];

/** The descriptor with this id, or undefined when nothing is registered under it. */
export function findSection(id: string): SectionDescriptor | undefined {
  return SECTION_REGISTRY.find((section) => section.id === id);
}

/** Every section whose relevance for this profile is `level`, in registry order. */
export function sectionsByRelevance(
  profile: AndroidProjectProfile | undefined,
  level: SectionRelevance
): SectionDescriptor[] {
  return SECTION_REGISTRY.filter((section) => section.relevance(profile) === level);
}

/**
 * The rows a section index (the Control Center view) shows for this profile:
 * `primary` sections first, then `available` ones, each block in registry order,
 * and `hidden` sections left out entirely.
 *
 * Pure on purpose — this is the whole ordering decision, so it can be unit-tested
 * against plain profile fixtures while the tree provider stays thin glue. The sort
 * is stable rather than clever: registry order is the designed default presentation
 * order, and until usage tracking exists (plan item 7) there is nothing better to
 * rank by, so relevance only ever promotes a whole block, never reshuffles within one.
 */
export function orderedSections(
  profile: AndroidProjectProfile | undefined
): SectionDescriptor[] {
  return [
    ...sectionsByRelevance(profile, "primary"),
    ...sectionsByRelevance(profile, "available"),
  ];
}
