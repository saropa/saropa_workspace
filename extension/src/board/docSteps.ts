// Why: the open-step reader and its types live apart from the fact reader to keep that file short.
// One open step of a document: a checklist box or a table row with an open state word.
export interface DocStep {
  // 1-based line in the document.
  line: number;
  // The nearest heading above the step ("" when none).
  heading: string;
  text: string;
  // The cell under a table column named "Needs", when the row has one.
  needsCell?: string;
}

// Open steps kept per document, and the length of each step's text.
const MAX_STEPS = 200;
const STEP_TEXT = 160;

const DONE_WORDS = ["done", "applied", "merged", "fixed", "built", "implemented", "closed", "yes", "verified"];
const OPEN_WORDS = ["pending", "open", "partial", "not started", "in progress"];

// Why: the fact reader also needs heading text, so this is shared from the steps module.
// The text of a Markdown heading line ("#" to "######" and a space), or undefined when the line is
// not one. `lazy` also takes the closing "#" marks and spaces off the end. Read left to right,
// where the patterns it replaces took quadratic time on a long run of spaces.
export function headingText(line: string, maxHashes: number, lazy: boolean): string | undefined {
  let n = 0;
  while (line[n] === "#") {
    n++;
  }
  if (n < 1 || n > maxHashes) {
    return undefined;
  }
  let e = n;
  while (line[e] === " " || line[e] === "\t") {
    e++;
  }
  if (e === n) {
    return undefined;
  }
  let rest = line.slice(e);
  const term = rest.search(/[\r\u2028\u2029]/);
  if (term >= 0) {
    if (lazy) {
      return undefined;
    }
    rest = rest.slice(0, term);
  }
  if (rest === "") {
    // Two or more spaces leave the last one as the heading text.
    return e - n >= 2 ? " " : undefined;
  }
  if (lazy) {
    let end = rest.length;
    while (end > 1 && " \t#".includes(rest[end - 1])) {
      end--;
    }
    return rest.slice(0, end);
  }
  return rest;
}

// The text of an open checklist box on this line, or undefined when the line has none.
function checkboxText(line: string): string | undefined {
  const box = /^\s*[-*] \[ \]\s*(.*)$/.exec(line);
  return box ? box[1].trim().slice(0, STEP_TEXT) : undefined;
}

// A table row that names columns (status, item, dev, prod) rather than holding a step.
function isHeaderRow(cells: string[]): boolean {
  return cells.some((c) => ["status", "item", "dev", "prod"].includes(c));
}

// Whether the last three cells of a table row hold a done word or an open word.
function rowState(cells: string[]): { isDone: boolean; isOpen: boolean } {
  const tail = cells.slice(-3);
  return { isDone: tail.some((c) => DONE_WORDS.includes(c.split(" ")[0])), isOpen: tail.some((c) => OPEN_WORDS.includes(c)) };
}

// The text of an open table row: its first two cells that are not the Needs column or a state word.
function openRowText(raw: string[], needsCol: number): string {
  const text = raw.filter((c, k) => c && k !== needsCol && !OPEN_WORDS.includes(c.toLowerCase())).slice(0, 2).join(" - ");
  return text.slice(0, STEP_TEXT);
}

// Why: the fact reader counts steps through this single scanner.
// The open steps (checklist boxes and table rows in an open state) and the state-word row counts.
export function scanSteps(body: string): { rowsAll: number; rowsDone: number; steps: DocStep[]; stepsCut: number } {
  const res = { rowsAll: 0, rowsDone: 0, steps: [] as DocStep[], stepsCut: 0 };
  const lines = body.split(/\r?\n/);
  let heading = "";
  // The header cells of the table the loop is inside, when its second line is a divider.
  let header: string[] | undefined;
  const addStep = (step: DocStep): void => {
    if (res.steps.length < MAX_STEPS) {
      res.steps.push(step);
    } else {
      res.stepsCut += 1;
    }
  };
  lines.forEach((l, i) => {
    const h = headingText(l, 6, true);
    if (h !== undefined) {
      heading = h.trim().slice(0, STEP_TEXT);
    }
    const box = checkboxText(l);
    if (box !== undefined) {
      addStep({ line: i + 1, heading, text: box });
    }
    if (!l.startsWith("|")) {
      header = undefined;
      return;
    }
    if (/^\|[\s:|-]+\|$/.test(l)) {
      return;
    }
    const raw = l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    if (/^\|[\s:|-]+\|$/.test(lines[i + 1] ?? "")) {
      header = raw.map((c) => c.toLowerCase());
    }
    const cells = raw.map((c) => c.toLowerCase());
    if (isHeaderRow(cells)) {
      return;
    }
    const { isDone, isOpen } = rowState(cells);
    if (isDone || isOpen) {
      res.rowsAll += 1;
      if (isDone) {
        res.rowsDone += 1;
      } else {
        const col = header ? header.indexOf("needs") : -1;
        addStep({ line: i + 1, heading, text: openRowText(raw, col), needsCell: col >= 0 ? raw[col].slice(0, STEP_TEXT) : undefined });
      }
    }
  });
  return res;
}
