import { BoardItem, ItemMarks, BoardProject, UnverifiedReason } from "./boardModel";
import { PathStep, PathToGo } from "./pathToGo";
import { LiveMark } from "./liveEvidence";
import { chooseBox } from "./boardHtmlHandoff";
import { BoardStrings, fillT, collapsible, sectionIcon, docLink, escapeHtml, liveLine, glyphTip, pill, pillify, pl, tip, titleAttr } from "./boardHtmlUtil";
import { kebab } from "./boardHtmlMenus";
import type { FeedNote } from "./recipeEvidence";
import { Signal, showsOnRow } from "./reportSignals";

// The project rows and the item lists of the board page.

const LIST_CAP = 30;
// A list longer than this starts folded.
const LONG_LIST = 25;

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

// One project's verdict row: name, light, link mark, health marks and the item squares.
export function verdict(p: BoardProject, t: BoardStrings, lights: Map<string, string>, toggles = false, badge = "", index?: number): string {
  const light = p.light === "no-go" ? t.noGo : p.light === "go" ? t.go : t.unverified;
  const why = p.light !== "unverified" ? "" : p.reasons.map((r) => reasonText(r, p, t)).join(" · ");
  const lightTip = why || pl(t, p.light === "go" ? "light.go" : p.light === "no-go" ? "light.noGo" : "light.unverified");
  const squares = p.items
    .slice(0, 14)
    .map((i) => `<i class="sq ${i.status}" ${tip(t, "square." + i.status, { title: i.title })}></i>`)
    .join("");
  // The link mark is amber while a project it depends on is NO-GO, green otherwise.
  const waiting = p.dependsOn.some((d) => lights.get(d) === "no-go");
  const dep = p.dependsOn.length > 0 ? `<i class="link ${waiting ? "wait" : "ok"}" ${glyphTip(t, waiting ? "g.amberDiamond" : "g.greenDiamond", `${t.dependsOn} ${p.dependsOn.map((d) => lights.get("name:" + d) ?? d).join(", ")}`)}></i>` : "";
  const rowTip = toggles ? tip(t, "projectRow", { name: p.name }) : tip(t, "projectRowPlain", { name: p.name });
  return `<div class="vd${toggles ? " ptgrow" : ""}"${rowTip}><b class="pn"${toggles ? ' tabindex="0" role="button" aria-expanded="false"' : ""} ${tip(t, "projectName", { name: p.name })}>${sectionIcon(t, "project")}${escapeHtml(p.name)}</b>${badge}<span class="go ${p.light}" ${titleAttr(lightTip)}>${escapeHtml(light)}</span>${dep}${healthMarks(p, t)}${feedLine(p, t)}${signalLine(p, t)}<span class="bar" ${tip(t, "squares", { count: p.items.length })}>${squares}</span>${why ? `<i class="info" ${glyphTip(t, "g.infoIcon", why)} aria-label="${escapeHtml(why)}"></i>` : ""}${index === undefined ? "" : kebab(t, "scope", `project:${index}`, p.name)}</div>`;
}

// The small marks on a row: a progress ring, size bars, a code letter and one dot per
// other project mentioned. The exact figures are in the tooltip, not on the screen.
function marks(m: ItemMarks | undefined, t: BoardStrings): string {
  if (!m) {
    return "";
  }
  const pct = m.total > 0 ? Math.round((m.done / m.total) * 100) : 0;
  const ring = m.total === 0 ? "none" : m.done === m.total ? "ok" : m.done > 0 ? "part" : "none";
  const bars = [1, 2, 3, 4].map((n) => `<u${n <= m.size ? ' class="on"' : ""}></u>`).join("");
  const code = m.code === undefined ? "" : `<b class="code" ${m.code ? tip(t, "codeLang", { lang: m.code }) : tip(t, "codeNoLang")}>${escapeHtml(m.code ? m.code.charAt(0).toUpperCase() : "{}")}</b>`;
  const dots = m.mentions.map((n) => `<i class="pd" ${glyphTip(t, "g.greyDot", pl(t, "mentions", { name: n }))}></i>`).join("");
  // On a narrow row only the ring (the first mark) stays; the group's tooltip lists them all.
  const mk = (html: string, top = false): string => `<span class="mk${top ? " top" : ""}">${html}</span>`;
  const ringHtml = `<i class="ring ${ring}" style="--p:${pct}" ${glyphTip(t, "g.ring", m.total === 0 ? pl(t, "ringNone") : pl(t, "ringSteps", { done: m.done, total: m.total }))}></i>`;
  const barsHtml = `<i class="bars" ${glyphTip(t, "g.bars", pl(t, "barsSize", { size: m.size }))}>${bars}</i>`;
  return `<span class="marks" title="${escapeHtml(m.detail)}">${mk(ringHtml, true)}${mk(barsHtml)}${code ? mk(code) : ""}${dots ? mk(dots) : ""}</span>`;
}

