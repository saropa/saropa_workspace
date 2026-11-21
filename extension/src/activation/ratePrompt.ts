/**
 * Pure rating-prompt helpers (no `vscode` import so they can be unit-tested
 * headlessly). Follows the same separation as welcomePanelUpgrade.ts in
 * saropa_lints: the decision logic lives here, the VS Code toast lives in
 * activationOffers.ts.
 */

/** Number of activations before the first rating prompt appears. */
export const RATING_ACTIVATION_THRESHOLD = 10;

/** Additional activations after "Remind Later" before re-prompting. */
export const RATING_REMIND_INTERVAL = 15;

/** globalState key: number of activations since install. */
export const ACTIVATION_COUNT_KEY = "saropaWorkspace.ratePrompt.activationCount";

/** globalState key: activation count at which to show the next prompt. */
export const NEXT_PROMPT_AT_KEY = "saropaWorkspace.ratePrompt.nextPromptAt";

/** globalState key: permanent dismissal flag ("No Thanks"). */
export const RATE_DISMISSED_KEY = "saropaWorkspace.ratePrompt.dismissed";

/** Snapshot of the three globalState values the prompt decision reads. */
export interface RatePromptState {
  /** True when the user chose "No Thanks" and should never be asked again. */
  dismissed: boolean;
  /** Lifetime activation count (incremented before the check each session). */
  activationCount: number;
  /** The activation count at which the next prompt fires. */
  nextPromptAt: number;
}

/**
 * True when the activation count has reached the threshold and the user has not
 * permanently dismissed the prompt. Called once per activation after the count
 * is incremented.
 */
export function shouldPromptForRating(state: RatePromptState): boolean {
  if (state.dismissed) {
    return false;
  }
  return state.activationCount >= state.nextPromptAt;
}

/**
 * Human-readable reason for the prompt decision, for the debug log. Mirrors
 * shouldPromptForRating's branches so the log never disagrees with behavior.
 */
export function describeRatePromptReason(state: RatePromptState, shown: boolean): string {
  if (shown) {
    return `activation ${state.activationCount} reached threshold ${state.nextPromptAt}`;
  }
  if (state.dismissed) {
    return "permanently dismissed by user";
  }
  return `activation ${state.activationCount} below threshold ${state.nextPromptAt}`;
}
