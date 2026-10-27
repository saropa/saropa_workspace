import { LiveFile } from "./liveEvidence";

// The text table the board page needs. The strings come in as a table so the core stays
// free of VS Code and of the l10n catalog.
export interface BoardStrings {
  // Labels of the Projects and Settings buttons, the hint, the roll-up and the grey rows,
  // keyed by name (see boardHtmlProjects.ts). Optional: a plain-browser check may omit them.
  projectLabels?: Record<string, string>;
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
  ptgRunLint: string;
  ptgRunTests: string;
  ptgOpenRules: string;
  ptgAcceptBtn: string;
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
  // Tooltips and the labels of the controls added with them, keyed (see views/boardStrings.ts).
  polish: Record<string, string>;
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
  return t.handToChat ? `<button class="hb sec" ${attrs} title="${escapeHtml(t.handToChatTip)}">${escapeHtml(t.handToChat)}</button>` : "";
}

// One word or sentence of the control and tooltip table, with {name} placeholders filled in.
// The key itself when the table has no entry, so a missing entry is visible, never empty.
export function pl(t: BoardStrings, key: string, vars: Record<string, string | number> = {}): string {
  const table = t.polish as Record<string, string> | undefined;
  const text = table && typeof table === "object" ? (table[key] ?? key) : key;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined ? m : String(vars[k])));
}

// A title attribute from the table, escaped. Every element on the page carries one.
export function tip(t: BoardStrings, key: string, vars: Record<string, string | number> = {}): string {
  return `title="${escapeHtml(pl(t, key, vars))}"`;
}

// A title attribute from plain text, escaped.
export function titleAttr(text: string): string {
  return `title="${escapeHtml(text)}"`;
}

// A title for a glyph: what it looks like, then what it means ("Red dot: lint is failing").
export function glyphTip(t: BoardStrings, look: string, text: string): string {
  return titleAttr(`${pl(t, look)}: ${text}`);
}

// A document the page can open: an underlined link whose tooltip is the document's path inside
// its project. It carries only an index (`attr`, e.g. data-id="3"); the host resolves it.
export function docLink(text: string, path: string, attr: string): string {
  return `<a class="doc" href="#" ${attr} ${titleAttr(path)}>${escapeHtml(text)}</a>`;
}

// Fills {name} placeholders after escaping, so a document title can never add markup. Values in
// `html` are already-built markup (a link, say) and go in as they are.
export function fill(tmpl: string, vars: Record<string, string | number | undefined>, html: Record<string, string> = {}): string {
  return escapeHtml(tmpl).replace(/\{(\w+)\}/g, (m, k: string) => (html[k] !== undefined ? html[k] : vars[k] === undefined ? m : escapeHtml(String(vars[k]))));
}

// A number shown on the page: a small rounded pill, so it stands out from the words around it.
export function pill(t: BoardStrings, n: number | string, tipKey = "pillTip", vars: Record<string, string | number> = {}): string {
  return `<span class="pill" ${tip(t, tipKey, vars)}>${escapeHtml(String(n))}</span>`;
}

// Wraps every whole number in already-escaped text in a pill. Only for sentences the board
// builds from its own counts; never for a document title or a name.
export function pillify(t: BoardStrings, escaped: string): string {
  return escaped.replace(/(^|[^\w.#&])(\d+)(?![\w.]*\d|\w|\.\w)/g, (_m, pre: string, n: string) => `${pre}${pill(t, n)}`);
}

// A section the reader can fold: a details element whose summary holds the heading. Native
// details gives keyboard support and the expanded state; the page script remembers it per
// viewer under `id`. Expanded unless `open` is false.
export function collapsible(o: { id: string; head: string; body: string; tipAttr: string; cls?: string; domId?: string; level?: 2 | 3; open?: boolean; attrs?: string }): string {
  const h = o.level === 3 ? "h3" : "h2";
  return `<details class="${o.cls ?? "box"}"${o.domId ? ` id="${o.domId}"` : ""} data-sec="${escapeHtml(o.id)}"${o.open === false ? "" : " open"}${o.attrs ?? ""}><summary class="sh" ${o.tipAttr}><${h} ${o.tipAttr}>${o.head}</${h}></summary>${o.body}</details>`;
}

// Like fill, for page text: a number among the values goes in as a pill.
export function fillT(t: BoardStrings, tmpl: string, vars: Record<string, string | number | undefined>, html: Record<string, string> = {}): string {
  return escapeHtml(tmpl).replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = vars[k];
    return html[k] !== undefined ? html[k] : v === undefined ? m : typeof v === "number" ? pill(t, v) : escapeHtml(v);
  });
}
