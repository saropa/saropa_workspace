import * as path from "node:path";
import * as vscode from "vscode";
import { BoardModel } from "../board/boardModel";
import { PatchCheck, PatchRow, checkPatch, extractPatch, targetsOf } from "../board/patch";
import { ruleCategories } from "../board/ruleAssign";
import { BoardRun } from "../commands/boardScanStore";
import { watchResults } from "../commands/boardPatch";
import { l10n } from "../i18n/l10n";

// Release Board, bring back an AI reply: the host half of the drawer's Bring back tab. It keeps
// the one reply being reviewed (pasted, or found by the watcher in a hand-off folder), checks it
// against the model the page was painted from and sends the page a list to tick. The page names
// rows by index; a row is applied only when it is checked again against the current board.

// The reply under review, as the page was told about it.
interface Review {
  text: string;
  source: "paste" | "file";
  name?: string;
  rows: PatchRow[];
}

// A result file the watcher found and checked: a reply with at least one change to offer.
interface Ready {
  text: string;
  name: string;
  count: number;
}

const statusLabel = (run: BoardRun, status: string): string => ruleCategories(run.cfg).find((c) => c.status === status)?.label ?? status;

export class BoardPatches {
  private review: Review | undefined;
  private ready: Ready | undefined;

  constructor(
    private readonly state: () => { model: BoardModel; run: BoardRun } | undefined,
    private readonly post: (m: unknown) => void,
    private readonly changed: () => void
  ) {}

  // Starts watching the hand-off folders; the caller disposes the watcher.
  watch(): vscode.Disposable {
    return watchResults(
      () => this.state()?.run.cfg.projects.map((p) => vscode.Uri.parse(p.path)) ?? [],
      (text, name) => this.found(text, name)
    );
  }

  // How many changes the waiting result file offers; undefined when none waits.
  view(): { patchReady?: number } {
    return this.ready ? { patchReady: this.ready.count } : {};
  }

  private check(text: string): { check: PatchCheck; run: BoardRun } | undefined {
    const s = this.state();
    const raw = extractPatch(text);
    if (!s) {
      return undefined;
    }
    const statuses = [...new Set(ruleCategories(s.run.cfg).map((c) => c.status))];
    return { check: raw === undefined ? { ok: false, reason: "notJson" } : checkPatch(raw, targetsOf(s.model), statuses), run: s.run };
  }

  // A result file was read: it is kept for the owner only when it holds a reply with something to offer.
  private found(text: string, name: string): void {
    const c = this.check(text);
    const count = c?.check.ok ? c.check.rows.filter((r) => !r.stale).length : 0;
    if (count > 0 && (this.ready?.name !== name || this.ready.count !== count)) {
      this.ready = { text, name, count };
      this.changed();
    }
  }

  // The pasted text, or the waiting result file, as a list for the page.
  read(text: string, source: "paste" | "file", name?: string): void {
    const c = this.check(text);
    if (!c) {
      return;
    }
    if (!c.check.ok) {
      this.review = undefined;
      this.post({ type: "patchReview", source, error: l10n(`releaseBoard.patch.error.${c.check.reason}`), rows: [], refused: [] });
      return;
    }
    const s = c.check;
    this.review = { text, source, ...(name ? { name } : {}), rows: s.rows };
    const targets = targetsOf(this.state()!.model);
    this.post({
      type: "patchReview",
      source,
      ...(name ? { name } : {}),
      rows: s.rows.map((r, i) => ({
        i,
        op: l10n(`releaseBoard.patch.op.${r.change.op}`),
        item: targets.get(r.change.item)?.title ?? r.change.item,
        before: r.change.op === "setStatus" ? statusLabel(c.run, r.before) : r.before,
        after: r.change.op === "setStatus" ? statusLabel(c.run, r.after) : r.after,
        reason: r.change.reason,
        stale: r.stale,
      })),
      refused: s.refused.map((x) => ({ n: x.n, text: l10n("releaseBoard.patch.refused", { n: x.n, reason: l10n(`releaseBoard.patch.refusal.${x.reason}`) }) })),
    });
  }

  // The Bring back view for the waiting result file.
  open(): void {
    if (this.ready) {
      this.read(this.ready.text, "file", this.ready.name);
    }
  }

  // The ticked rows, as they stand against the board now: a row the board no longer offers, or
  // one whose document changed, is left out. Undefined when nothing is under review.
  pick(ids: number[]): { rows: PatchRow[]; name: string } | undefined {
    const review = this.review;
    const now = review ? this.check(review.text) : undefined;
    if (!review || !now?.check.ok) {
      return undefined;
    }
    const sig = (r: PatchRow): string => JSON.stringify(r.change);
    const fresh = new Set(now.check.rows.filter((r) => !r.stale).map(sig));
    const rows = [...new Set(ids)].map((i) => review.rows[i]).filter((r): r is PatchRow => r !== undefined && !r.stale && fresh.has(sig(r)));
    return { rows, name: review.name ? path.posix.basename(review.name, ".result.json") : l10n("releaseBoard.patch.pasted") };
  }

  // Forgets the reply and the waiting file (applied, or rejected).
  clear(): void {
    const had = this.ready !== undefined;
    this.review = undefined;
    this.ready = undefined;
    if (had) {
      this.changed();
    }
  }
}