// A small flame on the row when the files the document names have errors, warnings or crashes.
// Red for errors and crashes, amber for warnings only. Never an input to the light.
function liveMark(m: LiveMark | undefined, t: BoardStrings): string {
  if (!m) {
    return "";
  }
  const lines = [t.liveHead, ...m.files.map((f) => liveLine(f, t)), ...(m.more > 0 ? [t.liveMore.replace("{count}", String(m.more))] : [])];
  const tip = lines.join("\n");
  return `<i class="flame${m.hot ? " hot" : ""}" role="img" aria-label="${escapeHtml(tip)}" ${glyphTip(t, m.hot ? "g.flameRed" : "g.flameAmber", tip)}></i>`;
}

// The icons and counts at the end of a row. On a narrow row only the most severe one stays on
// screen and the tooltip of the group lists all of them.
function linkMark(i: BoardItem, t: BoardStrings): string {
  const parts: Array<{ html: string; rank: number; text: string }> = [];
  const add = (html: string, rank: number, text: string): void => {
    if (html) {
      parts.push({ html, rank, text });
    }
  };
  if (i.live) {
    const hot = i.live.hot;
    add(liveMark(i.live, t), hot ? 90 : 50, pl(t, hot ? "g.flameRed" : "g.flameAmber"));
  }
  if (i.link) {
    const rank = i.link.state === "done" ? 10 : i.link.state === "open" ? 40 : 70;
    add(`<i class="link ${i.link.state}" ${glyphTip(t, i.link.state === "done" ? "g.greenDiamond" : i.link.state === "open" ? "g.amberDiamond" : "g.redDiamond", i.link.detail)}></i>`, rank, i.link.detail);
  }
  if (i.blocksCount > 0) {
    const text = pl(t, "blocks", { count: i.blocksCount });
    add(`<i class="link blocks" ${glyphTip(t, "g.amberDiamondFilled", text)}></i>`, 60, text);
  }
  if (i.severity) {
    const text = pl(t, i.stopping ? "severityStops" : "severity", { severity: i.severity }) + (i.severityByUser ? " " + pl(t, "byYou") : "");
    const red = i.severity === "extreme" || i.severity === "critical";
    add(`<i class="sev s-${i.severity}${i.stopping ? " stop" : ""}" ${glyphTip(t, red ? "g.redTriangle" : i.severity === "high" ? "g.amberTriangle" : "g.greyTriangle", text)}></i>`, (i.stopping ? 100 : red ? 95 : i.severity === "high" ? 80 : 20), text);
  }
  if (i.severityByUser || i.statusByUser) {
    add(`<b class="code" ${tip(t, "byYou")}>${escapeHtml(pl(t, "byYouMark"))}</b>`, 40, pl(t, "byYou"));
  }
  if (i.audience === "pro") {
    add(`<b class="code" title="${escapeHtml(t.proOnly)}">Pro</b>`, 30, t.proOnly);
  }
  if (i.pinned) {
    // A pinned document stops the release, so nothing less severe may stand in for it on a narrow row.
    add(`<i class="pin" ${glyphTip(t, "g.redRing", t.pinned)}></i>`, 97, t.pinned);
  }
  if (i.chats !== undefined) {
    add(pill(t, i.chats, "chatsPill", { count: i.chats }), 20, pl(t, "chatsPill", { count: i.chats }));
  }
  if (i.hub) {
    add(`<b class="code" title="${escapeHtml(t.hub)}">hub</b>`, 5, t.hub);
  }
  if (parts.length === 0) {
    return "";
  }
  const best = parts.reduce((a, b) => (b.rank > a.rank ? b : a));
  const all = pl(t, "marksMore", { list: parts.map((p) => p.text).join("; ") });
  return `<span class="marks lm" ${titleAttr(all)}>${parts.map((p) => `<span class="mk${p === best ? " top" : ""}">${p.html}</span>`).join("")}</span>`;
}

