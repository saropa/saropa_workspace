// Pure formatting / parsing helpers for the live metric badges (#24). Kept free of
// any VS Code dependency (no `vscode` import) so they run under Node's built-in test
// runner without the extension host — the same separation the scheduling math uses.
// The line-count text itself is localized at the call site (it carries a word); these
// helpers deal only in numbers and symbol units, which need no translation.

// Human-readable byte size with binary (1024) units. Units are symbols (B / KB / MB),
// so they need no translation; one decimal below 10 of a unit, whole numbers above.
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const num = value < 10 ? value.toFixed(1) : Math.round(value).toString();
  return `${num} ${units[unit]}`;
}

// Count newlines in a file's bytes. Counts '\n' (0x0A), which covers LF and CRLF; a
// final line with no trailing newline is still counted, so a one-line file with no
// newline reads as 1. An empty file reads as 0.
export function countLines(bytes: Uint8Array): number {
  if (bytes.length === 0) {
    return 0;
  }
  let count = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0a) {
      count++;
    }
  }
  // A trailing newline means the last '\n' already closed the final line; without
  // one, the bytes after the last newline are an extra (uncounted) line.
  return bytes[bytes.length - 1] === 0x0a ? count : count + 1;
}

// Parse a human size into bytes: a bare number is bytes; a number with a unit
// (b/kb/mb/gb/tb, case- and space-insensitive, optional trailing "b" as in "kib")
// uses binary 1024 steps. Returns undefined for an unparseable or negative value, so
// the input box can reject it inline.
export function parseSize(input: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb|k|m|g|t)?b?$/i.exec(input.trim());
  if (!match) {
    return undefined;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0) {
    return undefined;
  }
  const unit = (match[2] ?? "b").toLowerCase();
  const power =
    { b: 0, k: 1, kb: 1, m: 2, mb: 2, g: 3, gb: 3, t: 4, tb: 4 }[unit] ?? 0;
  return Math.round(value * 1024 ** power);
}
