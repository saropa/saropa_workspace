import { l10n } from "../i18n/l10n";

// The text of the Tags and rules page, in en.json as "releaseBoard.tags.label.<key>". Placeholders such as
// {count} are left in the text for the page to fill.
export const TAGS_LABEL_KEYS = [
  "title", "tab_tags", "tab_link", "tab_naming", "tab_severity", "tagsTip", "linkTip", "namingTip", "severityTip", "newTag", "add", "addTip", "newPhrase", "phraseTip",
  "dates", "datesTip", "prefixes", "prefixesTip", "acronyms", "acronymsTip", "severityLine", "openSeverity", "save", "saveTip", "cancel", "cancelTip", "import", "importTip",
  "export", "exportTip", "reset", "resetTip", "matches", "previewWait", "previewTip", "emojiTip", "labelTip", "colourTip", "hexTip", "custom", "col_teal", "col_sky", "col_indigo",
  "col_orchid", "col_olive", "col_ochre", "col_slate", "col_pine", "up", "down", "turnOn", "turnOff", "turnOnTip", "turnOffTip", "remove", "patternsTip", "effectsTip", "eff_group",
  "eff_name", "eff_emoji", "eff_colour", "removePhrase", "duplicate", "invalid", "problem_shape", "problem_tags", "problem_id", "problem_label", "problem_emoji", "problem_colour",
  "problem_patterns", "problem_effects", "problem_linkWords", "problem_naming", "problem_invalid",
] as const;

export function tagsLabels(): Record<string, string> {
  return Object.fromEntries(TAGS_LABEL_KEYS.map((k) => [k, l10n(`releaseBoard.tags.label.${k}`, { count: "{count}", phrase: "{phrase}", problem: "{problem}" })]));
}
