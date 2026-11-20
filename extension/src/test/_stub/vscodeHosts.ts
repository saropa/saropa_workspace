// Registration-style host APIs for the test stub: content/tree/webview providers, file
// watchers, tree views, status-bar items and the document/theme events. Each call is
// recorded so a registrar test can assert what was registered, and disposing a handle
// removes it from the record. Split out of vscode.ts to keep that file small.

import { Disposable } from "./vscodeExtras";
import { EventEmitter } from "./vscodeTypes";

/** vscode.StatusBarAlignment values. */
export const StatusBarAlignment = { Left: 1, Right: 2 } as const;

/** vscode.ProgressLocation values. */
export const ProgressLocation = { SourceControl: 1, Window: 10, Notification: 15 } as const;

/** One recorded withProgress call: where it showed and its title. */
export interface ProgressRun {
  readonly location: number | undefined;
  readonly title: string | undefined;
}

const progressRuns: ProgressRun[] = [];

/** Test hook: the withProgress calls made since the last reset, in order. */
export function __progressRuns(): readonly ProgressRun[] {
  return progressRuns;
}

function withProgress<T>(
  options: { location?: number; title?: string },
  task: (progress: { report(value: unknown): void }) => PromiseLike<T>
): Promise<T> {
  progressRuns.push({ location: options.location, title: options.title });
  return Promise.resolve(task({ report: (): void => undefined }));
}

/** One recorded provider registration. */
export interface ProviderRegistration {
  readonly kind: string;
  readonly id: string;
  /** The provider object passed at registration, so a test can call it. */
  readonly provider: unknown;
}

const providers: ProviderRegistration[] = [];

function track(kind: string, id: string, provider?: unknown): Disposable {
  const entry: ProviderRegistration = { kind, id, provider };
  providers.push(entry);
  return new Disposable(() => {
    const at = providers.indexOf(entry);
    if (at >= 0) {
      providers.splice(at, 1);
    }
  });
}

/** Test hook: the provider registrations that are still live, in registration order. */
export function __providerRegistrations(): readonly ProviderRegistration[] {
  return providers;
}

const events = {
  textChanged: new EventEmitter<unknown>(),
  textSaved: new EventEmitter<unknown>(),
  textClosed: new EventEmitter<unknown>(),
  textOpened: new EventEmitter<unknown>(),
  foldersChanged: new EventEmitter<unknown>(),
  themeChanged: new EventEmitter<unknown>(),
  configChanged: new EventEmitter<{ affectsConfiguration(section: string): boolean }>(),
  tabsChanged: new EventEmitter<unknown>(),
};

/** Names of the events a test can fire with `__fireHostEvent`. */
export type HostEventName = keyof typeof events;

/** Test hook: fires one of the document, folder, theme, configuration or tab events with `payload`. */
export function __fireHostEvent(name: HostEventName, payload: unknown): void {
  (events[name] as EventEmitter<unknown>).fire(payload);
}

/** A file-system watcher handle: three events and a dispose. */
export interface FakeFileWatcher {
  readonly pattern: string;
  /** The folder a relative pattern is rooted at (its path), or undefined for a plain string pattern. */
  readonly base: string | undefined;
  readonly created: EventEmitter<unknown>;
  readonly changed: EventEmitter<unknown>;
  readonly deleted: EventEmitter<unknown>;
  disposed: boolean;
  onDidCreate: EventEmitter<unknown>["event"];
  onDidChange: EventEmitter<unknown>["event"];
  onDidDelete: EventEmitter<unknown>["event"];
  dispose(): void;
}

const watchers: FakeFileWatcher[] = [];

/** Test hook: every file watcher created since the last reset, in creation order. */
export function __fileWatchers(): readonly FakeFileWatcher[] {
  return watchers;
}

// The path of a RelativePattern base, which is a folder (with a uri) or a uri.
function baseOf(base: unknown): string | undefined {
  const holder = base as { fsPath?: string; uri?: { fsPath?: string } } | undefined;
  return holder?.fsPath ?? holder?.uri?.fsPath;
}

