import { BoardModel } from "./boardModel";
import { SittingLine } from "./sittings";
import { Train, trainRows } from "./train";
import { SinceView } from "./sinceLast";
import { TidyReport } from "./tidy";
import { BoardStrings, collapsible, fillT, docLink, escapeHtml, handButton, glyphTip, liveLine, pill, pillify, pl, tip, titleAttr } from "./boardHtmlUtil";
import { RULES_PATH } from "./ruleAssign";

// The boxes around the project rows: sittings, tidy, unnamed crashes, trains, linked
// documents, outside sources and the strip of changes since the board was last seen.

// Names of the time boxes the filter offers, with the minutes each means.
const TIME_LABELS: Array<[string, string]> = [["any", "timeAny"], ["15", "time15"], ["30", "time30"], ["60", "timeHour"], ["240", "timeHalfDay"]];

// The Sittings box: always visible. A compact filter on top ("Time I have", then the contexts
// in hand as chips) and the list of steps that fit under it. By default every context is in
// hand and any time fits, so nothing is hidden. Lines carry only an index; the host resolves it
// against the model it rendered.
export function sittingsBox(model: BoardModel, t: BoardStrings): string {
  const v = model.sittings;
  if (!v) {
    return "";
  }
  const chip = (id: string, label: string): string =>
    `<button class="chip sec" data-have="${escapeHtml(id)}" aria-pressed="${v.have.includes(id)}" ${tip(t, "chip", { name: label })}>${escapeHtml(label)}</button>`;
  const all = v.contexts.length > 0 ? `<button class="chip sec" data-haveall="1" aria-pressed="${v.have.length === v.contexts.length}" ${tip(t, "chipAll")}>${escapeHtml(pl(t, "haveAll"))}</button>` : "";
  const time = TIME_LABELS.map(([n, key]) => `<button class="chip sec" data-box="${n}" aria-pressed="${v.timeBox === n}" ${tip(t, n === "any" ? "timeAnyTip" : "timeTip", { label: pl(t, key) })}>${escapeHtml(pl(t, key))}</button>`).join("");
  const line = (l: SittingLine, i: number): string =>
    `<div class="row" ${tip(t, "step", { minutes: l.minutes })}><span class="tag" ${tip(t, "project", { name: l.projectName })}>${escapeHtml(l.projectName)}</span><span class="f">${docLink(l.text || l.heading || l.docTitle, l.path, `data-step="${i}"`)}</span><span class="k" ${tip(t, "stepDoc", { title: l.docTitle })}>${escapeHtml(l.docTitle)}</span>${l.needs.length > 0 ? `<span class="k" ${tip(t, "stepNeeds")}>${escapeHtml(l.needs.join(" + "))}</span>` : ""}${pill(t, l.minutes, "stepMinutesPill", { minutes: l.minutes })}${handButton(t, `data-hk="line" data-i="${i}"`)}</div>`;
  const doable = v.lines.slice(0, v.doable).map((l, i) => line(l, i)).join("");
  const rest = [
    v.more > 0 ? `<p class="note">${pillify(t, escapeHtml(t.sittingsMore.replace("{count}", String(v.more))))}</p>` : "",
    v.needOther > 0 ? `<p class="note">${pillify(t, escapeHtml(t.sittingsNeedOther.replace("{count}", String(v.needOther))))}</p>` : "",
    v.tooLong > 0 ? `<p class="note">${pillify(t, escapeHtml(t.sittingsTooLong.replace("{count}", String(v.tooLong))))}</p>` : "",
  ].join("");
  const body = v.have.length === 0 ? `<p class="note">${escapeHtml(t.sittingsPick)}</p>` : v.doable === 0 ? `<p class="note">${escapeHtml(t.sittingsNone)}</p>` : doable;
  const shownUntagged = v.lines.slice(v.doable).map((l, i) => line(l, v.doable + i)).join("");
  const untagged =
    v.untagged > 0
      ? `<details class="untag" id="sit-untag" data-sec="sittings-untagged" open><summary ${tip(t, "untagged")}>${pillify(t, escapeHtml(t.sittingsUntagged.replace("{count}", String(v.untagged + v.untaggedMore))))}</summary><p class="note">${escapeHtml(t.sittingsUntaggedNote)}</p>${shownUntagged}</details>`
      : "";
  const fit = `<details class="steps" id="sit-steps" data-sec="sittings-steps" open><summary ${tip(t, "stepsSummary")}>${pillify(t, escapeHtml(pl(t, "stepsFit", { count: v.doable })))}</summary>${body}${rest}${untagged}</details>`;
  const filter = `<div class="filter"><span class="k" ${tip(t, "timeLabelTip")}>${escapeHtml(pl(t, "timeLabel"))}</span><span class="seg" role="group" aria-label="${escapeHtml(pl(t, "timeLabel"))}" ${tip(t, "timeGroup")}>${time}</span><span class="k" ${tip(t, "haveLabelTip")}>${escapeHtml(pl(t, "haveLabel"))}</span><span class="seg" role="group" aria-label="${escapeHtml(pl(t, "haveLabel"))}" ${tip(t, "haveGroup")}>${all}${v.contexts.map((c) => chip(c.id, c.label)).join("")}</span></div>`;
  return collapsible({ id: "sittings", domId: "sit-panel", tipAttr: tip(t, "sittingsHeading"), head: escapeHtml(t.sittingsHeading), body: filter + fit });
}

