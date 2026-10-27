// Types, group list and entry helper for the adb command catalog. Split out of
// adbCommandCatalog.ts, which re-exports all of it.

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

/** One section of the adb command catalog. */
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

/** The l10n key for a group's description line. */
export function adbGroupDescriptionKey(group: AdbCommandGroup): string {
  return `adb.group.${group}.description`;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

// Shorthand: every entry derives its two l10n keys from its id, so the two can
// never drift apart and a new entry cannot silently ship without strings (the
// unit test asserts both resolve).
export function entry(
  e: Omit<AdbCommandEntry, "labelKey" | "descriptionKey">
): AdbCommandEntry {
  return {
    ...e,
    labelKey: `adb.${e.id}.label`,
    descriptionKey: `adb.${e.id}.description`,
  };
}
