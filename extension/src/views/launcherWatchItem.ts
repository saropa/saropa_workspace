import type { FolderWatchMode } from "../model/folderWatch";
import { l10n } from "../i18n/l10n";
import type { LauncherItem } from "./launcherItems";

// The plain inputs the host distills a FolderWatch + its unseen count into, so the row
// builder below stays vscode-free and unit-testable. The host (launcherView) owns the
// FolderWatchStore reads (label fallback, unseen tally); this only formats the card.
export interface WatchItemInput {
  readonly id: string;
  readonly label: string;
  readonly target: string;
  readonly isFile: boolean;
  readonly mode: FolderWatchMode;
  readonly enabled: boolean;
  readonly unseen: number;
  // Whether the watch is global (alerts in every project). The card marks it with a
  // globe glyph and a "global" note, mirroring the Watches sidebar row.
  readonly isGlobal: boolean;
}

// Build the launcher card for one folder/file watch. The glyph, tint, and secondary line
// mirror the Watches sidebar row (watchesTreeProvider) exactly so the two surfaces never
// disagree: a disabled watch reads muted (closed eye, "off"); a global watch carries a
// globe glyph and a "global" note; an enabled watch with unseen files leads with the count
// on a blue glyph; an idle local one shows a plain eye. The card is openable but not
// runnable — a primary click expands the drawer (whose Open clears the unseen counter),
// never opens on the bare click, so an accidental click cannot mark a watch seen (the
// launcher's deliberate browse-then-act model; styleguide 1.1a / 4.5).
export function watchLauncherItem(w: WatchItemInput): LauncherItem {
  const kind = l10n(w.isFile ? "folderWatch.kindFile" : "folderWatch.kindFolder");
  const mode = l10n(
    w.mode === "changed" ? "folderWatch.modeChanged" : "folderWatch.modeNew"
  );

  let icon: string;
  let color: string;
  let sub: string;
  if (!w.enabled) {
    icon = "eye-closed";
    color = "descriptionForeground";
    sub = l10n("watchesView.rowOff", { kind, mode });
  } else if (w.isGlobal && w.unseen > 0) {
    icon = "globe";
    color = "charts.blue";
    sub = l10n("watchesView.rowGlobalUnseen", { count: w.unseen, kind, mode });
  } else if (w.isGlobal) {
    icon = "globe";
    color = "foreground";
    sub = l10n("watchesView.rowGlobal", { kind, mode });
  } else if (w.unseen > 0) {
    icon = "bell-dot";
    color = "charts.blue";
    sub = l10n("watchesView.rowUnseen", { count: w.unseen, kind, mode });
  } else {
    icon = "eye";
    color = "foreground";
    sub = l10n("watchesView.rowIdle", { kind, mode });
  }

  return {
    id: w.id,
    label: w.label,
    sub,
    // The drawer surfaces the watched path so the user can confirm which target this is
    // before opening it (the card head shows only the label + state line).
    desc: w.target,
    pane: "watches",
    section: l10n("launcher.watchesSection"),
    groupId: "watches",
    groupIcon: "eye",
    groupColor: "charts.blue",
    icon,
    color,
    // "file" so no kind chip renders — a watch is not a runnable shell/macro/routine.
    kind: "file",
    runnable: false,
    openable: true,
    menu: [],
  };
}
