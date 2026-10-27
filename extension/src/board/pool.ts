// Bounded parallel map: runs `fn` over the items with at most `limit` in flight and returns
// the results in the order of the items. Reads on a remote or virtual file system cost a
// round trip each, so a scan that awaits them one at a time is slow however fast the CPU is.
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) {
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}
