import { BoardItem, ItemMarks, BoardProject, UnverifiedReason } from "./boardModel";
import { PathStep, PathToGo } from "./pathToGo";
import { LiveMark } from "./liveEvidence";
import { BoardStrings, escapeHtml, fill, handButton, liveLine } from "./boardHtmlUtil";
import type { FeedNote } from "./recipeEvidence";

// The project rows and the item lists of the board page.

const LIST_CAP = 30;

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
  return fill(tmpl, { what, reason: note.reason ?? "" });
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
    `<i class="hl ${e}" title="${escapeHtml(label + ": " + detail)}" aria-label="${escapeHtml(label + ": " + detail)}"></i>`;
  const build = h.build !== undefined ? one(t.healthBuild, h.build, h.buildDetail ?? "") : "";
  return `<span class="marks">${build}${one(t.healthLint, h.lint, h.lintDetail)}${one(t.healthTests, h.tests, h.testsDetail)}</span>`;
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
  return lines.length > 0 ? `<span class="fn">${lines.join(" ")}</span>` : "";
}

// One project's verdict row: name, light, link mark, health marks and the item squares.
export function verdict(p: BoardProject, t: BoardStrings, lights: Map<string, string>, toggles = false): string {
  const light = p.light === "no-go" ? t.noGo : p.light === "go" ? t.go : t.unverified;
  const why = p.light !== "unverified" ? "" : p.reasons.map((r) => reasonText(r, p, t)).join(" · ");
  const squares = p.items
    .slice(0, 14)
    .map((i) => `<i class="sq ${i.status}"></i>`)
    .join("");
  // The link mark is amber while a project it depends on is NO-GO, green otherwise.
  const waiting = p.dependsOn.some((d) => lights.get(d) === "no-go");
  const dep = p.dependsOn.length > 0 ? `<span class="link ${waiting ? "wait" : "ok"}" title="${escapeHtml(t.dependsOn)} ${escapeHtml(p.dependsOn.map((d) => lights.get("name:" + d) ?? d).join(", "))}"></span>` : "";
  return `<div class="vd${toggles ? " ptgrow" : ""}"${toggles ? ' tabindex="0" role="button" aria-expanded="false"' : ""}><b class="pn">${escapeHtml(p.name)}</b><span class="go ${p.light}" title="${escapeHtml(why)}">${escapeHtml(light)}</span>${dep}${healthMarks(p, t)}${feedLine(p, t)}<span class="bar">${squares}</span>${why ? `<i class="info" title="${escapeHtml(why)}" aria-label="${escapeHtml(why)}"></i>` : ""}</div>`;
}

// The small marks on a row: a progress ring, size bars, a code letter and one dot per
// other project mentioned. The exact figures are in the tooltip, not on the screen.
function marks(m: ItemMarks | undefined): string {
  if (!m) {
    return "";
  }
  const pct = m.total > 0 ? Math.round((m.done / m.total) * 100) : 0;
  const ring = m.total === 0 ? "none" : m.done === m.total ? "ok" : m.done > 0 ? "part" : "none";
  const bars = [1, 2, 3, 4].map((n) => `<u${n <= m.size ? ' class="on"' : ""}></u>`).join("");
  const code = m.code === undefined ? "" : `<b class="code">${escapeHtml(m.code ? m.code.charAt(0).toUpperCase() : "{}")}</b>`;
  const dots = m.mentions.map((n) => `<i class="pd" title="${escapeHtml(n)}"></i>`).join("");
  return `<span class="marks" title="${escapeHtml(m.detail)}"><i class="ring ${ring}" style="--p:${pct}"></i><i class="bars">${bars}</i>${code}${dots}</span>`;
}

// A small flame on the row when the files the document names have errors, warnings or crashes.
// Red for errors and crashes, amber for warnings only. Never an input to the light.
function liveMark(m: LiveMark | undefined, t: BoardStrings): string {
  if (!m) {
    return "";
  }
  const lines = [t.liveHead, ...m.files.map((f) => liveLine(f, t)), ...(m.more > 0 ? [t.liveMore.replace("{count}", String(m.more))] : [])];
  const tip = lines.join("\n");
  return `<i class="flame${m.hot ? " hot" : ""}" role="img" aria-label="${escapeHtml(tip)}" title="${escapeHtml(tip)}"></i>`;
}