// The words for one report candidate in the Tidy box. Already escaped.
function reportText(r: TidyReport, t: BoardStrings): string {
  switch (r.kind) {
    case "debt": {
      const word = r.trend === "up" ? t.tidyTrendUp : r.trend === "down" ? t.tidyTrendDown : r.trend === "same" ? t.tidyTrendSame : undefined;
      return word === undefined ? fillT(t, t.tidyRepDebt, { count: r.count }) : fillT(t, t.tidyRepDebtTrend, { count: r.count, trend: word });
    }
    case "branches":
      return fillT(t, t.tidyRepBranches, { count: r.count });
    case "bloat":
      return fillT(t, t.tidyRepBloat, { count: r.count });
    default:
      return fillT(t, t.tidyRepBigFiles, { count: r.count });
  }
}

// The Tidy box: documents with every step done that nobody has touched for a while, then the
// reports of the tech-debt, branch and bloat recipes. Open by default when there is something
// to list. Buttons carry only an index; the host resolves it against the list it rendered. A
// document move asks first; a report row only opens the report and changes nothing.
export function tidyBox(model: BoardModel, t: BoardStrings): string {
  const v = model.tidy;
  const reports = v?.reports ?? [];
  if (!v || (v.candidates.length === 0 && reports.length === 0)) {
    return "";
  }
  const rows = v.candidates
    .map((c, i) => {
      const detail = t.tidyDetail.replace("{count}", String(c.stepsDone)).replace("{days}", String(c.idleDays));
      return `<div class="row tidy" ${tip(t, "tidyRow")}><span class="tag" ${tip(t, "project", { name: c.projectName })}>${escapeHtml(c.projectName)}</span><span class="f">${docLink(c.title, c.path, `data-id="${c.id}"`)}</span><span class="k" ${titleAttr(detail)}>${pillify(t, escapeHtml(detail))}</span><button data-tidy="${i}" ${tip(t, "tidyMove")}>${escapeHtml(t.tidyMove)}</button></div>`;
    })
    .join("");
  const more = v.more > 0 ? `<p class="note">${pillify(t, escapeHtml(t.tidyMore.replace("{count}", String(v.more))))}</p>` : "";
  const repRows = reports
    .map((r, i) => `<div class="row tidy" ${tip(t, "tidyReportRow")}><span class="tag" ${tip(t, "project", { name: r.projectName })}>${escapeHtml(r.projectName)}</span><span class="f">${reportText(r, t)}</span><button class="sec" data-tidyrep="${i}" ${tip(t, "tidyReport")}>${escapeHtml(t.tidyOpenReport)}</button></div>`)
    .join("");
  const repNote = reports.length > 0 ? `<p class="note">${escapeHtml(t.tidyReportsNote)}</p>` : "";
  const note = v.candidates.length > 0 ? `<p class="note">${pillify(t, escapeHtml(t.tidyNote.replace("{days}", String(v.afterDays))))}</p>` : "";
  const total = v.candidates.length + v.more + reports.length;
  return collapsible({ id: "tidy", domId: "tidy-box", tipAttr: titleAttr(t.tidyTitle.replace("{count}", String(total))), head: `${escapeHtml(t.tidyHeading)} ${pill(t, total, "count", { count: total })}`, body: note + rows + more + repNote + repRows, open: total <= 25 });
}

