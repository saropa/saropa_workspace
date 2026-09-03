// Bounded accumulator for a background run's combined stdout+stderr text.
//
// backgroundRunner.ts used to accumulate the full output in one growing string for
// the life of the run (read back for the completion toast, "Diff Last Two Runs",
// badge parsing, and extract-and-copy). A long-lived process (a dev server, a watch
// task) that prints megabytes of output over hours grew that string without bound,
// so memory tracked wall-clock time rather than anything the extension needed to
// keep. This caps it at 1MB total: the first 512KB (the startup/config output that
// usually explains a failure) plus the last 512KB (the most recent activity), with
// a marker over the dropped middle. No VS Code dependency, so the bound + truncation
// logic is unit-testable under Node's built-in runner without the extension host.
//
// Sizes are measured in UTF-16 code units (JS string .length), not bytes — close
// enough for the "cap memory growth" goal; getting exact UTF-8 byte counts would
// require re-encoding every chunk for no practical benefit here.

// Half the total cap goes to the head, half to the tail.
const HEAD_LIMIT = 512 * 1024;
const TAIL_LIMIT = 512 * 1024;

export interface BoundedCapture {
  // Feed the next chunk of stdout/stderr text (called once per "data" event).
  append(text: string): void;
  // The captured text so far: unmodified while under the cap, or head + a
  // truncation marker + tail once the run has produced more than 1MB total.
  getCaptured(): string;
}

// Build the marker string naming how much was dropped from the middle. Kept in this
// module (not the l10n catalog) because it only ever appears inside a diagnostic
// output blob, never as its own UI string — the toasts and views that DO surface run
// output verbatim (Show Output, Diff Last Two Runs) are showing the truncated capture
// as data, not presenting this line as a piece of chrome that needs translation.
function truncationMarker(omittedChars: number): string {
  return `\n--- Output truncated (${omittedChars} characters omitted) ---\n`;
}

// Create a fresh bounded capture for one run. A new instance per run (rather than a
// shared reset()) keeps this stateless from the caller's point of view and matches
// the closure-return shape attachOutputCapture already used.
export function createBoundedCapture(): BoundedCapture {
  // Frozen once it reaches HEAD_LIMIT: the earliest output, which usually carries the
  // command line, startup banner, and any config/compile error that dooms the rest of
  // the run.
  let head = "";
  // A sliding window of the most recent TAIL_LIMIT chars, trimmed from the front
  // whenever a new chunk pushes it over the limit.
  let tail = "";
  // Total chars ever appended, including anything already dropped — needed so
  // getCaptured() can report how much the marker is standing in for.
  let totalLength = 0;

  return {
    append(text: string): void {
      totalLength += text.length;
      if (head.length < HEAD_LIMIT) {
        // Still filling the head. Split the chunk at the head boundary so a single
        // large chunk (e.g. one huge JSON dump) fills the head and overflows the
        // remainder into the tail in the same call, rather than waiting for the next
        // "data" event to notice the head is full.
        const room = HEAD_LIMIT - head.length;
        if (text.length <= room) {
          head += text;
          return;
        }
        head += text.slice(0, room);
        tail += text.slice(room);
      } else {
        tail += text;
      }
      // Keep only the newest TAIL_LIMIT chars of the tail so memory never grows past
      // HEAD_LIMIT + TAIL_LIMIT regardless of how long the process keeps printing.
      if (tail.length > TAIL_LIMIT) {
        tail = tail.slice(tail.length - TAIL_LIMIT);
      }
    },
    getCaptured(): string {
      const keptLength = head.length + tail.length;
      if (totalLength <= keptLength) {
        // Nothing has been dropped yet — return the untruncated text as-is so a
        // normal (non-megabyte) run is byte-for-byte identical to the old behavior.
        return head + tail;
      }
      const omitted = totalLength - keptLength;
      return head + truncationMarker(omitted) + tail;
    },
  };
}
