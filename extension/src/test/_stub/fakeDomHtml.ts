// HTML parsing and serializing for the fake DOM. The parser is tolerant like a browser's
// (stray end tags are ignored, void and raw-text elements are handled) and decodes the
// entities a real page would, so tests see exactly what escaped markup turns into.

import type { FakeElement, FakeNode, FakeText } from "./fakeDomNodes";

/** What the parser needs from the owning document. */
export interface HtmlFactory {
  createElement(tag: string): FakeElement;
  createTextNode(data: string): FakeText;
}

export const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RAW_TEXT_TAGS = new Set(["script", "style"]);


const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(?:(amp|lt|gt|quot|apos|nbsp)|#(\d+)|#x([0-9a-fA-F]+));/g, (_m, name?: string, dec?: string, hex?: string) =>
    name ? ENTITIES[name] : String.fromCodePoint(dec ? parseInt(dec, 10) : parseInt(hex!, 16)));
}

const escText = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string): string => escText(s).replace(/"/g, "&quot;");

export function serializeNode(n: FakeNode): string {
  if (n.nodeType === 3) {
    return escText((n as FakeText).data);
  }
  const el = n as FakeElement;
  const attrs = [...el.attrs].map(([k, v]) => ` ${k}="${escAttr(v)}"`).join("");
  return VOID_TAGS.has(el.tag) ? `<${el.tag}${attrs}>` : `<${el.tag}${attrs}>${el.innerHTML}</${el.tag}>`;
}

const ATTR_RE = /\s*([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/y;

/** Reads the attributes of a start tag whose name ended at `from`; returns where it ended. */
function readAttributes(html: string, from: number, el: FakeElement): { end: number; selfClose: boolean } {
  let i = from;
  for (;;) {
    while (/\s/.test(html[i] ?? "")) {
      i++;
    }
    if (i >= html.length) {
      return { end: i, selfClose: false };
    }
    if (html[i] === ">") {
      return { end: i + 1, selfClose: false };
    }
    if (html.startsWith("/>", i)) {
      return { end: i + 2, selfClose: true };
    }
    ATTR_RE.lastIndex = i;
    const a = ATTR_RE.exec(html);
    if (!a) {
      i++;
      continue;
    }
    el.setAttribute(a[1].toLowerCase(), decodeEntities(a[2] ?? a[3] ?? a[4] ?? ""));
    i = ATTR_RE.lastIndex;
  }
}

/** Index just past a comment or doctype starting at `at`, or -1 when `at` starts neither. */
function skipDeclaration(html: string, at: number): number {
  if (html.startsWith("<!--", at)) {
    const end = html.indexOf("-->", at + 4);
    return end < 0 ? html.length : end + 3;
  }
  if (html.startsWith("<!", at)) {
    const end = html.indexOf(">", at);
    return end < 0 ? html.length : end + 1;
  }
  return -1;
}

/** Parses markup into `parent`. Tolerant like a browser: stray end tags are ignored. */
export function parseHtml(html: string, parent: FakeElement, doc: HtmlFactory): void {
  const stack: FakeElement[] = [parent];
  const top = (): FakeElement => stack[stack.length - 1];
  const addText = (raw: string): void => {
    if (raw === "") {
      return;
    }
    const text = decodeEntities(raw);
    const last = top().childNodes[top().childNodes.length - 1];
    if (last && last.nodeType === 3) {
      (last as FakeText).data += text;
    } else {
      top().appendChild(doc.createTextNode(text));
    }
  };
  const close = /<\/([a-zA-Z][\w:-]*)\s*>/y;
  const open = /<([a-zA-Z][\w:-]*)/y;
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      addText(html.slice(i));
      break;
    }
    addText(html.slice(i, lt));
    i = lt;
    const past = skipDeclaration(html, i);
    if (past >= 0) {
      i = past;
      continue;
    }
    close.lastIndex = i;
    const closeMatch = close.exec(html);
    if (closeMatch) {
      const at = stack.map((e) => e.tag).lastIndexOf(closeMatch[1].toLowerCase());
      if (at > 0) {
        stack.length = at;
      }
      i += closeMatch[0].length;
      continue;
    }
    open.lastIndex = i;
    const openMatch = open.exec(html);
    if (!openMatch) {
      addText("<");
      i++;
      continue;
    }
    const el = doc.createElement(openMatch[1]);
    const tag = readAttributes(html, i + openMatch[0].length, el);
    i = tag.end;
    top().appendChild(el);
    if (RAW_TEXT_TAGS.has(el.tag) && !tag.selfClose) {
      const end = html.toLowerCase().indexOf(`</${el.tag}`, i);
      const stop = end < 0 ? html.length : end;
      el.appendChild(doc.createTextNode(html.slice(i, stop)));
      const gt = html.indexOf(">", stop);
      i = gt < 0 ? html.length : gt + 1;
    } else if (!VOID_TAGS.has(el.tag) && !tag.selfClose) {
      stack.push(el);
    }
  }
}
