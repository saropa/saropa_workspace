import * as vscode from "vscode";
import { ShortcutMetric } from "../model/shortcut";
import { countLines, formatBytes } from "./metricFormat";
import { l10n } from "../i18n/l10n";

// Live metric badges for file shortcuts (#24): file size, line count, or last-modified,
// shown inline in the tree and refreshed as the file changes on disk. The point is
// to watch a build artifact / dump / log shrink or grow without switching to a
// terminal and typing `ls -lh` — and, when a size threshold is set, to be toasted
// the moment the file grows past it.
//
// PERFORMANCE (the whole design is built around not slowing the editor down):
//   - OPT-IN ONLY. A shortcut is watched only when the user explicitly set a metric on
//     it; a workspace with no metric'd shortcuts arms zero watchers and costs nothing.
//   - ONE NON-RECURSIVE WATCHER PER METRIC'D SHORTCUT, scoped to the single exact file
//     (a RelativePattern of dir + basename, never `**`). VS Code file watchers are
//     OS-backed (inotify / ReadDirectoryChangesW), not polling, so an idle watcher
//     is free.
//   - DEBOUNCED. A file written continuously (a bundler streaming output) fires many
//     change events; they collapse into one stat after a quiet window, not a stat
//     per write.
//   - SIZE-CAPPED READS. Line counting reads the file, so it is capped: above the
//     cap the badge degrades to showing size, so a multi-GB dump is never read.
//   - stat, not read, for size / modified — a single cheap syscall.
//
// In-memory and per-session like runStatusRegistry / shortcutBadges: a badge is recomputed
// from disk on demand and a fresh window re-measures. The engine owns disposables
// (the watchers), so it is disposed on deactivation (see extension.ts).

// Above this size, line counting would mean reading a very large file into memory;
// the badge degrades to size-only instead. 5 MB is comfortably larger than any source
// file while still cheap to read for the line count.
const LINE_COUNT_CAP_BYTES = 5 * 1024 * 1024;

// Quiet window before a watched file's change is measured. Long enough to coalesce a
// burst of writes (a build streaming output) into one stat; short enough that the
// badge still reads as live.
const DEBOUNCE_MS = 400;

// What the tree renders for a pin's metric. Size / line text is stable between file
// changes, so it is precomputed; "modified" carries the raw mtime and is formatted
// relative at paint time so it never goes stale between repaints (5 min -> 1 hour).
export interface MetricBadge {
  kind: ShortcutMetric["kind"];
  // size / lines: the formatted value ("245 KB", "1,203 lines"). Undefined for the
  // "modified" kind (which uses mtime instead).
  text?: string;
  // modified: the file's last-modified epoch ms, formatted relative by the tree.
  mtime?: number;
  // True when a size threshold is set and the file currently exceeds it. Drives the
  // warning tint on the row.
  over: boolean;
}

// A shortcut the provider asks the engine to watch: its id, a display name (for the
// over-threshold toast), the resolved file URI, and the metric to compute.
export interface MetricTarget {
  pinId: string;
  name: string;
  uri: vscode.Uri;
  metric: ShortcutMetric;
}

// Per-watched-shortcut live state: the watcher to dispose, the URI + metric it was armed
// for (so a changed target re-arms), a pending debounce timer, and the last over
// state (undefined = not yet measured, so the first measure never toasts).
interface Entry {
  name: string;
  uri: vscode.Uri;
  metric: ShortcutMetric;
  watcher: vscode.FileSystemWatcher;
  debounce?: ReturnType<typeof setTimeout>;
  lastOver?: boolean;
}

class MetricBadgeRegistry implements vscode.Disposable {
  private readonly byShortcut = new Map<string, Entry>();
  private readonly badges = new Map<string, MetricBadge>();
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  // Reconcile the set of watched shortcuts against the current metric'd shortcuts. Arms a
  // watcher for a newly-metric'd shortcut, re-arms one whose file or metric changed, and
  // disposes one no longer metric'd — so watchers exactly track the opted-in set and
  // never leak. Called on every store change (cheap: a no-op when nothing changed).
  track(targets: MetricTarget[]): void {
    const wanted = new Map(targets.map((t) => [t.pinId, t]));

    // Drop watchers for shortcuts that are no longer metric'd (or vanished).
    for (const [pinId, entry] of this.byShortcut) {
      if (!wanted.has(pinId)) {
        this.disposeEntry(pinId, entry);
      }
    }

    // Add or re-arm watchers for the wanted set.
    for (const target of targets) {
      const existing = this.byShortcut.get(target.pinId);
      if (existing && this.sameTarget(existing, target)) {
        // Unchanged: keep the live watcher and its measured badge (avoids churn on
        // an unrelated refresh — e.g. another shortcut added).
        existing.name = target.name;
        continue;
      }
      if (existing) {
        this.disposeEntry(target.pinId, existing);
      }
      this.arm(target);
    }
  }

  get(pinId: string): MetricBadge | undefined {
    return this.badges.get(pinId);
  }

