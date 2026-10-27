// Waits for an asynchronous effect without a fixed sleep: yields to the event loop until
// the condition holds, and fails with a clear message when it never does.

/** Yields to the event loop until `condition()` is true; throws after `maxTurns` turns. */
export async function settle(condition: () => boolean, maxTurns = 200): Promise<void> {
  for (let turn = 0; turn < maxTurns; turn++) {
    if (condition()) {
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("settle: the condition never became true");
}
