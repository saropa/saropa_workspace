// Minimal Markdown to HTML conversion for the note preview/copy commands. Pure.
// Split out of noteCommands.ts, which re-exports markdownToHtml.

/**
 * Converts common Markdown constructs to HTML for rich-text clipboard paste.
 * Covers headings, bold, italic, inline code, code blocks, links, images,
 * unordered/ordered lists, blockquotes, horizontal rules, and paragraphs.
 * Not a full CommonMark parser — intentionally minimal with zero dependencies.
 */
export function markdownToHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inCode = false;
  let inList: "ul" | "ol" | null = null;
  let inBlockquote = false;

  const esc = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const inlineMarkup = (line: string): string => {
    let s = esc(line);
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/__(.+?)__/g, "<strong>$1</strong>");
    s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
    s = s.replace(/_(.+?)_/g, "<em>$1</em>");
    return s;
  };

  const closeList = (): void => {
    if (inList) {
      out.push(inList === "ul" ? "</ul>" : "</ol>");
      inList = null;
    }
  };

  const closeBlockquote = (): void => {
    if (inBlockquote) {
      out.push("</blockquote>");
      inBlockquote = false;
    }
  };

  for (const raw of lines) {
    const line = raw;

    if (/^```/.test(line)) {
      if (inCode) {
        out.push("</code></pre>");
        inCode = false;
      } else {
        closeList();
        closeBlockquote();
        out.push("<pre><code>");
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      out.push(esc(line));
      continue;
    }

    if (/^---+$|^\*\*\*+$|^___+$/.test(line.trim())) {
      closeList();
      closeBlockquote();
      out.push("<hr>");
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      closeList();
      closeBlockquote();
      const level = headingMatch[1].length;
      out.push(`<h${level}>${inlineMarkup(headingMatch[2])}</h${level}>`);
      continue;
    }

    const bqMatch = line.match(/^>\s?(.*)/);
    if (bqMatch) {
      closeList();
      if (!inBlockquote) {
        out.push("<blockquote>");
        inBlockquote = true;
      }
      out.push(`<p>${inlineMarkup(bqMatch[1])}</p>`);
      continue;
    }

    const ulMatch = line.match(/^[\s]*[-*+]\s+(.*)/);
    if (ulMatch) {
      closeBlockquote();
      if (inList !== "ul") {
        closeList();
        out.push("<ul>");
        inList = "ul";
      }
      out.push(`<li>${inlineMarkup(ulMatch[1])}</li>`);
      continue;
    }

    const olMatch = line.match(/^[\s]*\d+\.\s+(.*)/);
    if (olMatch) {
      closeBlockquote();
      if (inList !== "ol") {
        closeList();
        out.push("<ol>");
        inList = "ol";
      }
      out.push(`<li>${inlineMarkup(olMatch[1])}</li>`);
      continue;
    }

    closeList();
    closeBlockquote();

    if (!line.trim()) {
      continue;
    }

    out.push(`<p>${inlineMarkup(line)}</p>`);
  }

  if (inCode) { out.push("</code></pre>"); }
  closeList();
  closeBlockquote();

  return out.join("\n");
}
