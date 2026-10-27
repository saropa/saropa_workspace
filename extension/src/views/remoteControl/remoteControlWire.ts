// Wire types for the Mobile Remote Control panel: the payload the host posts to the
// webview and the pieces it is built from. Types only. Split out of
// remoteControlData.ts, which re-exports them.

import { AdbCommandEntry, AdbCommandGroup, groupAdbCatalog } from "../../model/adbCommandCatalog";

import { AndroidProjectProfile } from "../../model/androidProjectProfile";

import { AdbEnvironment } from "../../exec/adbEnvironment";

// The synthetic group id of the "Recent" pseudo-group. Not an AdbCommandGroup — it is an
// arrangement, not a catalog bucket — so it is spelled out here and widens the wire
// type's `id` rather than polluting ADB_COMMAND_GROUPS (a Recent entry must still appear
// in its real group below).
export const RECENT_GROUP_ID = "recent";

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

// The adb availability / connection-health block (MOBILE_REMOTE_CONTROL_PLAN section 5).
// Every word is resolved here, like everything else on the wire; the client only picks a
// tone class and, when adb is missing, renders the guidance banner instead of a chip.
export interface RemoteControlAdbWire {
  // adb resolved on PATH. False is the "adb not found" state, which is a BANNER rather
  // than a chip: it explains why nothing here will run, and how to fix it.
  available: boolean;
  // The header chip's text: "No device connected" / "2 devices connected", plus the
  // unauthorized/offline qualifier when one applies.
  status: string;
  // The chip's hover — the resolved adb path, or why the device query produced nothing.
  detail: string;
  // Drives the chip/banner styling only: "ok" once a device can actually be commanded.
  tone: "ok" | "warn" | "error";
  // Shown only when `available` is false: the headline and the install guidance.
  missingTitle?: string;
  missingBody?: string;
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
  adbRefresh: string;
  adbRefreshTitle: string;
  adbChecking: string;
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
  // The adb availability / device-count block. Absent only before the first probe has
  // answered, which the client renders as the neutral "checking" chip rather than
  // claiming either state.
  adb?: RemoteControlAdbWire;
  strings: RemoteControlStrings;
}

/** Inputs for building the Remote Control payload; every field is optional and passed as data so the builder stays pure. */
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
  // The last adb probe (exec/adbEnvironment.probeAdbEnvironment()). Passed as data, so
  // this module stays pure and no test needs adb installed.
  adb?: AdbEnvironment;
}
