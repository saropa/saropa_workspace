import { LiveFile } from "./liveEvidence";

// The text table the board page needs. The strings come in as a table so the core stays
// free of VS Code and of the l10n catalog.
export interface BoardStrings {
  // Labels of the Projects and Settings buttons, the hint, the roll-up and the grey rows,
  // keyed by name (see boardHtmlProjects.ts). Optional: a plain-browser check may omit them.
  projectLabels?: Record<string, string>;
  // The AI hand-off drawer, its menu items and the selection line; the key itself shows when a label is missing.
  handoffLabels?: Record<string, string>;
  // Text of the keyword line and the options menu entry (see keywordMark.ts). `edit` is empty
  // when the keyword editor is switched off.
  keywordLabels?: Record<string, string>;
  // False turns the colored icons before section headings off; anything else leaves them on.
  sectionIcons?: boolean;
  title: string;
  intro: string;
  noGo: string;
  unverified: string;
  resolveNow: string;
  workOn: string;
  inProgress: string;
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

// Small helpers shared by every part of the page: escaping, placeholder filling and
// title attributes.

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

// Longest hover line; a longer one is cut with an ellipsis so the tooltip stays readable.
const TIP_LINE_MAX = 100;

// A title attribute from plain text, escaped. Each line is cut to TIP_LINE_MAX characters.
export function titleAttr(text: string): string {
  const cut = text.split("\n").map((l) => (l.length > TIP_LINE_MAX ? l.slice(0, TIP_LINE_MAX - 1) + "…" : l)).join("\n");
  return `title="${escapeHtml(cut)}"`;
}

// A title for a glyph: what it looks like, then what it means ("Red dot: lint is failing").
export function glyphTip(t: BoardStrings, look: string, text: string): string {
  return titleAttr(`${pl(t, look)}: ${text}`);
}

// A document the page can open: an underlined link whose tooltip is the document's path inside
// its project (full name first, so a name cut by the ellipsis stays readable). It carries only an index (`attr`, e.g. data-id="3"); the host resolves it.
export function docLink(text: string, path: string, attr: string): string {
  return `<a class="doc" href="#" ${attr} title="${escapeHtml(path ? `${text}\n${path}` : text)}">${escapeHtml(text)}</a>`;
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
  const word = (c: string | undefined): boolean => c !== undefined && /\w/.test(c);
  let out = "";
  let i = 0;
  while (i < escaped.length) {
    const c = escaped[i];
    if (c < "0" || c > "9") {
      out += c;
      i++;
      continue;
    }
    let j = i;
    while (j < escaped.length && escaped[j] >= "0" && escaped[j] <= "9") {
      j++;
    }
    const before = i === 0 ? undefined : escaped[i - 1];
    const next = escaped[j];
    // A number in the middle of a word, a version, an entity or a decimal is left as it is.
    let plain = (before !== undefined && (word(before) || before === "." || before === "#" || before === "&")) || word(next);
    if (!plain && next === ".") {
      let k = j;
      while (escaped[k] === ".") {
        k++;
      }
      plain = k === j + 1 ? word(escaped[k]) : escaped[k] >= "0" && escaped[k] <= "9";
    }
    out += plain ? escaped.slice(i, j) : pill(t, escaped.slice(i, j));
    i = j;
  }
  return out;
}

// The colored icon that stands before a section heading, by section id (the longest matching
// prefix wins). The one place icons are made, so the setting turns them all off at once.
const SECTION_ICONS: Record<string, string> = {
  sittings: "\u23F1\uFE0F",
  "sittings-steps": "\u{1FA9C}",
  "sittings-untagged": "\u{1F3F7}\uFE0F",
  tidy: "\u{1F9F9}",
  live: "\u{1F4E1}",
  norule: "\u{1F4CF}",
  since: "\u{1F554}",
  linked: "\u{1F517}",
  flags: "\u{1F6A9}",
  suggest: "\u{1F4A1}",
  "list.resolveNow": "\u{1F6A8}",
  "list.inProgress": "\u{1F6A7}",
  "list.workOn": "\u{1F6E0}\uFE0F",
  "list:": "\u{1F4CB}",
  "outside:": "\u{1F4C2}",
  "future:outside": "\u{1F4C2}",
  "future:not-feasible": "\u26D4",
  "future:": "\u{1F516}",
  future: "\u{1F52E}",
  project: "\u{1F4C1}",
  train: "\u{1F686}",
};

export function sectionIcon(t: BoardStrings, id: string): string {
  if (t.sectionIcons === false) {
    return "";
  }
  let best = "";
  for (const k of Object.keys(SECTION_ICONS)) {
    if ((id === k || (k.endsWith(":") && id.startsWith(k))) && k.length > best.length) {
      best = k;
    }
  }
  return best ? `<span class="si" aria-hidden="true">${SECTION_ICONS[best]}</span> ` : "";
}

// A section the reader can fold: a details element whose summary holds the heading. Native
// details gives keyboard support and the expanded state; the page script remembers it per
// viewer under `sec` (default `id`, which also picks the icon). Expanded unless `open` is false.
export function collapsible(o: { t: BoardStrings; id: string; head: string; body: string; tipAttr: string; cls?: string; domId?: string; level?: 2 | 3; open?: boolean; attrs?: string; sec?: string }): string {
  const h = o.level === 3 ? "h3" : "h2";
  return `<details class="${o.cls ?? "box"}"${o.domId ? ` id="${o.domId}"` : ""} data-sec="${escapeHtml(o.sec ?? o.id)}"${o.open === false ? "" : " open"}${o.attrs ?? ""}><summary class="sh" ${o.tipAttr}><${h} ${o.tipAttr}>${sectionIcon(o.t, o.id)}${o.head}</${h}></summary>${o.body}</details>`;
}

// Like fill, for page text: a number among the values goes in as a pill.
export function fillT(t: BoardStrings, tmpl: string, vars: Record<string, string | number | undefined>, html: Record<string, string> = {}): string {
  return escapeHtml(tmpl).replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = vars[k];
    return html[k] !== undefined ? html[k] : v === undefined ? m : typeof v === "number" ? pill(t, v) : escapeHtml(v);
  });
}
