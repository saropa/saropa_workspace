// Minimal DOM node model for running webview client scripts under node:vm without a
// browser. It implements only what the extension's webview scripts use: element trees,
// attributes, classList, dataset, simple selectors, an HTML parser/serializer (so markup
// assigned to innerHTML becomes real elements, with entities decoded exactly as a browser
// would), and bubbling events. Anything outside that surface throws, so a script that
// starts using a new API fails loudly instead of silently doing nothing.

export type Listener = (ev: FakeEvent) => void;

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RAW_TEXT_TAGS = new Set(["script", "style"]);
// Events that do not bubble in a browser.
const NON_BUBBLING = new Set(["mouseenter", "mouseleave", "focus", "blur", "scroll", "load"]);

/** The browser DataTransfer surface the drag scripts touch. */
export class FakeDataTransfer {
  effectAllowed = "uninitialized";
  dropEffect = "none";
  private readonly data = new Map<string, string>();
  setData(type: string, value: string): void {
    this.data.set(type, String(value));
  }
  getData(type: string): string {
    return this.data.get(type) ?? "";
  }
}

/** A dispatched event. Extra fields (key, clientX, ...) come from the init object. */
export class FakeEvent {
  type: string;
  target: FakeNode | FakeEventTarget | null = null;
  currentTarget: FakeNode | FakeEventTarget | null = null;
  bubbles: boolean;
  defaultPrevented = false;
  propagationStopped = false;
  button = 0;
  key = "";
  clientX = 0;
  clientY = 0;
  relatedTarget: FakeNode | null = null;
  dataTransfer: FakeDataTransfer | null = null;
  data: unknown = undefined;
  constructor(type: string, init: Partial<FakeEvent> = {}) {
    this.type = type;
    this.bubbles = !NON_BUBBLING.has(type);
    Object.assign(this, init);
  }
  preventDefault(): void {
    this.defaultPrevented = true;
  }
  stopPropagation(): void {
    this.propagationStopped = true;
  }
}

/** Listener registry shared by the window, the document and every element. */
export class FakeEventTarget {
  private readonly listeners = new Map<string, Listener[]>();
  addEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type);
    if (list) {
      this.listeners.set(type, list.filter((l) => l !== fn));
    }
  }
  /** Number of listeners registered for a type (self-test and leak checks). */
  listenerCount(type: string): number {
    return (this.listeners.get(type) ?? []).length;
  }
  /** Runs the listeners and the `on<type>` property handler for this target only. */
  invoke(ev: FakeEvent): void {
    ev.currentTarget = this;
    for (const fn of [...(this.listeners.get(ev.type) ?? [])]) {
      fn.call(this, ev);
    }
    const own = (this as unknown as Record<string, unknown>)["on" + ev.type];
    if (typeof own === "function") {
      (own as Listener).call(this, ev);
    }
  }
}

export abstract class FakeNode extends FakeEventTarget {
  parentNode: FakeElement | null = null;
  abstract readonly nodeType: number;
  abstract textContent: string;
  get parentElement(): FakeElement | null {
    return this.parentNode;
  }
}

export class FakeText extends FakeNode {
  readonly nodeType = 3;
  constructor(public data: string) {
    super();
  }
  get textContent(): string {
    return this.data;
  }
  set textContent(v: string) {
    this.data = v;
  }
}

/** Receives window-level dispatch after the document; set by the window. */
export interface EventRoot {
  invoke(ev: FakeEvent): void;
}

/** Inline style declaration: free properties plus the custom-property methods. */
export class FakeStyle {
  private readonly custom = new Map<string, string>();
  setProperty(name: string, value: string): void {
    this.custom.set(name, String(value));
  }
  getPropertyValue(name: string): string {
    return this.custom.get(name) ?? "";
  }
  get cssText(): string {
    return Object.entries(this).map(([k, v]) => `${k}: ${String(v)}`).join("; ");
  }
  set cssText(css: string) {
    for (const decl of css.split(";")) {
      const at = decl.indexOf(":");
      if (at > 0) {
        const name = decl.slice(0, at).trim().replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
        (this as unknown as Record<string, string>)[name] = decl.slice(at + 1).trim();
      }
    }
  }
}

