import * as vscode from "vscode";
import { BoardItem } from "../board/boardModel";
import { SeverityInput } from "../board/tagsEditorHtml";
import { Profile, SeverityDict } from "../board/severity";
import { DraftProblem, LIMITS, PreviewDoc, checkDraft, dictFromDraft, dictOfSeverity, draftFromDictChecked } from "../board/severityEdit";
import { BoardConfig } from "../board/types";
import type { RulesSnapshot } from "../commands/boardRuleAssign";
import { eligibleItems, loadPreviewDocs, previewAsync } from "../commands/boardKeywordPreview";
import { readKeywordSettings } from "../commands/boardKeywordSettings";
import { offerUndo } from "../commands/boardOrganizeEdit";
import { currentSeverityDict, saveSeverity } from "../commands/boardSeverityEdit";
import { l10n } from "../i18n/l10n";
import { keywordLabels, partNames } from "./keywordStrings";

// Release Board, the host side of the Severity tab in the Tags and rules editor: the phrases, threshold, weights
// and negation words that decide a document's severity. The page holds a draft; the host checks every draft it
// receives (the page's values are never trusted), answers with counts and titles only, and writes only after
// the user confirmed.

// What the part needs from the board the editor was opened on.
export interface SeverityPartInput {
  cfg: BoardConfig;
  items: readonly BoardItem[];
  projectNames: ReadonlyMap<string, string>;
  profile: Profile;
}

// The dictionary in the file now, not the one of the last scan, so an edit made outside the board is what the
// editor starts from and what the write is checked against.
export async function loadSeverityDict(cfg: BoardConfig, root?: vscode.WorkspaceFolder): Promise<SeverityDict> {
  return (await currentSeverityDict(root)) ?? dictOfSeverity(cfg.severity);
}

export class SeverityPart {
  // The preview request the page asked for last; older ones stop.
  private latest = 0;
  private docs!: Promise<{ docs: PreviewDoc[]; total: number }>;
  private saving = false;
  // The parts whose unusable values a save would drop or replace, in words (empty when none).
  private lossy = "";
  // What the Severity tab starts from.
  readonly view: SeverityInput;

  // `dict`: the dictionary in the file at open or at the last save; the write is checked against it.
  constructor(
    private input: SeverityPartInput,
    private dict: SeverityDict,
    private readonly root: vscode.WorkspaceFolder | undefined,
    private readonly post: (m: unknown) => void,
    private readonly saved: () => Promise<void>,
  ) {
    const { draft, replaced } = draftFromDictChecked(this.dict);
    this.lossy = replaced.length > 0 ? partNames(replaced) : "";
    this.loadDocs();
    this.view = { labels: keywordLabels(), draft, note: this.lossy ? l10n("releaseBoard.keywords.msg.lossyNote", { parts: this.lossy }) : "" };
  }

  // The dictionary the file held at open or at the last save.
  get current(): SeverityDict {
    return this.dict;
  }

  private loadDocs(): void {
    const { input } = this;
    this.docs = loadPreviewDocs(input.items, input.cfg.projects, input.projectNames, this.dict, readKeywordSettings().previewMaxDocuments).catch(() => ({ docs: [], total: eligibleItems(input.items).length }));
  }

  // The board scanned again (or the editor was opened from another board panel): preview against its documents.
  rebind(input: SeverityPartInput): void {
    this.input = input;
    this.loadDocs();
  }

  // Stops answering previews once the panel is gone.
  dispose(): void {
    this.latest = -1;
  }

  // Handles a sev* message; false when the message is not one of them.
  async handle(m: { type?: unknown; seq?: unknown; draft?: unknown }): Promise<boolean> {
    if (m.type === "sevPreview" && typeof m.seq === "number") {
      await this.preview(m.seq, m.draft);
    } else if (m.type === "sevSave") {
      await this.save(m.draft);
    } else {
      return false;
    }
    return true;
  }

  private async preview(seq: number, raw: unknown): Promise<void> {
    this.latest = seq;
    const checked = checkDraft(raw);
    if (!checked.ok) {
      this.post({ type: "sevInvalid", seq });
      return;
    }
    const { docs, total } = await this.docs;
    const result = await previewAsync(docs, dictFromDraft(checked.draft, this.dict), this.input.profile, () => this.latest === seq);
    if (result) {
      this.post({ type: "sevPreview", seq, result, total });
    }
  }

  // Saves after the host checked the draft again and the user confirmed; the confirmation names
  // how many open documents would change level, counted now, not taken from the page. The editor stays open.
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
      const { docs, total } = await this.docs;
      const impact = await previewAsync(docs, dictFromDraft(checked.draft, this.dict), this.input.profile, () => true);
      let snapshot: RulesSnapshot | undefined;
      const outcome = await saveSeverity({ kind: "draft", draft: checked.draft, impact, total, lossy: this.lossy, expected: this.dict }, { root: this.root, onSnapshot: (x) => (snapshot = x) });
      if (outcome === "saved") {
        // The file holds the new dictionary: later saves are checked against it, and the page treats the draft as saved.
        this.dict = (await currentSeverityDict(this.root)) ?? dictFromDraft(checked.draft, this.dict);
        this.lossy = "";
        this.post({ type: "sevSaved", draft: draftFromDictChecked(this.dict).draft });
        await this.saved();
        if (snapshot) {
          offerUndo(snapshot, this.saved, this.root?.name);
        }
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