function linkMark(i: BoardItem, t: BoardStrings): string {
  const parts: string[] = [];
  parts.push(liveMark(i.live, t));
  if (i.link) {
    parts.push(`<i class="link ${i.link.state}" title="${escapeHtml(i.link.detail)}"></i>`);
  }
  if (i.blocksCount > 0) {
    parts.push(`<i class="link blocks" title="${i.blocksCount}"></i>`);
  }
  if (i.severity) {
    parts.push(`<i class="sev s-${i.severity}${i.stopping ? " stop" : ""}" title="${escapeHtml(i.severity)}"></i>`);
  }
  if (i.audience === "pro") {
    parts.push(`<b class="code" title="${escapeHtml(t.proOnly)}">Pro</b>`);
  }
  if (i.pinned) {
    parts.push(`<i class="pin" title="${escapeHtml(t.pinned)}"></i>`);
  }
  if (i.chats !== undefined) {
    parts.push(`<b class="code" title="${escapeHtml(t.chatsTitle.replace("{count}", String(i.chats)))}">${i.chats}</b>`);
  }
  if (i.hub) {
    parts.push(`<b class="code" title="${escapeHtml(t.hub)}">hub</b>`);
  }
  const shown = parts.filter(Boolean);
  return shown.length > 0 ? `<span class="marks">${shown.join("")}</span>` : "";
}

function row(i: BoardItem, name: string, t: BoardStrings, indent: boolean): string {
  return `<div class="row${indent ? " in" : ""}" tabindex="0" role="button" data-id="${i.id}" title="${escapeHtml(i.path)}"><i class="sq ${i.status}"></i><span class="tag">${escapeHtml(name)}</span><span class="f">${escapeHtml(i.title)}</span>${marks(i.marks)}${linkMark(i, t)}<span class="k">${escapeHtml(i.kind)}</span>${i.status === "red" || i.stopping ? handButton(t, `data-hk="item" data-i="${i.id}"`) : ""}</div>`;
}

// One list of items under a heading, grouped items together, capped at a fixed length.
export function list(title: string, items: BoardItem[], names: Map<string, string>, t: BoardStrings): string {
  // Items of one group sit together under its heading; the rest follow, alone.
  const size = new Map<string, number>();
  items.forEach((i) => i.group && size.set(i.group.id, (size.get(i.group.id) ?? 0) + 1));
  const grouped = (i: BoardItem): BoardItem["group"] => (i.group && (size.get(i.group.id) ?? 0) > 1 ? i.group : undefined);
  const ordered = [...items].sort((a, b) => (grouped(b) ? 1 : 0) - (grouped(a) ? 1 : 0) || (grouped(a)?.name ?? "").localeCompare(grouped(b)?.name ?? "") || (grouped(a)?.id ?? "").localeCompare(grouped(b)?.id ?? ""));
  let last: string | undefined;
  const shown = ordered
    .slice(0, LIST_CAP)
    .map((i) => {
      const g = grouped(i);
      const head = g && g.id !== last ? `<div class="grp"><i class="sq ${i.status}"></i><b title="${size.get(g.id)}">${escapeHtml(g.name)}</b></div>` : "";
      last = g?.id;
      return head + row(i, names.get(i.project) ?? i.project, t, g !== undefined);
    })
    .join("");
  const more = items.length > LIST_CAP ? `<p class="note" title="${escapeHtml(t.more.replace("{count}", String(items.length - LIST_CAP)))}">…</p>` : "";
  const body = items.length === 0 ? `<p class="note">${escapeHtml(t.nothingHere)}</p>` : shown + more;
  return `<section class="box"><h2 title="${items.length}">${escapeHtml(title)}</h2>${body}</section>`;
}

// The step line for a row whose daily report job has something to say. Escaped.
function feedStepText(kind: "build" | "lint" | "tests", s: PathStep, t: BoardStrings): string {
  const what = kind === "build" ? t.feedWhatBuild : kind === "lint" ? t.feedWhatLint : t.feedWhatTests;
  const tmpl = s.feed === "off" ? t.ptgFeedOff : s.feed === "checking" ? t.ptgFeedChecking : s.feed === "waiting" ? t.ptgFeedWaiting : s.feed === "failed" ? t.ptgFeedFailed : undefined;
  return tmpl === undefined ? "" : fill(tmpl, { what, reason: s.reason ?? "" });
}

