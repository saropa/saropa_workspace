import {
  ADB_COMMAND_CATALOG,
  adbGroupLabelKey,
  groupAdbCatalog,
} from "../model/adbCommandCatalog";
import { resolveAdbCommand } from "./remoteControl/remoteControlData";
import type { AndroidProjectProfile } from "../model/androidProjectProfile";
import { l10n } from "../i18n/l10n";
import type { LauncherItem } from "./launcherItems";

// Build the launcher cards for the adb command catalog — Mobile Remote Control as a
// Launcher category (PLAN_Launcher_Restructure.md, "Mobile Remote Control as a category" /
// build-order step 2). This module reuses the SAME pure builders the standalone Mobile
// Remote Control panel renders from (ADB_COMMAND_CATALOG, groupAdbCatalog,
// resolveAdbCommand from remoteControlData.ts) instead of re-deriving the catalog, the
// grouping, or the profile-substitution logic here: it only reshapes an already-resolved
// row into the flat, group-tagged LauncherItem shape the other five adapters produce.
//
// Running or pinning a card is NOT wired here — this module is data-only, matching
// watchLauncherItem/fileLauncherItem. The launcher's message router (launcherViewMessages.ts)
// recognizes the "adb:" id prefix this module mints and forwards run/pin actions to the
// existing runAdbCommand()/pinAdbCommand() in remoteControl/remoteControlActions.ts — no
// new execution path.
//
// Grouped exactly like "mine"/"recipes"/"files": one collapsible group per catalog group
// (connection, appControl, files, …), in ADB_COMMAND_GROUPS order, via groupAdbCatalog. A
// group with no surviving row is already omitted by groupAdbCatalog, so an empty group
// never reaches the webview.
export function adbLauncherItems(profile?: AndroidProjectProfile): LauncherItem[] {
  const items: LauncherItem[] = [];
  for (const [group, entries] of groupAdbCatalog(ADB_COMMAND_CATALOG)) {
    const sectionLabel = l10n(adbGroupLabelKey(group));
    for (const entry of entries) {
      const resolved = resolveAdbCommand(entry, profile);
      // Surface the two flags a user needs BEFORE clicking Run, not after it fails: a row
      // that needs an attached device, or a device API level this one might not meet, gets
      // the same wording the standalone panel badges it with (remoteControlShell.ts /
      // remoteControl.badge.* below it), appended onto desc rather than added as new
      // LauncherItem fields (prompts/missingProject/autoFilled are the standalone panel's
      // own concerns — an about-to-run preview, not a pre-run warning — so they stay off
      // the card).
      const badgeParts: string[] = [];
      if (resolved.requiresDevice) {
        badgeParts.push(l10n("remoteControl.badge.requiresDevice"));
      }
      if (resolved.minSdk !== undefined) {
        badgeParts.push(l10n("remoteControl.badge.minSdk", { level: resolved.minSdk }));
      }
      // The catalog's own search terms (tags) do not reach any of the launcher's search
      // haystack fields (label/sub/desc/section — see launcherScriptCards.ts) unless folded
      // into one of them here, so a search for "wipe" or "sideload" matches nothing without
      // this. Appended after the badges, mirroring launcherScriptItem.ts's own
      // tags-into-a-visible-field precedent (there, sub; here, desc, since sub already
      // carries the resolved command preview).
      const descParts = [resolved.description];
      if (badgeParts.length > 0) {
        descParts.push(badgeParts.join(" · "));
      }
      if (entry.tags.length > 0) {
        descParts.push(entry.tags.join(", "));
      }
      items.push({
        // "adb:" mirrors the "library:" prefix scripts use (launcherScriptItem.ts) to
        // route an action back to the right host-side handler without a real Shortcut
        // behind it.
        id: `adb:${resolved.id}`,
        label: resolved.label,
        // The dry-run preview: the exact command this row would run once substituted
        // against the resolved project profile — the same string the standalone panel
        // shows, surfaced here as the card's secondary line.
        sub: resolved.command,
        desc: descParts.join(" · "),
        pane: "mobileRemote",
        section: sectionLabel,
        groupId: `mobileRemote:${group}`,
        groupIcon: "device-mobile",
        groupColor: "charts.green",
        // A destructive row gets the same warning tint the standalone panel badges it
        // with, so the two surfaces never disagree about which commands are dangerous.
        icon: resolved.destructive ? "warning" : "device-mobile",
        color: resolved.destructive ? "errorForeground" : "charts.green",
        kind: "shell",
        // Names the icon's hover tooltip, same as every other non-file adapter
        // (launcherItems.ts) — an adb row is a shell command, so it reuses that adapter's
        // own "shell" kind label rather than minting a near-duplicate string.
        kindLabel: l10n("launcher.kind.shell"),
        runnable: true,
        openable: false,
        headAction: "run",
        // No on-disk file backs an adb command, so there is nothing to copy a path to.
        copyable: false,
        menu: [],
      });
    }
  }
  return items;
}
