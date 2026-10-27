// Value types for the vscode test stub: Uri, FileType, EventEmitter, ThemeColor and the
// small enum-like constants. Pure and stateless, so they live apart from the stateful
// fakes in vscode.ts (which re-exports everything here).

import * as nodePath from "node:path";

// vscode.FileType: the store reads `.type` from a stat to tell a file from a
// directory (the auto-shortcut literal-path branch). Only File/Directory are exercised.
export const FileType = {
  Unknown: 0,
  File: 1,
  Directory: 2,
  SymbolicLink: 64,
} as const;

// A faithful-enough URI for both the store path helpers and real file IO. file()
// yields the "file" scheme and echoes the path as fsPath; parse() reads the scheme
// from a "scheme://..." string and round-trips toString(); joinPath() composes a
// file URI from a base + path segments (used by every project-file read/write).
// Real platform-specific fsPath normalization is not modeled — the tests use
// forward-slash paths, which node's fs accepts on every OS — so this verifies the
// store's BRANCHING and IO, not OS path canonicalization.
export class Uri {
  private constructor(
    public readonly scheme: string,
    public readonly fsPath: string,
    private readonly raw: string
  ) {}

  // The path part of a "scheme://authority/path" string, as vscode.Uri.path.
  get path(): string {
    return this.fsPath.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]*/, "");
  }

  // The authority part of a "scheme://authority/path" string; empty when there is none.
  get authority(): string {
    return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/]*)/.exec(this.fsPath)?.[1] ?? "";
  }

  static file(p: string): Uri {
    return new Uri("file", p, p);
  }

  static parse(value: string): Uri {
    const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(value);
    const scheme = match ? match[1] : "file";
    return new Uri(scheme, value, value);
  }

  // Compose a child file URI. Mirrors vscode.Uri.joinPath: append the segments to
  // the base path with "/" separators (the store always passes POSIX-style
  // relative segments). A trailing slash on the base is collapsed so the result
  // never contains a double slash.
  static joinPath(base: Uri, ...segments: string[]): Uri {
    const head = base.fsPath.replace(/[\\/]+$/, "");
    // Resolve "." and ".." like the real vscode.Uri.joinPath does; without this a
    // ".." segment leaves a path such as "a/package.json/../x" that the OS rejects.
    const joined = nodePath.posix.normalize([head, ...segments].join("/"));
    return new Uri("file", joined, joined);
  }

  toString(): string {
    return this.raw;
  }
}

// A workspace folder: the store reads `.uri` (for joinPath / fsPath) and `.name`
// (for stable auto-shortcut ids). `index` completes the vscode shape.
export interface WorkspaceFolder {
  readonly uri: Uri;
  readonly name: string;
  readonly index: number;
}

// vscode.RelativePattern: constructed by the store only on the GLOB auto-shortcut
// branch (a pattern with wildcards). Holds the base folder + the glob string;
// findFiles below reads both.
export class RelativePattern {
  constructor(
    public readonly base: WorkspaceFolder,
    public readonly pattern: string
  ) {}
}

// Settable workspace folders. undefined models "no folder open" (the store guards

// A faithful-enough EventEmitter for code that exposes a `vscode.EventEmitter`'s
// `.event` and fires it. Listeners registered via `.event` get a disposable; `.fire`
// notifies a snapshot of the current listeners so a listener that disposes mid-fire
// does not corrupt iteration. Models only what the idle monitor (and similar) use.
type Listener<T> = (e: T) => void;
// vscode.EventEmitter stand-in — see the comment above for the `.event`/`.fire`
// contract this fakes.
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

// vscode.ThemeColor: shortcutOpen builds a peek-highlight decoration at MODULE scope, so any
// bundle that transitively imports it constructs one at load time — before a test runs. Only
// the id is modeled; nothing asserts on it, it must merely construct.
export class ThemeColor {
  constructor(public readonly id: string) {}
}

// vscode.ThemeIcon: quick-pick items carry one as their iconPath. Only the id is modeled.
export class ThemeIcon {
  constructor(public readonly id: string) {}
}

// vscode.TreeItem / TreeItemCollapsibleState: the tree-row classes extend TreeItem, so any
// bundle that imports one needs the base class to exist at load. Only the fields the
// rows assign and the unit tests read are modeled.
export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
} as const;
export class TreeItem {
  description?: string | boolean;
  tooltip?: unknown;
  iconPath?: unknown;
  contextValue?: string;
  command?: unknown;
  resourceUri?: Uri;
  id?: string;
  constructor(
    public label: string | { label: string },
    public collapsibleState: number = TreeItemCollapsibleState.None
  ) {}
}

// vscode.TextEditorRevealType / OverviewRulerLane: same module-scope decoration options.
// Modeled as the real numeric members so a bundle loads; no test asserts on them.
export const TextEditorRevealType = {
  Default: 0,
  InCenter: 1,
  InCenterIfOutsideViewport: 2,
  AtTop: 3,
} as const;
/** Stub of the overview ruler lane flags (same numeric values as VS Code). */
export const OverviewRulerLane = {
  Left: 1,
  Center: 2,
  Right: 4,
  Full: 7,
} as const;

// vscode.ViewColumn: only the members a webview panel test needs to pass through
// (never asserted on — a panel test cares about the html/postMessage/dispose
// surface, not which editor column it opened in).
export const ViewColumn = {
  One: 1,
  Two: 2,
  Three: 3,
} as const;
