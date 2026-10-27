// Event model for the fake DOM: events, their listener registry and the drag data object.

export type Listener = (ev: FakeEvent) => void;

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
  target: FakeEventTarget | null = null;
  currentTarget: FakeEventTarget | null = null;
  bubbles: boolean;
  defaultPrevented = false;
  propagationStopped = false;
  button = 0;
  key = "";
  clientX = 0;
  clientY = 0;
  relatedTarget: FakeEventTarget | null = null;
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
