import type { NeedsRefusal } from "./needsEdit";
import type { LinkState } from "./links";

// Full l10n keys, written out so the release audit can see each one is used and defined.

// Message shown when a Needs edit is refused.
export const NEEDS_REFUSAL_KEYS: Record<NeedsRefusal, string> = {
  exists: "releaseBoard.needs.exists",
  absent: "releaseBoard.needs.absent",
  target: "releaseBoard.needs.target",
  shape: "releaseBoard.needs.shape",
  type: "releaseBoard.needs.type",
};

// Short label for a link that is not open. An open link has no label.
export const NEEDS_STATE_KEYS: Record<Exclude<LinkState, "open">, string> = {
  done: "releaseBoard.needs.state.done",
  missing: "releaseBoard.needs.state.missing",
  ambiguous: "releaseBoard.needs.state.ambiguous",
  self: "releaseBoard.needs.state.self",
};