// Crash signals from debug runs in files that no open document names. The button carries only
// an index; the host resolves it against the list it rendered and writes one new document.
export function unnamedBox(model: BoardModel, t: BoardStrings, canAct: boolean): string {
  const list = model.liveUnnamed ?? [];
  if (list.length === 0) {
    return "";
  }
  const rows = list
    .map((u, i) => {
      const detail = liveLine({ file: u.file, logs: u.logs }, t);
      const btn = canAct && u.folder ? `<button data-bug="${i}" ${tip(t, "liveStart")}>${escapeHtml(t.liveUnnamedStart)}</button>` : "";
      return `<div class="row tidy" ${tip(t, "liveRow")}><span class="tag" ${tip(t, "project", { name: u.projectName })}>${escapeHtml(u.projectName)}</span><span class="f" title="${escapeHtml(detail)}">${pillify(t, escapeHtml(detail))}</span>${btn}</div>`;
    })
    .join("");
  return collapsible({ id: "live", domId: "live-box", tipAttr: tip(t, "liveHeading"), head: `${escapeHtml(t.liveUnnamedHeading)} ${pill(t, list.length, "count", { count: list.length })}`, body: `<p class="note">${escapeHtml(t.liveUnnamedNote)}</p>${rows}` });
}

// The Profile picker: how strict the light is.
export function profilePicker(model: BoardModel, t: BoardStrings): string {
  const opts: Array<[string, string]> = [["rush", t.profileRush], ["deliberate", t.profileDeliberate], ["zero", t.profileZero]];
  return `<span class="seg" role="group" aria-label="${escapeHtml(t.profileLabel)}" title="${escapeHtml(t.profileLabel)}">${opts.map(([v, label]) => `<button class="sec" data-profile="${v}"${model.profile === v ? ' aria-pressed="true"' : ' aria-pressed="false"'} ${tip(t, "profile." + v)}>${escapeHtml(label)}</button>`).join("")}</span>`;
}

// Most folders listed in the "Documents with no rule" section; the rest are counted.
const NO_RULE_CAP = 30;