/** Canvas 2D context double: records every call and assignment. */
export class RecordingContext {
  readonly calls: Array<{ op: string; args: unknown[] }> = [];
  readonly assigned: Array<{ prop: string; value: unknown }> = [];
  constructor() {
    return new Proxy(this, {
      get: (target, prop: string) =>
        prop in target ? (target as unknown as Record<string, unknown>)[prop] : (...args: unknown[]) => { target.calls.push({ op: prop, args }); },
      set: (target, prop: string, value: unknown) => {
        target.assigned.push({ prop, value });
        return true;
      },
    });
  }
}

export interface Rect { left: number; top: number; right: number; bottom: number; width: number; height: number }

export class FakeElement extends FakeNode {
  readonly nodeType = 1;
  readonly tag: string;
  readonly ownerDocument: FakeDocumentLike;
  childNodes: FakeNode[] = [];
  readonly attrs = new Map<string, string>();
  readonly style = new FakeStyle();
  rect: Rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  offsetLeft = 0;
  offsetTop = 0;
  offsetWidth = 0;
  offsetHeight = 0;
  clientWidth = 0;
  clientHeight = 0;
  scrollLeft = 0;
  scrollTop = 0;
  disabled = false;
  readOnly = false;
  title = "";
  type = "";
  placeholder = "";
  draggable = false;
  selected = false;
  width = 0;
  height = 0;
  private rawValue: string | null = null;
  private ctx: RecordingContext | null = null;

  constructor(tag: string, doc: FakeDocumentLike) {
    super();
    this.tag = tag.toLowerCase();
    this.ownerDocument = doc;
  }

