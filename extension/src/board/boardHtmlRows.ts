import { BoardItem, BoardProject, UnverifiedReason } from "./boardModel";
import { PathStep, PathToGo } from "./pathToGo";
import { LiveMark } from "./liveEvidence";
import { chooseBox } from "./boardHtmlHandoff";
import { dragAttrs } from "./boardHtmlDrag";
import { BoardStrings, fillT, collapsible, sectionIcon, docLink, escapeHtml, liveLine, glyphTip, pill, pillify, pl, tip, titleAttr } from "./boardHtmlUtil";
import { blocksNow, kebab, rowData } from "./boardHtmlMenus";
import type { FeedNote } from "./recipeEvidence";
import { Signal, showsOnRow } from "./reportSignals";

// The project rows and the item lists of the board page.

export const LIST_CAP = 30;
// A list longer than this starts folded.
const LONG_LIST = 25;
// Rows a list shows at first; the rest wait behind a "Show N more" pill.
export const SHOWN_ROWS = 5;

function reasonText(r: UnverifiedReason, p: BoardProject, t: BoardStrings): string {
  switch (r) {
    case "baseline":
      return t.reasonBaseline;
    case "grey":
      return t.reasonGrey.replace("{count}", String(p.counts.grey));
    case "health":
      return t.reasonHealth;
    case "unread":
      return t.reasonUnread;
  }
}

// The sentence for what a row's daily report job is doing. Already escaped.
function feedSentence(kind: "build" | "lint" | "tests", note: FeedNote, t: BoardStrings): string {
  const what = kind === "build" ? t.feedWhatBuild : kind === "lint" ? t.feedWhatLint : t.feedWhatTests;
  const tmpl = note.state === "off" ? t.ptgFeedOff : note.state === "checking" ? t.ptgFeedChecking : note.state === "waiting" ? t.ptgFeedWaiting : t.ptgFeedFailed;
  return fillT(t, tmpl, { what, reason: note.reason ?? "" });
}

// Two small marks: lint and tests, and a third for the build once a daily build report was
// found. Red failing, green passing, grey missing; the figures are in the tooltip. Nothing
// shows for a project with no health setup and no evidence.
function healthMarks(p: BoardProject, t: BoardStrings): string {
  if (!p.health) {
    return "";
  }
  const h = p.health;
  const one = (label: string, e: string, detail: string): string =>
    `<i class="hl ${e}" ${glyphTip(t, e === "failing" ? "g.redDot" : e === "passing" ? "g.greenDot" : e === "na" ? "g.dashedDot" : "g.greyDot", label + ": " + detail)} aria-label="${escapeHtml(label + ": " + detail)}"></i>`;
  const build = h.build !== undefined ? one(t.healthBuild, h.build, h.buildDetail ?? "") : "";
  const deps = h.deps !== undefined ? one(t.healthDeps, h.deps, h.depsDetail ?? "") : "";
  return `<span class="marks">${build}${deps}${one(t.healthLint, h.lint, h.lintDetail)}${one(t.healthTests, h.tests, h.testsDetail)}</span>`;
}

// A short line on the row while a daily report job runs, waits or failed to start. Only for
// a row whose evidence is still missing; the "turn on" offer lives in the Path to GO list.
function feedLine(p: BoardProject, t: BoardStrings): string {
  const h = p.health;
  if (!h?.feeds) {
    return "";
  }
  const lines: string[] = [];
  for (const kind of ["build", "lint", "tests"] as const) {
    const note = h.feeds[kind];
    const evidence = kind === "build" ? h.build : h[kind];
    if (note && note.state !== "off" && evidence !== "passing" && evidence !== "failing") {
      lines.push(feedSentence(kind, note, t));
    }
  }
  return lines.length > 0 ? `<span class="fn" ${tip(t, "feedLine")}>${lines.join(" ")}</span>` : "";
}

