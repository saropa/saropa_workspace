// Runs a webview page's inline client scripts under node:vm against a small fake DOM, so
// the browser-side scripts can be tested for behavior without a browser or jsdom.
//
//   const page = runPage(html);           // parse the markup, run its inline scripts
//   page.receive({ type: "data", ... });  // a message from the extension host
//   page.click(page.byId("refresh"));     // a user event
//   page.takePosted();                    // the messages the page sent to the host
//
// Time is virtual: setTimeout and requestAnimationFrame callbacks only run when a test
// calls page.timers.advance/runAll or page.frames.flush, so tests never sleep. Layout is
// virtual too: getBoundingClientRect returns whatever a test assigns to element.rect.

import * as vm from "node:vm";
import {
  dispatchEvent,
  FakeDataTransfer,
  FakeElement,
  FakeEvent,
  FakeEventTarget,
  FakeText,
  parseHtml,
  type EventRoot,
  type FakeDocumentLike,
  type Listener,
} from "./fakeDomNodes";

export { FakeDataTransfer, FakeElement, FakeEvent, FakeText } from "./fakeDomNodes";

/** The document: an element root with the lookups scripts call on `document`. */
export class FakeDocument extends FakeElement implements FakeDocumentLike {
  activeElement: FakeElement | null = null;
  eventRoot: EventRoot | null = null;
  readonly documentElement: FakeElement;
  readonly body: FakeElement;
  /** Answers document.elementFromPoint; tests assign it to simulate hit testing. */
  hitTest: (x: number, y: number) => FakeElement | null = () => null;

  constructor() {
    super("#document", null as unknown as FakeDocumentLike);
    Object.assign(this, { ownerDocument: this });
    this.documentElement = this.createElement("html");
    this.body = this.createElement("body");
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
    this.activeElement = this.body;
  }
  createElement(tag: string): FakeElement {
    return new FakeElement(tag, this);
  }
  createTextNode(data: string): FakeText {
    return new FakeText(data);
  }
  createElementNS(_ns: string, tag: string): FakeElement {
    return this.createElement(tag);
  }
  getElementById(id: string): FakeElement | null {
    return this.querySelector("#" + id);
  }
  elementFromPoint(x: number, y: number): FakeElement | null {
    return this.hitTest(x, y);
  }
}

interface Timer { id: number; fn: () => void; due: number; seq: number }

/** Virtual setTimeout queue. */
export class FakeTimers {
  now = 0;
  private nextId = 1;
  private seq = 0;
  private queue: Timer[] = [];
  set(fn: () => void, delay = 0): number {
    const id = this.nextId++;
    this.queue.push({ id, fn, due: this.now + Math.max(0, Number(delay) || 0), seq: this.seq++ });
    return id;
  }
  clear(id: unknown): void {
    this.queue = this.queue.filter((t) => t.id !== id);
  }
  get pending(): number {
    return this.queue.length;
  }
  /** Moves virtual time forward and runs every timer that falls due, in order. */
  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      const due = this.queue.filter((t) => t.due <= end).sort((a, b) => a.due - b.due || a.seq - b.seq)[0];
      if (!due) {
        break;
      }
      this.queue = this.queue.filter((t) => t !== due);
      this.now = Math.max(this.now, due.due);
      due.fn();
    }
    this.now = end;
  }
  /** Runs every pending timer (including ones scheduled meanwhile). */
  runAll(): void {
    for (let guard = 0; this.queue.length > 0; guard++) {
      if (guard > 1000) {
        throw new Error("fakeDom: timers keep rescheduling themselves");
      }
      this.advance(Math.max(...this.queue.map((t) => t.due)) - this.now);
    }
  }
}

/** Virtual requestAnimationFrame queue. */
export class FakeFrames {
  private queue: Array<() => void> = [];
  request(fn: () => void): number {
    this.queue.push(fn);
    return this.queue.length;
  }
  get pending(): number {
    return this.queue.length;
  }
  /** Runs the callbacks queued so far (callbacks queued while flushing wait for the next flush). */
  flush(): void {
    const run = this.queue;
    this.queue = [];
    run.forEach((fn) => fn());
  }
}

/** The window object; also the global scope the scripts run in. */
export class FakeWindow extends FakeEventTarget implements EventRoot {
  innerWidth = 1024;
  innerHeight = 768;
  devicePixelRatio = 1;
  [key: string]: unknown;
}

const clone = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));

export interface PageOptions {
  /** State the page finds via getState() on load (as after a webview reload). */
  state?: unknown;
  innerWidth?: number;
  innerHeight?: number;
  /** Fixed value (ms since epoch) for `new Date()` and `Date.now()` inside the page. */
  now?: number;
  /** Values getComputedStyle(...).getPropertyValue returns, by property name. */
  computedStyle?: Record<string, string>;
}

