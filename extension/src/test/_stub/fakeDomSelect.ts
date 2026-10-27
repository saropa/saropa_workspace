// Selector engine for the fake DOM: tag, #id, .class, [attr], [attr="value"], :not(...),
// descendant and child combinators, and comma lists. Anything else throws, so a script
// using a selector the harness cannot match fails loudly.

/** What the matcher needs from an element. */
export interface SelectableElement {
  readonly tag: string;
  readonly id: string;
  readonly parentNode: SelectableElement | null;
  readonly classList: { contains(c: string): boolean };
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
}


type Simple =
  | { kind: "tag"; name: string }
  | { kind: "id"; name: string }
  | { kind: "class"; name: string }
  | { kind: "attr"; name: string; value: string | null }
  | { kind: "not"; inner: Simple[] };
export interface Part { compound: Simple[]; combinator: " " | ">" }

function splitTopLevel(src: string, isSep: (ch: string) => boolean): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let escaped = false;
  let cur = "";
  for (const ch of src) {
    if (quote) {
      // A backslash inside quotes escapes the next character, as in CSS strings.
      quote = !escaped && ch === quote ? "" : quote;
      escaped = !escaped && ch === "\\";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "[" || ch === "(") {
      depth++;
    } else if (ch === "]" || ch === ")") {
      depth--;
    } else if (depth === 0 && isSep(ch)) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCompound(src: string): Simple[] {
  const out: Simple[] = [];
  let i = 0;
  const ident = (): string => {
    const m = /^[\w-]+/.exec(src.slice(i));
    if (!m) {
      throw new Error(`fakeDom: unsupported selector "${src}"`);
    }
    i += m[0].length;
    return m[0];
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === "*") {
      i++;
      out.push({ kind: "tag", name: "*" });
    } else if (ch === "#") {
      i++;
      out.push({ kind: "id", name: ident() });
    } else if (ch === ".") {
      i++;
      out.push({ kind: "class", name: ident() });
    } else if (ch === "[") {
      let end = i + 1;
      for (let quote = "", escaped = false; end < src.length && (quote || src[end] !== "]"); end++) {
        const c = src[end];
        quote = quote ? (!escaped && c === quote ? "" : quote) : c === '"' || c === "'" ? c : "";
        escaped = !!quote && !escaped && c === "\\";
      }
      const body = src.slice(i + 1, end);
      i = end + 1;
      const eq = body.indexOf("=");
      const unquote = (v: string): string => v.trim().replace(/^(["'])([\s\S]*)\1$/, "$2").replace(/\\([\s\S])/g, "$1");
      out.push(eq < 0
        ? { kind: "attr", name: body.trim(), value: null }
        : { kind: "attr", name: body.slice(0, eq).trim(), value: unquote(body.slice(eq + 1)) });
    } else if (src.startsWith(":not(", i)) {
      const end = src.indexOf(")", i);
      out.push({ kind: "not", inner: parseCompound(src.slice(i + 5, end)) });
      i = end + 1;
    } else if (/[A-Za-z]/.test(ch)) {
      out.push({ kind: "tag", name: ident().toLowerCase() });
    } else {
      throw new Error(`fakeDom: unsupported selector "${src}"`);
    }
  }
  return out;
}

function parseComplex(src: string): Part[] {
  const parts: Part[] = [];
  let combinator: " " | ">" = " ";
  for (const piece of splitTopLevel(src.trim().replace(/\s*>\s*/g, " > "), (c) => /\s/.test(c))) {
    if (piece === "") {
      continue;
    }
    if (piece === ">") {
      combinator = ">";
      continue;
    }
    parts.push({ compound: parseCompound(piece), combinator });
    combinator = " ";
  }
  return parts;
}

export function parseSelectorList(selector: string): Part[][] {
  return splitTopLevel(selector, (c) => c === ",").map((s) => parseComplex(s));
}

function matchesCompound(el: SelectableElement, compound: Simple[]): boolean {
  return compound.every((s) => {
    switch (s.kind) {
      case "tag": return s.name === "*" || el.tag === s.name;
      case "id": return el.id === s.name;
      case "class": return el.classList.contains(s.name);
      case "attr": return s.value === null ? el.hasAttribute(s.name) : el.getAttribute(s.name) === s.value;
      case "not": return !matchesCompound(el, s.inner);
    }
  });
}

export function matchesComplex(el: SelectableElement, parts: Part[], at = parts.length - 1): boolean {
  if (at < 0 || !matchesCompound(el, parts[at].compound)) {
    return false;
  }
  if (at === 0) {
    return true;
  }
  if (parts[at].combinator === ">") {
    return !!el.parentNode && matchesComplex(el.parentNode, parts, at - 1);
  }
  for (let a = el.parentNode; a; a = a.parentNode) {
    if (matchesComplex(a, parts, at - 1)) {
      return true;
    }
  }
  return false;
}