// The words for one note from a daily report, and whether it is a warning. Already escaped.
function signalText(s: Signal, t: BoardStrings): { text: string; warn: boolean } {
  const count = s.count ?? 0;
  switch (s.kind) {
    case "prs":
      return { text: fillT(t, t.sigPrs, { count }), warn: false };
    case "uncommitted":
      return { text: fillT(t, t.sigUncommitted, { count }), warn: true };
    case "staleBranches":
      return { text: fillT(t, t.sigStaleBranches, { count }), warn: true };
    case "changelog":
      return { text: fillT(t, t.sigChangelog, {}), warn: true };
    case "version":
      return { text: fillT(t, t.sigVersion, {}), warn: true };
    case "links":
      return { text: fillT(t, t.sigLinks, { count }), warn: true };
    default:
      return s.result === "pass" ? { text: fillT(t, t.sigReadyPass, {}), warn: false } : { text: fillT(t, t.sigReadyFail, { count }), warn: true };
  }
}

// Short notes on the row from the other daily reports (review queue, uncommitted files, the
// checks). They are information: they never change the light. The tooltip has the report's own figures.
function signalLine(p: BoardProject, t: BoardStrings): string {
  return (p.health?.signals ?? [])
    .filter(showsOnRow)
    .map((s) => {
      const { text, warn } = signalText(s, t);
      return `<span class="fn${warn ? " warn" : ""}" title="${escapeHtml(s.detail)}">${text}</span>`;
    })
    .join("");
}

// The summary pills of a set of open items: how many block the release (the only red), how many
// wait for review and how many are in progress. A zero count is left out.
export function itemCounts(items: readonly BoardItem[], name: string, t: BoardStrings): string {
  const n = { red: 0, amber: 0, purple: 0 };
  for (const i of items) {
    n[blocks(i) ? "red" : i.status] += 1;
  }
  return (["red", "amber", "purple"] as const)
    .filter((k) => n[k] > 0)
    .map((k) => `<span class="cp ${k}" ${tip(t, "cpTip." + k, { count: n[k], name })}>${pill(t, n[k], "cpTip." + k, { count: n[k], name })} ${escapeHtml(pl(t, "cp." + k))}</span>`)
    .join("");
}

const cardCounts = (p: BoardProject, t: BoardStrings): string => itemCounts(p.items, p.name, t);

// One project's verdict row: name, light, link mark, health marks and the count pills.
export function verdict(p: BoardProject, t: BoardStrings, lights: Map<string, string>, toggles = false, badge = "", index?: number, withCounts = true): string {
  const light = p.light === "no-go" ? t.noGo : p.light === "go" ? t.go : t.unverified;
  const why = p.light !== "unverified" ? "" : p.reasons.map((r) => reasonText(r, p, t)).join(" · ");
  const lightTip = why || pl(t, p.light === "go" ? "light.go" : p.light === "no-go" ? "light.noGo" : "light.unverified");
  const counts = withCounts ? cardCounts(p, t) : "";
  // The link mark is amber while a project it depends on is NO-GO, green otherwise.
  const waiting = p.dependsOn.some((d) => lights.get(d) === "no-go");
  const dep = p.dependsOn.length > 0 ? `<i class="link ${waiting ? "wait" : "ok"}" ${glyphTip(t, waiting ? "g.amberDiamond" : "g.greenDiamond", `${t.dependsOn} ${p.dependsOn.map((d) => lights.get("name:" + d) ?? d).join(", ")}`)}></i>` : "";
  const rowTip = toggles ? tip(t, "projectRow", { name: p.name }) : tip(t, "projectRowPlain", { name: p.name });
  return `<div class="vd${toggles ? " ptgrow" : ""}"${toggles ? ' tabindex="0" role="button" aria-expanded="false"' : ""} ${rowTip}><b class="pn" ${tip(t, "projectName", { name: p.name })}>${sectionIcon(t, "project")}${escapeHtml(p.name)}</b>${badge}<span class="go ${p.light}" ${titleAttr(lightTip)}>${escapeHtml(light)}</span>${dep}${healthMarks(p, t)}${feedLine(p, t)}${signalLine(p, t)}${counts}${why ? `<i class="info" ${glyphTip(t, "g.infoIcon", why)} aria-label="${escapeHtml(why)}"></i>` : ""}${index === undefined ? "" : kebab(t, "scope", `project:${index}`, p.name)}</div>`;
}

// True when an open document blocks the release under the chosen profile: a red folder, a
// stopping severity or a pin. Only these are drawn red.
const blocks = blocksNow;