// The "Documents with no rule" section: always shown. It says what it is, how many documents
// no rule placed, and lists each folder with its document count. A folder row offers to add a
// rule for it and to preview what a rule would match; both carry only the row's index and the
// host resolves it against the list it rendered. With nothing to list it says so in a sentence.
export function noRuleBox(model: BoardModel, t: BoardStrings, names: Map<string, string>, canAct: boolean): string {
  const folders = model.needsRule;
  const total = folders.reduce((a, n) => a + n.count, 0);
  const head = `${escapeHtml(t.needsRuleHeading)} ${pill(t, total, "count", { count: total })}`;
  const section = (body: string, open: boolean): string => collapsible({ id: "norule", domId: "norule-box", tipAttr: tip(t, "noRuleHeading"), head, body, open });
  if (folders.length === 0) {
    return section(`<p class="note">${escapeHtml(pl(t, "noRuleEmpty"))}</p>`, true);
  }
  const rows = folders
    .slice(0, NO_RULE_CAP)
    .map((n, i) => {
      const project = names.get(n.project) ?? n.project;
      const folder = n.folder || "/";
      const count = pl(t, "noRuleCount", { count: n.count });
      const buttons = canAct ? `<button data-assign="${i}" ${tip(t, "noRuleAssignTip", { folder, file: RULES_PATH })}>${escapeHtml(pl(t, "noRuleAssign"))}</button><button class="sec" data-preview="${i}" ${tip(t, "noRulePreviewTip", { folder })}>${escapeHtml(pl(t, "noRulePreview"))}</button>` : "";
      return `<div class="row tidy" ${tip(t, "noRuleRow", { folder })}><span class="tag" ${tip(t, "project", { name: project })}>${escapeHtml(project)}</span><span class="f" ${titleAttr(folder)}>${escapeHtml(folder)}</span><span class="k" ${titleAttr(count)}>${pillify(t, escapeHtml(count))}</span>${buttons}</div>`;
    })
    .join("");
  const more = folders.length > NO_RULE_CAP ? `<p class="note">${pillify(t, escapeHtml(t.more.replace("{count}", String(folders.length - NO_RULE_CAP))))}</p>` : "";
  const rules = `<p class="note"><a class="doc" href="#" data-rules="1" ${titleAttr(RULES_PATH)}>${escapeHtml(t.ptgOpenRules)}</a></p>`;
  return section(`<p class="note">${escapeHtml(t.needsRuleNote)}</p>${rows}${more}${rules}`, folders.length <= 10);
}

// One box per outside source group. Items with a link carry only an index.
export function outsideBoxes(model: BoardModel, t: BoardStrings): string {
  return model.outside
    .map(
      (g, gi) =>
        collapsible({ id: "outside:" + g.id, tipAttr: tip(t, "outsideGroup", { label: g.label, count: g.items.length }), head: `${escapeHtml(g.label)} ${pill(t, g.items.length, "count", { count: g.items.length })}`, open: g.items.length <= 25, body: g.items
          .map((it, ii) => `<div class="cn${it.url ? " click ext" : ""}"${it.url ? ` tabindex="0" role="button" data-g="${gi}" data-i="${ii}"` : ""} ${tip(t, it.url ? "outsideLink" : "outsideItem")}><span class="f">${escapeHtml(it.title)}</span>${it.detail ? `<span class="k" ${tip(t, "outsideDetail", { detail: it.detail })}>${escapeHtml(it.detail)}</span>` : ""}</div>`)
          .join("") })
    )
    .join("");
}

// The collapsed box of linked documents: chains in finish order, Needs lines that need a look, and suggested links.
export function chains(model: BoardModel, t: BoardStrings): string {
  if (model.chains.length === 0 && model.flags.length === 0 && model.suggestions.length === 0) {
    return "";
  }
  const node = (n: BoardModel["chains"][number][number]): string =>
    `<div class="cn" ${tip(t, "chainNode")}><span class="tag" ${tip(t, "project", { name: n.project })}>${escapeHtml(n.project)}</span><span class="f">${n.id !== undefined ? docLink(n.title, n.path, `data-id="${n.id}"`) : escapeHtml(n.title)}</span></div>`;
  const chain = model.chains.map((c) => `<div class="chain" ${tip(t, "chain")}>${c.map(node).join("")}</div>`).join("");
  const flags = model.flags.length > 0 ? `<h3 ${tip(t, "flagsHeading")}>${escapeHtml(t.flagsHeading)}</h3><p class="note">${escapeHtml(t.flagsNote)}</p>${model.flags.map((f) => `<div class="cn" ${tip(t, "flagRow")}>${escapeHtml(f)}</div>`).join("")}` : "";
  const suggest =
    model.suggestions.length > 0
      ? `<h3 ${tip(t, "suggestHeading")}>${escapeHtml(t.suggestHeading)}</h3><p class="note">${escapeHtml(t.suggestNote)}</p>${model.suggestions
          .map(
            (s) =>
              `<div class="cn sug" ${tip(t, "suggestRow")}><i class="link suggest" ${glyphTip(t, "g.greyDiamondDashed", pl(t, "suggestMark"))}></i><span class="tag" ${tip(t, "project", { name: s.from.project })}>${escapeHtml(s.from.project)}</span><span class="f">${docLink(s.from.title, s.fromKey.slice(s.fromKey.indexOf("/") + 1), `data-id="${s.from.id}"`)}</span><span class="n" ${tip(t, "arrowWaits")}>&rarr;</span><span class="f">${docLink(s.to.title, s.toPath, `data-id="${s.to.id}"`)}</span><button data-suggest="${escapeHtml(s.key)}" data-decision="accept" ${tip(t, "suggestAccept")}>${escapeHtml(t.suggestAccept)}</button><button class="sec" data-suggest="${escapeHtml(s.key)}" data-decision="reject" ${tip(t, "suggestReject")}>${escapeHtml(t.suggestReject)}</button></div>`
          )
          .join("")}`
      : "";
  const head = model.chains.length > 0 ? `<p class="note">${escapeHtml(t.linkedNote)}</p>${chain}` : "";
  const name = model.chains.length > 0 ? t.linkedHeading : model.flags.length > 0 ? t.flagsHeading : t.suggestHeading;
  return `<details class="box" data-sec="linked" open><summary ${tip(t, "linkedSummary")}><i class="link open" aria-label="${escapeHtml(name)}" ${glyphTip(t, "g.amberDiamond", name)}></i> ${escapeHtml(name)}</summary>${head}${flags}${suggest}</details>`;
}

