import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { BoardItem } from "../board/boardModel";
import { TagsTab, renderTagsEditor } from "../board/tagsEditorHtml";
import { EditorState, LIMITS, checkState, exportText, importDiff, namingPreview, parseImport, testMatch } from "../board/org/organizeEdit";
import { Profile, SeverityDict } from "../board/severity";
import { BoardConfig } from "../board/types";
import { RULES_FILE } from "../commands/boardConfigLoad";
import { explainUnreadable, offerUndo, readOrganize, saveState } from "../commands/boardOrganizeEdit";
import { l10n } from "../i18n/l10n";
import { SeverityPart, loadSeverityDict } from "./severityPart";
import { tagsLabels } from "./tagsStrings";

// Release Board, the Tags and rules editor: an editor-tab webview with tabs for tags, link words, naming and
// severity keywords. One instance. The page holds a draft; the host checks every state it receives (the page's
// values are never trusted), answers with counts and titles only, never takes a path from the page, and writes
// only through the safe rules-file path. A save leaves the editor open and the page keeps its other drafts.

// What the editor takes from the board; a scan after a save hands the same shape back.
export interface BoardView {
  cfg: BoardConfig;
  items: readonly BoardItem[];
  projectNames: ReadonlyMap<string, string>;
  profile: Profile;
}

export interface TagsEditorInput extends BoardView {
  // Called after the rules file changed, so the board scans again; resolves with what the board shows now.
  onSaved: () => Promise<BoardView | void>;
  // The tab the page starts on, or is switched to when the editor is already open (default: tags).
  tab?: TagsTab;
  // Tag ids to highlight on the Tags tab (the ones that matched the row or group "Edit tags" was chosen on).
  focus?: string[];
}

let current: TagsEditorPanel | undefined;