// The hover card of a row: what the document is, why it blocks (or not), what it waits on, and
// who or what set its status or severity. Plain text, one line per fact; the page escapes it.
function rowCard(i: BoardItem, t: BoardStrings): string {
  const lines = [pl(t, blocks(i) ? "stTip.red" : "stTip." + i.status, { title: i.title })];
  if (i.status === "red") {
    lines.push(pl(t, "whyRed"));
  }
  if (i.pinned) {
    lines.push(t.pinned);
  }
  if (i.severity) {
    lines.push(pl(t, i.stopping ? "severityStops" : "severity", { severity: pl(t, "sev." + i.severity) }));
  }
  if (i.link) {
    lines.push(i.link.detail);
  }
  if (i.blocksCount > 0) {
    lines.push(pl(t, "blocks", { count: i.blocksCount }));
  }
  if (i.severityByUser || i.statusByUser) {
    lines.push(pl(t, "byYou"));
  }
  lines.push(pl(t, "kind", { kind: i.kind || "-" }));
  return lines.join("\n");
}

// The status pill: a shape for the status, the word, and the severity word. Red only when the
// document blocks the release; a hand-set value carries a pen mark.
function statusPill(i: BoardItem, t: BoardStrings): string {
  const k = blocks(i) ? "red" : i.status;
  const shape = k === "red" ? "●" : k === "amber" ? "◆" : "◐";
  const sev = i.severity ? ` · ${escapeHtml(pl(t, "sev." + i.severity))}` : "";
  const pen = i.severityByUser || i.statusByUser ? ` <span ${tip(t, "byYou")}>✎</span>` : "";
  return `<span class="stat ${k}" role="button" tabindex="0" aria-haspopup="menu" aria-expanded="false" data-menu="row" data-id="${i.id}"${rowData(i)} ${titleAttr(rowCard(i, t))}><span aria-hidden="true">${shape}</span> ${escapeHtml(pl(t, "st." + k))}${sev}${pen}</span>`;
}

// A small flame on the row when the files the document names have errors, warnings or crashes.
// Amber: it never changes the light. Only the figures differ, in the tooltip.
function liveMark(m: LiveMark | undefined, t: BoardStrings): string {
  if (!m) {
    return "";
  }
  const lines = [t.liveHead, ...m.files.map((f) => liveLine(f, t)), ...(m.more > 0 ? [t.liveMore.replace("{count}", String(m.more))] : [])];
  const tip = lines.join("\n");
  return `<i class="flame" role="img" aria-label="${escapeHtml(tip)}" ${glyphTip(t, "g.flameAmber", tip)}></i>`;
}

// The neutral facts pill of a row: progress ring and "3/7", the link mark, Pro, chats and hub.
// Size bars, the code letter and the other-project dots are only in the tooltip.
function facts(i: BoardItem, t: BoardStrings): string {
  const parts: string[] = [];
  const text: string[] = [];
  const m = i.marks;
  if (m) {
    const pct = m.total > 0 ? Math.round((m.done / m.total) * 100) : 0;
    const ring = m.total === 0 ? "none" : m.done === m.total ? "ok" : m.done > 0 ? "part" : "none";
    const steps = m.total === 0 ? pl(t, "ringNone") : pl(t, "ringSteps", { done: m.done, total: m.total });
    parts.push(`<i class="ring ${ring}" style="--p:${pct}" ${glyphTip(t, "g.ring", steps)}></i>${m.total > 0 ? `<span class="fx">${m.done}/${m.total}</span>` : ""}`);
    text.push(m.detail, pl(t, "barsSize", { size: m.size }));
    if (m.code !== undefined) {
      text.push(m.code ? pl(t, "codeLang", { lang: m.code }) : pl(t, "codeNoLang"));
    }
    m.mentions.forEach((n) => text.push(pl(t, "mentions", { name: n })));
  }
  if (i.live) {
    parts.push(liveMark(i.live, t));
  }
  if (i.link) {
    // A link waiting on open work or a stale Needs line is amber; one that is satisfied is green.
    const glyph = i.link.state === "done" ? "g.greenDiamond" : i.link.state === "open" ? "g.amberDiamond" : "g.amberDiamondDashed";
    parts.push(`<i class="link ${i.link.state}" ${glyphTip(t, glyph, i.link.detail)}></i>`);
    text.push(i.link.detail);
  }
  if (i.blocksCount > 0) {
    const blocksText = pl(t, "blocks", { count: i.blocksCount });
    parts.push(`<i class="link blocks" ${glyphTip(t, "g.amberDiamondFilled", blocksText)}></i>`);
    text.push(blocksText);
  }
  if (i.audience === "pro") {
    parts.push(`<b class="code" title="${escapeHtml(t.proOnly)}">Pro</b>`);
    text.push(t.proOnly);
  }
  if (i.chats !== undefined) {
    parts.push(pill(t, i.chats, "chatsPill", { count: i.chats }));
    text.push(pl(t, "chatsPill", { count: i.chats }));
  }
  if (i.hub) {
    parts.push(`<b class="code" title="${escapeHtml(t.hub)}">hub</b>`);
    text.push(t.hub);
  }
  if (parts.length === 0) {
    return "";
  }
  // On a narrow row only the first mark stays; the tooltip of the pill lists all of them.
  return `<span class="facts" ${titleAttr(pl(t, "marksMore", { list: text.filter(Boolean).join("; ") }))}>${parts.map((p, n) => `<span class="mk${n === 0 ? " top" : ""}">${p}</span>`).join("")}</span>`;
}