const lightKey = (l: "go" | "no-go" | "unverified"): string => (l === "go" ? "light.go" : l === "no-go" ? "light.noGo" : "light.unverified");

// One row above the projects per train: its name, one light (the worst of its members) and
// the order to ship in. It never carries a path.
export function trainBox(trains: Train[] | undefined, t: BoardStrings): string {
  if (!trains || trains.length === 0) {
    return "";
  }
  const word = { "no-go": t.noGo, unverified: t.unverified, go: t.go };
  const rows = trainRows(trains, { title: t.trainTitle, light: word, heldBy: t.trainHeldBy, cycle: t.trainCycle });
  return trains
    .map((tr, i) => {
      const rowTip = escapeHtml(rows[i].tooltip.join(" | "));
      const steps = tr.members
        .map((m, n) => `<span class="tag" ${tip(t, "trainStep", { n: n + 1 })}>${n + 1}</span><span class="f">${escapeHtml(m.name)}</span><span class="go ${m.light}" ${tip(t, lightKey(m.light))}>${escapeHtml(m.label)}</span>`)
        .join(`<span class="n" ${tip(t, "arrowThen")}>&rarr;</span>`);
      return `<div class="vd train" title="${rowTip}"><b class="pn" ${tip(t, "trainName")}>${fillT(t, t.trainTitle, { name: tr.name })}</b><span class="go ${tr.light}" ${tip(t, lightKey(tr.light))}>${escapeHtml(word[tr.light])}</span><span class="ord" role="group" aria-label="${escapeHtml(t.trainOrder)}" title="${escapeHtml(t.trainOrder)}">${steps}</span>${tr.cycle ? `<i class="info" ${glyphTip(t, "g.infoIcon", t.trainCycle)} aria-label="${escapeHtml(t.trainCycle)}"></i>` : ""}</div>`;
    })
    .join("");
}

// The strip at the top: what changed since the board was last seen. Text only, all escaped.
export function sinceBox(view: SinceView | undefined, t: BoardStrings): string {
  if (!view || view.lines.length === 0) {
    return "";
  }
  const rows = view.lines
    .map((l) => `<li>${pillify(t, escapeHtml(l.text))}${l.details.length > 0 ? `<ul class="sd">${l.details.map((d) => `<li>${escapeHtml(d)}</li>`).join("")}</ul>` : ""}</li>`)
    .join("");
  return collapsible({ id: "since", cls: "box since", tipAttr: tip(t, "sinceHeading"), head: escapeHtml(view.heading), body: `<ul class="sl">${rows}</ul>`, attrs: ` role="status" aria-label="${escapeHtml(view.heading)}"` });
}
