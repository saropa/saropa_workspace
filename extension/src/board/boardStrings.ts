// The text table the board page needs. The strings come in as a table so the core stays
// free of VS Code and of the l10n catalog.

export interface BoardStrings {
  title: string;
  intro: string;
  noGo: string;
  unverified: string;
  resolveNow: string;
  workOn: string;
  inProgress: string;
  nothingHere: string;
  more: string;
  blocked: string;
  refresh: string;
  accept: string;
  safetyHold: string;
  baseline: string;
  reasonBaseline: string;
  reasonGrey: string;
  reasonHealth: string;
  reasonUnread: string;
  go: string;
  healthLint: string;
  healthTests: string;
  allClear: string;
  dependsOn: string;
  linkedHeading: string;
  linkedNote: string;
  flagsHeading: string;
  flagsNote: string;
  hub: string;
  profileLabel: string;
  profileRush: string;
  profileDeliberate: string;
  profileZero: string;
  severityNames: string;
  proOnly: string;
  pinned: string;
  needsRuleHeading: string;
  needsRuleNote: string;
  loading: string;
  suggestHeading: string;
  suggestNote: string;
  suggestAccept: string;
  suggestReject: string;
  refreshing: string;
  // "{count}" Claude sessions touched this document.
  chatsTitle: string;
  // Path to GO. "{title}", "{count}", "{folder}", "{severity}" are filled in by the page.
  ptgNone: string;
  ptgItemRed: string;
  ptgItemPinned: string;
  ptgItemSeverity: string;
  ptgUnblocks: string;
  ptgWaiter: string;
  ptgItemFirst: string;
  ptgItemFirstAny: string;
  ptgBlocked: string;
  ptgLintMissing: string;
  ptgLintFailing: string;
  ptgTestsMissing: string;
  ptgTestsFailing: string;
  ptgRules: string;
  ptgRulesAny: string;
  ptgUnread: string;
  ptgAccept: string;
  ptgMore: string;
  ptgOpen: string;
  ptgRunLint: string;
  ptgRunTests: string;
  ptgOpenRules: string;
  ptgAcceptBtn: string;
  sittingsButton: string;
  sittingsHeading: string;
  sittingsPick: string;
  sittingsNone: string;
  // "{count}" steps cut by the cap.
  sittingsMore: string;
  // "{count}" steps that need longer than the time box.
  sittingsTooLong: string;
  // "{count}" steps whose contexts are not in hand.
  sittingsNeedOther: string;
  // "{count}" steps with no context found.
  sittingsUntagged: string;
  sittingsUntaggedNote: string;
  timeAny: string;
  // "{count}" minutes.
  timeMinutes: string;
  // "{count}" minutes a step is thought to take.
  stepMinutes: string;
  // Label of the Hand to chat button; empty when the feature is off (no button is drawn).
  handToChat: string;
  handToChatTip: string;
  tidyHeading: string;
  // "{days}" days without a change.
  tidyNote: string;
  // "{count}" steps done, "{days}" days untouched.
  tidyDetail: string;
  tidyMove: string;
  // "{count}" documents ready to tidy.
  tidyTitle: string;
  // "{count}" more documents not listed.
  tidyMore: string;
  // Live evidence. Heading of the mark's tooltip; then one line per source with "{errors}",
  // "{warnings}" and "{crashes}"; "{count}" more files.
  liveHead: string;
  liveProblems: string;
  liveLints: string;
  liveLogs: string;
  liveMore: string;
  liveUnnamedHeading: string;
  liveUnnamedNote: string;
  liveUnnamedStart: string;
  // Release train. "{name}" is the train's name, "{names}" the projects holding the light back.
  trainTitle: string;
  trainHeldBy: string;
  trainCycle: string;
  trainOrder: string;
}
