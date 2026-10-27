import { BoardModel } from "./boardModel";
import { SittingLine } from "./sittings";
import { Train, trainRows } from "./train";
import { SinceView } from "./sinceLast";
import { TidyReport } from "./tidy";
import { BoardStrings, escapeHtml, fill, handButton, liveLine } from "./boardHtmlUtil";

// The boxes around the project rows: sittings, tidy, unnamed crashes, trains, linked
// documents, outside sources and the strip of changes since the board was last seen.

// The Sittings box: toggles for what the owner has in hand, a time box, and one list of
// steps. Hidden until the "I have..." button opens it. Lines carry only an index; the host
// resolves it against the model it rendered.
export function sittingsBox(model: BoardModel, t: BoardStrings): string {
  const v = model.sittings;
  if (!v) {
    return "";
  }
  const toggle = (id: string, label: string): string => `<button data-have="${escapeHtml(id)}" aria-pressed="${v.have.includes(id)}" class="${v.have.includes(id) ? "on" : ""}">${escapeHtml(label)}</button>`;
  const boxes: Array<[string, string]> = [["any", t.timeAny], ...["15", "30", "60"].map((n): [string, string] => [n, t.timeMinutes.replace("{count}", n)])];
  const time = boxes.map(([n, label]) => `<button data-box="${n}" aria-pressed="${v.timeBox === n}" class="${v.timeBox === n ? "on" : ""}">${escapeHtml(label)}</button>`).join("");
  const line = (l: SittingLine, i: number): string =>
    `<div class="row" tabindex="0" role="button" data-step="${i}" title="${escapeHtml(l.docTitle + " - " + t.stepMinutes.replace("{count}", String(l.minutes)))}"><span class="tag">${escapeHtml(l.projectName)}</span><span class="f">${escapeHtml(l.text || l.heading || l.docTitle)}</span><span class="k">${escapeHtml(l.docTitle)}</span>${l.needs.length > 0 ? `<span class="k">${escapeHtml(l.needs.join(" + "))}</span>` : ""}<span class="k">${l.minutes}</span>${handButton(t, `data-hk="line" data-i="${i}"`)}</div>`;
  const doable = v.lines.slice(0, v.doable).map((l, i) => line(l, i)).join("");
  const rest = [
    v.more > 0 ? `<p class="note">${escapeHtml(t.sittingsMore.replace("{count}", String(v.more)))}</p>` : "",
    v.needOther > 0 ? `<p class="note">${escapeHtml(t.sittingsNeedOther.replace("{count}", String(v.needOther)))}</p>` : "",
    v.tooLong > 0 ? `<p class="note">${escapeHtml(t.sittingsTooLong.replace("{count}", String(v.tooLong)))}</p>` : "",
  ].join("");
  const body = v.have.length === 0 ? `<p class="note">${escapeHtml(t.sittingsPick)}</p>` : v.doable === 0 ? `<p class="note">${escapeHtml(t.sittingsNone)}</p>` : doable;
  const shownUntagged = v.lines.slice(v.doable).map((l, i) => line(l, v.doable + i)).join("");
  const untagged =
    v.untagged > 0
      ? `<details class="untag" id="sit-untag"><summary>${escapeHtml(t.sittingsUntagged.replace("{count}", String(v.untagged + v.untaggedMore)))}</summary><p class="note">${escapeHtml(t.sittingsUntaggedNote)}</p>${shownUntagged}</details>`
      : "";
  return `<section class="box" id="sit-panel" hidden><h2>${escapeHtml(t.sittingsHeading)}</h2><div class="seg" role="group">${v.contexts.map((c) => toggle(c.id, c.label)).join("")}</div> <div class="seg" role="group">${time}</div>${body}${rest}${untagged}</section>`;
}

