import { l10n } from "../i18n/l10n";
import { readKeywordSettings } from "../commands/boardKeywordSettings";

// The text of the keyword editor page and of the keyword line on the board. Every entry is in
// en.json as "releaseBoard.keywords.label.<key>" (editor) or "releaseBoard.keywords.board.<key>"
// (board). Placeholders such as {count} are left in the text for the page to fill.

export const KEYWORD_LABEL_KEYS = [
  "title", "intro", "warn", "previewTitle", "previewTitleTip", "previewWait", "previewInvalid", "previewNone", "previewSummary", "previewEase", "previewTighten",
  "previewPartial", "previewExample", "previewEaseMark", "previewTightenMark", "previewMore", "previewListTip", "sev_extreme", "sev_critical",
  "sev_high", "sev_medium", "sev_low", "help_extreme", "help_critical", "help_high", "help_low", "mediumNote", "levelTip", "phrasesHint", "chipTip",
  "removeTip", "removeText", "addPlaceholder", "inputTip", "addButton", "addTip", "restoreLevel", "restoreLevelTip", "restoreAll", "restoreAllTip",
  "changedMark", "changedTip", "scoringTitle", "scoringTip", "thresholdLabel", "thresholdHelp", "wTitleLabel", "wTitleHelp", "wHeadLabel",
  "wHeadHelp", "wBodyLabel", "wBodyHelp", "wCapLabel", "wCapHelp", "numTip", "negTitle", "negTip", "negHelp", "negChipTip", "negRemoveTip",
  "negInputTip", "negAddTip", "negRestoreTip", "save", "saveTip", "cancel", "cancelTip", "problemTooLong", "problemTooMany", "problemDuplicate",
  "problemBadChar", "problemNumber", "listTip", "negListTip",
] as const;

export const KEYWORD_BOARD_KEYS = [
  "markPlain", "markPlainTip", "markCustom", "markCustomTip", "edit", "editTip", "restore", "restoreTip", "menu", "menuTip", "part_threshold",
  "part_weights", "part_negation", "part_phrases_extreme", "part_phrases_critical", "part_phrases_high", "part_phrases_low", "part_minBodyDensity",
  "part_audience", "partSep",
] as const;

export type KeywordLabels = Record<(typeof KEYWORD_LABEL_KEYS)[number], string>;

// The editor page text; {count}, {level} and the other placeholders stay for the page to fill.
export function keywordLabels(): KeywordLabels {
  return Object.fromEntries(KEYWORD_LABEL_KEYS.map((k) => [k, l10n(`releaseBoard.keywords.label.${k}`)])) as KeywordLabels;
}

// The board's keyword line text. `edit` is empty when the editor is switched off: the line then
// shows the mark without its buttons.
export function keywordBoardLabels(): Record<string, string> {
  const out = Object.fromEntries(KEYWORD_BOARD_KEYS.map((k) => [k, l10n(`releaseBoard.keywords.board.${k}`)]));
  if (!readKeywordSettings().enabled) {
    out.edit = "";
  }
  return out;
}
