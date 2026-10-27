import { LiveFile } from "./liveEvidence";

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
  healthBuild: string;
  healthDeps: string;
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
  ptgBuildFailing: string;
  ptgDepsFailing: string;
  // Daily report job notes. "{what}" is the word below, "{reason}" why a job did not start.
  ptgFeedOff: string;
  ptgFeedChecking: string;
  ptgFeedWaiting: string;
  ptgFeedFailed: string;
  feedWhatBuild: string;
  feedWhatLint: string;
  feedWhatTests: string;
  ptgEnable: string;
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
  // Read-only report candidates in the Tidy box. "{count}" is what the report counted.
  tidyReportsNote: string;
  tidyOpenReport: string;
  tidyRepDebt: string;
  // "{count}" markers, "{trend}" one of the three words below.
  tidyRepDebtTrend: string;
  tidyTrendUp: string;
  tidyTrendDown: string;
  tidyTrendSame: string;
  tidyRepBranches: string;
  tidyRepBloat: string;
  tidyRepBigFiles: string;
  // Notes on a project row from the daily reports. "{count}" is what the report counted.
  sigPrs: string;
  sigUncommitted: string;
  sigStaleBranches: string;
  sigChangelog: string;
  sigVersion: string;
  sigLinks: string;
  sigReadyPass: string;
  sigReadyFail: string;
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
  // Future tab: every label and phrase, keyed (see views/boardStrings.ts).
  futureLabels: Record<string, string>;
}

// Small helpers shared by every part of the page: escaping, placeholder filling and the
// Hand to chat button.

// Escapes text for HTML. Every piece of untrusted text goes through this before it is placed in the page.
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// One line of live evidence for a file: the file name, then the counts of each source.
export function liveLine(f: LiveFile, t: BoardStrings): string {
  const v = (c: { errors: number; warnings: number; crashes?: number }): Record<string, number> => ({ errors: c.errors, warnings: c.warnings, crashes: c.crashes ?? 0 });
  const raw = (tmpl: string, c: { errors: number; warnings: number; crashes?: number }): string => tmpl.replace(/\{(\w+)\}/g, (m, k: string) => String(v(c)[k] ?? m));
  const bits = [f.logs ? raw(t.liveLogs, f.logs) : "", f.problems ? raw(t.liveProblems, f.problems) : "", f.lints ? raw(t.liveLints, f.lints) : ""].filter(Boolean);
  return `${f.file}: ${bits.join("; ")}`;
}

// The Hand to chat button. It carries only indexes; the host builds the prompt from the model it rendered.
export function handButton(t: BoardStrings, attrs: string): string {
  return t.handToChat ? `<button class="hb" ${attrs} title="${escapeHtml(t.handToChatTip)}">${escapeHtml(t.handToChat)}</button>` : "";
}

// Fills {name} placeholders after escaping, so a document title can never add markup.
export function fill(tmpl: string, vars: Record<string, string | number | undefined>): string {
  return escapeHtml(tmpl).replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined ? m : escapeHtml(String(vars[k]))));
}
