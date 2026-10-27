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
import { Disposable, applyEdit, recordWarning, recordInfo, languages as readLanguages } from "./vscodeExtras";

import { FileType, Uri, WorkspaceFolder, EventEmitter } from "./vscodeTypes";
import { findFiles } from "./vscodeFind";
import { hostWorkspace, hostWindow, hostLanguages } from "./vscodeHosts";
import { showTextDocument, visibleTextEditors } from "./vscodeEditor";

/** Stub of `vscode.languages`: the Problems panel read plus the provider registrations. */
export const languages = { ...readLanguages, ...hostLanguages };
import { createOutputChannel } from "./vscodeOutput";
import { FakeWebviewPanel, fakeWebviewPanel, createdPanels } from "./vscodeWebview";

// Value types live in vscodeTypes.ts; re-exported so `./_stub/vscode` stays the one entry point.
export * from "./vscodeTypes";
export * from "./vscodeWebview";
export { env, __externalOpens, __resetEnv } from "./vscodeEnv";
export { Range, Selection, TextEditorRevealType, __openedDocuments, __shownEditors, __setVisibleEditors, __resetOpenedDocuments } from "./vscodeEditor";
export { commands, __registeredCommands, __recordedCommands, __resetRecordedCommands } from "./vscodeCommands";
export { StatusBarAlignment, ProgressLocation, __progressRuns, __providerRegistrations, __fireHostEvent, __fileWatchers, __treeViews, __statusBarItems, __quickPicks, __setTabGroups, __resetHosts } from "./vscodeHosts";

export { DiagnosticSeverity, Disposable, WorkspaceEdit, __resetWarnings, __setDiagnostics, __setWarningAnswer, __warningMessages, __infoMessages, __infoCalls, __setInfoAnswer, __resetInfo } from "./vscodeExtras";

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
// Values set at workspace and folder scope; only inspect() sees them, get() reads the global map.
const workspaceValues = new Map<string, unknown>();
const folderValues = new Map<string, unknown>();
// Test-control hook: sets a value at workspace or folder scope for inspect().
export function __setConfigAt(scope: "workspace" | "folder", section: string, key: string, value: unknown): void {
  (scope === "workspace" ? workspaceValues : folderValues).set(`${section}.${key}`, value);
}
// Test-control hook: seeds a single "section.key" value, read back by
// getConfiguration().get() in place of the caller's supplied default.
export function __setConfig(section: string, key: string, value: unknown): void {
  configValues.set(section ? `${section}.${key}` : key, value);
}
// Test-control hook: clears configuration and installed-extension state so it
// does not leak from one test into the next.
export function __resetConfig(): void {
  configValues.clear();
  workspaceValues.clear();
  folderValues.clear();
  installedExtensions.clear();
}

// vscode.ConfigurationTarget: the status-bar action menu writes its "hide me" flag at
// Global (user) scope. Only the members the tested code passes are modeled.
export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
} as const;

function getConfiguration(section?: string): {
  get<T>(key: string, defaultValue: T): T;
  inspect<T>(key: string): { globalValue?: T; workspaceValue?: T; workspaceFolderValue?: T } | undefined;
  update(key: string, value: unknown, target?: number): Promise<void>;
} {
  return {
    get<T>(key: string, defaultValue: T): T {
      const full = section ? `${section}.${key}` : key;
      return (configValues.has(full) ? configValues.get(full) : defaultValue) as T;
    },
    // __setConfig sets the user (global) value; __setConfigAt sets a workspace or folder one.
    inspect<T>(key: string): { globalValue?: T; workspaceValue?: T; workspaceFolderValue?: T } | undefined {
      const full = section ? `${section}.${key}` : key;
      const found = [configValues, workspaceValues, folderValues].some((m) => m.has(full));
      return found
        ? { globalValue: configValues.get(full) as T, workspaceValue: workspaceValues.get(full) as T, workspaceFolderValue: folderValues.get(full) as T }
        : undefined;
    },
    // Writes into the same map get() reads, so a test asserts the effect of a
    // settings-writing action by reading the value back through __getConfig.
    async update(key: string, value: unknown): Promise<void> {
      configValues.set(section ? `${section}.${key}` : key, value);
    },
  };
}