// One open document: the title is the link that opens it (its tooltip is the path inside the
// project); a click anywhere else on the row opens it too.
function row(i: BoardItem, name: string | undefined, t: BoardStrings, indent: boolean): string {
  return `<div class="row${indent ? " in" : ""}" data-id="${i.id}" ${tip(t, "row", { kind: i.kind || "-" })}><i class="sq ${i.status}" ${i.statusByUser ? titleAttr(`${pl(t, "square." + i.status, { title: i.title })} ${pl(t, "byYou")}`) : tip(t, "square." + i.status, { title: i.title })}></i>${name === undefined ? "" : `<span class="tag" ${tip(t, "project", { name })}>${escapeHtml(name)}</span>`}${chooseBox(t, i.id, i.title)}<span class="f">${docLink(i.title, i.path, `data-id="${i.id}"`)}</span>${marks(i.marks, t)}${linkMark(i, t)}<span class="k" ${tip(t, "kind", { kind: i.kind || "-" })}>${escapeHtml(i.kind)}</span>${kebab(t, "row", i.id, i.title)}</div>`;
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
  const shown = ordered
    .slice(0, cap)
    .map((i) => {
      const g = opt.cap === undefined ? grouped(i) : undefined;
      const head = g && g.id !== last ? `<div class="grp" ${tip(t, "group", { count: size.get(g.id) ?? 0 })}><i class="sq ${i.status}" ${tip(t, "square." + i.status, { title: g.name })}></i><b ${tip(t, "group", { count: size.get(g.id) ?? 0 })}>${escapeHtml(g.name)}</b>${kebab(t, "scope", `group:${i.id}`, g.name)}</div>` : "";
      last = g?.id;
      return head + row(i, opt.single ? undefined : (names.get(i.project) ?? i.project), t, g !== undefined);
    })
    .join("");
  const left = items.length > cap ? items.length - cap : 0;
  const hidden = left + (opt.more ?? 0);
  const more = hidden > 0 ? `<p class="note" ${titleAttr(t.more.replace("{count}", String(hidden)))}>${pillify(t, escapeHtml(t.more.replace("{count}", String(hidden))))}</p>` : "";
  const body = items.length === 0 ? `<p class="note">${escapeHtml(t.nothingHere)}</p>` : shown + more;
  const note = opt.note ? `<p class="note">${escapeHtml(opt.note)}</p>` : "";
  const total = items.length + (opt.more ?? 0);
  // A long list starts folded; the heading still shows how many it holds.
  return collapsible({ t, id: opt.tip ?? "list:" + title, tipAttr: tip(t, opt.tip ?? "list", { title, count: total }), head: `${escapeHtml(title)} ${pill(t, total, "count", { count: total })}`, body: note + body, open: items.length <= LONG_LIST });
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
      const named = s.project ? `${link} (${escapeHtml(s.project)})` : link;
      const unblocks = s.unblocks ? " " + fillT(t, t.ptgUnblocks, { count: s.unblocks }) : "";
      if (s.why === undefined) {
        // The document does not stop the release itself: the one that waits on it does.
        return fillT(t, s.waiter ? t.ptgItemFirst : t.ptgItemFirstAny, { waiter: s.waiter ?? "" }, { title: named }) + unblocks;
      }
      const base = s.why === "red" ? t.ptgItemRed : s.why === "pinned" ? t.ptgItemPinned : t.ptgItemSeverity;
      const waiter = s.waiter ? " " + fillT(t, t.ptgWaiter, { title: s.waiter }) : "";
      return fillT(t, base, { severity: s.severity ?? "" }, { title: named }) + unblocks + waiter;
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
  const more = path.hidden > 0 ? `<li class="note" data-more="1">${fillT(t, t.ptgMore, { count: path.hidden })}</li>` : "";
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
