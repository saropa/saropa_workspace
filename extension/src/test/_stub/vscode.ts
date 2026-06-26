// Minimal `vscode` stand-in for unit tests. esbuild aliases the bare "vscode"
// import to THIS file when bundling tests (see esbuild.test.js), so a module that
// touches a small slice of the API can run under `node --test` without the
// extension host. It models ONLY the surface the unit-tested code paths use;
// anything else is intentionally absent so an accidental new host dependency fails
// loudly at bundle/run time rather than silently passing against a fake.

// workspace.getConfiguration(section).get(key, default): the unit tests exercise
// the DEFAULT-config path, so every key returns its supplied default. Behavior
// under custom user settings is a host concern (4.2 integration), not a unit one.
export const workspace = {
  getConfiguration(_section?: string): {
    get<T>(key: string, defaultValue: T): T;
  } {
    return {
      get<T>(_key: string, defaultValue: T): T {
        return defaultValue;
      },
    };
  },
};

// window.showInputBox / showQuickPick: the interactive run-token tests drive these
// through settable handlers, so a test can return a chosen value or undefined (a
// cancel) and count how often a dialog was raised. Defaults to "cancel everything"
// (undefined) until a test installs a handler; __resetHandlers restores that.
type InputResult = string | undefined;
type InputHandler = (opts?: { prompt?: string; value?: string }) => Promise<InputResult>;
type PickHandler = (items: readonly string[]) => Promise<InputResult>;

let inputHandler: InputHandler = async () => undefined;
let pickHandler: PickHandler = async () => undefined;

// A faithful-enough EventEmitter for code that exposes a `vscode.EventEmitter`'s
// `.event` and fires it. Listeners registered via `.event` get a disposable; `.fire`
// notifies a snapshot of the current listeners so a listener that disposes mid-fire
// does not corrupt iteration. Models only what the idle monitor (and similar) use.
type Listener<T> = (e: T) => void;
export class EventEmitter<T> {
  private readonly listeners = new Set<Listener<T>>();
  readonly event = (listener: Listener<T>): { dispose(): void } => {
    this.listeners.add(listener);
    return { dispose: (): boolean => this.listeners.delete(listener) };
  };
  fire(data: T): void {
    for (const listener of [...this.listeners]) {
      listener(data);
    }
  }
  dispose(): void {
    this.listeners.clear();
  }
}

// Backing emitters for the window activity events the idle monitor subscribes to. A
// test drives them through the __fire* helpers below to simulate the user interacting
// (or the window losing focus, which is deliberately NOT activity).
const windowStateEmitter = new EventEmitter<{ focused: boolean }>();
const selectionEmitter = new EventEmitter<unknown>();
const activeEditorEmitter = new EventEmitter<unknown>();

export const window = {
  showInputBox(opts?: { prompt?: string; value?: string }): Promise<InputResult> {
    return inputHandler(opts);
  },
  // The real signature takes (items, options); the second arg is unused by the
  // tested code paths, so the stub ignores it.
  showQuickPick(items: readonly string[]): Promise<InputResult> {
    return pickHandler(items);
  },
  onDidChangeWindowState: windowStateEmitter.event,
  onDidChangeTextEditorSelection: selectionEmitter.event,
  onDidChangeActiveTextEditor: activeEditorEmitter.event,
};

// Test drivers for the window activity events.
export function __fireWindowState(focused: boolean): void {
  windowStateEmitter.fire({ focused });
}
export function __fireSelection(): void {
  selectionEmitter.fire({});
}
export function __fireActiveEditor(): void {
  activeEditorEmitter.fire(undefined);
}

export function __setInputHandler(handler: InputHandler): void {
  inputHandler = handler;
}
export function __setPickHandler(handler: PickHandler): void {
  pickHandler = handler;
}
export function __resetHandlers(): void {
  inputHandler = async () => undefined;
  pickHandler = async () => undefined;
}

// A faithful-enough URI for the store path helpers: file() yields the "file"
// scheme and echoes the path as fsPath; parse() reads the scheme from a
// "scheme://..." string and round-trips toString(). This is enough to verify the
// helpers' BRANCHING (file vs non-file scheme, fsPath vs toString); real
// platform-specific fsPath normalization is a host concern (4.2), not a unit one.
export class Uri {
  private constructor(
    public readonly scheme: string,
    public readonly fsPath: string,
    private readonly raw: string
  ) {}

  static file(p: string): Uri {
    return new Uri("file", p, p);
  }

  static parse(value: string): Uri {
    const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(value);
    const scheme = match ? match[1] : "file";
    return new Uri(scheme, value, value);
  }

  toString(): string {
    return this.raw;
  }
}