// The words for one report candidate in the Tidy box. Already escaped.
function reportText(r: TidyReport, t: BoardStrings): string {
  switch (r.kind) {
    case "debt": {
      const word = r.trend === "up" ? t.tidyTrendUp : r.trend === "down" ? t.tidyTrendDown : r.trend === "same" ? t.tidyTrendSame : undefined;
      return word === undefined ? fill(t.tidyRepDebt, { count: r.count }) : fill(t.tidyRepDebtTrend, { count: r.count, trend: word });
    }
    case "branches":
      return fill(t.tidyRepBranches, { count: r.count });
    case "bloat":
      return fill(t.tidyRepBloat, { count: r.count });
    default:
      return fill(t.tidyRepBigFiles, { count: r.count });
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
      return `<div class="row tidy"><span class="tag">${escapeHtml(c.projectName)}</span><span class="f click" tabindex="0" role="button" data-id="${c.id}" title="${escapeHtml(c.path)}">${escapeHtml(c.title)}</span><span class="k">${escapeHtml(detail)}</span><button data-tidy="${i}">${escapeHtml(t.tidyMove)}</button></div>`;
    })
    .join("");
  const more = v.more > 0 ? `<p class="note">${escapeHtml(t.tidyMore.replace("{count}", String(v.more)))}</p>` : "";
  const repRows = reports
    .map((r, i) => `<div class="row tidy"><span class="tag">${escapeHtml(r.projectName)}</span><span class="f">${reportText(r, t)}</span><button data-tidyrep="${i}">${escapeHtml(t.tidyOpenReport)}</button></div>`)
    .join("");
  const repNote = reports.length > 0 ? `<p class="note">${escapeHtml(t.tidyReportsNote)}</p>` : "";
  const note = v.candidates.length > 0 ? `<p class="note">${escapeHtml(t.tidyNote.replace("{days}", String(v.afterDays)))}</p>` : "";
  return `<section class="box" id="tidy-box"><h2 title="${escapeHtml(t.tidyTitle.replace("{count}", String(v.candidates.length + v.more + reports.length)))}">${escapeHtml(t.tidyHeading)}</h2>${note}${rows}${more}${repNote}${repRows}</section>`;
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
      const btn = canAct && u.folder ? `<button data-bug="${i}">${escapeHtml(t.liveUnnamedStart)}</button>` : "";
      return `<div class="row tidy"><span class="tag">${escapeHtml(u.projectName)}</span><span class="f" title="${escapeHtml(detail)}">${escapeHtml(detail)}</span>${btn}</div>`;
    })
    .join("");
  return `<section class="box" id="live-box"><h2>${escapeHtml(t.liveUnnamedHeading)}</h2><p class="note">${escapeHtml(t.liveUnnamedNote)}</p>${rows}</section>`;
}

