// Tests for the pure rating-prompt decision logic (no VS Code dependency).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shouldPromptForRating,
  describeRatePromptReason,
  RATING_ACTIVATION_THRESHOLD,
  RATING_REMIND_INTERVAL,
  type RatePromptState,
} from "../activation/ratePrompt";

// --- shouldPromptForRating ---

test("shows prompt when activation count reaches the default threshold", () => {
  const state: RatePromptState = {
    dismissed: false,
    activationCount: RATING_ACTIVATION_THRESHOLD,
    nextPromptAt: RATING_ACTIVATION_THRESHOLD,
  };
  assert.equal(shouldPromptForRating(state), true);
});

test("shows prompt when activation count exceeds the threshold", () => {
  // Covers the edge case of a user who somehow skipped the exact threshold
  // (e.g. the extension was deactivated before the prompt could fire).
  const state: RatePromptState = {
    dismissed: false,
    activationCount: RATING_ACTIVATION_THRESHOLD + 5,
    nextPromptAt: RATING_ACTIVATION_THRESHOLD,
  };
  assert.equal(shouldPromptForRating(state), true);
});

test("does not show prompt below the threshold", () => {
  const state: RatePromptState = {
    dismissed: false,
    activationCount: RATING_ACTIVATION_THRESHOLD - 1,
    nextPromptAt: RATING_ACTIVATION_THRESHOLD,
  };
  assert.equal(shouldPromptForRating(state), false);
});

test("does not show prompt when permanently dismissed", () => {
  // Even with a high activation count, a dismissed user is never asked again.
  const state: RatePromptState = {
    dismissed: true,
    activationCount: 999,
    nextPromptAt: RATING_ACTIVATION_THRESHOLD,
  };
  assert.equal(shouldPromptForRating(state), false);
});

test("does not show prompt when remind-later bumped the threshold", () => {
  // "Remind Later" pushes nextPromptAt forward; the user has not reached it yet.
  const remindedAt = RATING_ACTIVATION_THRESHOLD;
  const state: RatePromptState = {
    dismissed: false,
    activationCount: remindedAt + RATING_REMIND_INTERVAL - 1,
    nextPromptAt: remindedAt + RATING_REMIND_INTERVAL,
  };
  assert.equal(shouldPromptForRating(state), false);
});

test("shows prompt again after remind-later interval elapses", () => {
  const remindedAt = RATING_ACTIVATION_THRESHOLD;
  const state: RatePromptState = {
    dismissed: false,
    activationCount: remindedAt + RATING_REMIND_INTERVAL,
    nextPromptAt: remindedAt + RATING_REMIND_INTERVAL,
  };
  assert.equal(shouldPromptForRating(state), true);
});

test("first activation is always below threshold", () => {
  const state: RatePromptState = {
    dismissed: false,
    activationCount: 1,
    nextPromptAt: RATING_ACTIVATION_THRESHOLD,
  };
  assert.equal(shouldPromptForRating(state), false);
});

// --- describeRatePromptReason ---

test("reason mentions threshold when prompt is shown", () => {
  const state: RatePromptState = {
    dismissed: false,
    activationCount: 10,
    nextPromptAt: 10,
  };
  const reason = describeRatePromptReason(state, true);
  assert.match(reason, /reached threshold/);
  assert.match(reason, /10/);
});

test("reason mentions dismissal when permanently dismissed", () => {
  const state: RatePromptState = {
    dismissed: true,
    activationCount: 50,
    nextPromptAt: 10,
  };
  const reason = describeRatePromptReason(state, false);
  assert.match(reason, /dismissed/);
});

test("reason mentions below threshold when not yet due", () => {
  const state: RatePromptState = {
    dismissed: false,
    activationCount: 5,
    nextPromptAt: 10,
  };
  const reason = describeRatePromptReason(state, false);
  assert.match(reason, /below threshold/);
});
