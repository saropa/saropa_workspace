// Canonical human-readable byte-size formatter (binary 1024 units: B/KB/MB/GB/TB).
// Centralized because this exact log-based algorithm had been hand-copied into
// processPoll.ts and projectStats.ts (byte-identical) and metricFormat.ts had grown a
// second, slightly different algorithm (a while-loop with a <10-for-decimal threshold
// instead of this one's >=100-for-whole-number threshold) — four near-identical
// implementations that could each drift independently (BUG-012). This one was picked
// as the single source of truth because it was already the majority (3 of 4 sites,
// including the Dashboard webview's client-side copy, which cannot import this module
// directly — see formatBytesJs in views/webviewClientUtils.ts for that JS-text twin)
// and its threshold (a decimal only below 100 of a unit) reads better at a glance in a
// live badge than a decimal cutoff at 10.
export function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(value >= 100 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}
