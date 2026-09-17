// The adb command catalog (MOBILE_REMOTE_CONTROL_PLAN section 2): the static,
// typed data the Mobile Remote Control panel renders as a searchable, grouped card
// list. Data, not code — every individual adb command lives here rather than as a
// `contributes.commands` entry, per the plan's rule that a section contributes two
// palette commands and nothing more.
//
// This module is deliberately inert: it holds no VS Code imports, runs no process,
// and resolves no placeholder. Rendering (section 3), auto-fill from
// AndroidProjectProfile and execution through exec/runner.ts (sections 4-5) are
// later steps that consume this list. Keeping it pure is what makes it unit
// testable and what keeps the panel's search a synchronous, allocation-cheap
// operation.
//
// Out of scope by plan: logcat and any other log streaming, which belongs to the
// separate Saropa Log Capture extension. No entry here streams logs.
//
// ---------------------------------------------------------------------------
// Placeholder token convention
// ---------------------------------------------------------------------------
//
// `commandTemplate` is a shell string carrying `{token}` placeholders. Substitution
// is NOT implemented here — the execution layer resolves them, some from the
// project profile and the rest from the existing `${prompt:...}` /
// `${pickFolder:...}` templating that library.json shortcuts already use. The
// tokens in use, and where each is expected to come from:
//
//   {applicationId}  AndroidProjectProfile.applicationIds — the selected variant's
//                    resolved package id, defaultApplicationId when none is picked.
//   {scheme},{host}  AndroidProjectProfile.deepLinks — one generated command per
//                    manifest intent-filter pair. `{host}` may resolve to "" for a
//                    custom scheme with no authority.
//   {path}           Deep-link path/query suffix, user supplied (intent lab).
//   {permission}     An android.permission.* name, from the manifest's declared
//                    permissions or the permission inspector's checklist.
//   {host}:{port}    Wireless debugging endpoint; {port} also carries the debug
//                    service port for `adb reverse`.
//   {pairingCode}    The six-digit code shown by Android's wireless pairing dialog.
//   {localPath}      A path in the workspace, prompted or picked.
//   {remotePath}     A path on the device, e.g. /sdcard/Download/file.txt.
//   {x},{y},{x2},{y2},{durationMs},{text},{keycode}
//                    Input-synthesis arguments, all user supplied.
//   {command}        A raw shell command, for the passthrough entry only.
//
// A token is always written bare in braces with no default and no nesting, so the
// execution layer can find every one of them with a single scan and refuse to run
// a command that still has an unresolved placeholder.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// The catalog's top-level buckets, in the order the panel renders them: the
// connection lifecycle first (nothing else works without a device), then the
// everyday app loop, then the occasional and the dangerous. Declared as a const
// tuple rather than a TS `enum` so the order is data the UI can iterate and the
// values stay plain strings in serialized webview messages.
export const ADB_COMMAND_GROUPS = [
  "connection",
  "appControl",
  "files",
  "deviceInfo",
  "inputUi",
  "powerReboot",
  "permissions",
  "deepLinks",
  "shell",
] as const;

export type AdbCommandGroup = (typeof ADB_COMMAND_GROUPS)[number];

// One runnable catalog row.
export interface AdbCommandEntry {
  // Stable, unique, dotted `<group>.<verb>` id. It is the key the panel's run
  // message carries, the l10n key stem, and what pinning/recency records — so it
  // is an API: renaming one orphans a user's pin.
  id: string;
  group: AdbCommandGroup;
  // Catalog keys into src/i18n/locales/en.json, by convention
  // `adb.<id>.label` / `adb.<id>.description`. No English lives in this file.
  labelKey: string;
  descriptionKey: string;
  // The shell string, with `{token}` placeholders per the convention above.
  commandTemplate: string;
  // Free-text search terms that are NOT derivable from the id — synonyms, the
  // underlying adb/Android verb, and the vocabulary a developer actually types
  // ("wifi", "apk", "wipe"). Lowercase, deduped by hand.
  tags: string[];
  // False only for commands that work with no device attached (connect, pair,
  // list devices, server management) — the panel greys the rest out when nothing
  // is connected instead of letting them fail with a raw adb error.
  requiresDevice: boolean;
  // True when running it destroys state: uninstalls, wipes app data, kills the
  // running app, deletes a file, or reboots the device. The panel badges these
  // and the execution layer requires a dry-run confirm before running one.
  destructive: boolean;
  // Minimum device API level, when the command only exists above one. Compared
  // against `getprop ro.build.version.sdk`; absent means "works everywhere the
  // extension cares about".
  minSdk?: number;
}

