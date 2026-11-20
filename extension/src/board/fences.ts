// One definition of "inside a fenced code block" for every board reader and writer. Before this
// module the Needs reader and the Needs editor blanked only ``` pairs while the patch writer also
// honored ~~~ fences and the closing rule, so a `Needs:` line inside a ~~~ block was read as live
// by one side and skipped by the other. Pure.

// Longest line the fence test looks at; a longer line is never a fence line, so a hostile text
// cannot stall the editor with one huge line.
const MAX_FENCE_LINE = 2000;

const bodyOf = (line: string): string => line.replace(/\r?\n$/, "");

// The text as lines that keep their own endings, and which lines sit in a fenced code block
// (``` or ~~~, the fence lines included). A fence closes on a line of the same character, at
// least as long as the opener, with nothing after it; an unclosed fence runs to the end.
export function scanFences(text: string): { lines: string[]; fenced: boolean[] } {
  const lines = text.split(/(?<=\n)/);
  const fenced: boolean[] = [];
  let open: { ch: string; n: number } | undefined;
  for (const line of lines) {
    const body = bodyOf(line);
    const f = body.length <= MAX_FENCE_LINE ? /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(body) : null;
    if (!open) {
      // A backtick fence cannot carry a backtick in its info string (that is inline code).
      const starts = f !== null && !(f[1][0] === "`" && f[2].includes("`"));
      fenced.push(starts);
      if (starts && f) {
        open = { ch: f[1][0], n: f[1].length };
      }
    } else {
      fenced.push(true);
      if (f && f[1][0] === open.ch && f[1].length >= open.n && f[2].trim() === "") {
        open = undefined;
      }
    }
  }
  return { lines, fenced };
}

// The text with every fenced line emptied but its line break kept, so line numbers still match
// the file.
export function blankFences(text: string): string {
  const { lines, fenced } = scanFences(text);
  return lines.map((l, i) => (fenced[i] ? l.replace(/[^\r\n]/g, "") : l)).join("");
}