// One open document: the title is the link that opens it (its tooltip is the path inside the
// project); a click anywhere else on the row opens it too. The row menu button shows on hover.
export function row(i: BoardItem, name: string | undefined, t: BoardStrings, indent: boolean, quiet = false): string {
  return `<div class="row${indent ? " in" : ""}" data-id="${i.id}"${dragAttrs(i.id)} ${titleAttr(rowCard(i, t))}>${quiet ? "" : statusPill(i, t)}${name === undefined ? "" : `<span class="tag" ${tip(t, "project", { name })}>${escapeHtml(name)}</span>`}${chooseBox(t, i.id, i.title)}<span class="f">${docLink(i.title, i.path, `data-id="${i.id}"`)}</span>${facts(i, t)}${kebab(t, "row", i.id, i.title, rowData(i))}</div>`;
}

// What a list adds to the plain item list: its tooltip key, an explanation line, how many more
// items the caller left out, and its own cap.
export interface ListOptions {
  tip?: string;
  note?: string;
  more?: number;
  cap?: number;
  // Leave out the project name of each row: only one project is shown.
  single?: boolean;
  // Tells the lists of one project card apart from the same list of another card.
  scope?: string;
  // Leave out the status pill of each row: the heading already says it.
  quiet?: boolean;
}

// One list of items under a heading, grouped items together, capped at a fixed length.
export function list(title: string, items: BoardItem[], names: Map<string, string>, t: BoardStrings, opt: ListOptions = {}): string {
  const cap = opt.cap ?? LIST_CAP;
  // Items of one group sit together under its heading; the rest follow, alone.
  const size = new Map<string, number>();
  items.forEach((i) => i.group && size.set(i.group.id, (size.get(i.group.id) ?? 0) + 1));
  const grouped = (i: BoardItem): BoardItem["group"] => (i.group && (size.get(i.group.id) ?? 0) > 1 ? i.group : undefined);
  const ordered = opt.cap === undefined ? [...items].sort((a, b) => (grouped(b) ? 1 : 0) - (grouped(a) ? 1 : 0) || (grouped(a)?.name ?? "").localeCompare(grouped(b)?.name ?? "") || (grouped(a)?.id ?? "").localeCompare(grouped(b)?.id ?? "")) : items;
  let last: string | undefined;
  const parts = ordered.slice(0, cap).map((i) => {
    const g = opt.cap === undefined ? grouped(i) : undefined;
    const head = g && g.id !== last ? `<div class="grp" ${tip(t, "group", { count: size.get(g.id) ?? 0 })}><i class="sq ${blocks(i) ? "red" : i.status}" ${tip(t, "stTip." + (blocks(i) ? "red" : i.status), { title: g.name })}></i><b ${tip(t, "group", { count: size.get(g.id) ?? 0 })}>${escapeHtml(g.name)}</b>${kebab(t, "scope", `group:${i.id}`, g.name)}</div>` : "";
    last = g?.id;
    return head + row(i, opt.single ? undefined : (names.get(i.project) ?? i.project), t, g !== undefined, opt.quiet);
  });
  const left = items.length > cap ? items.length - cap : 0;
  const hidden = left + (opt.more ?? 0);
  const more = hidden > 0 ? `<p class="note" ${titleAttr(t.more.replace("{count}", String(hidden)))}>${pillify(t, escapeHtml(t.more.replace("{count}", String(hidden))))}</p>` : "";
  // An empty list is not drawn.
  const total = items.length + (opt.more ?? 0);
  if (total === 0) {
    return "";
  }
  // Rows past the first few wait behind a pill; the page script reveals them.
  const rest = parts.length - SHOWN_ROWS;
  const shown = rest > 0 ? `${parts.slice(0, SHOWN_ROWS).join("")}<button type="button" class="sec" data-show-more ${tip(t, "showMoreTip")}>${pillify(t, escapeHtml(pl(t, "showMore", { count: rest })))}</button><div hidden>${parts.slice(SHOWN_ROWS).join("")}${more}</div>` : parts.join("") + more;
  const note = opt.note ? `<p class="note">${escapeHtml(opt.note)}</p>` : "";
  // A long list starts folded; the heading still shows how many it holds.
  const id = opt.tip ?? "list:" + title;
  return collapsible({ t, id, sec: opt.scope ? `${id}:${opt.scope}` : id, tipAttr: tip(t, opt.tip ?? "list", { title, count: total }), head: `${escapeHtml(title)} ${pill(t, total, "count", { count: total })}`, body: note + shown, open: items.length <= LONG_LIST });
}