  dispose(): void {
    for (const [pinId, entry] of this.byShortcut) {
      this.disposeEntry(pinId, entry);
    }
    this._onDidChange.dispose();
  }

  // Whether a live entry already covers a target (same file + same metric), so the
  // reconcile can leave its watcher and measured badge untouched.
  private sameTarget(entry: Entry, target: MetricTarget): boolean {
    return (
      entry.uri.toString() === target.uri.toString() &&
      entry.metric.kind === target.metric.kind &&
      entry.metric.thresholdBytes === target.metric.thresholdBytes
    );
  }

  // Create a single-file, non-recursive watcher and measure once immediately so the
  // badge shows without waiting for the first change.
  private arm(target: MetricTarget): void {
    // RelativePattern(dir, basename) with no `**` watches exactly this one file, so
    // the OS watch is as narrow as possible (no directory-tree recursion).
    const dir = vscode.Uri.joinPath(target.uri, "..");
    const base = target.uri.path.split("/").pop() ?? target.uri.path;
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(dir, base)
    );
    const entry: Entry = {
      name: target.name,
      uri: target.uri,
      metric: target.metric,
      watcher,
    };
    this.byShortcut.set(target.pinId, entry);
    // A create / change / delete on the file all schedule a (debounced) re-measure.
    const onEvent = (): void => this.scheduleMeasure(target.pinId);
    watcher.onDidChange(onEvent);
    watcher.onDidCreate(onEvent);
    watcher.onDidDelete(onEvent);
    // Initial measure (not debounced — there is nothing to coalesce yet).
    void this.measure(target.pinId);
  }

  // Coalesce a burst of file-change events into one measurement after a quiet window.
  private scheduleMeasure(pinId: string): void {
    const entry = this.byShortcut.get(pinId);
    if (!entry) {
      return;
    }
    if (entry.debounce) {
      clearTimeout(entry.debounce);
    }
    entry.debounce = setTimeout(() => {
      entry.debounce = undefined;
      void this.measure(pinId);
    }, DEBOUNCE_MS);
  }

  // Stat (and, for line count, read) the file and update the cached badge. A toast
  // fires only on the under->over threshold crossing, and never on the first measure
  // (so opening a workspace with an already-over file shows the red badge silently).
  private async measure(pinId: string): Promise<void> {
    const entry = this.byShortcut.get(pinId);
    if (!entry) {
      return;
    }
    const badge = await this.computeBadge(entry);
    if (!badge) {
      // The file is gone (deleted): drop the badge so a stale value does not linger.
      if (this.badges.delete(pinId)) {
        this._onDidChange.fire();
      }
      entry.lastOver = undefined;
      return;
    }
    this.badges.set(pinId, badge);

    // Toast on a fresh under->over crossing only. The first measure seeds lastOver
    // without alerting; thereafter a transition from not-over to over fires once.
    if (
      entry.lastOver === false &&
      badge.over &&
      entry.metric.thresholdBytes !== undefined
    ) {
      void vscode.window.showWarningMessage(
        l10n("metric.overToast", {
          name: entry.name,
          size: badge.text ?? "",
          limit: formatBytes(entry.metric.thresholdBytes),
        })
      );
    }
    entry.lastOver = badge.over;
    this._onDidChange.fire();
  }

  // Compute the badge from disk, or undefined when the file no longer exists.
  private async computeBadge(entry: Entry): Promise<MetricBadge | undefined> {
    let stat: vscode.FileStat;
    try {
      stat = await vscode.workspace.fs.stat(entry.uri);
    } catch {
      return undefined;
    }
    const kind = entry.metric.kind;
    if (kind === "modified") {
      return { kind, mtime: stat.mtime, over: false };
    }
    const threshold = entry.metric.thresholdBytes;
    const over = threshold !== undefined && stat.size > threshold;
    if (kind === "size") {
      return { kind, text: formatBytes(stat.size), over };
    }
    // kind === "lines": reading is the cost, so cap it — a file past the cap shows
    // its size instead, so a huge dump is never read just to count its lines.
    if (stat.size > LINE_COUNT_CAP_BYTES) {
      return { kind, text: formatBytes(stat.size), over };
    }
    let lines: number;
    try {
      const bytes = await vscode.workspace.fs.readFile(entry.uri);
      lines = countLines(bytes);
    } catch {
      // Read failed (a race with a rewrite): fall back to size rather than no badge.
      return { kind, text: formatBytes(stat.size), over };
    }
    return { kind, text: l10n("metric.lines", { count: lines }), over };
  }

  private disposeEntry(pinId: string, entry: Entry): void {
    if (entry.debounce) {
      clearTimeout(entry.debounce);
    }
    entry.watcher.dispose();
    this.byShortcut.delete(pinId);
    this.badges.delete(pinId);
  }
}

// Module-level singleton: the tree provider tracks + reads, the engine watches.
export const metricBadges = new MetricBadgeRegistry();
