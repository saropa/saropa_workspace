import * as path from "node:path";
import * as vscode from "vscode";
import { BoardModel } from "../board/boardModel";
import { MAX_PATCH_CHARS, PatchCheck, PatchRow, checkPatch, extractPatch, targetsOf } from "../board/patch";
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
  // The result file this review was read from (path and time); none for a pasted reply.
  file?: { path: string; mtime: number };
}

// A result file the watcher found and checked: a reply with at least one change to offer.
interface Ready {
  text: string;
  name: string;
  // The file's full path: two projects may hold a result file of the same name.
  file: string;
  count: number;
  mtime: number;
}

// How many answered result files (by name and time) are remembered so they are not offered again.
const MAX_REMEMBERED = 200;
const ANSWERED_KEY = "saropaWorkspace.releaseBoard.answeredResults";

const statusLabel = (run: BoardRun, status: string): string => ruleCategories(run.cfg).find((c) => c.status === status)?.label ?? status;

export class BoardPatches {
  private review: Review | undefined;
  private ready: Ready | undefined;
  // Result files the owner applied or rejected, as "path\ttime"; a file edited later is offered again.
  // Kept in the workspace state, so a restart does not offer a rejected reply again.
  private readonly answered: Set<string>;
  private watcher: ReturnType<typeof watchResults> | undefined;
  private scanned = false;

  constructor(
    private readonly state: () => { model: BoardModel; run: BoardRun } | undefined,
    private readonly post: (m: unknown) => void,
    private readonly changed: () => void,
    private readonly memory?: () => vscode.Memento
  ) {
    this.answered = new Set(this.memory?.().get<string[]>(ANSWERED_KEY, []).filter((x) => typeof x === "string"));
  }

  // Starts watching the hand-off folders; the caller disposes the watcher.
  watch(): vscode.Disposable {
    this.watcher = watchResults(
      () => this.state()?.run.cfg.projects.map((p) => vscode.Uri.parse(p.path)) ?? [],
      (text, name, mtime, file) => this.found(text, name, mtime, file),
      (file) => this.gone(file)
    );
    return this.watcher;
  }

  // Looks once for result files already in the hand-off folders; called when the board first has a model.
  scan(): void {
    if (!this.scanned && this.watcher) {
      this.scanned = true;
      this.watcher.scan();
    }
  }

  // The waiting file changed: only the pill is updated while a reply is open for review (a new
  // paint would wipe the list), else the board is painted again.
  private pillChanged(): void {
    if (this.review) {
      this.post({ type: "patchPill", count: this.ready?.count ?? 0 });
    } else {
      this.changed();
    }
  }

  private gone(file: string): void {
    if (this.ready?.file === file) {
      this.ready = undefined;
      this.pillChanged();
    }
  }

  // How many changes the waiting result file offers; undefined when none waits.
  view(): { patchReady?: number } {
    return this.ready ? { patchReady: this.ready.count } : {};
  }

  private check(text: string): { check: PatchCheck; run: BoardRun } | undefined {
    const s = this.state();
    if (!s) {
      return undefined;
    }
    if (text.length > MAX_PATCH_CHARS) {
      return { check: { ok: false, reason: "tooLarge" }, run: s.run };
    }
    const raw = extractPatch(text);
    const statuses = [...new Set(ruleCategories(s.run.cfg).map((c) => c.status))];
    return { check: raw === undefined ? { ok: false, reason: "notJson" } : checkPatch(raw, targetsOf(s.model), statuses), run: s.run };
  }

  // A result file was read: it is kept for the owner only when it holds a reply with something to offer.
  private found(text: string, name: string, mtime: number, file: string): void {
    if (this.answered.has(`${file}\t${mtime}`)) {
      return;
    }
    const c = this.check(text);
    const count = c?.check.ok ? c.check.rows.filter((r) => !r.stale).length : 0;
    if (count > 0 && (this.ready?.file !== file || this.ready.count !== count || this.ready.mtime !== mtime)) {
      this.ready = { text, name, file, count, mtime };
      this.pillChanged();
    } else if (count === 0 && this.ready?.file === file && c) {
      this.ready = undefined;
      this.pillChanged();
    }
  }

  // The pasted text, or the waiting result file, as a list for the page.
  read(text: string, source: "paste" | "file", name?: string, file?: { path: string; mtime: number }): void {
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
    this.review = { text, source, ...(name ? { name } : {}), ...(file ? { file } : {}), rows: s.rows };
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
      this.read(this.ready.text, "file", this.ready.name, { path: this.ready.file, mtime: this.ready.mtime });
    }
  }

  // The ticked rows, as they stand against the board now: a row the board no longer offers, or
  // one whose document changed, is left out. Undefined when nothing is under review.
  pick(ids: number[]): { rows: PatchRow[]; dropped: number; name: string; source: "paste" | "file"; text: string } | undefined {
    const review = this.review;
    const now = review ? this.check(review.text) : undefined;
    if (!review || !now?.check.ok) {
      return undefined;
    }
    // A row is the same only when its change and the value it replaces are both still what the board shows.
    const sig = (r: PatchRow): string => JSON.stringify([r.change, r.before]);
    const fresh = new Set(now.check.rows.filter((r) => !r.stale).map(sig));
    const wanted = [...new Set(ids)].map((i) => review.rows[i]).filter((r): r is PatchRow => r !== undefined && !r.stale);
    const rows = wanted.filter((r) => fresh.has(sig(r)));
    return { rows, dropped: wanted.length - rows.length, name: review.name ? path.posix.basename(review.name, ".result.json") : l10n("releaseBoard.patch.pasted"), source: review.source, text: review.text };
  }

  // Forgets the reply under review. Only the result file that was reviewed is marked answered, and
  // the waiting file is dropped only when it is that same file: a pasted reply, or a newer file that
  // arrived during the review, leaves the waiting file offered.
  clear(): void {
    const reviewed = this.review?.file;
    let had = false;
    if (reviewed) {
      this.answered.add(`${reviewed.path}\t${reviewed.mtime}`);
      if (this.answered.size > MAX_REMEMBERED) {
        this.answered.delete(this.answered.values().next().value as string);
      }
      void this.memory?.().update(ANSWERED_KEY, [...this.answered]);
      if (this.ready?.file === reviewed.path && this.ready.mtime === reviewed.mtime) {
        this.ready = undefined;
        had = true;
      }
    }
    this.review = undefined;
    if (had) {
      this.changed();
    }
  }
}
