import * as vscode from "vscode";
import { Shortcut, ShortcutMetric, shortcutKind } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { formatBytes, parseSize } from "../exec/metricFormat";
import { l10n } from "../i18n/l10n";

// Roadmap #24 — Live metric badge editor.
//
// A small QuickPick flow to give a file shortcut a live inline badge: file size, line
// count, or last-modified. For the size metric it then offers an optional threshold
// — the file's badge turns to a warning and a one-time toast fires the moment the
// file grows past it ("tell me when bundle.js blows past 250 KB"). Choosing "Off"
// clears the metric (the engine disposes that shortcut's watcher on the next reconcile).

// The metric kinds offered, each with its l10n label/detail key.
interface KindChoice {
  kind: ShortcutMetric["kind"] | "off";
  labelKey: string;
  detailKey: string;
}

const KIND_CHOICES: readonly KindChoice[] = [
  { kind: "size", labelKey: "metric.kind.size", detailKey: "metric.kind.sizeDetail" },
  { kind: "lines", labelKey: "metric.kind.lines", detailKey: "metric.kind.linesDetail" },
  {
    kind: "modified",
    labelKey: "metric.kind.modified",
    detailKey: "metric.kind.modifiedDetail",
  },
  { kind: "off", labelKey: "metric.kind.off", detailKey: "metric.kind.offDetail" },
];

export async function setMetric(store: ShortcutStore, shortcut: Shortcut): Promise<void> {
  // Auto-shortcuts are recomputed each refresh and never stored in pins[], so there is
  // nowhere to persist a metric; surface that rather than silently failing.
  if (shortcut.isAuto) {
    vscode.window.showWarningMessage(l10n("metric.autoUnsupported"));
    return;
  }
  // A metric watches one file on disk; a non-file action shortcut (url / shell / command /
  // macro) has no single file to measure.
  if (shortcutKind(shortcut) !== "file") {
    vscode.window.showWarningMessage(l10n("metric.fileOnly"));
    return;
  }

  const name = shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
  const title = l10n("metric.title", { name });

  interface KindItem extends vscode.QuickPickItem {
    value: KindChoice["kind"];
  }
  const items: KindItem[] = KIND_CHOICES.map((c) => ({
    label: l10n(c.labelKey),
    detail: l10n(c.detailKey),
    value: c.kind,
    // Mark the shortcut's current kind so the picker opens on it.
    picked: (shortcut.metric?.kind ?? "off") === c.kind,
  }));
  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: l10n("metric.kindPlaceholder"),
  });
  if (!pick) {
    return; // Esc: leave the metric unchanged.
  }

  if (pick.value === "off") {
    await store.setShortcutMetric(shortcut, undefined);
    vscode.window.showInformationMessage(l10n("metric.cleared", { name }));
    return;
  }

  // A threshold only makes sense for the size metric (line count / modified have no
  // byte ceiling). For size, offer one; pre-fill the shortcut's current threshold.
  let thresholdBytes: number | undefined;
  if (pick.value === "size") {
    const seed =
      shortcut.metric?.kind === "size" && shortcut.metric.thresholdBytes !== undefined
        ? formatBytes(shortcut.metric.thresholdBytes)
        : "";
    const entered = await vscode.window.showInputBox({
      title,
      prompt: l10n("metric.thresholdPrompt"),
      placeHolder: l10n("metric.thresholdPlaceholder"),
      value: seed,
      validateInput: (input) => {
        const trimmed = input.trim();
        if (trimmed === "") {
          return undefined; // empty = no threshold (badge only)
        }
        return parseSize(trimmed) === undefined
          ? l10n("metric.thresholdInvalid")
          : undefined;
      },
    });
    if (entered === undefined) {
      return; // Esc on the threshold step aborts without writing.
    }
    thresholdBytes = entered.trim() === "" ? undefined : parseSize(entered.trim());
  }

  const metric: ShortcutMetric =
    pick.value === "size" && thresholdBytes !== undefined
      ? { kind: "size", thresholdBytes }
      : { kind: pick.value };
  await store.setShortcutMetric(shortcut, metric);

  // Name the metric (and the threshold when set) so the confirmation ties to the
  // concrete choice rather than a generic "saved".
  // Use the plain kind name (no codicon) for the toast — showInformationMessage
  // renders $(icon) syntax literally, so the picker labels would leak "$(dashboard)".
  const kindName = l10n(`metric.name.${pick.value}`);
  vscode.window.showInformationMessage(
    thresholdBytes !== undefined
      ? l10n("metric.savedThreshold", {
          name,
          kind: kindName,
          limit: formatBytes(thresholdBytes),
        })
      : l10n("metric.saved", { name, kind: kindName })
  );
}
