import * as vscode from "vscode";
import { Shortcut, shortcutKind, isAnnotationShortcut } from "../model/shortcut";
import { RunResult } from "../exec/runStatus";
import { ShortcutBadge } from "../exec/shortcutBadges";
import { MetricBadge } from "../exec/metricBadges";
import { RunSource } from "../exec/telemetry";
import { resolveShortcutRowIcon } from "./shortcutRowTokens";
import { buildShortcutRowDescription } from "./shortcutRowDescription";
import { buildShortcutContextValue } from "./shortcutRowContext";
import { buildShortcutTooltipLines } from "./shortcutRowTooltip";
import { l10n } from "../i18n/l10n";

// The structural tree rows (Recent root, scope roots, group folders) live in
// pinTreeItems; re-exported here so the tree providers keep importing every tree
// node from one place.
export {
  RecentRootItem,
  ShortcutGroupItem,
  ShortcutFolderItem,
} from "./shortcutTreeItems";

// The divider glyph for a "separator" annotation row. A run of box-drawing dashes
// reads as a horizontal rule in the narrow sidebar (it truncates cleanly to the
// view width). Fixed here as the single source for the separator's appearance.
const SEPARATOR_LABEL = "─".repeat(40);

// Leading marker on the NAME of a shortcut the user has not yet opened or run
// ("untapped"): a per-row discovery cue for shortcuts added but never used. It leads
// the label (rendered in the full-strength foreground), NOT the description — a dot in
// the dimmed descriptionForeground color, next to an already-gray path, was too faint to
// spot. The row repaints the instant the shortcut is tapped (the provider listens to
// tappedShortcuts), so the dot disappears on first open/run.
const UNTAPPED_MARKER = "●";

// Tree node for a single shortcut. Selecting it fires the activate dispatcher, which
// decides open (single click) vs run (double click within the configured window).
//
// `recentInfo` renders the shortcut as an entry of the Recent group (local telemetry):
// it gives the node a distinct id namespace (so the same shortcut can appear both in
// its home scope and under Recent without an id collision) and shows when it last
// ran or was opened (tagged by kind) instead of the schedule/last-run badge.
export class ShortcutTreeItem extends vscode.TreeItem {
  // True when this node is a Recent-group entry; excluded from drag/drop so a
  // recent listing is read-only (the underlying shortcut is reordered from its home).
  readonly isRecent: boolean;