// The Profile picker: how strict the light is.
export function profilePicker(model: BoardModel, t: BoardStrings): string {
  const opts: Array<[string, string]> = [["rush", t.profileRush], ["deliberate", t.profileDeliberate], ["zero", t.profileZero]];
  return `<span class="seg" role="group" aria-label="${escapeHtml(t.profileLabel)}" title="${escapeHtml(t.profileLabel)}">${opts.map(([v, label]) => `<button data-profile="${v}"${model.profile === v ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"'}>${escapeHtml(label)}</button>`).join("")}</span>`;
}

// The collapsed list of folders where documents no rule placed sit, so the owner can add a rule.
export function needsRule(model: BoardModel, t: BoardStrings, names: Map<string, string>): string {
  if (model.needsRule.length === 0) {
    return "";
  }
  const rows = model.needsRule
    .map((n) => `<div class="cn rulefix click" tabindex="0" role="button" title="${n.count}"><i class="sq"></i><span class="tag">${escapeHtml(names.get(n.project) ?? n.project)}</span><span class="f">${escapeHtml(n.folder || "/")}</span></div>`)
    .join("");
  return `<details class="box"><summary><i class="sq" aria-label="${escapeHtml(t.needsRuleHeading)}" title="${escapeHtml(t.needsRuleHeading)}"></i></summary><h2>${escapeHtml(t.needsRuleHeading)}</h2><p class="note">${escapeHtml(t.needsRuleNote)}</p>${rows}</details>`;
}

// One box per outside source group. Items with a link carry only an index.
export function outsideBoxes(model: BoardModel): string {
  return model.outside
    .map(
      (g, gi) =>
        `<section class="box"><h2 title="${g.items.length}">${escapeHtml(g.label)}</h2>${g.items
          .map((it, ii) => `<div class="cn${it.url ? " click ext" : ""}"${it.url ? ` tabindex="0" role="button" data-g="${gi}" data-i="${ii}"` : ""}><span class="f">${escapeHtml(it.title)}</span>${it.detail ? `<span class="k">${escapeHtml(it.detail)}</span>` : ""}</div>`)
          .join("")}</section>`
    )
    .join("");
}

// The collapsed box of linked documents: chains in finish order, Needs lines that need a look, and suggested links.
export function chains(model: BoardModel, t: BoardStrings): string {
  if (model.chains.length === 0 && model.flags.length === 0 && model.suggestions.length === 0) {
    return "";
  }
  const node = (n: BoardModel["chains"][number][number]): string =>
    `<div class="cn"><span class="tag">${escapeHtml(n.project)}</span>${n.id !== undefined ? `<span class="f click" tabindex="0" role="button" data-id="${n.id}">${escapeHtml(n.title)}</span>` : `<span class="f">${escapeHtml(n.title)}</span>`}</div>`;
  const chain = model.chains.map((c) => `<div class="chain">${c.map(node).join("")}</div>`).join("");
  const flags = model.flags.length > 0 ? `<h3>${escapeHtml(t.flagsHeading)}</h3><p class="note">${escapeHtml(t.flagsNote)}</p>${model.flags.map((f) => `<div class="cn">${escapeHtml(f)}</div>`).join("")}` : "";
  const suggest =
    model.suggestions.length > 0
      ? `<h3>${escapeHtml(t.suggestHeading)}</h3><p class="note">${escapeHtml(t.suggestNote)}</p>${model.suggestions
          .map(
            (s) =>
              `<div class="cn sug"><i class="link suggest"></i><span class="tag">${escapeHtml(s.from.project)}</span><span class="f click" tabindex="0" role="button" data-id="${s.from.id}">${escapeHtml(s.from.title)}</span><span class="n">&rarr;</span><span class="f click" tabindex="0" role="button" data-id="${s.to.id}">${escapeHtml(s.to.title)}</span><button data-suggest="${escapeHtml(s.key)}" data-decision="accept">${escapeHtml(t.suggestAccept)}</button><button data-suggest="${escapeHtml(s.key)}" data-decision="reject">${escapeHtml(t.suggestReject)}</button></div>`
          )
          .join("")}`
      : "";
  const head = model.chains.length > 0 ? `<h2>${escapeHtml(t.linkedHeading)}</h2><p class="note">${escapeHtml(t.linkedNote)}</p>${chain}` : "";
  return `<details class="box"><summary><i class="link open" aria-label="${escapeHtml(t.linkedHeading)}" title="${escapeHtml(t.linkedHeading)}"></i></summary>${head}${flags}${suggest}</details>`;
}

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
      const tip = escapeHtml(rows[i].tooltip.join(" | "));
      const steps = tr.members
        .map((m, n) => `<span class="tag">${n + 1}</span><span class="f">${escapeHtml(m.name)}</span><span class="go ${m.light}" title="${escapeHtml(word[m.light])}">${escapeHtml(m.label)}</span>`)
        .join('<span class="n">&rarr;</span>');
      return `<div class="vd train" title="${tip}"><b class="pn">${fill(t.trainTitle, { name: tr.name })}</b><span class="go ${tr.light}">${escapeHtml(word[tr.light])}</span><span class="ord" aria-label="${escapeHtml(t.trainOrder)}">${steps}</span>${tr.cycle ? `<i class="info" title="${escapeHtml(t.trainCycle)}" aria-label="${escapeHtml(t.trainCycle)}"></i>` : ""}</div>`;
    })
    .join("");
}

// The strip at the top: what changed since the board was last seen. Text only, all escaped.
export function sinceBox(view: SinceView | undefined): string {
  if (!view || view.lines.length === 0) {
    return "";
  }
  const rows = view.lines
    .map((l) => `<li>${escapeHtml(l.text)}${l.details.length > 0 ? `<ul class="sd">${l.details.map((d) => `<li>${escapeHtml(d)}</li>`).join("")}</ul>` : ""}</li>`)
    .join("");
  return `<section class="box since" role="status"><h2>${escapeHtml(view.heading)}</h2><ul class="sl">${rows}</ul></section>`;
}