function stepText(s: PathStep, t: BoardStrings): string {
  switch (s.kind) {
    case "item": {
      const named = s.project ? `${s.title ?? ""} (${s.project})` : s.title;
      const unblocks = s.unblocks ? " " + fill(t.ptgUnblocks, { count: s.unblocks }) : "";
      if (s.why === undefined) {
        // The document does not stop the release itself: the one that waits on it does.
        return fill(s.waiter ? t.ptgItemFirst : t.ptgItemFirstAny, { title: named, waiter: s.waiter ?? "" }) + unblocks;
      }
      const base = s.why === "red" ? t.ptgItemRed : s.why === "pinned" ? t.ptgItemPinned : t.ptgItemSeverity;
      const waiter = s.waiter ? " " + fill(t.ptgWaiter, { title: s.waiter }) : "";
      return fill(base, { title: named, severity: s.severity ?? "" }) + unblocks + waiter;
    }
    case "blocked":
      return fill(t.ptgBlocked, { count: s.count });
    case "build":
      return s.evidence === "failing" ? fill(t.ptgBuildFailing, {}) : feedStepText("build", s, t);
    case "lint":
      return s.evidence === "failing" ? fill(t.ptgLintFailing, {}) : s.feed ? feedStepText("lint", s, t) : fill(t.ptgLintMissing, {});
    case "tests":
      return s.evidence === "failing" ? fill(t.ptgTestsFailing, {}) : s.feed ? feedStepText("tests", s, t) : fill(t.ptgTestsMissing, {});
    case "rules":
      return s.folder === undefined ? fill(t.ptgRulesAny, { count: s.count }) : fill(t.ptgRules, { count: s.count, folder: s.folder || "/" });
    case "unread":
      return fill(t.ptgUnread, { count: s.count });
    case "accept":
      return fill(t.ptgAccept, {});
  }
}

// The button of a step, or nothing when the step has no action the board can take. The page
// sends only the project and step index; the host resolves them.
function stepButton(s: PathStep, t: BoardStrings, pi: number, si: number, canAct: boolean): string {
  if (!canAct) {
    return "";
  }
  const evidenceKind = s.kind === "lint" || s.kind === "tests" || s.kind === "build";
  const enable = evidenceKind && s.enable === true;
  const run = (s.kind === "lint" || s.kind === "tests") && s.run && s.feed !== "checking" && s.feed !== "waiting";
  const label = s.kind === "item" ? t.ptgOpen : s.kind === "rules" ? t.ptgOpenRules : s.kind === "accept" ? t.ptgAcceptBtn : run ? (s.kind === "lint" ? t.ptgRunLint : t.ptgRunTests) : "";
  const button = (text: string, debounce: boolean): string => `<button class="ptgb" data-p="${pi}" data-s="${si}"${debounce ? ' data-run="1"' : ""}>${escapeHtml(text)}</button>`;
  // A row whose daily report is off offers both: turn the report on, and the run it had before.
  return (enable ? button(t.ptgEnable, true) : "") + (label ? button(label, Boolean(run)) : "");
}

// One project's steps, hidden until its row is clicked. A step that is no longer listed is
// shown ticked by the page script, for a few minutes.
export function pathList(path: PathToGo, t: BoardStrings, pi: number, canAct: boolean): string {
  const items = path.steps
    .map((s, si) => `<li data-k="${escapeHtml(s.key)}"${s.kind === "lint" || s.kind === "tests" || s.kind === "build" ? ` title="${escapeHtml(s.detail ?? "")}"` : ""}><span class="st">${stepText(s, t)}</span>${stepButton(s, t, pi, si, canAct)}${handButton(t, `data-hk="step" data-p="${pi}" data-s="${si}"`)}</li>`)
    .join("");
  const more = path.hidden > 0 ? `<li class="note" data-more="1">${fill(t.ptgMore, { count: path.hidden })}</li>` : "";
  const none = path.steps.length === 0 ? `<li class="note" data-none="1">${escapeHtml(t.ptgNone)}</li>` : "";
  return `<ol class="ptg" hidden data-live="${canAct ? 1 : 0}" data-all="${escapeHtml(JSON.stringify(path.allKeys))}">${none}${items}${more}</ol>`;
}

// A project's verdict row, with its Path to GO folded under it when there is one.
export function projectBlock(p: BoardProject, i: number, t: BoardStrings, lights: Map<string, string>, path: PathToGo | undefined, canAct: boolean): string {
  if (!path) {
    return verdict(p, t, lights);
  }
  return `<div class="pj" data-pid="${escapeHtml(p.id)}">${verdict(p, t, lights, true)}${pathList(path, t, i, canAct)}</div>`;
}
