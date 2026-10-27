// Minimal Markdown to HTML conversion for the note preview/copy commands. Pure.
// Split out of noteCommands.ts, which re-exports markdownToHtml.

/** Escapes the three characters that would otherwise start markup. */
function escapeMd(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Escapes a line, then turns inline Markdown into tags. The escape runs first so
 * user text can never inject HTML; code spans go before emphasis so asterisks
 * inside backticks are not treated as bold.
 */
function inlineMarkup(line: string): string {
  let s = escapeMd(line);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__(.+?)__/g, "<strong>$1</strong>");
  s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
  s = s.replace(/_(.+?)_/g, "<em>$1</em>");
  return s;
}

/** Which block (if any) the converter is currently inside. */
interface MdState {
  readonly out: string[];
  inCode: boolean;
  inList: "ul" | "ol" | null;
  inBlockquote: boolean;
}

function closeList(st: MdState): void {
  if (st.inList) {
    st.out.push(st.inList === "ul" ? "</ul>" : "</ol>");
    st.inList = null;
  }
}

function closeBlockquote(st: MdState): void {
  if (st.inBlockquote) {
    st.out.push("</blockquote>");
    st.inBlockquote = false;
  }
}

/** Handles a ``` fence line: opens or closes a code block. */
function convertFence(st: MdState): void {
  if (st.inCode) {
    st.out.push("</code></pre>");
    st.inCode = false;
    return;
  }
  closeList(st);
  closeBlockquote(st);
  st.out.push("<pre><code>");
  st.inCode = true;
}

/** Opens a list of `kind` (closing a different open list) and adds one item. */
function convertListItem(st: MdState, kind: "ul" | "ol", text: string): void {
  closeBlockquote(st);
  if (st.inList !== kind) {
    closeList(st);
    st.out.push(`<${kind}>`);
    st.inList = kind;
  }
  st.out.push(`<li>${inlineMarkup(text)}</li>`);
}

/**
 * Converts one line outside a code block. Block types are tried in a fixed
 * order (rule, heading, quote, bullet, number); anything else is a paragraph.
 */
function convertLine(st: MdState, line: string): void {
  if (/^---+$|^\*\*\*+$|^___+$/.test(line.trim())) {
    closeList(st);
    closeBlockquote(st);
    st.out.push("<hr>");
    return;
  }
  const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
  if (headingMatch) {
    closeList(st);
    closeBlockquote(st);
    const level = headingMatch[1].length;
    st.out.push(`<h${level}>${inlineMarkup(headingMatch[2])}</h${level}>`);
    return;
  }
  const bqMatch = line.match(/^>\s?(.*)/);
  if (bqMatch) {
    closeList(st);
    if (!st.inBlockquote) {
      st.out.push("<blockquote>");
      st.inBlockquote = true;
    }
    st.out.push(`<p>${inlineMarkup(bqMatch[1])}</p>`);
    return;
  }
  const ulMatch = line.match(/^[\s]*[-*+]\s+(.*)/);
  if (ulMatch) {
    convertListItem(st, "ul", ulMatch[1]);
    return;
  }
  const olMatch = line.match(/^[\s]*\d+\.\s+(.*)/);
  if (olMatch) {
    convertListItem(st, "ol", olMatch[1]);
    return;
  }
  closeList(st);
  closeBlockquote(st);
  if (line.trim()) {
    st.out.push(`<p>${inlineMarkup(line)}</p>`);
  }
}

/**
 * Converts common Markdown constructs to HTML for rich-text clipboard paste.
 * Covers headings, bold, italic, inline code, code blocks, links, images,
 * unordered/ordered lists, blockquotes, horizontal rules, and paragraphs.
 * Not a full CommonMark parser — intentionally minimal with zero dependencies.
 */
export function markdownToHtml(md: string): string {
  const st: MdState = { out: [], inCode: false, inList: null, inBlockquote: false };
  for (const line of md.split(/\r?\n/)) {
    if (/^```/.test(line)) {
      convertFence(st);
    } else if (st.inCode) {
      st.out.push(escapeMd(line));
    } else {
      convertLine(st, line);
    }
  }
  if (st.inCode) { st.out.push("</code></pre>"); }
  closeList(st);
  closeBlockquote(st);
  return st.out.join("\n");
}
