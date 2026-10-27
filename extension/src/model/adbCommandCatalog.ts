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
import { ADB_CATALOG_CONNECT } from "./adbCatalogDataConnect";
import { ADB_CATALOG_DEVICE } from "./adbCatalogDataDevice";
import { AdbCommandEntry, AdbCommandGroup, ADB_COMMAND_GROUPS } from "./adbCatalogTypes";

// Re-exported so existing import paths keep working.
export {
  ADB_COMMAND_GROUPS,
  adbGroupLabelKey,
  adbGroupDescriptionKey,
} from "./adbCatalogTypes";
export type { AdbCommandGroup, AdbCommandEntry } from "./adbCatalogTypes";

// The full catalog, in the order the panel renders it.
export const ADB_COMMAND_CATALOG: AdbCommandEntry[] = [...ADB_CATALOG_CONNECT, ...ADB_CATALOG_DEVICE];

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