// Test-control hook: reads back a "section.key" value a tested action wrote through
// getConfiguration().update.
export function __getConfig(section: string, key: string): unknown {
  return configValues.get(section ? `${section}.${key}` : key);
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
  // Lists a directory as [name, type] pairs, like workspace.fs.readDirectory.
  async readDirectory(uri: Uri): Promise<Array<[string, number]>> {
    return nodeFs
      .readdirSync(uri.fsPath, { withFileTypes: true })
      .map((e): [string, number] => [e.name, e.isDirectory() ? FileType.Directory : FileType.File]);
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
// The messages window.showErrorMessage was called with since the last reset, in order.
const errorMessages: string[] = [];
/** Test hook: the error messages shown since the last reset. */
export function __errorMessages(): readonly string[] {
  return errorMessages;
}
// Test-control hook: clears the error-message log between tests.
export function __resetErrorMessages(): void {
  errorMessages.length = 0;
}

/** Stub of `vscode.workspace`: configuration, text documents and folders for tests. */
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
  // Empty unless a test pushes a document (for example a dirty one).
  textDocuments: [] as Array<{ isDirty: boolean; uri: Uri }>,
  applyEdit,
  // Configuration changes never fire in the stub; tests read settings directly.
  onDidChangeConfiguration: (_listener: (e: { affectsConfiguration(section: string): boolean }) => void): { dispose(): void } => ({ dispose: (): void => undefined }),
  fs: fsApi,
  findFiles,
  ...hostWorkspace,
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
type PickHandler = (items: readonly unknown[], options?: unknown) => Promise<unknown>;
// window.showOpenDialog: the ${pickFolder:...} token test drives this through a
// settable handler, same shape as input/pick — sees the options passed (so a test
// can assert the defaultUri/title) and returns a chosen Uri array or undefined.
type OpenDialogHandler = (
  opts?: OpenDialogOptions
) => Promise<Uri[] | undefined>;
interface OpenDialogOptions {
  canSelectMany?: boolean;
  canSelectFiles?: boolean;
  canSelectFolders?: boolean;
  defaultUri?: Uri;
  openLabel?: string;
  title?: string;
}

let inputHandler: InputHandler = async () => undefined;
let pickHandler: PickHandler = async () => undefined;
let openDialogHandler: OpenDialogHandler = async () => undefined;

// (or the window losing focus, which is deliberately NOT activity).
const windowStateEmitter = new EventEmitter<{ focused: boolean }>();
const selectionEmitter = new EventEmitter<unknown>();
const activeEditorEmitter = new EventEmitter<unknown>();

// vscode.window stand-in: the settable input/pick dialogs, inert message toasts,
// the no-op output channel, the activity-event emitters the idle monitor
// subscribes to, and webview panel creation.
export const window = {
  activeTextEditor: undefined as { viewColumn?: number } | undefined,
  createWebviewPanel(
    viewType: string,
    title: string,
    _column: number,
    _options?: unknown
  ): FakeWebviewPanel {
    const panel = fakeWebviewPanel(viewType, title);
    createdPanels.push(panel);
    return panel;
  },
  showInputBox(opts?: { prompt?: string; value?: string }): Promise<InputResult> {
    return inputHandler(opts);
  },
  // The handler also sees the options (placeholder, canPickMany), so a test can assert them.
  showQuickPick(items: readonly unknown[], options?: unknown): Promise<unknown> {
    return pickHandler(items, options);
  },
  showOpenDialog(opts?: OpenDialogOptions): Promise<Uri[] | undefined> {
    return openDialogHandler(opts);
  },
  showSaveDialog(_opts?: unknown): Promise<Uri | undefined> {
    return Promise.resolve(undefined);
  },
  // Recorded and answered by the handler in vscodeExtras (default: dismissed).
  showInformationMessage(message: string, ...rest: unknown[]): Promise<string | undefined> {
    return recordInfo(message, rest);
  },
  // Recorded and answered by the handler in vscodeExtras (default: dismissed).
  showWarningMessage(message: string, ...rest: unknown[]): Promise<string | undefined> {
    return recordWarning(message, rest);
  },
  // Records the message so a test can assert which diagnostic surfaced (e.g. a
  // script's missing-requirement toast), then resolves inert like the other toasts.
  showErrorMessage(message: string, ..._items: string[]): Promise<string | undefined> {
    errorMessages.push(message);
    return Promise.resolve(undefined);
  },
  // Logs the document and returns a fake editor over the file (see vscodeEditor).
  showTextDocument,
  visibleTextEditors,
  createOutputChannel,
  // Paired with ThemeColor above: shortcutOpen creates its peek-highlight decoration type at
  // module scope, so this must exist for any bundle that imports it to load at all. The
  // returned handle is inert — no test drives a real editor decoration.
  createTextEditorDecorationType(_options?: unknown): { dispose(): void } {
    return { dispose: (): void => {} };
  },
  onDidChangeWindowState: windowStateEmitter.event,
  onDidChangeTextEditorSelection: selectionEmitter.event,
  onDidChangeActiveTextEditor: activeEditorEmitter.event,
  ...hostWindow,
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

// Test-control hook: installs the handler that answers window.showInputBox calls.
export function __setInputHandler(handler: InputHandler): void {
  inputHandler = handler;
}
// Test-control hook: installs the handler that answers window.showQuickPick calls.
export function __setPickHandler(handler: PickHandler): void {
  pickHandler = handler;
}
// Test-control hook: installs the handler that answers window.showOpenDialog calls.
export function __setOpenDialogHandler(handler: OpenDialogHandler): void {
  openDialogHandler = handler;
}
// Test-control hook: restores the input/pick/openDialog handlers to their "cancel
// everything" defaults between tests.
export function __resetHandlers(): void {
  inputHandler = async () => undefined;
  pickHandler = async () => undefined;
  openDialogHandler = async () => undefined;
}
