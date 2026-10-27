// Waits for an asynchronous effect without a fixed sleep: yields to the event loop until
// the condition holds, and fails with a clear message when it never does within the limit.

/** Yields to the event loop until `condition()` is true; throws after `timeoutMs` milliseconds. */
export async function settle(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("settle: the condition never became true");
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}
