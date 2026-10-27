// Shared escaping for text that goes into a regular expression or a Markdown table cell.
// Backslashes are always escaped first so no later step can undo or double an escape.

// Escapes every regular-expression metacharacter, backslash included.
export function escapeRegExp(s: string): string {
  return s.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");
}

// Makes text safe for one Markdown table cell: backslashes and pipes escaped, line breaks and
// backticks turned into spaces.
export function escapeCell(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/[\r\n`]/g, " ");
}
