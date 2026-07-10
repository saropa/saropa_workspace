// Minimal `vscode` stand-in for unit tests. esbuild aliases the bare "vscode"
// import to THIS file when bundling tests (see esbuild.test.js), so a module that
// touches a small slice of the API can run under `node --test` without the
// extension host. It models ONLY the surface the unit-tested code paths use;
// anything else is intentionally absent so an accidental new host dependency fails
// loudly at bundle/run time rather than silently passing against a fake.
//
// The store-IO tests (shortcutStore) need real persistence, so workspace.fs is backed
// by the actual node filesystem against a temp directory the test creates, and
// workspace.workspaceFolders / getConfiguration are settable per test. This makes
// the REAL ShortcutStore code run (readProjectFile / writeProjectFile / migration /
// seedAutoShortcuts) — only the host shell is faked, which is unavoidable outside the
// Electron host. globalState / workspaceState are faked by the test's own
// ExtensionContext (an in-memory Map), not here.

import * as nodeFs from "node:fs";
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
    const joined = [head, ...segments].join("/");
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
// that path); a test installs folders pointing at its temp directory.
let folders: WorkspaceFolder[] | undefined;
// Test-control hook: installs the array `workspace.workspaceFolders` returns
// (undefined models "no folder open").
export function __setWorkspaceFolders(next: WorkspaceFolder[] | undefined): void {
  folders = next;
}

// The folder that owns a URI (prefix match on fsPath), mirroring
// workspace.getWorkspaceFolder. Returns undefined for a path outside every folder
// (the store's "offer global instead" branch).
function ownerFolder(uri: Uri): WorkspaceFolder | undefined {
  const target = uri.fsPath.replace(/\\/g, "/");
  return (folders ?? []).find((f) => {
    const base = f.uri.fsPath.replace(/\\/g, "/").replace(/\/+$/, "");
    return target === base || target.startsWith(base + "/");
  });
}

// Settable configuration. Keyed by the full "section.key" the store requests; an
// unset key returns the caller's default (the common path the unit tests took
// before store IO existed). A test sets recipes.enabled=false to skip the recipe
// detection graph, or autoShortcuts.patterns to drive seeding.
const configValues = new Map<string, unknown>();
// Test-control hook: seeds a single "section.key" value, read back by
// getConfiguration().get() in place of the caller's supplied default.
export function __setConfig(section: string, key: string, value: unknown): void {
  configValues.set(section ? `${section}.${key}` : key, value);
}
// Test-control hook: clears configuration and installed-extension state so it
// does not leak from one test into the next.
export function __resetConfig(): void {
  configValues.clear();
  installedExtensions.clear();
}

function getConfiguration(section?: string): {
  get<T>(key: string, defaultValue: T): T;
} {
  return {
    get<T>(key: string, defaultValue: T): T {
      const full = section ? `${section}.${key}` : key;
      return (configValues.has(full) ? configValues.get(full) : defaultValue) as T;
    },
  };
}