  get tagName(): string {
    return this.tag.toUpperCase();
  }
  get children(): FakeElement[] {
    return this.childNodes.filter((n): n is FakeElement => n instanceof FakeElement);
  }
  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }
  get id(): string {
    return this.attrs.get("id") ?? "";
  }
  set id(v: string) {
    this.attrs.set("id", String(v));
  }
  get className(): string {
    return this.attrs.get("class") ?? "";
  }
  set className(v: string) {
    this.attrs.set("class", String(v));
  }

  get classList(): {
    add(...c: string[]): void;
    remove(...c: string[]): void;
    toggle(c: string, force?: boolean): boolean;
    contains(c: string): boolean;
  } {
    const read = (): string[] => this.className.split(/\s+/).filter(Boolean);
    const write = (list: string[]): void => {
      this.className = list.join(" ");
    };
    return {
      add: (...c) => write([...new Set([...read(), ...c])]),
      remove: (...c) => write(read().filter((x) => !c.includes(x))),
      contains: (c) => read().includes(c),
      toggle: (c, force) => {
        const has = read().includes(c);
        const want = force === undefined ? !has : !!force;
        write(want ? [...new Set([...read(), c])] : read().filter((x) => x !== c));
        return want;
      },
    };
  }

  get dataset(): Record<string, string | undefined> {
    const key = (prop: string): string => "data-" + prop.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
    const unkey = (attr: string): string => attr.slice(5).replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
    return new Proxy({} as Record<string, string | undefined>, {
      get: (_t, prop: string) => this.attrs.get(key(prop)),
      set: (_t, prop: string, v: unknown) => {
        this.attrs.set(key(prop), String(v));
        return true;
      },
      has: (_t, prop: string) => this.attrs.has(key(prop)),
      deleteProperty: (_t, prop: string) => this.attrs.delete(key(prop)),
      ownKeys: () => [...this.attrs.keys()].filter((k) => k.startsWith("data-")).map(unkey),
      getOwnPropertyDescriptor: (_t, prop: string) =>
        this.attrs.has(key(prop)) ? { enumerable: true, configurable: true, value: this.attrs.get(key(prop)) } : undefined,
    });
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, String(value));
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }

  get value(): string {
    if (this.tag === "select") {
      const options = this.querySelectorAll("option");
      const chosen = options.find((o) => o.selected) ?? options[0];
      return chosen ? chosen.value : "";
    }
    return this.rawValue ?? this.attrs.get("value") ?? "";
  }
  set value(v: string) {
    if (this.tag === "select") {
      for (const o of this.querySelectorAll("option")) {
        o.selected = o.value === String(v);
      }
      return;
    }
    this.rawValue = String(v);
  }

  get textContent(): string {
    return this.childNodes.map((n) => n.textContent).join("");
  }
  set textContent(v: string) {
    this.clear();
    if (String(v) !== "") {
      this.appendChild(new FakeText(String(v)));
    }
  }
  get innerHTML(): string {
    return this.childNodes.map((n) => serializeNode(n)).join("");
  }
  set innerHTML(html: string) {
    this.clear();
    parseHtml(String(html), this, this.ownerDocument);
  }
  insertAdjacentHTML(where: string, html: string): void {
    if (where !== "beforeend") {
      throw new Error(`fakeDom: insertAdjacentHTML("${where}") is not supported`);
    }
    parseHtml(String(html), this, this.ownerDocument);
  }

  private clear(): void {
    for (const n of this.childNodes) {
      n.parentNode = null;
    }
    this.childNodes = [];
  }

  appendChild<T extends FakeNode>(node: T): T {
    node.parentNode?.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  removeChild<T extends FakeNode>(node: T): T {
    this.childNodes = this.childNodes.filter((n) => n !== node);
    node.parentNode = null;
    return node;
  }
  remove(): void {
    this.parentNode?.removeChild(this);
  }
  contains(other: unknown): boolean {
    for (let n = other as FakeNode | null; n; n = n.parentNode) {
      if (n === this) {
        return true;
      }
    }
    return false;
  }
  closest(selector: string): FakeElement | null {
    const parsed = parseSelectorList(selector);
    for (let n: FakeElement | null = this; n; n = n.parentNode) {
      if (parsed.some((c) => matchesComplex(n!, c))) {
        return n;
      }
    }
    return null;
  }
  matches(selector: string): boolean {
    return parseSelectorList(selector).some((c) => matchesComplex(this, c));
  }
  querySelectorAll(selector: string): FakeElement[] {
    const parsed = parseSelectorList(selector);
    const out: FakeElement[] = [];
    const walk = (el: FakeElement): void => {
      for (const child of el.children) {
        if (parsed.some((c) => matchesComplex(child, c))) {
          out.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  getBoundingClientRect(): Rect {
    return { ...this.rect };
  }
  getContext(kind: string): RecordingContext {
    if (kind !== "2d") {
      throw new Error(`fakeDom: getContext("${kind}") is not supported`);
    }
    this.ctx = this.ctx ?? new RecordingContext();
    return this.ctx;
  }
  focus(): void {
    this.ownerDocument.activeElement = this;
  }
  click(): void {
    if (!this.disabled) {
      dispatchEvent(this, new FakeEvent("click"));
    }
  }
}

/** What elements need from their document (kept structural to avoid an import cycle). */
export interface FakeDocumentLike {
  activeElement: FakeElement | null;
  createElement(tag: string): FakeElement;
  /** Window-level target reached after the document when an event bubbles. */
  eventRoot: EventRoot | null;
}

/** Bubbles an event from `target` up through its ancestors, the document and the window. */
export function dispatchEvent(target: FakeNode | FakeEventTarget, ev: FakeEvent): FakeEvent {
  ev.target = target;
  const path: FakeEventTarget[] = [];
  let doc: FakeDocumentLike | null = null;
  for (let n: FakeNode | null = target instanceof FakeNode ? target : null; n; n = n.parentNode) {
    path.push(n);
    if (n instanceof FakeElement) {
      doc = n.ownerDocument;
    }
  }
  if (!(target instanceof FakeNode)) {
    path.push(target);
  } else if (doc?.eventRoot && path[path.length - 1] === (doc as unknown as FakeEventTarget)) {
    path.push(doc.eventRoot as unknown as FakeEventTarget);
  }
  for (let i = 0; i < path.length; i++) {
    if (i > 0 && !ev.bubbles) {
      break;
    }
    path[i].invoke(ev);
    if (ev.propagationStopped) {
      break;
    }
  }
  return ev;
}

// ---- selectors -------------------------------------------------------------

type Simple =
  | { kind: "tag"; name: string }
  | { kind: "id"; name: string }
  | { kind: "class"; name: string }
  | { kind: "attr"; name: string; value: string | null }
  | { kind: "not"; inner: Simple[] };
interface Part { compound: Simple[]; combinator: " " | ">" }

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

function parseSelectorList(selector: string): Part[][] {
  return splitTopLevel(selector, (c) => c === ",").map((s) => parseComplex(s));
}

function matchesCompound(el: FakeElement, compound: Simple[]): boolean {
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

function matchesComplex(el: FakeElement, parts: Part[], at = parts.length - 1): boolean {
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

// ---- HTML ------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(?:(amp|lt|gt|quot|apos|nbsp)|#(\d+)|#x([0-9a-fA-F]+));/g, (_m, name?: string, dec?: string, hex?: string) =>
    name ? ENTITIES[name] : String.fromCodePoint(dec ? parseInt(dec, 10) : parseInt(hex!, 16)));
}

const escText = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string): string => escText(s).replace(/"/g, "&quot;");

export function serializeNode(n: FakeNode): string {
  if (n instanceof FakeText) {
    return escText(n.data);
  }
  const el = n as FakeElement;
  const attrs = [...el.attrs].map(([k, v]) => ` ${k}="${escAttr(v)}"`).join("");
  return VOID_TAGS.has(el.tag) ? `<${el.tag}${attrs}>` : `<${el.tag}${attrs}>${el.innerHTML}</${el.tag}>`;
}

const ATTR_RE = /\s*([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/y;

/** Parses markup into `parent`. Tolerant like a browser: stray end tags are ignored. */
export function parseHtml(html: string, parent: FakeElement, doc: FakeDocumentLike): void {
  const stack: FakeElement[] = [parent];
  const top = (): FakeElement => stack[stack.length - 1];
  const addText = (raw: string, decode = true): void => {
    if (raw === "") {
      return;
    }
    const text = decode ? decodeEntities(raw) : raw;
    const last = top().childNodes[top().childNodes.length - 1];
    if (last instanceof FakeText) {
      last.data += text;
    } else {
      top().appendChild(new FakeText(text));
    }
  };
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      addText(html.slice(i));
      break;
    }
    addText(html.slice(i, lt));
    i = lt;
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith("<!", i)) {
      const end = html.indexOf(">", i);
      i = end < 0 ? html.length : end + 1;
      continue;
    }
    const close = /<\/([a-zA-Z][\w:-]*)\s*>/y;
    close.lastIndex = i;
    const closeMatch = close.exec(html);
    if (closeMatch) {
      const name = closeMatch[1].toLowerCase();
      const at = stack.map((e) => e.tag).lastIndexOf(name);
      if (at > 0) {
        stack.length = at;
      }
      i += closeMatch[0].length;
      continue;
    }
    const open = /<([a-zA-Z][\w:-]*)/y;
    open.lastIndex = i;
    const openMatch = open.exec(html);
    if (!openMatch) {
      addText("<");
      i++;
      continue;
    }
    const el = doc.createElement(openMatch[1]);
    i += openMatch[0].length;
    let selfClose = false;
    for (;;) {
      while (/\s/.test(html[i] ?? "")) {
        i++;
      }
      if (i >= html.length) {
        break;
      }
      if (html[i] === ">") {
        i++;
        break;
      }
      if (html.startsWith("/>", i)) {
        selfClose = true;
        i += 2;
        break;
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
    top().appendChild(el);
    if (RAW_TEXT_TAGS.has(el.tag) && !selfClose) {
      const end = html.toLowerCase().indexOf(`</${el.tag}`, i);
      const stop = end < 0 ? html.length : end;
      el.appendChild(new FakeText(html.slice(i, stop)));
      const gt = html.indexOf(">", stop);
      i = gt < 0 ? html.length : gt + 1;
    } else if (!VOID_TAGS.has(el.tag) && !selfClose) {
      stack.push(el);
    }
  }
}
