// Why: the "Needs:" line reader and its limit live apart from the fact reader to keep that file short; the limit is defined here once and re-exported there.
// Longest line read as a "Needs:" line; a longer line is not read as one. Every pattern here is linear within it.
export const MAX_LINE = 2000;

const isWs = (c: string | undefined): boolean => c !== undefined && /\s/.test(c);

// One Needs line split into its label (with the markers before it) and the text after it, or
// undefined when the line is not one. Same shape as /^([ \t>*_-]*needs\**[ \t]*:[ \t]*\**[ \t]*)(.+)$/i,
// read left to right so a run of spaces or `*` costs linear time.
export function needsLineParts(line: string): { label: string; rest: string } | undefined {
  if (line.length > MAX_LINE) {
    return undefined;
  }
  let i = 0;
  while (i < line.length && " \t>*_-".includes(line[i])) {
    i++;
  }
  if (line.slice(i, i + 5).toLowerCase() !== "needs") {
    return undefined;
  }
  i += 5;
  while (line[i] === "*") {
    i++;
  }
  while (line[i] === " " || line[i] === "\t") {
    i++;
  }
  if (line[i] !== ":") {
    return undefined;
  }
  const start = ++i;
  while (line[i] === " " || line[i] === "\t") {
    i++;
  }
  while (line[i] === "*") {
    i++;
  }
  while (line[i] === " " || line[i] === "\t") {
    i++;
  }
  // The text after the label cannot be empty: give back the last label character when it is.
  if (i >= line.length) {
    if (i === start) {
      return undefined;
    }
    i--;
  }
  const rest = line.slice(i);
  return /[\r\u2028\u2029]/.test(rest) ? undefined : { label: line.slice(0, i), rest };
}

// "Needs: docs/PLAN_A.md, [Other](../x/PLAN_B.md); supabase:db-access/run.sql" gives the
// three targets. A target is a path, a file name, a Markdown link, or "project:path".
export function parseNeeds(body: string): string[] {
  const out: string[] = [];
  for (const raw of body.split(/\r\n|[\n\r\u2028\u2029]/)) {
    if (raw.length > MAX_LINE) {
      continue;
    }
    const m = needsLineParts(raw);
    if (!m) {
      continue;
    }
    for (const t of needsTargets(m.rest)) {
      if (!out.includes(t)) {
        out.push(t);
      }
    }
  }
  return out;
}

// Calls `f(whole, target)` for each Markdown link "[text](target)" and puts its result in place of
// the link. Linear: every "](" is looked at once.
export function mapLinks(text: string, f: (whole: string, target: string) => string): string {
  let out = "";
  let copied = 0;
  let failUntil = -1;
  let j = text.indexOf("](");
  while (j >= 0) {
    const from = Math.max(text.lastIndexOf("]", j - 1) + 1, copied);
    const open = j >= from ? text.indexOf("[", from) : -1;
    if (open >= 0 && open < j && j + 2 > failUntil) {
      let q = j + 2;
      while (q < text.length && text[q] !== ")" && !isWs(text[q])) {
        q++;
      }
      if (text[q] === ")" && q > j + 2) {
        out += text.slice(copied, open) + f(text.slice(open, q + 1), text.slice(j + 2, q));
        copied = q + 1;
        j = text.indexOf("](", copied);
        continue;
      }
      // Every "](" before q reaches the same stop, so none of them is a link.
      failUntil = q;
    }
    j = text.indexOf("](", j + 1);
  }
  return out + text.slice(copied);
}

// The separators in a Needs line: ";" and "," and " and " (with spaces around). With `wide`, a
// ";" or "," takes the spaces around it too. Linear: each space run is looked at once.
export function needsSeparators(s: string, wide: boolean): Array<{ index: number; len: number }> {
  const out: Array<{ index: number; len: number }> = [];
  const isSep = (c: string | undefined): boolean => c === ";" || c === ",";
  let i = 0;
  while (i < s.length) {
    if (!wide && isSep(s[i])) {
      out.push({ index: i, len: 1 });
      i++;
      continue;
    }
    if (!isWs(s[i]) && !(wide && isSep(s[i]))) {
      i++;
      continue;
    }
    let j = i;
    while (isWs(s[j])) {
      j++;
    }
    const isAnd = j > i && s.startsWith("and", j) && isWs(s[j + 3]);
    if ((wide && isSep(s[j])) || isAnd) {
      let k = j + (isAnd ? 3 : 1);
      while (isWs(s[k])) {
        k++;
      }
      out.push({ index: i, len: k - i });
      i = k;
    } else {
      i = j;
    }
  }
  return out;
}

const WRAP_LEAD = "`*_\"'<(";
const WRAP_TAIL = "`*_\"'>).";

// The targets one Needs line names, after its "Needs:" label.
export function needsTargets(rest: string): string[] {
  // A Markdown link stands for its target, so a comma in the link text splits nothing.
  const line = mapLinks(rest.slice(0, MAX_LINE), (_, target) => target);
  const parts: string[] = [];
  let from = 0;
  for (const sep of needsSeparators(line, false)) {
    parts.push(line.slice(from, sep.index));
    from = sep.index + sep.len;
  }
  parts.push(line.slice(from));
  return parts.map(stripWrap).filter((t) => t !== "");
}

// Trims a part and takes the quotes, backticks, brackets and full stop around it off.
function stripWrap(part: string): string {
  const t = part.trim();
  let a = 0;
  while (a < t.length && WRAP_LEAD.includes(t[a])) {
    a++;
  }
  let b = t.length;
  while (b > a && WRAP_TAIL.includes(t[b - 1])) {
    b--;
  }
  return t.slice(a, b);
}
