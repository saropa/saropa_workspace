import { l10n } from "../i18n/l10n";
import { readsNeeds } from "./docFacts";
import { Link } from "./links";
import { ScanSnapshot } from "./scanner";
import { BoardConfig } from "./types";
import { BoardItem, factsFor } from "./boardModelParts";
import { inferLinkProposals } from "./org/linksInfer";
import type { Confidence } from "./org/linksSignals";
import { settingsOf } from "./org/settings";
import { PatchRow, PatchTarget, checkList } from "./patch";

// Proposed links: the link engine run over the open documents of the board. They are only
// proposals; the person ticks the ones to accept (a Needs: line) or rejects them (remembered).

// One proposal as the board keeps it. `item` waits on `on`, both as "project:path".
export interface ProposalView {
  // "project/from->project/to", the key a rejection is stored under.
  key: string;
  item: string;
  on: string;
  confidence: Confidence;
  // The reason, in words.
  why: string;
}

// The answer for the last documents, links and rejections it saw. The board is built on every repaint
// from the same scan; the engine runs again only when one of them changed.
let last: { key: string; res: ProposalView[] } | undefined;

// Forgets the cached answer, so the next call runs the engine again (tests that time a cold run).
export function resetProposalCache(): void {
  last = undefined;
}

// A short fingerprint of many strings (two 32-bit sums), so a change key costs one pass and no big string.
function fingerprint(parts: Iterable<string>): string {
  let a = 0x9e3779b9;
  let b = 0x85ebca6b;
  for (const s of parts) {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      a = Math.imul(a ^ c, 2654435761);
      b = Math.imul(b ^ c, 1597334677);
    }
    a = Math.imul(a ^ 0xff, 2654435761);
    b = Math.imul(b ^ 0xff, 1597334677);
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

// Proposals between the open documents. A document that does not read Needs lines (.sql) takes no part.
// A pair the older dashed suggestions (`offered`) already show is left to them when it is only a
// mention or a weak guess, whatever the signal; a stronger pair of another signal (a phrase, a
// sequence) is shown here once, and the caller takes it off the dashed ones.
export function buildProposals(all: BoardItem[], snapshot: ScanSnapshot | undefined, cfg: BoardConfig, links: Link[], rejected: string[] | undefined, offered: ReadonlySet<string>): ProposalView[] {
  const phrases = settingsOf(cfg.organize).linkPhrases;
  const docs = all
    .filter((it) => readsNeeds(it.path))
    .map((it) => {
      const f = factsFor(snapshot, it.project, it.path);
      return { project: it.project, path: it.path, title: it.title, text: f?.linkText ?? "", ...(f?.linkEarly ? { early: f.linkEarly } : {}) };
    });
  const existing = links.filter((l) => l.toProject && l.toPath);
  const key = fingerprint([
    ...docs.map((d) => `${d.project}\t${d.path}\t${d.title}\t${d.text.length}\t${d.early ?? 0}`),
    "|links",
    ...existing.map((l) => `${l.fromProject}/${l.fromPath}->${l.toProject}/${l.toPath}`),
    "|rejected",
    ...(rejected ?? []),
    "|phrases",
    ...phrases,
    "|offered",
    ...offered,
  ]);
  if (last?.key !== key) {
    const res = inferLinkProposals(docs, existing, new Set(rejected ?? []), { phrases })
      .filter((p) => !(offered.has(p.key) && (p.confidence === "low" || p.signal === "mention")))
      .map((p) => ({
        key: p.key,
        item: `${p.fromProject}:${p.fromPath}`,
        on: `${p.toProject}:${p.toPath}`,
        confidence: p.confidence,
        why: l10n(p.why.key, p.why.params),
      }));
    last = { key, res };
  }
  return last.res;
}

// A proposal that was left out of the review list, and why, in words.
export interface SkippedProposal {
  key: string;
  text: string;
}

// Why a proposal fails the shared checks, as the end of a message key of the board.
function skipKey(reason: string, item: PatchTarget): string {
  if (reason === "noRevision") {
    return "unread";
  }
  if (reason === "circle" || reason === "linked") {
    return reason;
  }
  return reason === "badValue" && !readsNeeds(item.path) ? "sql" : "unsafe";
}

// The proposals as rows of the shared review list: each one is an "add a Needs link" change, run
// through the same checks as the changes of an AI reply (path guard, circle, already linked, no .sql).
// A proposal the board does not show is left out; one that fails a check is listed as skipped.
export function proposalRows(proposals: readonly ProposalView[], targets: ReadonlyMap<string, PatchTarget>): { rows: PatchRow[]; skipped: SkippedProposal[] } {
  const shown = proposals.filter((p) => targets.has(p.item) && targets.has(p.on));
  const changes = shown.map((p) => {
    const rev = targets.get(p.item)!.rev;
    return { op: "addNeeds", item: p.item, on: p.on, reason: p.why, ...(rev ? { rev } : {}) };
  });
  const { rows, refused } = checkList(changes, targets as Map<string, PatchTarget>, []);
  const skipped = refused.map((r) => {
    const p = shown[r.n - 1];
    const item = targets.get(p.item)!;
    return { key: p.key, text: l10n("releaseBoard.link.skipped", { item: item.title, on: targets.get(p.on)!.title, reason: l10n(`releaseBoard.link.skip.${skipKey(r.reason, item)}`) }) };
  });
  return { rows, skipped };
}
