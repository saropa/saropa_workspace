// Routine summary text helpers: status labels, detail sanitizing and the member
// outcome shape. Split out of routineRunner so the engine stays focused on running.
import * as path from "path";
import { l10n } from "../i18n/l10n";
// The outcome of one member within a routine run, for the summary report row.
export interface MemberOutcome {
  label: string;
  status: "ok" | "failed" | "skipped" | "missing" | "dispatched";
  durationMs?: number;
  detail?: string;
  // Absolute path of the report this member wrote, when it wrote one (the report
  // rituals and project-stats do; a terminal / url member does not). The summary
  // turns it into a relative link so it is the one index over the day's sub-reports.
  reportPath?: string;
}

// Human-readable status word for an attention line, from the catalog. The raw enum
// values ("missing", "failed") are code identifiers, not user copy.
const STATUS_KEYS: Record<MemberOutcome["status"], string> = {
  ok: "routine.status.ok",
  failed: "routine.status.failed",
  skipped: "routine.status.skipped",
  missing: "routine.status.missing",
  dispatched: "routine.status.dispatched",
};

/** The localized label for a member status. */
export function statusLabel(status: MemberOutcome["status"]): string {
  return l10n(STATUS_KEYS[status]);
}

// Explanation for statuses whose meaning is not self-evident: what happened and
// what the user can do. Failed members carry their own error detail instead.
export function defaultNote(status: MemberOutcome["status"]): string {
  if (status === "missing") {
    return l10n("routine.note.missing");
  }
  return "";
}

// How much of a member's error detail the attention line carries. A spawn error
// can be a full stack trace; the attention line is a one-line pointer, not the
// error's home (the output channel keeps the full text).
const DETAIL_MAX_CHARS = 200;

// Flatten a detail to one line and bound its length so a raw multi-line error
// message cannot break out of the attention blockquote or dominate the document.
export function sanitizeDetail(detail: string): string {
  const oneLine = detail.replace(/\s*\n\s*/g, " ").trim();
  return oneLine.length > DETAIL_MAX_CHARS
    ? `${oneLine.slice(0, DETAIL_MAX_CHARS)}…`
    : oneLine;
}

// Prepare one member report's body for inline embedding under its `## <member>`
// section heading: drop the report's own H1 (the section heading already names it —
// keeping both renders a duplicate title), then demote every remaining heading two
// levels so the member's internal structure nests under the section instead of
// competing with the summary's own hierarchy. Heading syntax inside fenced code
// blocks (captured command output is fenced per the report conventions) is left
// untouched — a `# comment` in captured shell output is content, not structure.
// ATX headings only (`# Title`); Setext headings (`Title` over `===`) are not
// recognized — no report writer in this codebase emits them, and a future one must
// not without extending this.
// Exported for unit tests: the fence tracking and demotion edge cases are pure
// string transforms, assertable without running a routine.
export function embedMemberReport(markdown: string): string {
  const lines = markdown.split("\n");

  // Drop the leading H1 (first non-empty line only — an H1 later in the body is a
  // real section and gets demoted like the rest).
  const firstContent = lines.findIndex((line) => line.trim() !== "");
  if (firstContent >= 0 && /^# /.test(lines[firstContent] ?? "")) {
    lines.splice(firstContent, 1);
  }

  // Fence tracking pairs the CHARACTER and LENGTH of the opening fence, matching
  // CommonMark: a fence closes only on the same character with at least the opening
  // run's length. This matters because buildCommandReport deliberately widens its
  // fence to (longest inner run + 1) so captured output containing ``` stays inside
  // the block — a naive any-3+-run toggle would flip state on that inner run and
  // then mangle the rest of the document as if it were outside the fence.
  let openFence: { char: string; length: number } | undefined;
  const out = lines.map((line) => {
    // A fence opener/closer may be indented at most 3 spaces (CommonMark): 4+
    // spaces is an indented code block, and a backtick run inside one (e.g. inside
    // a list item's code) is content, not a fence toggle.
    const run = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (run) {
      const char = (run[1] ?? "")[0] ?? "`";
      const length = (run[1] ?? "").length;
      if (!openFence) {
        openFence = { char, length };
      } else if (char === openFence.char && length >= openFence.length) {
        openFence = undefined;
      }
      // A shorter or different-character run inside an open fence is content —
      // fall through as a plain line (no state change, and headings can't match a
      // fence line anyway).
      return line;
    }
    if (openFence) {
      return line;
    }
    // Demote headings outside fences, clamped at H6 (Markdown's deepest level —
    // more # characters would render as literal text). An H5/H6 therefore lands on
    // H6 alongside a demoted H4; a flattened tail beats un-renderable syntax.
    const heading = /^(#{1,6}) /.exec(line);
    if (!heading) {
      return line;
    }
    const depth = Math.min(6, (heading[1] ?? "").length + 2);
    return `${"#".repeat(depth)} ${line.slice((heading[1] ?? "").length + 1)}`;
  });
  return out.join("\n").trim();
}