// Convert a VS Code glob to a RegExp anchored to a folder-relative POSIX path.
// Handles the constructs the auto-shortcut patterns use: `**` (any depth), `*` (one
// segment), `?` (one char). Enough to expand a real glob against the temp tree;
// literal patterns never reach here (the store stats those directly).
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**/` matches any number of leading segments (including none); a bare
        // `**` matches anything.
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

// workspace.findFiles for the glob auto-shortcut branch: walk the base folder, match
// each file's folder-relative POSIX path against the pattern, skip the excluded
// subtree (the store passes node_modules), and cap at maxResults. The non-glob
// branch never calls this — the store stats a literal path directly.
async function findFiles(
  include: RelativePattern,
  exclude?: string,
  maxResults?: number
): Promise<Uri[]> {
  const root = include.base.uri.fsPath;
  const matcher = globToRegExp(include.pattern);
  const excludeName = exclude ? exclude.replace(/[*/]/g, "") : undefined;
  const out: Uri[] = [];
  const walk = (dir: string): void => {
    if (maxResults !== undefined && out.length >= maxResults) {
      return;
    }
    for (const entry of nodeFs.readdirSync(dir, { withFileTypes: true })) {
      if (excludeName && entry.name === excludeName) {
        continue;
      }
      const full = nodePath.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        const rel = nodePath.relative(root, full).replace(/\\/g, "/");
        if (matcher.test(rel)) {
          out.push(Uri.joinPath(include.base.uri, rel));
        }
      }
    }
  };
  walk(root);
  return out;
}

// workspace.fs backed by the real node filesystem. The store awaits these and
// catches rejections (a missing file is the normal first-run state), so a sync
// throw inside an async function — which becomes a rejected promise — is the right
// shape for stat/readFile on an absent path.
const fsApi = {
  async stat(uri: Uri): Promise<{ type: number; size: number; ctime: number; mtime: number }> {
    const s = nodeFs.statSync(uri.fsPath);
    return {
      type: s.isDirectory() ? FileType.Directory : FileType.File,
      size: s.size,
      ctime: Math.trunc(s.ctimeMs),
      mtime: Math.trunc(s.mtimeMs),
    };
  },
  async readFile(uri: Uri): Promise<Uint8Array> {
    return nodeFs.readFileSync(uri.fsPath);
  },
  async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
    nodeFs.writeFileSync(uri.fsPath, content);
  },
  async createDirectory(uri: Uri): Promise<void> {
    nodeFs.mkdirSync(uri.fsPath, { recursive: true });
  },
  async delete(uri: Uri, options?: { recursive?: boolean }): Promise<void> {
    nodeFs.rmSync(uri.fsPath, { recursive: !!options?.recursive, force: true });
  },
};

// vscode.workspace stand-in: configuration reads, workspaceFolders /
// getWorkspaceFolder, the real-filesystem-backed fs, and findFiles — the slice of
// the real namespace the store and detectors actually touch.
// The fsPaths handed to showTextDocument since the last reset. The report writers all
// route their auto-open through exec/reportOpen, so this log is how a test asserts
// that a routine raised exactly ONE window (its summary) rather than one per member.
const openedDocuments: string[] = [];
// The documents showTextDocument was called with since the last reset, in order.
export function __openedDocuments(): readonly string[] {
  return openedDocuments;
}
// Test-control hook: clears the opened-document log between tests.
export function __resetOpenedDocuments(): void {
  openedDocuments.length = 0;
}

export const workspace = {
  getConfiguration,
  // Modeled as an identity: the report writers pass the URI straight to
  // showTextDocument, which is where the test observes the open.
  async openTextDocument(uri: Uri): Promise<{ uri: Uri }> {
    return { uri };
  },
  get workspaceFolders(): WorkspaceFolder[] | undefined {
    return folders;
  },
  getWorkspaceFolder(uri: Uri): WorkspaceFolder | undefined {
    return ownerFolder(uri);
  },
  fs: fsApi,
  findFiles,
};

// vscode.extensions.getExtension: the suite recipes probe whether a sibling Saropa
// tool's extension is installed (so they only seed a command the host can run). A
// test installs the relevant ids; an unset id models "not installed" (the
// graceful-absence path). getExtension returns a stand-in only carrying `.id`, the
// single field the detector reads (it checks presence, not the activation surface).
let installedExtensions = new Set<string>();
// Test-control hook: sets which extension ids extensions.getExtension() reports
// as installed for the rest of the test.
export function __setInstalledExtensions(ids: string[]): void {
  installedExtensions = new Set(ids);
}
// vscode.extensions stand-in: reports installed/not-installed by id, driven by
// __setInstalledExtensions (defaults to "nothing installed").
export const extensions = {
  getExtension(id: string): { id: string } | undefined {
    return installedExtensions.has(id) ? { id } : undefined;
  },
};

// window.showInputBox / showQuickPick: the interactive run-token tests drive these
// through settable handlers, so a test can return a chosen value or undefined (a
// cancel) and count how often a dialog was raised. Defaults to "cancel everything"
// (undefined) until a test installs a handler; __resetHandlers restores that.
type InputResult = string | undefined;
type InputHandler = (opts?: { prompt?: string; value?: string }) => Promise<InputResult>;
// showQuickPick is modeled with one settable handler, but the real API yields a
// QuickPickItem object (or, with canPickMany, an array of them) — not just a string.
// So the handler sees the item list as `unknown[]` and may return any shape (a chosen
// item, an array of items, or undefined for cancel); the tested editors narrow it.
type PickHandler = (items: readonly unknown[]) => Promise<unknown>;

let inputHandler: InputHandler = async () => undefined;
let pickHandler: PickHandler = async () => undefined;

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
// (or the window losing focus, which is deliberately NOT activity).
const windowStateEmitter = new EventEmitter<{ focused: boolean }>();
const selectionEmitter = new EventEmitter<unknown>();
const activeEditorEmitter = new EventEmitter<unknown>();

// A no-op OutputChannel: the store's getOutputChannel() constructs one lazily on an
// error/diagnostic path. The tests do not assert on it; it must only not throw.
function createOutputChannel(name: string): {
  name: string;
  appendLine(value: string): void;
  append(value: string): void;
  clear(): void;
  show(preserveFocus?: boolean): void;
  hide(): void;
  replace(value: string): void;
  dispose(): void;
} {
  return {
    name,
    appendLine(): void {},
    append(): void {},
    clear(): void {},
    show(): void {},
    hide(): void {},
    replace(): void {},
    dispose(): void {},
  };
}

// vscode.window stand-in: the settable input/pick dialogs, inert message toasts,
// the no-op output channel, and the activity-event emitters the idle monitor
// subscribes to.
export const window = {
  showInputBox(opts?: { prompt?: string; value?: string }): Promise<InputResult> {
    return inputHandler(opts);
  },
  // The real signature takes (items, options); the second arg is unused by the
  // tested code paths, so the stub ignores it.
  showQuickPick(items: readonly unknown[]): Promise<unknown> {
    return pickHandler(items);
  },
  // The branch-set binder and several command handlers emit toasts via these. No
  // test asserts on their text, so they are inert no-ops that resolve to undefined
  // (the "no action button chosen" result) — they must only exist and not throw.
  showInformationMessage(
    _message: string,
    ..._items: string[]
  ): Promise<string | undefined> {
    return Promise.resolve(undefined);
  },
  showWarningMessage(
    _message: string,
    ..._items: string[]
  ): Promise<string | undefined> {
    return Promise.resolve(undefined);
  },
  // Records which document was raised, so the report-open suppression tests can
  // assert on the number and identity of windows a run produced.
  async showTextDocument(doc: { uri: Uri }): Promise<void> {
    openedDocuments.push(doc.uri.fsPath);
  },
  createOutputChannel,
  onDidChangeWindowState: windowStateEmitter.event,
  onDidChangeTextEditorSelection: selectionEmitter.event,
  onDidChangeActiveTextEditor: activeEditorEmitter.event,
};

// Test drivers for the window activity events.
export function __fireWindowState(focused: boolean): void {
  windowStateEmitter.fire({ focused });
}
// Fires a text-editor-selection change with an empty payload — enough to count as
// "activity" for the idle monitor, which only cares that the event fired.
export function __fireSelection(): void {
  selectionEmitter.fire({});
}
// Fires an active-editor-change event with an undefined payload, the same
// "any fire counts as activity" shortcut as __fireSelection.
export function __fireActiveEditor(): void {
  activeEditorEmitter.fire(undefined);
}

// commands.executeCommand: the analytics preview calls it to open the Markdown
// preview, but the unit-tested path (buildReport) never reaches it. Modeled as an
// inert async no-op. Each call is recorded so a test that DOES care which command
// ran (the branch-set binder's on-switch shortcut runner) can assert it; the recording
// is cleared by __resetRecordedCommands.
const recordedCommands: Array<{ command: string; args: unknown[] }> = [];
// vscode.commands stand-in: executeCommand is an inert no-op that records the
// call, so a test that cares which command ran can assert against it afterward.
export const commands = {
  executeCommand(command: string, ...rest: unknown[]): Promise<undefined> {
    recordedCommands.push({ command, args: rest });
    return Promise.resolve(undefined);
  },
};

// The commands executeCommand was called with since the last reset, for tests that
// assert a side-effecting command fired (e.g. saropaWorkspace.runPin).
export function __recordedCommands(): ReadonlyArray<{
  command: string;
  args: unknown[];
}> {
  return recordedCommands;
}
// Test-control hook: clears the recorded executeCommand call log between tests.
export function __resetRecordedCommands(): void {
  recordedCommands.length = 0;
}

// Test-control hook: installs the handler that answers window.showInputBox calls.
export function __setInputHandler(handler: InputHandler): void {
  inputHandler = handler;
}
// Test-control hook: installs the handler that answers window.showQuickPick calls.
export function __setPickHandler(handler: PickHandler): void {
  pickHandler = handler;
}
// Test-control hook: restores the input/pick handlers to their "cancel
// everything" defaults between tests.
export function __resetHandlers(): void {
  inputHandler = async () => undefined;
  pickHandler = async () => undefined;
}