function createFileSystemWatcher(pattern: unknown): FakeFileWatcher {
  const created = new EventEmitter<unknown>();
  const changed = new EventEmitter<unknown>();
  const deleted = new EventEmitter<unknown>();
  const watcher: FakeFileWatcher = {
    pattern: typeof pattern === "string" ? pattern : String((pattern as { pattern?: unknown }).pattern),
    base: typeof pattern === "string" ? undefined : baseOf((pattern as { base?: unknown }).base),
    created,
    changed,
    deleted,
    disposed: false,
    onDidCreate: created.event,
    onDidChange: changed.event,
    onDidDelete: deleted.event,
    dispose(): void {
      watcher.disposed = true;
    },
  };
  watchers.push(watcher);
  return watcher;
}

/** A tree-view handle with its selection, message and expand/collapse events. */
export interface FakeTreeView {
  readonly viewId: string;
  selection: unknown[];
  message: string | undefined;
  readonly revealed: unknown[];
  disposed: boolean;
  onDidExpandElement: EventEmitter<unknown>["event"];
  onDidCollapseElement: EventEmitter<unknown>["event"];
  onDidChangeSelection: EventEmitter<unknown>["event"];
  onDidChangeVisibility: EventEmitter<unknown>["event"];
  reveal(element: unknown): Promise<void>;
  dispose(): void;
}

const treeViews: FakeTreeView[] = [];

/** Test hook: every tree view created since the last reset. */
export function __treeViews(): readonly FakeTreeView[] {
  return treeViews;
}

function createTreeView(viewId: string, _options?: unknown): FakeTreeView {
  const expand = new EventEmitter<unknown>();
  const collapse = new EventEmitter<unknown>();
  const selected = new EventEmitter<unknown>();
  const visible = new EventEmitter<unknown>();
  const view: FakeTreeView = {
    viewId,
    selection: [],
    message: undefined,
    revealed: [],
    disposed: false,
    onDidExpandElement: expand.event,
    onDidCollapseElement: collapse.event,
    onDidChangeSelection: selected.event,
    onDidChangeVisibility: visible.event,
    async reveal(element: unknown): Promise<void> {
      view.revealed.push(element);
    },
    dispose(): void {
      view.disposed = true;
    },
  };
  treeViews.push(view);
  return view;
}

/** A persistent quick pick: the properties the extension sets, plus accept and hide events. */
export interface FakeQuickPick {
  title: string | undefined;
  placeholder: string | undefined;
  items: readonly unknown[];
  activeItems: readonly unknown[];
  selectedItems: readonly unknown[];
  ignoreFocusOut: boolean;
  canSelectMany: boolean;
  matchOnDescription: boolean;
  matchOnDetail: boolean;
  /** The text in the box. Setting it fires onDidChangeValue, as the real box does. */
  value: string;
  shown: boolean;
  disposed: boolean;
  onDidAccept: EventEmitter<unknown>["event"];
  onDidHide: EventEmitter<unknown>["event"];
  onDidChangeValue: EventEmitter<string>["event"];
  show(): void;
  hide(): void;
  dispose(): void;
  /** Test driver: selects `items` (none, one or several) and fires the accept event, as Enter would. */
  accept(...items: unknown[]): void;
  /** Test driver: types `text` into the box, as a user would (same event as setting value). */
  type(text: string): void;
}

const quickPicks: FakeQuickPick[] = [];
let quickPickDriver: ((pick: FakeQuickPick) => void) | undefined;

/**
 * Test hook: installs a function called each time a quick pick is shown. It answers the
 * menu by calling `pick.accept(item)` or `pick.hide()`; pass undefined to remove it.
 */
export function __setQuickPickDriver(driver: ((pick: FakeQuickPick) => void) | undefined): void {
  quickPickDriver = driver;
}

/** Test hook: every quick pick created since the last reset, in creation order. */
export function __quickPicks(): readonly FakeQuickPick[] {
  return quickPicks;
}

function createQuickPick(): FakeQuickPick {
  const accepted = new EventEmitter<unknown>();
  const hidden = new EventEmitter<unknown>();
  const typed = new EventEmitter<string>();
  let text = "";
  const pick: FakeQuickPick = {
    title: undefined,
    placeholder: undefined,
    items: [],
    activeItems: [],
    selectedItems: [],
    ignoreFocusOut: false,
    canSelectMany: false,
    matchOnDescription: false,
    matchOnDetail: false,
    get value(): string {
      return text;
    },
    set value(next: string) {
      text = next;
      typed.fire(next);
    },
    shown: false,
    disposed: false,
    onDidAccept: accepted.event,
    onDidHide: hidden.event,
    onDidChangeValue: typed.event,
    show(): void {
      pick.shown = true;
      quickPickDriver?.(pick);
    },
    hide(): void {
      pick.shown = false;
      hidden.fire(undefined);
    },
    dispose(): void {
      pick.disposed = true;
    },
    accept(...items: unknown[]): void {
      pick.selectedItems = items;
      accepted.fire(undefined);
    },
    type(next: string): void {
      pick.value = next;
    },
  };
  quickPicks.push(pick);
  return pick;
}

