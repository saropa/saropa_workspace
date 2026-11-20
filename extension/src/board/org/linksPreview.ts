// The Tags editor, link-word preview: runs the link engine over the board's documents with the DRAFT phrases, so the
// Link tab can show which "waits on" links those words would propose. Pure: it reads no file and posts nothing.

import type { Link } from "../links";
import { inferLinkProposals } from "./linksInfer";
import type { InferOptions, LinkProposal } from "./linksInfer";
import type { LinkDoc } from "./linksSignals";

// What the engine needs from the board: the open documents with their text, the links already written, and the
// proposals the person turned down (neither of those two is proposed again).
export interface LinkContext {
  docs: LinkDoc[];
  existing: Link[];
  rejected: string[];
}

// The preview shows a few proposals and the total, so a large board never fills the tab.
export const LINK_PREVIEW_ROWS = 8;

// What the editor page shows for the draft's link constants: the full count, so the owner sees the real effect, and a capped sample.
export interface LinkPreview {
  // Every proposal the draft phrases make (before the row cap).
  total: number;
  // The first proposals in the engine's own order (strongest first), capped at LINK_PREVIEW_ROWS.
  rows: LinkProposal[];
}

// Proposals under the draft phrases and inference constants. The caps match the board's so the count
// here is the count the board would show after a save.
export function previewLinks(ctx: LinkContext, phrases: readonly string[], opt?: Omit<InferOptions, "phrases">): LinkPreview {
  const all = inferLinkProposals(ctx.docs, ctx.existing, new Set(ctx.rejected), { ...opt, phrases });
  return { total: all.length, rows: all.slice(0, LINK_PREVIEW_ROWS) };
}