// The step line for a row whose daily report job has something to say. Escaped.
function feedStepText(kind: "build" | "lint" | "tests", s: PathStep, t: BoardStrings): string {
  const what = kind === "build" ? t.feedWhatBuild : kind === "lint" ? t.feedWhatLint : t.feedWhatTests;
  const tmpl = s.feed === "off" ? t.ptgFeedOff : s.feed === "checking" ? t.ptgFeedChecking : s.feed === "waiting" ? t.ptgFeedWaiting : s.feed === "failed" ? t.ptgFeedFailed : undefined;
  return tmpl === undefined ? "" : fillT(t, tmpl, { what, reason: s.reason ?? "" });
}

function stepText(s: PathStep, t: BoardStrings): string {
  switch (s.kind) {
    case "item": {
      // The document's title is a link to it; the project name, when shown, stays plain text.
      const link = s.itemId !== undefined ? docLink(s.title ?? "", s.docPath ?? "", `data-id="${s.itemId}"`) : escapeHtml(s.title ?? "");
      const named = s.project ? `${link} <span class="tag">${escapeHtml(s.project)}</span>` : link;
      const unblocks = s.unblocks ? " " + fillT(t, t.ptgUnblocks, { count: s.unblocks }) : "";
      if (s.why === undefined) {
        // The document does not stop the release itself: the one that waits on it does.
        return fillT(t, s.waiter ? t.ptgItemFirst : t.ptgItemFirstAny, { waiter: s.waiter ?? "" }, { title: named }) + unblocks;
      }
      const base = s.why === "red" ? t.ptgItemRed : s.why === "pinned" ? t.ptgItemPinned : t.ptgItemSeverity;
      const reason = s.why === "red" || s.why === "pinned" ? ` <span class="why">${escapeHtml(pl(t, "why." + s.why))}</span>` : "";
      const waiter = s.waiter ? " " + fillT(t, t.ptgWaiter, { title: s.waiter }) : "";
      return fillT(t, base, { severity: s.severity ?? "" }, { title: named }) + reason + unblocks + waiter;
    }
    case "blocked":
      return fillT(t, t.ptgBlocked, { count: s.count });
    case "build":
      return s.evidence === "failing" ? fillT(t, t.ptgBuildFailing, {}) : feedStepText("build", s, t);
    case "deps":
      return fillT(t, t.ptgDepsFailing, {});
    case "lint":
      return s.evidence === "failing" ? fillT(t, t.ptgLintFailing, {}) : s.feed ? feedStepText("lint", s, t) : fillT(t, t.ptgLintMissing, {});
    case "tests":
      return s.evidence === "failing" ? fillT(t, t.ptgTestsFailing, {}) : s.feed ? feedStepText("tests", s, t) : fillT(t, t.ptgTestsMissing, {});
    case "rules":
      return s.folder === undefined ? fillT(t, t.ptgRulesAny, { count: s.count }) : fillT(t, t.ptgRules, { count: s.count, folder: s.folder || "/" });
    case "unread":
      return fillT(t, t.ptgUnread, { count: s.count });
    case "accept":
      return fillT(t, t.ptgAccept, {});
  }
}

