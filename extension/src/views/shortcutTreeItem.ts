import * as vscode from "vscode";
import { Shortcut, shortcutKind, isAnnotationShortcut } from "../model/shortcut";
import { shortcutDisplayName } from "../model/shortcutDisplayName";
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

/** Named options for constructing a {@link ShortcutTreeItem}. Only `shortcut`
 * is required; every other field defaults to the safe resting state. */
export interface ShortcutTreeItemOptions {
  readonly shortcut: Shortcut;
  readonly resolvedUri?: vscode.Uri;
  readonly isRunning?: boolean;
  readonly lastRun?: RunResult;
  readonly isStopping?: boolean;
  /** Tags this node as a Recent-group entry with when/how it last ran. */
  readonly recentInfo?: { at: number; source: RunSource; kind?: "run" | "opened" };
  /** True when the file shortcut's target no longer exists on disk. */
  readonly missing?: boolean;
  /** Lifetime run count (local telemetry). 0 when telemetry is disabled. */
  readonly runCount?: number;
  /** Display name of the unmet run prerequisite (WOW #13). */
  readonly lockedBy?: string;
  /** Lint severity / test tally from the last sweep (#26, #32). */
  readonly sweepBadge?: ShortcutBadge;
  /** The badge from the run before the current one, for the ▲/▼ trend delta. */
  readonly previousBadge?: ShortcutBadge;
  /** Live metric for a file shortcut (#24): size / line count / modified. */
  readonly metricBadge?: MetricBadge;
  /** True when the user has not yet opened or run this shortcut. */
  readonly untapped?: boolean;
  /** True when this manual pin's path matches an auto-pin pattern (the auto was suppressed). */
  readonly shadowsAuto?: boolean;
  /** Owning workspace folder name (multi-root only, project-scoped only). */
  readonly owningFolder?: string;
}

// Tree node for a single shortcut. Selecting it fires the activate dispatcher, which
// decides open (single click) vs run (double click within the configured window).
export class ShortcutTreeItem extends vscode.TreeItem {
  readonly isRecent: boolean;
  readonly shortcut: Shortcut;

  constructor(opts: ShortcutTreeItemOptions) {
    const {
      shortcut,
      resolvedUri,
      isRunning = false,
      lastRun,
      isStopping = false,
      recentInfo,
      missing = false,
      runCount = 0,
      lockedBy,
      sweepBadge,
      previousBadge,
      metricBadge,
      untapped = false,
      shadowsAuto = false,
      owningFolder,
    } = opts;
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
      : shortcutDisplayName(shortcut);
    // Lead the row name with the untapped dot so the marker sits in the full-strength
    // label color and is actually visible. Annotation rows overwrite this.label in their
    // early-return branch below, so a comment/separator never carries the dot even when
    // it is technically untapped.
    const displayLabel = untapped ? `${UNTAPPED_MARKER} ${baseLabel}` : baseLabel;
    super(displayLabel, vscode.TreeItemCollapsibleState.None);
    this.shortcut = shortcut;

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

    if (isAnnotationShortcut(shortcut)) {
      applyAnnotationLayout(this, shortcut, kind);
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
      previousBadge,
      metricBadge,
      recentInfo,
      owningFolder,
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
      previousBadge,
      runCount,
      metricBadge,
      metricText,
      untapped,
      customColor: shortcut.color,
      shadowsAuto,
      owningFolder,
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
      shadowsAuto,
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

// Inert annotation row (comment or separator). No command — a click does nothing.
function applyAnnotationLayout(
  item: vscode.TreeItem,
  shortcut: Shortcut,
  kind: ReturnType<typeof shortcutKind>
): void {
  item.resourceUri = undefined;
  if (kind === "separator") {
    item.label = SEPARATOR_LABEL;
    item.tooltip = l10n("annotation.separatorTooltip");
    item.contextValue = "annotationSeparator";
    item.iconPath = undefined;
  } else {
    const text = shortcut.label?.trim();
    item.label =
      text && text.length > 0 ? text : l10n("annotation.commentEmpty");
    item.tooltip = item.label;
    item.contextValue = "annotationComment";
    item.iconPath = new vscode.ThemeIcon(
      "comment",
      new vscode.ThemeColor("descriptionForeground")
    );
  }
}