  constructor(
    readonly shortcut: Shortcut,
    resolvedUri: vscode.Uri | undefined,
    isRunning: boolean,
    lastRun?: RunResult,
    isStopping = false,
    recentInfo?: { at: number; source: RunSource; kind?: "run" | "opened" },
    // True when this file shortcut's target no longer exists on disk (computed by the
    // store's stat pass). Drives the warning glyph + "file not found" hover; the
    // open/run handlers re-stat at click time before acting on it.
    missing = false,
    // Lifetime run count for this shortcut (local telemetry, roadmap 3.3). Surfaced as
    // a tooltip line when greater than zero; the provider passes 0 when telemetry is
    // disabled so a turned-off user sees nothing. Reuses the count the telemetry
    // store already keeps — no separate collection path.
    runCount = 0,
    // When set, the display name of the prerequisite shortcut that has not yet
    // succeeded this session, so this shortcut is locked (WOW #13). Drives a lock
    // glyph, a "waiting on" badge, and a tooltip line. Undefined when the shortcut is
    // cleared to run.
    lockedBy?: string,
    // Lint severity counts / test tally from this shortcut's last sweep (#26, #32).
    // When present, a compact glyph lead ("3✖ 5⚠", "12✓ 1✗") prefixes the row and a
    // fuller line joins the hover. Undefined when the shortcut has produced no
    // parseable sweep.
    sweepBadge?: ShortcutBadge,
    // Live metric for a file shortcut (#24): size / line count / last-modified,
    // measured by the metric engine. Appended to the row as an inline value ("245 KB");
    // when `over` a size threshold, the icon is tinted as a warning. Undefined when the
    // shortcut carries no metric. Appended last (a narrow, well-named param) rather than
    // threaded through an options refactor, matching how sweepBadge above was added.
    metricBadge?: MetricBadge,
    // True when the user has not yet opened or run this shortcut. Drives the leading
    // untapped dot + a hover line marking it as not-yet-used. Recent entries are tapped
    // by definition, so they pass false. Annotation rows return before this is read (a
    // comment/separator is never "untapped").
    untapped = false
  ) {
    const kind = shortcutKind(shortcut);
    const isFile = kind === "file";
    const basename = shortcut.path.split("/").pop() ?? shortcut.path;
    // Masked / vault shortcut (WOW #26): the row must reveal nothing about the target,
    // so it shows a generic localized label (never the filename/alias) and, below,
    // hides the path from the detail/hover and shows a lock glyph. Computed before
    // super() because the displayed label is the super() argument.
    const masked = shortcut.masked === true;
    const baseLabel = masked
      ? l10n("mask.label")
      : shortcut.label ?? basename;
    // Lead the row name with the untapped dot so the marker sits in the full-strength
    // label color and is actually visible. Annotation rows overwrite this.label in their
    // early-return branch below, so a comment/separator never carries the dot even when
    // it is technically untapped.
    const displayLabel = untapped ? `${UNTAPPED_MARKER} ${baseLabel}` : baseLabel;
    super(displayLabel, vscode.TreeItemCollapsibleState.None);

    // Stable id (scope-qualified) so TreeView.reveal can match this node across
    // the tree being rebuilt — the status-bar "next scheduled run" reveals a shortcut
    // by constructing a fresh item with the same id.
    this.isRecent = recentInfo !== undefined;
    // A Recent entry uses a distinct id namespace so it never collides with the
    // same shortcut shown in its home scope (VS Code requires unique tree-item ids).
    this.id = this.isRecent
      ? `recent:${shortcut.scope}:${shortcut.id}`
      : `shortcut:${shortcut.scope}:${shortcut.id}`;
    // resourceUri drives the file-type icon/decorations; only meaningful for file
    // shortcuts. Non-file shortcuts (url/shell/command/macro) render from their own
    // glyph. A masked shortcut sets none: the file-type icon (and the decoration VS
    // Code derives from the path) would leak the target's extension/identity, the
    // opposite of the mask. Its lock glyph comes from resolveShortcutRowIcon instead.
    this.resourceUri = isFile && !masked ? resolvedUri : undefined;

    // Comment / separator: an inert annotation row. It has no command (a click does
    // nothing), no resourceUri, no badges — it only labels or divides the list.
    // Returning here keeps every run/badge/icon path below from treating it as a
    // real shortcut; combined with the absent `command`, that makes the row unreachable
    // by the click dispatcher (the model's discriminated-union guard in practice).
    if (isAnnotationShortcut(shortcut)) {
      this.resourceUri = undefined;
      if (kind === "separator") {
        // VS Code tree rows have no native divider, so a run of box-drawing
        // characters reads as a horizontal rule between groups of shortcuts. No icon:
        // the line itself is the whole visual, and a glyph would break it up.
        this.label = SEPARATOR_LABEL;
        this.tooltip = l10n("annotation.separatorTooltip");
        this.contextValue = "annotationSeparator";
        this.iconPath = undefined;
      } else {
        // Comment: the text is the label, marked by a muted comment glyph so it
        // reads as a note rather than a runnable shortcut. Empty text falls back to a
        // placeholder so the row stays selectable (and renamable).
        const text = shortcut.label?.trim();
        this.label =
          text && text.length > 0 ? text : l10n("annotation.commentEmpty");
        this.tooltip = this.label;
        this.contextValue = "annotationComment";
        this.iconPath = new vscode.ThemeIcon(
          "comment",
          new vscode.ThemeColor("descriptionForeground")
        );
      }
      // Deliberately NO this.command: an annotation is inert, so a click neither
      // opens nor runs. Returning leaves it a plain leaf node.
      return;
    }

    // Badge + description assembly (leading state badge, identity detail, live
    // metric) — extracted so this constructor stays a short sequence of builder
    // calls; see shortcutRowDescription.ts for the phase's own reasoning.
    const { description, metricText } = buildShortcutRowDescription({
      shortcut,
      masked,
      isFile,
      isRunning,
      isStopping,
      lastRun,
      lockedBy,
      sweepBadge,
      metricBadge,
      recentInfo,
    });
    this.description = description;

    // contextValue gates the menus; see shortcutRowContext.ts for the exact suffix
    // rules each menu clause depends on.
    this.contextValue = buildShortcutContextValue(shortcut, isRunning, isStopping);

    // Hover lines (target, live state, notices, last run, sweep/metric summaries,
    // gesture footer); see shortcutRowTooltip.ts for the phase's own reasoning.
    this.tooltip = buildShortcutTooltipLines({
      shortcut,
      masked,
      isFile,
      resolvedUri,
      isRunning,
      isStopping,
      missing,
      lockedBy,
      lastRun,
      sweepBadge,
      runCount,
      metricBadge,
      metricText,
      untapped,
    }).join("\n");

    // Row glyph + tint: the priority chain and every codicon/color token live in
    // the shared token map (UI plan, Phase 4), so the visual language is consistent
    // and learnable. The call site only states the inputs; the resolver owns which
    // state wins and what it looks like.
    this.iconPath = resolveShortcutRowIcon({
      isRunning,
      isStopping,
      isFile,
      hasResolvedUri: resolvedUri !== undefined,
      missing,
      locked: Boolean(lockedBy),
      masked,
      paused: Boolean(shortcut.paused),
      metricOver: Boolean(metricBadge?.over),
      lastRunOutcome: lastRun?.outcome,
      customIcon: shortcut.icon,
      customColor: shortcut.color,
      hasExpiry: Boolean(shortcut.expires),
      isAuto: Boolean(shortcut.isAuto),
      kind,
      fileName: isFile ? basename : undefined,
    });

    // Single command for click; the dispatcher reads timing to choose open/run.
    this.command = {
      command: "saropaWorkspace.activatePin",
      title: "Activate",
      arguments: [shortcut],
    };
  }
}