// The action of a step, or nothing when the step has no action the board can take. A step that
// opens a document (the rules file) is an underlined link with the file's path as its tooltip;
// the rest are buttons. The page sends only the project and step index; the host resolves them.
function stepButton(s: PathStep, t: BoardStrings, pi: number, si: number, canAct: boolean): string {
  if (!canAct) {
    return "";
  }
  const evidenceKind = s.kind === "lint" || s.kind === "tests" || s.kind === "build";
  const enable = evidenceKind && s.enable === true;
  const run = (s.kind === "lint" || s.kind === "tests") && s.run && s.feed !== "checking" && s.feed !== "waiting";
  const label = s.kind === "accept" ? t.ptgAcceptBtn : run ? (s.kind === "lint" ? t.ptgRunLint : t.ptgRunTests) : "";
  const button = (text: string, tipKey: string, debounce: boolean): string => `<button class="ptgb" data-p="${pi}" data-s="${si}"${debounce ? ' data-run="1"' : ""} ${tip(t, tipKey)}>${escapeHtml(text)}</button>`;
  const tipKey = s.kind === "accept" ? "ptgAccept" : s.kind === "lint" ? "ptgRunLint" : "ptgRunTests";
  // A row whose daily report is off offers both: turn the report on, and the run it had before.
  return (enable ? button(t.ptgEnable, "ptgEnable", true) : "") + (label ? button(label, tipKey, Boolean(run)) : "");
}

// One project's steps, hidden until its row is clicked. A step that is no longer listed is
// shown ticked by the page script, for a few minutes.
export function pathList(path: PathToGo, t: BoardStrings, pi: number, canAct: boolean): string {
  const items = path.steps
    .map((s, si) => `<li data-k="${escapeHtml(s.key)}"${s.kind === "lint" || s.kind === "tests" || s.kind === "build" || s.kind === "deps" ? ` title="${escapeHtml(s.detail ?? "")}"` : ""}><span class="st">${stepText(s, t)}</span>${stepButton(s, t, pi, si, canAct)}</li>`)
    .join("");
  const more = path.hidden > 0 ? `<li class="note" data-ptg-more="1">${fillT(t, t.ptgMore, { count: path.hidden })}</li>` : "";
  const none = path.steps.length === 0 ? `<li class="note" data-none="1">${escapeHtml(t.ptgNone)}</li>` : "";
  return `<ol class="ptg" hidden data-live="${canAct ? 1 : 0}" data-all="${escapeHtml(JSON.stringify(path.allKeys))}">${none}${items}${more}</ol>`;
}

// A project's verdict row, with its Path to GO folded under it when there is one.
export function projectBlock(p: BoardProject, i: number, t: BoardStrings, lights: Map<string, string>, path: PathToGo | undefined, canAct: boolean, badge = ""): string {
  if (!path) {
    return verdict(p, t, lights, false, badge, i);
  }
  return `<div class="pj" data-pid="${escapeHtml(p.id)}">${verdict(p, t, lights, true, badge, i)}${pathList(path, t, i, canAct)}</div>`;
}

// A project card: the verdict row is the heading; the Path to GO and the project's own lists sit
// inside. The caller says whether it starts open. Its fold state is remembered per light, so a
// change of light starts the card over.
export function projectCard(p: BoardProject, i: number, t: BoardStrings, lights: Map<string, string>, path: PathToGo | undefined, canAct: boolean, badge: string, open: boolean, lists: string): string {
  const steps = path ? `<div class="pj" data-pid="${escapeHtml(p.id)}">${pathList(path, t, i, canAct)}</div>` : "";
  return `<details class="box pcard" data-sec="${escapeHtml(`project:${p.id}:${p.light}`)}"${open ? " open" : ""}><summary class="sh">${verdict(p, t, lights, false, badge, i, false)}</summary>${steps}${lists}</details>`;
}
