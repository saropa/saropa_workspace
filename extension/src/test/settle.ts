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

/** Lets pending promise chains and immediate callbacks run: yields to the event loop `turns` times, with no timer. For "nothing happens" checks, where there is no condition to wait for. */
export async function flushEvents(turns = 10): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}