// The l10n keys for a group's own heading and blurb, by the same
// derive-from-the-id rule the entries use. The panel renders one collapsible
// section per group, so these live here beside the group list rather than being
// spelled out again in the view layer.
export function adbGroupLabelKey(group: AdbCommandGroup): string {
  return `adb.group.${group}.label`;
}

export function adbGroupDescriptionKey(group: AdbCommandGroup): string {
  return `adb.group.${group}.description`;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

// Shorthand: every entry derives its two l10n keys from its id, so the two can
// never drift apart and a new entry cannot silently ship without strings (the
// unit test asserts both resolve).
function entry(
  e: Omit<AdbCommandEntry, "labelKey" | "descriptionKey">
): AdbCommandEntry {
  return {
    ...e,
    labelKey: `adb.${e.id}.label`,
    descriptionKey: `adb.${e.id}.description`,
  };
}

export const ADB_COMMAND_CATALOG: AdbCommandEntry[] = [
  // --- Connection ----------------------------------------------------------
  // Subsumes the adb half of the bundled device-connect Python script
  // (debug_connect/connect.py, core.py), which the plan retires in favour of
  // these entries.
  entry({
    id: "connection.list-devices",
    group: "connection",
    commandTemplate: "adb devices -l",
    tags: ["devices", "list", "attached", "serial", "emulator"],
    requiresDevice: false,
    destructive: false,
  }),
  entry({
    id: "connection.connect",
    group: "connection",
    commandTemplate: "adb connect {host}:{port}",
    tags: ["wireless", "wifi", "tcp", "network", "attach"],
    requiresDevice: false,
    destructive: false,
  }),
  entry({
    id: "connection.pair",
    group: "connection",
    commandTemplate: "adb pair {host}:{port} {pairingCode}",
    tags: ["wireless", "wifi", "pairing", "code", "developer options"],
    requiresDevice: false,
    destructive: false,
    // Wireless debugging pairing landed in Android 11.
    minSdk: 30,
  }),
  entry({
    id: "connection.tcpip",
    group: "connection",
    commandTemplate: "adb tcpip {port}",
    tags: ["wireless", "wifi", "usb", "switch", "port"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "connection.disconnect",
    group: "connection",
    commandTemplate: "adb disconnect {host}:{port}",
    tags: ["wireless", "wifi", "detach", "drop"],
    requiresDevice: false,
    destructive: false,
  }),
  entry({
    id: "connection.reverse",
    group: "connection",
    commandTemplate: "adb reverse tcp:{port} tcp:{port}",
    tags: ["port", "forward", "debug", "flutter", "devtools", "localhost"],
    requiresDevice: true,
    destructive: false,
  }),

  // --- App control ---------------------------------------------------------
  entry({
    id: "appControl.install",
    group: "appControl",
    commandTemplate: "adb install -r {localPath}",
    tags: ["apk", "sideload", "deploy", "reinstall", "update"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "appControl.uninstall",
    group: "appControl",
    commandTemplate: "adb uninstall {applicationId}",
    tags: ["remove", "delete", "apk", "package"],
    requiresDevice: true,
    destructive: true,
  }),
  entry({
    id: "appControl.clear-data",
    group: "appControl",
    commandTemplate: "adb shell pm clear {applicationId}",
    tags: ["wipe", "reset", "storage", "preferences", "cache", "first run"],
    requiresDevice: true,
    destructive: true,
  }),
  entry({
    id: "appControl.force-stop",
    group: "appControl",
    commandTemplate: "adb shell am force-stop {applicationId}",
    tags: ["kill", "quit", "stop", "process"],
    requiresDevice: true,
    destructive: true,
  }),
  entry({
    id: "appControl.launch",
    group: "appControl",
    commandTemplate:
      "adb shell monkey -p {applicationId} -c android.intent.category.LAUNCHER 1",
    tags: ["start", "open", "run", "launcher", "cold start"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "appControl.list-packages",
    group: "appControl",
    commandTemplate: "adb shell pm list packages -3",
    tags: ["packages", "installed", "third party", "find", "search"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "appControl.package-info",
    group: "appControl",
    commandTemplate: "adb shell dumpsys package {applicationId}",
    tags: ["dumpsys", "version", "signature", "installer", "details"],
    requiresDevice: true,
    destructive: false,
  }),

  // --- Files ---------------------------------------------------------------
  entry({
    id: "files.push",
    group: "files",
    commandTemplate: "adb push {localPath} {remotePath}",
    tags: ["upload", "copy", "transfer", "sdcard", "fixture"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "files.pull",
    group: "files",
    commandTemplate: "adb pull {remotePath} {localPath}",
    tags: ["download", "copy", "transfer", "fetch", "screenshot"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "files.delete",
    group: "files",
    commandTemplate: "adb shell rm -r {remotePath}",
    tags: ["remove", "wipe", "cleanup", "sdcard"],
    requiresDevice: true,
    destructive: true,
  }),

  // --- Device info ---------------------------------------------------------
  entry({
    id: "deviceInfo.properties",
    group: "deviceInfo",
    commandTemplate: "adb shell getprop",
    tags: ["getprop", "model", "manufacturer", "locale", "abi", "build"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "deviceInfo.sdk-level",
    group: "deviceInfo",
    commandTemplate: "adb shell getprop ro.build.version.sdk",
    tags: ["getprop", "api", "android version", "minsdk", "targetsdk"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "deviceInfo.battery",
    group: "deviceInfo",
    commandTemplate: "adb shell dumpsys battery",
    tags: ["dumpsys", "power", "charge", "level", "temperature"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "deviceInfo.meminfo",
    group: "deviceInfo",
    commandTemplate: "adb shell dumpsys meminfo {applicationId}",
    tags: ["dumpsys", "memory", "ram", "heap", "leak", "profile"],
    requiresDevice: true,
    destructive: false,
  }),

  // --- Input / UI ----------------------------------------------------------
  entry({
    id: "inputUi.tap",
    group: "inputUi",
    commandTemplate: "adb shell input tap {x} {y}",
    tags: ["touch", "click", "press", "coordinates", "automation"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "inputUi.swipe",
    group: "inputUi",
    commandTemplate: "adb shell input swipe {x} {y} {x2} {y2} {durationMs}",
    tags: ["scroll", "drag", "fling", "gesture", "automation"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "inputUi.text",
    group: "inputUi",
    commandTemplate: "adb shell input text {text}",
    tags: ["type", "keyboard", "fill", "form", "automation"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "inputUi.keyevent",
    group: "inputUi",
    commandTemplate: "adb shell input keyevent {keycode}",
    tags: ["key", "back", "home", "enter", "volume", "automation"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "inputUi.screencap",
    group: "inputUi",
    commandTemplate: "adb exec-out screencap -p > {localPath}",
    tags: ["screenshot", "capture", "png", "docs", "bug report"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "inputUi.screenrecord",
    group: "inputUi",
    commandTemplate: "adb shell screenrecord {remotePath}",
    tags: ["video", "record", "capture", "mp4", "demo", "repro"],
    requiresDevice: true,
    destructive: false,
  }),

  // --- Power / reboot ------------------------------------------------------
  entry({
    id: "powerReboot.reboot",
    group: "powerReboot",
    commandTemplate: "adb reboot",
    tags: ["restart", "power cycle", "reset"],
    requiresDevice: true,
    destructive: true,
  }),
  entry({
    id: "powerReboot.reboot-recovery",
    group: "powerReboot",
    commandTemplate: "adb reboot recovery",
    tags: ["restart", "recovery", "sideload", "factory"],
    requiresDevice: true,
    destructive: true,
  }),
  entry({
    id: "powerReboot.reboot-bootloader",
    group: "powerReboot",
    commandTemplate: "adb reboot bootloader",
    tags: ["restart", "bootloader", "fastboot", "flash"],
    requiresDevice: true,
    destructive: true,
  }),
  entry({
    id: "powerReboot.screen-toggle",
    group: "powerReboot",
    commandTemplate: "adb shell input keyevent 26",
    tags: ["screen", "wake", "sleep", "display", "lock"],
    requiresDevice: true,
    destructive: false,
  }),

  // --- Permissions ---------------------------------------------------------
  entry({
    id: "permissions.grant",
    group: "permissions",
    commandTemplate: "adb shell pm grant {applicationId} {permission}",
    tags: ["allow", "runtime", "camera", "location", "dangerous"],
    requiresDevice: true,
    destructive: false,
    // Runtime permissions (and therefore pm grant/revoke) arrived in Android 6.
    minSdk: 23,
  }),
  entry({
    id: "permissions.revoke",
    group: "permissions",
    commandTemplate: "adb shell pm revoke {applicationId} {permission}",
    tags: ["deny", "runtime", "camera", "location", "dangerous"],
    requiresDevice: true,
    destructive: false,
    minSdk: 23,
  }),
  entry({
    id: "permissions.reset",
    group: "permissions",
    // `pm reset-permissions` takes no package: it resets the runtime permissions of EVERY
    // app on the device. Passing {applicationId} was inert and made the dry-run preview
    // imply a per-app scope it never had, so the token is gone and the entry is flagged
    // destructive to get the warning-severity confirm.
    commandTemplate: "adb shell pm reset-permissions",
    tags: ["reset", "runtime", "first run", "prompt", "qa", "all apps", "device-wide"],
    requiresDevice: true,
    destructive: true,
    minSdk: 23,
  }),
  entry({
    id: "permissions.list",
    group: "permissions",
    commandTemplate: "adb shell dumpsys package {applicationId} permissions",
    tags: ["dumpsys", "granted", "denied", "inspect", "audit"],
    requiresDevice: true,
    destructive: false,
  }),

  // --- Deep links ----------------------------------------------------------
  // The templates that AndroidProjectProfile.deepLinks fills in, one generated
  // command per manifest intent-filter scheme/host pair.
  entry({
    id: "deepLinks.open",
    group: "deepLinks",
    commandTemplate:
      "adb shell am start -a android.intent.action.VIEW -d {scheme}://{host}",
    tags: ["intent", "url", "link", "route", "navigate"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "deepLinks.open-path",
    group: "deepLinks",
    commandTemplate:
      "adb shell am start -a android.intent.action.VIEW -p {applicationId} -d {scheme}://{host}{path}",
    tags: ["intent", "url", "link", "route", "query", "parameters"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "deepLinks.app-links",
    group: "deepLinks",
    commandTemplate: "adb shell pm get-app-links {applicationId}",
    tags: ["verification", "domain", "https", "autoverify", "assetlinks"],
    requiresDevice: true,
    destructive: false,
    // pm get-app-links is an Android 12 addition.
    minSdk: 31,
  }),

  // --- Shell / misc --------------------------------------------------------
  entry({
    id: "shell.interactive",
    group: "shell",
    commandTemplate: "adb shell",
    tags: ["terminal", "prompt", "session", "console"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "shell.run",
    group: "shell",
    commandTemplate: "adb shell {command}",
    tags: ["passthrough", "custom", "arbitrary", "one-off"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "shell.restart-server",
    group: "shell",
    commandTemplate: "adb kill-server && adb start-server",
    tags: ["daemon", "restart", "unstick", "offline", "troubleshoot"],
    requiresDevice: false,
    destructive: false,
  }),
];

// ---------------------------------------------------------------------------
// Pure helpers for the panel
// ---------------------------------------------------------------------------

// Substring match over an entry's id, tags and group — the raw catalog fields, in
// lowercase. Deliberately NOT a match over label/description: those are l10n keys
// here and only become text once resolved, so the UI layer combines this result
// with its own match over the rendered strings. Keeping the l10n lookup out of
// this function is what lets it be tested without a catalog.
//
// An empty or whitespace-only query returns the input list (a new array, so a
// caller can sort it without mutating the catalog constant). Order is always the
// catalog's own order; ranking by recency is the caller's job (recentRuns.ts).
export function filterAdbCatalog(
  catalog: AdbCommandEntry[],
  query: string
): AdbCommandEntry[] {
  const needle = (query ?? "").trim().toLowerCase();
  if (needle === "") {
    return [...catalog];
  }
  return catalog.filter(
    (e) =>
      e.id.toLowerCase().includes(needle) ||
      e.group.toLowerCase().includes(needle) ||
      e.tags.some((tag) => tag.toLowerCase().includes(needle))
  );
}

// Bucket entries by group for the panel's collapsible sections. Groups are keyed
// in ADB_COMMAND_GROUPS order (not first-seen order), so the rendered section
// order is stable no matter how the input list was filtered or sorted, and a group
// with no surviving entry is omitted rather than rendered empty — matching the
// extension's never-silently-empty rule.
export function groupAdbCatalog(
  catalog: AdbCommandEntry[]
): Map<AdbCommandGroup, AdbCommandEntry[]> {
  const buckets = new Map<AdbCommandGroup, AdbCommandEntry[]>();
  for (const group of ADB_COMMAND_GROUPS) {
    const inGroup = catalog.filter((e) => e.group === group);
    if (inGroup.length > 0) {
      buckets.set(group, inGroup);
    }
  }
  return buckets;
}