class TagsEditorPanel {
  private readonly disposables: vscode.Disposable[] = [];
  private saving = false;
  private severity: SeverityPart | undefined;
  private root: vscode.WorkspaceFolder;
  // The state of the rules file at open or at the last save: a save is refused when the file holds another.
  private expected!: EditorState;
  // The parts of the file a save of the tags would drop (from the loader), in words.
  private lossy = "";
  private watcher: vscode.FileSystemWatcher | undefined;
  private watchTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly panel: vscode.WebviewPanel, private input: TagsEditorInput, root: vscode.WorkspaceFolder) {
    this.root = root;
    panel.onDidDispose(() => this.onClosed(), null, this.disposables);
    panel.webview.onDidReceiveMessage((m: unknown) => void this.onMessage(m), null, this.disposables);
  }

  private folders(): readonly vscode.WorkspaceFolder[] {
    return vscode.workspace.workspaceFolders ?? [this.root];
  }

  // Reads the rules file of the chosen folder and builds the page; false when the file cannot be edited.
  async load(tab?: TagsTab, focus?: string[]): Promise<boolean> {
    const read = await readOrganize(this.root);
    if (!read.ok) {
      explainUnreadable(read.reason, this.root);
      return false;
    }
    const dict = await loadSeverityDict(this.input.cfg, this.root);
    this.expected = read.state;
    this.lossy = read.lossy.length > 0 ? read.lossy.map((p) => l10n(`releaseBoard.tags.label.tab_${p === "linkWords" ? "link" : p}`)).join(", ") : "";
    this.severity?.dispose();
    const severity = new SeverityPart(this.input, dict, this.root, (m) => this.post(m), () => this.rescan());
    this.severity = severity;
    const list = this.folders();
    const meta = { folders: list.map((f) => f.name), folder: Math.max(0, list.findIndex((f) => f.uri.toString() === this.root.uri.toString())), file: RULES_FILE, lossy: this.lossy ? l10n("releaseBoard.tags.msg.lossyNote", { file: RULES_FILE, parts: this.lossy }) : "" };
    this.panel.webview.html = renderTagsEditor(tagsLabels(), crypto.randomBytes(16).toString("base64"), read.state, severity.view, tab ?? this.input.tab, focus ?? this.input.focus, meta);
    this.watch();
    return true;
  }

  // Tells the editor when the rules file of this folder changes on disk, so it can offer a reload.
  private watch(): void {
    this.watcher?.dispose();
    this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this.root, RULES_FILE));
    const check = (): void => {
      clearTimeout(this.watchTimer);
      this.watchTimer = setTimeout(() => void this.checkExternal(), 400);
    };
    this.watcher.onDidChange(check);
    this.watcher.onDidCreate(check);
    this.watcher.onDidDelete(check);
  }

  private async checkExternal(): Promise<void> {
    const read = await readOrganize(this.root);
    const dict = read.ok ? await loadSeverityDict(this.input.cfg, this.root) : undefined;
    if (!read.ok || JSON.stringify(read.state) !== JSON.stringify(this.expected) || JSON.stringify(dict) !== JSON.stringify(this.severity?.current)) {
      this.post({ type: "external" });
    }
  }

  // Shows the editor, on the given tab when there is one.
  reveal(tab?: TagsTab, focus?: string[]): void {
    this.panel.reveal();
    if (tab) {
      this.post({ type: "tab", tab });
    }
    if (focus) {
      this.post({ type: "focus", ids: focus });
    }
  }

  // The editor was opened again from a board panel: it follows that panel (its documents and its scans).
  rebind(input: TagsEditorInput): void {
    this.input = input;
    this.severity?.rebind(input);
    this.post({ type: "rescanned" });
  }

  // The board scanned again after a save: preview against the documents it shows now.
  private async rescan(): Promise<void> {
    const next = await this.input.onSaved();
    if (next) {
      this.input = { ...this.input, ...next };
      this.severity?.rebind(this.input);
      this.post({ type: "rescanned" });
    }
  }

  private onClosed(): void {
    current = undefined;
    clearTimeout(this.watchTimer);
    this.watcher?.dispose();
    this.severity?.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  private post(m: unknown): void {
    void this.panel.webview.postMessage(m);
  }

  // True when the page may be thrown away: it has no unsaved edits, or the user said so.
  private async discardOk(dirty: unknown): Promise<boolean> {
    if (dirty !== true) {
      return true;
    }
    const discard = l10n("releaseBoard.tags.msg.discard");
    return (await vscode.window.showWarningMessage(l10n("releaseBoard.tags.msg.discardAsk"), { modal: true }, discard)) === discard;
  }

  private async onMessage(message: unknown): Promise<void> {
    if (typeof message !== "object" || message === null) {
      return;
    }
    const m = message as { type?: unknown; seq?: unknown; state?: unknown; draft?: unknown; dirty?: unknown; tab?: unknown; index?: unknown };
    if (typeof m.type === "string" && m.type.startsWith("sev") && (await this.severity?.handle(m))) {
      return;
    }
    if (m.type === "preview" && typeof m.seq === "number") {
      this.preview(m.seq, m.state);
    } else if (m.type === "save") {
      await this.save(m.state);
    } else if (m.type === "export") {
      await this.export(m.state);
    } else if (m.type === "import") {
      await this.import(m.state);
    } else if (m.type === "openJson") {
      await this.openJson();
    } else if (m.type === "reload" && (await this.discardOk(m.dirty))) {
      await this.load(asTab(m.tab));
    } else if (m.type === "folder") {
      await this.switchFolder(m.index, m.tab, m.dirty);
    } else if (m.type === "cancel" && (await this.discardOk(m.dirty))) {
      this.panel.dispose();
    }
  }

  private async switchFolder(index: unknown, tab: unknown, dirty: unknown): Promise<void> {
    const list = this.folders();
    const next = typeof index === "number" ? list[index] : undefined;
    const keep = (): void => this.post({ type: "folderKept", index: Math.max(0, list.findIndex((f) => f.uri.toString() === this.root.uri.toString())) });
    if (!next || !(await this.discardOk(dirty))) {
      keep();
      return;
    }
    const before = this.root;
    this.root = next;
    if (!(await this.load(asTab(tab)))) {
      this.root = before;
      keep();
    }
  }

  // Which open documents each tag applies to under the draft, and what the naming rules make of the file names.
  // Titles, counts and names only.
  private preview(seq: number, raw: unknown): void {
    const checked = checkState(raw);
    if (!checked.ok) {
      this.post({ type: "invalid", seq, problem: checked.problem });
      return;
    }
    this.post({ type: "preview", seq, result: testMatch(this.input.items, checked.state.tags), naming: namingPreview(this.input.items, checked.state.naming) });
  }

  private async save(raw: unknown): Promise<void> {
    if (this.saving) {
      return;
    }
    const checked = checkState(raw);
    if (!checked.ok) {
      this.post({ type: "invalid", seq: -1, problem: checked.problem });
      void vscode.window.showWarningMessage(l10n("releaseBoard.tags.label.invalid", { problem: l10n(`releaseBoard.tags.label.problem_${checked.problem}`) }));
      return;
    }
    this.saving = true;
    try {
      if (this.lossy) {
        const ok = l10n("releaseBoard.tags.msg.lossyButton");
        if ((await vscode.window.showWarningMessage(l10n("releaseBoard.tags.msg.lossyConfirm", { file: RULES_FILE, folder: this.root.name, parts: this.lossy }), { modal: true }, ok)) !== ok) {
          return;
        }
      }
      const snapshot = await saveState(checked.state, this.expected, this.root);
      if (snapshot) {
        const now = await readOrganize(this.root);
        this.expected = now.ok ? now.state : checked.state;
        this.lossy = "";
        this.post({ type: "saved", part: "tags" });
        await this.rescan();
        offerUndo(snapshot, () => this.rescan(), this.root.name);
      }
    } finally {
      this.saving = false;
    }
  }

  // The host asks where to write; the page never names a path.
  private async export(raw: unknown): Promise<void> {
    const checked = checkState(raw);
    if (!checked.ok) {
      void vscode.window.showWarningMessage(l10n("releaseBoard.tags.label.invalid", { problem: l10n(`releaseBoard.tags.label.problem_${checked.problem}`) }));
      return;
    }
    const uri = await vscode.window.showSaveDialog({ title: l10n("releaseBoard.tags.msg.exportTitle"), filters: { JSON: ["json"] } });
    if (uri) {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(exportText(checked.state), "utf8"));
      void vscode.window.showInformationMessage(l10n("releaseBoard.tags.msg.exported"));
    }
  }

  // The host asks which file; whatever it holds is checked and anything unusable is dropped. The page shows what
  // the import would add and replace and asks before it takes the draft.
  private async import(draft: unknown): Promise<void> {
    const picked = await vscode.window.showOpenDialog({ title: l10n("releaseBoard.tags.msg.importTitle"), canSelectMany: false, filters: { JSON: ["json"] } });
    if (!picked?.[0]) {
      return;
    }
    const size = (await vscode.workspace.fs.stat(picked[0]).then((s) => s.size, () => -1));
    const result = size > LIMITS.importBytes ? ({ ok: false, problem: "size" } as const) : parseImport(Buffer.from(await vscode.workspace.fs.readFile(picked[0])).toString("utf8"));
    if (result.ok) {
      const here = checkState(draft);
      this.post({ type: "importPreview", state: result.state, diff: importDiff(here.ok ? here.state : this.expected, result.state) });
      return;
    }
    const word = result.problem === "size" ? "importBig" : result.problem === "parse" ? "importParse" : "importShape";
    void vscode.window.showWarningMessage(l10n("releaseBoard.tags.msg.importBad", { problem: l10n(`releaseBoard.tags.msg.${word}`) }));
  }

  // Opens the rules file in a text editor (the advanced path); the editor never needs it.
  private async openJson(): Promise<void> {
    const uri = vscode.Uri.joinPath(this.root.uri, RULES_FILE);
    try {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { viewColumn: vscode.ViewColumn.Beside });
    } catch {
      void vscode.window.showInformationMessage(l10n("releaseBoard.tags.msg.noJson", { file: RULES_FILE, folder: this.root.name }));
    }
  }
}

const asTab = (v: unknown): TagsTab | undefined => (v === "tags" || v === "link" || v === "naming" || v === "severity" ? v : undefined);

// Opens the editor, or shows the one that is open and points it at the board panel it was opened from.
export async function openTagsEditor(input: TagsEditorInput): Promise<void> {
  if (current) {
    current.rebind(input);
    current.reveal(input.tab, input.focus);
    return;
  }
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) {
    void vscode.window.showInformationMessage(l10n("releaseBoard.noFolder"));
    return;
  }
  const panel = vscode.window.createWebviewPanel("saropaWorkspace.releaseBoardTags", l10n("releaseBoard.tags.msg.panelTitle"), vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [],
  });
  const editor = new TagsEditorPanel(panel, input, root);
  current = editor;
  if (!(await editor.load())) {
    panel.dispose();
  }
}