/** A status-bar item handle: text, command, visibility. */
export interface FakeStatusBarItem {
  readonly alignment: number | undefined;
  readonly priority: number | undefined;
  text: string;
  tooltip: unknown;
  command: unknown;
  visible: boolean;
  disposed: boolean;
  show(): void;
  hide(): void;
  dispose(): void;
}

const statusItems: FakeStatusBarItem[] = [];

/** Test hook: every status-bar item created since the last reset. */
export function __statusBarItems(): readonly FakeStatusBarItem[] {
  return statusItems;
}

function createStatusBarItem(alignment?: number, priority?: number): FakeStatusBarItem {
  const item: FakeStatusBarItem = {
    alignment,
    priority,
    text: "",
    tooltip: undefined,
    command: undefined,
    visible: false,
    disposed: false,
    show(): void {
      item.visible = true;
    },
    hide(): void {
      item.visible = false;
    },
    dispose(): void {
      item.disposed = true;
      item.visible = false;
    },
  };
  statusItems.push(item);
  return item;
}

/** Test hook: forgets every recorded provider, watcher, tree view and status item. */
export function __resetHosts(): void {
  providers.length = 0;
  watchers.length = 0;
  treeViews.length = 0;
  statusItems.length = 0;
  quickPicks.length = 0;
  quickPickDriver = undefined;
  tabGroupList = [];
  progressRuns.length = 0;
}

/** The extra members of `vscode.workspace`. */
export const hostWorkspace = {
  createFileSystemWatcher,
  registerTextDocumentContentProvider: (scheme: string, provider?: unknown): Disposable => track("textDocumentContent", scheme, provider),
  onDidChangeTextDocument: events.textChanged.event,
  onDidSaveTextDocument: events.textSaved.event,
  onDidCloseTextDocument: events.textClosed.event,
  onDidOpenTextDocument: events.textOpened.event,
  onDidChangeWorkspaceFolders: events.foldersChanged.event,
  onDidChangeConfiguration: events.configChanged.event,
};

/** One editor group of the tab model: its column and tabs (only the tab input is modeled). */
export interface FakeTabGroup {
  readonly viewColumn: number;
  readonly isActive?: boolean;
  readonly tabs: ReadonlyArray<{ readonly input: unknown }>;
}

let tabGroupList: readonly FakeTabGroup[] = [];

/** Test hook: sets the editor groups `window.tabGroups.all` reports. */
export function __setTabGroups(groups: readonly FakeTabGroup[]): void {
  tabGroupList = groups;
}

/** The extra members of `vscode.window`. */
export const hostWindow = {
  createTreeView,
  createStatusBarItem,
  createQuickPick,
  withProgress,
  tabGroups: {
    get all(): readonly FakeTabGroup[] {
      return tabGroupList;
    },
    get activeTabGroup(): FakeTabGroup {
      return tabGroupList.find((g) => g.isActive) ?? tabGroupList[0] ?? { viewColumn: 1, tabs: [] };
    },
    onDidChangeTabs: events.tabsChanged.event,
  },
  registerTreeDataProvider: (viewId: string, provider?: unknown): Disposable => track("treeData", viewId, provider),
  registerWebviewViewProvider: (viewId: string, provider?: unknown, _options?: unknown): Disposable => track("webviewView", viewId, provider),
  registerUriHandler: (handler?: unknown): Disposable => track("uriHandler", "uri", handler),
  registerFileDecorationProvider: (provider?: unknown): Disposable => track("fileDecoration", "file", provider),
  onDidChangeActiveColorTheme: events.themeChanged.event,
};

/** The extra members of `vscode.languages`. */
export const hostLanguages = {
  registerCodeLensProvider: (selector: unknown, provider?: unknown): Disposable =>
    track("codeLens", typeof selector === "string" ? selector : JSON.stringify(selector), provider),
  onDidChangeDiagnostics: new EventEmitter<unknown>().event,
};
