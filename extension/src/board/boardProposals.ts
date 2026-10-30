import { l10n } from "../i18n/l10n";
import { readsNeeds } from "./docFacts";
import { Link } from "./links";
import { ScanSnapshot } from "./scanner";
import { BoardConfig } from "./types";
import { BoardItem, factsFor } from "./boardModelParts";
import { inferLinkProposals } from "./org/linksInfer";
import type { Confidence } from "./org/linksSignals";
import { settingsOf } from "./org/settings";
import type { PatchRow, PatchTarget } from "./patch";

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
let last: { snapshot: ScanSnapshot | undefined; key: string; res: ProposalView[] } | undefined;

// Forgets the cached answer (tests that time the engine).
export function resetProposalCache(): void {
  last = undefined;
}

// Proposals between the open documents. A document that does not read Needs lines (.sql) takes no part.
// A weak "names the file" pair the older dashed suggestions already offer is left to them.
export function buildProposals(all: BoardItem[], snapshot: ScanSnapshot | undefined, cfg: BoardConfig, links: Link[], rejected: string[] | undefined, offered: ReadonlySet<string>): ProposalView[] {
  const docs = all
    .filter((it) => readsNeeds(it.path))
    .map((it) => ({ project: it.project, path: it.path, title: it.title, text: factsFor(snapshot, it.project, it.path)?.linkText ?? "" }));
  const phrases = settingsOf(cfg.organize).linkPhrases;
  const existing = links.filter((l) => l.toProject && l.toPath);
  const key = JSON.stringify([docs.map((d) => [d.project, d.path, d.title, d.text.length]), existing.map((l) => [l.fromProject, l.fromPath, l.toProject, l.toPath]), rejected ?? [], phrases, [...offered]]);
  let hit = last;
  if (!hit || hit.snapshot !== snapshot || hit.key !== key) {
    const res = inferLinkProposals(docs, existing, new Set(rejected ?? []), { phrases }).filter((p) => !(p.signal === "mention" && offered.has(p.key))).map((p) => ({
      key: p.key,
      item: `${p.fromProject}:${p.fromPath}`,
      on: `${p.toProject}:${p.toPath}`,
      confidence: p.confidence,
      why: l10n(p.why.key, p.why.params),
    }));
    hit = last = { snapshot, key, res };
  }
  return hit.res;
}

// The proposals as rows of the shared review list: each one is an "add a Needs link" change, checked
// and written like the changes of an AI reply. Rows a proposal names that the board does not show are left out.
export function proposalRows(proposals: readonly ProposalView[], targets: ReadonlyMap<string, PatchTarget>): PatchRow[] {
  return proposals.flatMap((p) => {
    const item = targets.get(p.item);
    const other = targets.get(p.on);
    return item && other ? [{ change: { op: "addNeeds" as const, item: item.id, on: other.id, reason: p.why, ...(item.rev ? { rev: item.rev } : {}) }, before: "", after: other.title, stale: false }] : [];
  });
}
