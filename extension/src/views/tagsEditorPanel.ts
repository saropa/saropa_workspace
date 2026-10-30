import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { BoardItem } from "../board/boardModel";
import { TagsTab, renderTagsEditor } from "../board/tagsEditorHtml";
import { LIMITS, checkState, exportText, parseImport, testMatch } from "../board/org/organizeEdit";
import { Profile, SeverityDict } from "../board/severity";
import { BoardConfig } from "../board/types";
import { RULES_FILE } from "../commands/boardConfigLoad";
import { currentOrganizeState, offerUndo, saveState } from "../commands/boardOrganizeEdit";
import { l10n } from "../i18n/l10n";
import { SeverityPart, loadSeverityDict } from "./severityPart";
import { tagsLabels } from "./tagsStrings";

// Release Board, the Tags and rules editor: an editor-tab webview with tabs for tags, link words, naming and
// severity keywords. One instance. The page holds a draft; the host checks every state it receives (the page's
// values are never trusted), answers with counts and titles only, never takes a path from the page, and writes
// only through the safe rules-file path.

// What the editor needs from the board it was opened on.
export interface TagsEditorInput {
  cfg: BoardConfig;
  items: readonly BoardItem[];
  projectNames: ReadonlyMap<string, string>;
  profile: Profile;
  // Called after the rules file changed, so the board scans again.
  onSaved: () => Promise<void>;
  // The tab the page starts on, or is switched to when the editor is already open (default: tags).
  tab?: TagsTab;
  // Tag ids to highlight on the Tags tab (the ones that matched the row or group "Edit tags" was chosen on).
  focus?: string[];
}

let current: TagsEditorPanel | undefined;

class TagsEditorPanel {
  private readonly disposables: vscode.Disposable[] = [];
  private saving = false;

  private readonly severity: SeverityPart;

  constructor(private readonly panel: vscode.WebviewPanel, private readonly input: TagsEditorInput, state: Parameters<typeof renderTagsEditor>[2], dict: SeverityDict) {
    this.severity = new SeverityPart(input, dict, (m) => this.post(m), () => this.saved());
    panel.webview.html = renderTagsEditor(tagsLabels(), crypto.randomBytes(16).toString("base64"), state, this.severity.view, input.tab, input.focus);
    panel.onDidDispose(() => this.onClosed(), null, this.disposables);
    panel.webview.onDidReceiveMessage((m: unknown) => void this.onMessage(m), null, this.disposables);
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

  // After a severity save: the editor closes and the board scans again.
  private async saved(): Promise<void> {
    this.panel.dispose();
    await this.input.onSaved();
  }

  private onClosed(): void {
    current = undefined;
    this.severity.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  private post(m: unknown): void {
    void this.panel.webview.postMessage(m);
  }

  private async onMessage(message: unknown): Promise<void> {
    if (typeof message !== "object" || message === null) {
      return;
    }
    const m = message as { type?: unknown; seq?: unknown; state?: unknown; draft?: unknown };
    if (typeof m.type === "string" && m.type.startsWith("sev") && (await this.severity.handle(m))) {
      return;
    }
    if (m.type === "preview" && typeof m.seq === "number") {
      this.preview(m.seq, m.state);
    } else if (m.type === "save") {
      await this.save(m.state);
    } else if (m.type === "export") {
      await this.export(m.state);
    } else if (m.type === "import") {
      await this.import();
    } else if (m.type === "cancel") {
      this.panel.dispose();
    }
  }

  // Which open documents each tag applies to under the draft. Titles and counts only.
  private preview(seq: number, raw: unknown): void {
    const checked = checkState(raw);
    if (!checked.ok) {
      this.post({ type: "invalid", seq, problem: checked.problem });
      return;
    }
    this.post({ type: "preview", seq, result: testMatch(this.input.items, checked.state.tags) });
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
      const snapshot = await saveState(checked.state);
      if (snapshot) {
        this.panel.dispose();
        await this.input.onSaved();
        offerUndo(snapshot, this.input.onSaved);
      }
    } finally {
      this.saving = false;
    }
  }

  // The host asks where to write; the page never names a path.
  private async export(raw: unknown): Promise<void> {
    const checked = checkState(raw);
    if (!checked.ok) {
      return;
    }
    const uri = await vscode.window.showSaveDialog({ title: l10n("releaseBoard.tags.msg.exportTitle"), filters: { JSON: ["json"] } });
    if (uri) {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(exportText(checked.state), "utf8"));
      void vscode.window.showInformationMessage(l10n("releaseBoard.tags.msg.exported"));
    }
  }

  // The host asks which file; whatever it holds is checked and anything unusable is dropped.
  private async import(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({ title: l10n("releaseBoard.tags.msg.importTitle"), canSelectMany: false, filters: { JSON: ["json"] } });
    if (!picked?.[0]) {
      return;
    }
    const bytes = await vscode.workspace.fs.readFile(picked[0]);
    const result = bytes.byteLength > LIMITS.importBytes ? ({ ok: false, problem: "size" } as const) : parseImport(Buffer.from(bytes).toString("utf8"));
    if (result.ok) {
      this.post({ type: "state", state: result.state });
      return;
    }
    const word = result.problem === "size" ? "importBig" : result.problem === "parse" ? "importParse" : "importShape";
    void vscode.window.showWarningMessage(l10n("releaseBoard.tags.msg.importBad", { problem: l10n(`releaseBoard.tags.msg.${word}`) }));
  }
}

// Shows the open editor, if there is one.
function shown(tab?: TagsTab, focus?: string[]): boolean {
  current?.reveal(tab, focus);
  return current !== undefined;
}

// Opens the editor, or shows the one that is open.
export async function openTagsEditor(input: TagsEditorInput): Promise<void> {
  if (shown(input.tab, input.focus)) {
    return;
  }
  // The state is the one in the file now, not the one of the last scan.
  const state = await currentOrganizeState();
  if (!state) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.noRule.badJson", { file: RULES_FILE, folder: "" }));
    return;
  }
  if (shown(input.tab, input.focus)) {
    return;
  }
  const dict = await loadSeverityDict(input.cfg);
  if (shown(input.tab, input.focus)) {
    return;
  }
  const panel = vscode.window.createWebviewPanel("saropaWorkspace.releaseBoardTags", l10n("releaseBoard.tags.msg.panelTitle"), vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [],
  });
  current = new TagsEditorPanel(panel, input, state, dict);
}
