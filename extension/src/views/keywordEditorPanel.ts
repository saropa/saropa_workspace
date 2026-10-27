import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { BoardItem } from "../board/boardModel";
import { renderKeywordEditor } from "../board/keywordEditorHtml";
import { Profile } from "../board/severity";
import { DraftProblem, LIMITS, PreviewDoc, checkDraft, dictFromDraft, dictOfSeverity, draftFromDictChecked } from "../board/severityEdit";
import { BoardConfig } from "../board/types";
import { loadPreviewDocs, previewAsync } from "../commands/boardKeywordPreview";
import { readKeywordSettings } from "../commands/boardKeywordSettings";
import { currentSeverityDict, saveSeverity } from "../commands/boardSeverityEdit";
import { l10n } from "../i18n/l10n";
import { RULES_FILE } from "../commands/boardConfigLoad";
import { keywordLabels, partNames } from "./keywordStrings";

// Release Board, the keyword editor: an editor-tab webview with the phrases, threshold, weights
// and negation words that decide a document's severity. One instance. The page holds a draft;
// the host checks every draft it receives (the page's values are never trusted), answers with
// counts and titles only, and writes only after the user confirmed.

// What the editor needs from the board it was opened on.
export interface KeywordEditorInput {
  cfg: BoardConfig;
  items: readonly BoardItem[];
  projectNames: ReadonlyMap<string, string>;
  profile: Profile;
  // Called after the rules file was written, so the board scans again.
  onSaved: () => Promise<void>;
}

let current: KeywordEditorPanel | undefined;

class KeywordEditorPanel {
  private readonly disposables: vscode.Disposable[] = [];
  // The preview request the page asked for last; older ones stop.
  private latest = 0;
  private readonly dict;
  private readonly docs: Promise<{ docs: PreviewDoc[]; total: number }>;
  private saving = false;
  // The parts whose unusable values a save would drop or replace, in words (empty when none).
  private readonly lossy: string;

  constructor(private readonly panel: vscode.WebviewPanel, private readonly input: KeywordEditorInput) {
    this.dict = dictOfSeverity(input.cfg.severity);
    const { draft: saved, replaced } = draftFromDictChecked(this.dict);
    this.lossy = replaced.length > 0 ? partNames(replaced) : "";
    this.docs = loadPreviewDocs(input.items, input.cfg.projects, input.projectNames, this.dict, readKeywordSettings().previewMaxDocuments).catch(() => ({ docs: [], total: input.items.length }));
    const note = this.lossy ? l10n("releaseBoard.keywords.msg.lossyNote", { parts: this.lossy }) : "";
    panel.webview.html = renderKeywordEditor(keywordLabels(), crypto.randomBytes(16).toString("base64"), saved, saved, note);
    panel.onDidDispose(() => this.onClosed(), null, this.disposables);
    panel.webview.onDidReceiveMessage((m: unknown) => void this.onMessage(m), null, this.disposables);
  }

  reveal(): void {
    this.panel.reveal();
  }

  private onClosed(): void {
    this.latest = -1;
    current = undefined;
    this.disposables.forEach((d) => d.dispose());
  }

  private async onMessage(message: unknown): Promise<void> {
    if (typeof message !== "object" || message === null) {
      return;
    }
    const m = message as { type?: unknown; seq?: unknown; draft?: unknown };
    if (m.type === "preview" && typeof m.seq === "number") {
      await this.preview(m.seq, m.draft);
    } else if (m.type === "save") {
      await this.save(m.draft);
    } else if (m.type === "cancel") {
      this.panel.dispose();
    }
  }

  private async preview(seq: number, raw: unknown): Promise<void> {
    this.latest = seq;
    const checked = checkDraft(raw);
    if (!checked.ok) {
      void this.panel.webview.postMessage({ type: "invalid", seq });
      return;
    }
    const { docs, total } = await this.docs;
    const result = await previewAsync(docs, dictFromDraft(checked.draft, this.dict), this.input.profile, () => this.latest === seq);
    if (result) {
      void this.panel.webview.postMessage({ type: "preview", seq, result, total });
    }
  }

  // Saves after the host checked the draft again and the user confirmed; the confirmation names
  // how many open documents would change level, counted now, not taken from the page.
  private async save(raw: unknown): Promise<void> {
    if (this.saving) {
      return;
    }
    const checked = checkDraft(raw);
    if (!checked.ok) {
      void vscode.window.showWarningMessage(l10n("releaseBoard.keywords.msg.invalid", { problem: problemText(checked.problems) }));
      return;
    }
    this.saving = true;
    try {
      // The file may have changed since the editor opened (Restore defaults, a hand edit): the
      // dictionary the check ran against would be out of date, so nothing is written.
      const now = await currentSeverityDict();
      if (now && JSON.stringify(now) !== JSON.stringify(this.dict)) {
        void vscode.window.showWarningMessage(l10n("releaseBoard.keywords.msg.changedSinceOpen", { file: RULES_FILE }));
        return;
      }
      const { docs, total } = await this.docs;
      const impact = await previewAsync(docs, dictFromDraft(checked.draft, this.dict), this.input.profile, () => true);
      if ((await saveSeverity({ kind: "draft", draft: checked.draft, impact, total, lossy: this.lossy })) === "saved") {
        this.panel.dispose();
        await this.input.onSaved();
      }
    } finally {
      this.saving = false;
    }
  }
}

// The words for what is wrong with a draft.
function problemText(problems: readonly DraftProblem[]): string {
  const one = (p: DraftProblem): string =>
    p === "tooLong"
      ? l10n("releaseBoard.keywords.label.problemTooLong", { max: LIMITS.phraseChars })
      : p === "tooMany"
        ? l10n("releaseBoard.keywords.label.problemTooMany", { max: LIMITS.phrases })
        : p === "threshold" || p === "weight" || p === "cap"
          ? l10n("releaseBoard.keywords.label.problemNumber")
          : l10n("releaseBoard.keywords.label.problemBadChar");
  return [...new Set(problems.map(one))].join(" ");
}

// Opens the editor, or shows the one that is open.
export function openKeywordEditor(input: KeywordEditorInput): void {
  if (current) {
    current.reveal();
    return;
  }
  const panel = vscode.window.createWebviewPanel("saropaWorkspace.releaseBoardKeywords", l10n("releaseBoard.keywords.msg.panelTitle"), vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [],
  });
  current = new KeywordEditorPanel(panel, input);
}