export interface Page {
  readonly window: FakeWindow;
  readonly document: FakeDocument;
  readonly timers: FakeTimers;
  readonly frames: FakeFrames;
  /** Messages the page sent with postMessage, oldest first (plain host-realm copies). */
  readonly posted: unknown[];
  /** Every setState call, oldest first. */
  readonly states: unknown[];
  /** Lines the page wrote with console.*, as "level: text". */
  readonly logs: string[];
  /** The page's current saved state. */
  readonly state: unknown;
  byId(id: string): FakeElement;
  all(selector: string): FakeElement[];
  one(selector: string): FakeElement;
  /** Returns the posted messages so far and clears the list. */
  takePosted(): unknown[];
  /** A message from the extension host. */
  receive(data: unknown): void;
  fire(target: FakeElement | FakeDocument | FakeWindow, type: string, init?: Partial<FakeEvent>): FakeEvent;
  click(el: FakeElement, init?: Partial<FakeEvent>): FakeEvent;
  key(el: FakeElement | FakeDocument, key: string, init?: Partial<FakeEvent>): FakeEvent;
  /** Sets an input's value and fires `input`. */
  type(el: FakeElement, value: string): void;
  /** Evaluates an expression in the page scope and returns a plain host-realm copy. */
  evalJson(expression: string): unknown;
  /** Runs another script in the same page scope. */
  run(script: string, filename?: string): void;
}

/** Concatenated text of the inline <script> elements in `root`, in document order. */
function inlineScripts(root: FakeElement): string[] {
  return root.querySelectorAll("script").filter((s) => !s.hasAttribute("src")).map((s) => s.textContent);
}

/** Parses `html` into a document, then runs its inline scripts in order. */
export function runPage(html: string, options: PageOptions = {}): Page {
  const document = new FakeDocument();
  const window = new FakeWindow();
  window.innerWidth = options.innerWidth ?? 1024;
  window.innerHeight = options.innerHeight ?? 768;
  document.eventRoot = window;
  const timers = new FakeTimers();
  const frames = new FakeFrames();
  const posted: unknown[] = [];
  const states: unknown[] = [];
  const logs: string[] = [];
  let state: unknown = clone(options.state);
  let acquired = false;

  const tree = document.createElement("div");
  parseHtml(html, tree, document);
  const bodyEl = tree.querySelector("body");
  const htmlEl = tree.querySelector("html");
  for (const [k, v] of htmlEl?.attrs ?? []) {
    document.documentElement.setAttribute(k, v);
  }
  for (const [k, v] of bodyEl?.attrs ?? []) {
    document.body.setAttribute(k, v);
  }
  for (const node of [...(bodyEl ?? tree).childNodes]) {
    document.body.appendChild(node);
  }
  // Only body scripts run; the shells put their inline script at the end of <body>.
  const scripts = inlineScripts(document.body);

  const log = (level: string) => (...args: unknown[]): void => {
    logs.push(`${level}: ${args.map(String).join(" ")}`);
  };
  Object.assign(window, {
    window,
    document,
    self: window,
    console: { log: log("log"), info: log("info"), warn: log("warn"), error: log("error"), debug: log("debug") },
    setTimeout: (fn: () => void, delay?: number): number => timers.set(fn, delay),
    clearTimeout: (id: unknown): void => timers.clear(id),
    requestAnimationFrame: (fn: () => void): number => frames.request(fn),
    getComputedStyle: () => ({ getPropertyValue: (name: string): string => options.computedStyle?.[name] ?? "" }),
    acquireVsCodeApi: () => {
      if (acquired) {
        throw new Error("An instance of the VS Code API has already been acquired");
      }
      acquired = true;
      return {
        postMessage: (message: unknown): void => {
          posted.push(clone(message));
        },
        getState: (): unknown => clone(state),
        setState: (next: unknown): unknown => {
          state = clone(next);
          states.push(clone(next));
          return next;
        },
      };
    },
  });
  // The window is also the document's event root, so bubbling events reach it.
  // node:vm is not a security sandbox; it only runs this project's own page code.
  const context = vm.createContext(window);

  const run = (script: string, filename = "webview.js"): void => {
    new vm.Script(script, { filename }).runInContext(context);
  };
  if (options.now !== undefined) {
    run(`(function () {
  var Real = Date, fixed = ${Number(options.now)};
  function Fake() { return arguments.length ? new (Function.prototype.bind.apply(Real, [null].concat([].slice.call(arguments))))() : new Real(fixed); }
  Fake.prototype = Real.prototype; Fake.now = function () { return fixed; }; Fake.UTC = Real.UTC; Fake.parse = Real.parse;
  Date = Fake;
})();`, "fixed-date.js");
  }
  scripts.forEach((s, i) => run(s, `inline-script-${i + 1}.js`));

  const fire: Page["fire"] = (target, type, init) => dispatchEvent(target, new FakeEvent(type, init));
  const byId = (id: string): FakeElement => {
    const el = document.getElementById(id);
    if (!el) {
      throw new Error(`fakeDom: no element with id "${id}"`);
    }
    return el;
  };
  return {
    window,
    document,
    timers,
    frames,
    posted,
    states,
    logs,
    get state() {
      return clone(state);
    },
    byId,
    all: (selector) => document.querySelectorAll(selector),
    one: (selector) => {
      const el = document.querySelector(selector);
      if (!el) {
        throw new Error(`fakeDom: nothing matches "${selector}"`);
      }
      return el;
    },
    takePosted: () => posted.splice(0, posted.length),
    receive: (data) => {
      fire(window, "message", { data: clone(data) });
    },
    fire,
    click: (el, init) => fire(el, "click", init),
    key: (el, key, init) => fire(el, "keydown", { key, ...init }),
    type: (el, value) => {
      el.value = value;
      fire(el, "input");
    },
    evalJson: (expression) => {
      const json = vm.runInContext(`JSON.stringify(${expression})`, context) as string | undefined;
      return json === undefined ? undefined : (JSON.parse(json) as unknown);
    },
    run,
  };
}

export type { Listener };
