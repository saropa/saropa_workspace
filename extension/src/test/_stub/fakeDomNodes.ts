// Node model for the fake DOM: text nodes, elements (attributes, classList, dataset, style,
// tree editing, innerHTML, queries) and bubbling event dispatch. Parsing, selectors and
// events live in their own modules; this file ties them to the tree.

import { FakeEvent, FakeEventTarget } from "./fakeDomEvents";
import { parseHtml, serializeNode } from "./fakeDomHtml";
import { matchesComplex, parseSelectorList } from "./fakeDomSelect";

export { FakeDataTransfer, FakeEvent, FakeEventTarget, type Listener } from "./fakeDomEvents";
export { decodeEntities, parseHtml, serializeNode } from "./fakeDomHtml";

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
  createTextNode(data: string): FakeText;
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
