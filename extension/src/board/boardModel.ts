import { globToRegExp } from "./glob";
import { ProjectHealth } from "./health";
import { Profile, Severity, asProfile, stops } from "./severity";
import { customizedParts } from "./severityEdit";
import { SafetyResult } from "./safety";
import { orderLists } from "./boardOrder";
import { buildOrg } from "./boardOrg";
import { buildProposals, linkDocsOf } from "./boardProposals";
import { mergeNeeds, stepMinutes, stepNeeds } from "./needs";
import { Link, resolveLinks } from "./links";
import { OrgSettings, settingsOf } from "./org/settings";
import { finishedTargets } from "./ganttModel";
import { ScanSnapshot } from "./scanner";
import { askOf } from "./blockersAsk";
import { answerOptions, attachOrder } from "./orderModel";
import { pickInProgress } from "./inProgress";
import { attachChats, attachLinks, attachLive, buildChainSteps, buildSuggestions, buildTidyView, collectNeeds, linkFlags, needsRuleFolders } from "./boardModelLinks";
import { BoardConfig, Classified, ProjectDef, emptyCounts } from "./types";
import { BoardExtra, BoardItem, BoardModel, BoardProject, UnverifiedReason } from "./boardModelParts";
import { noGoCause } from "./lightCause";
import { OPEN, effectiveSeverity, factsFor, itemKey, revFor, marksOf, sittingsView, statusChosen, titleFromPath, userSeverities, userStatuses } from "./boardModelParts";

// The board's view model: what the first screen shows, built from classified rows.
// Pure, so the rules for the light are unit-tested without a webview.
//
// The light is honest. NO-GO when anything is in a red folder or an open document stops
// the release under the profile. UNVERIFIED (amber) only when the board could not read
// something: an open document whose severity is unknown, or a scan that is not accepted.
// Open work, unsorted documents and missing lint or test results are never amber; the
// board lists them as notes. Everything else is GO.

// Existing import paths keep working: the shapes and the title helper live in their own
// modules and are re-exported here.
export type { Light, UnverifiedReason, GroupView, BoardItem, ItemMarks, BoardProject, ChainStep, SittingsView, BoardModel, BoardExtra } from "./boardModelParts";
export { titleFromPath } from "./boardModelParts";

const ORDER: Record<string, number> = { red: 0, purple: 1, amber: 2 };
const SEV_ORDER: Record<string, number> = { extreme: 0, critical: 1, high: 2, medium: 3, low: 4 };
// Open steps kept on an item for the hand-off.
const HANDOFF_STEPS = 10;
const IMPORTANCE: Record<string, number> = { high: 0, normal: 1, low: 2 };

// What the build of every project needs to look at, gathered once. Exported for the
// helpers in boardModelLinks.ts (type import only).
export interface BuildContext {
  cfg: BoardConfig;
  rows: Classified[];
  snapshot?: ScanSnapshot;
  previous?: ScanSnapshot;
  health?: Record<string, ProjectHealth>;
  accepted: boolean;
  profile: Profile;
  names: Map<string, string>;
  exactPins: Set<string>;
  pinGlobs: RegExp[];
  // Project ids whose owner answered "which items block the next release".
  answered: Set<string>;
  seen: Record<string, string[]>;
  // Severities chosen by the user, and a count of the ones applied to open documents.
  overrides: Map<string, Severity>;
  statusKeys: Set<string>;
  byUser: { count: number; lowered: number };
  // Tags, link phrases and naming from the rules file `organize` key, for the auto-grouping and link engines.
  org: OrgSettings;
}

// The open items of one project, sorted, with its counts and its collapsed blocked documents.
function collectItems(def: ProjectDef, ctx: BuildContext): { items: BoardItem[]; counts: ReturnType<typeof emptyCounts>; blocked: number; blockedStop: number } {
  const counts = emptyCounts();
  const items: BoardItem[] = [];
  let blocked = 0;
  let blockedStop = 0;
  const dict = mergeNeeds(ctx.cfg.needs);
  const answered = ctx.answered.has(def.id);
  for (const r of ctx.rows) {
    if (r.project !== def.id) {
      continue;
    }
    counts[r.status] += 1;
    const pinned = ctx.exactPins.has(def.id + "/" + r.path) || ctx.pinGlobs.some((re) => re.test(def.id + "/" + r.path));
    // A deferred (blue) document the owner pinned as blocking the next release is
    // work that must land first, so it is collected as open (amber). Without this a
    // pinned PLAN_ document was skipped here and could never block. Counts above
    // still record it as blue.
    const status = pinned && r.status === "blue" ? "amber" : r.status;
    if (!OPEN.has(status)) {
      continue;
    }
    const facts = factsFor(ctx.snapshot, def.id, r.path);
    const rev = revFor(ctx.snapshot, def.id, r.path);
    const sev = effectiveSeverity(ctx.overrides, def.id, r.path, facts);
    if (sev.byUser) {
      ctx.byUser.count += 1;
      // A severity the user lowered below a level that stops the release is counted and shown.
      if (!pinned && sev.auto !== undefined && stops(ctx.profile, sev.auto) && !stops(ctx.profile, sev.severity as Severity)) {
        ctx.byUser.lowered += 1;
      }
    }
    if (status === "amber" && r.note === "blocked" && !pinned) {
      // A waiting document is collapsed into one mark, but one that would stop a
      // release under the profile still counts toward NO-GO (in an answered project only pinned ones block, and they are listed).
      blocked += 1;
      if (!answered && sev.severity !== undefined && stops(ctx.profile, sev.severity)) {
        blockedStop += 1;
      }
      continue;
    }
    const stopping = pinned || (sev.severity !== undefined && stops(ctx.profile, sev.severity));
    items.push({
      id: -1,
      project: def.id,
      path: r.path,
      title: facts?.title || titleFromPath(r.path),
      status: status as "red" | "amber" | "purple",
      kind: r.kind,
      ...(rev ? { rev } : {}),
      marks: facts ? marksOf(facts, ctx.names) : undefined,
      ...(facts?.steps?.length ? { steps: facts.steps.slice(0, HANDOFF_STEPS).map((x) => ({ line: x.line, text: x.text })) } : {}),
      ...(facts?.steps?.length ? { openMinutes: facts.steps.reduce((sum, x) => sum + stepMinutes(x.text, stepNeeds(x, dict), dict), 0) } : {}),
      hub: false,
      blocksCount: 0,
      waitsOn: [],
      severity: sev.severity,
      ...(sev.byUser ? { severityByUser: true } : {}),
      ...(statusChosen(ctx.statusKeys, r) ? { statusByUser: true } : {}),
      audience: facts?.audience,
      pinned,
      stopping,
      blocks: answered ? pinned : status === "red" || stopping,
      ...(answered ? { answered: true as const } : {}),
    });
  }
  items.sort(
    (a, b) =>
      (answered ? Number(b.blocks) - Number(a.blocks) : 0) ||
      ORDER[a.status] - ORDER[b.status] ||
      Number(b.pinned) - Number(a.pinned) ||
      (SEV_ORDER[a.severity ?? "medium"] ?? 3) - (SEV_ORDER[b.severity ?? "medium"] ?? 3) ||
      a.path.localeCompare(b.path)
  );
  return { items, counts, blocked, blockedStop };
}

// Builds one project's row and adds its items to `all`, giving each the next id.
function buildProject(def: ProjectDef, ctx: BuildContext, all: BoardItem[]): BoardProject {
  const lowBefore = ctx.byUser.lowered;
  const { items, counts, blocked, blockedStop } = collectItems(def, ctx);
  const lowered = ctx.byUser.lowered - lowBefore;
  for (const it of items) {
    it.id = all.length;
    all.push(it);
  }
  const reasons: UnverifiedReason[] = [];
  if (!ctx.accepted) {
    reasons.push("baseline");
  }
  if (counts.grey > 0) {
    reasons.push("grey");
  }
  const h = ctx.health?.[def.id];
  if (!h?.clean) {
    reasons.push("health");
  }
  if (items.some((i) => i.severity === undefined)) {
    reasons.push("unread");
  }
  // A scan held by the safety check must never hide red work the accepted scan had.
  const answered = ctx.answered.has(def.id);
  const ask = askOf(items, answered, ctx.seen[def.id]);
  // The held-scan rule only applies to an unanswered project; the flag is also stored so lightCause names it.
  const heldScanRed = !answered && !ctx.accepted && (ctx.previous?.projects[def.id]?.counts.red ?? 0) > 0;
  // One blocker test shared with lightCause (lightCause.ts): the light is NO-GO exactly when it yields a cause,
  // so the red light and the reason shown beside it cannot disagree.
  const blocker =
    noGoCause({ answered, health: h, blocking: items.filter((i) => i.blocks).length, blockedStop, red: counts.red, heldScanRed }) !== undefined;
  return {
    id: def.id,
    name: def.name ?? def.id,
    // Amber only when something could not be read (unread severity, scan not accepted). "grey" and "health" stay in `reasons` as notes.
    light: blocker ? "no-go" : reasons.includes("unread") || reasons.includes("baseline") ? "unverified" : "go",
    ...(heldScanRed ? { heldScanRed: true as const } : {}),
    health: h,
    reasons,
    items,
    blocked,
    blockedStopping: blockedStop,
    ...(answered ? { answered: true as const } : {}),
    ...(ask ? { ask } : {}),
    ...(lowered > 0 ? { loweredByUser: lowered } : {}),
    counts,
    dependsOn: def.dependsOn ?? [],
    ...(def.extra ? { extra: true } : {}),
  };
}

// A link the user accepted but the document text does not carry is mark-only: it shows, but the text is not the source.
function markOnlyLinks(links: Link[], inText: Map<string, string[]>): void {
  for (const l of links) {
    if (!inText.get(itemKey(l.fromProject, l.fromPath))?.includes(l.target)) {
      l.markOnly = true;
    }
  }
}

// Items that already wait on something and still have candidates to wait on get the "make dependency" affordance.
function flagMakeDep(all: BoardItem[], links: Link[]): void {
  for (const it of all) {
    if ((it.after ?? []).length > 0 && answerOptions(links, all, it).length > 0) {
      it.makeDep = true;
    }
  }
}

// Gathers what every project build reads once: names, pins, overrides and settings.
function makeContext(cfg: BoardConfig, rows: Classified[], accepted: boolean, snapshot: ScanSnapshot | undefined, previous: ScanSnapshot | undefined, health: Record<string, ProjectHealth> | undefined, extra: BoardExtra | undefined): BuildContext {
  const profile: Profile = asProfile(cfg.profile);
  return {
    cfg,
    rows,
    snapshot,
    previous,
    health,
    accepted,
    profile,
    names: new Map(cfg.projects.map((p) => [p.id, p.name ?? p.id])),
    // Hand pins are exact documents; the rules file's pins are globs.
    exactPins: new Set(extra?.pins ?? []),
    overrides: userSeverities(cfg),
    statusKeys: userStatuses(cfg),
    byUser: { count: 0, lowered: 0 },
    org: settingsOf(cfg.organize),
    answered: new Set(extra?.answered ?? []),
    seen: extra?.seen ?? {},
    pinGlobs: (Array.isArray(cfg.pinned) ? cfg.pinned : []).filter((g): g is string => typeof g === "string").map(globToRegExp),
  };
}

// The open workspace's projects first, then the extra ones; importance orders within each.
function orderedDefs(cfg: BoardConfig): ProjectDef[] {
  return [...cfg.projects].sort((a, b) => Number(a.extra === true) - Number(b.extra === true) || (IMPORTANCE[a.importance ?? "normal"] ?? 1) - (IMPORTANCE[b.importance ?? "normal"] ?? 1));
}

// Dashed suggestions and solid proposals together: a proposal needs the suggestion keys to
// avoid duplicating them, and a pair shown as a proposal is dropped from the dashed list.
function suggestionsAndProposals(
  all: BoardItem[],
  links: Link[],
  byKey: Map<string, BoardItem>,
  names: Map<string, string>,
  cfg: BoardConfig,
  snapshot: ScanSnapshot | undefined,
  extra: BoardExtra | undefined
): { suggestions: ReturnType<typeof buildSuggestions>; proposals: ReturnType<typeof buildProposals> } {
  const dashed = buildSuggestions(all, links, byKey, names, snapshot, extra?.rejected);
  const proposals = buildProposals(all, snapshot, cfg, links, extra?.rejected, new Set(dashed.map((s) => s.key)));
  const proposed = new Set(proposals.map((p) => p.key));
  return { suggestions: dashed.filter((s) => !proposed.has(s.key)), proposals };
}

// Targets whose work is finished, titled from the scan when it knows the document. Reference
// documents are excluded by the callback because they are never "done".
function finishedOf(links: Link[], rows: Classified[], snapshot: ScanSnapshot | undefined): ReturnType<typeof finishedTargets> {
  const reference = new Set(rows.filter((r) => r.status === "reference").map((r) => r.project + "	" + r.path));
  return finishedTargets(links, (project, path) => factsFor(snapshot, project, path)?.title || titleFromPath(path), (project, path) => reference.has(project + "	" + path));
}

// Builds the board model from the classified rows, the safety verdict, the accepted flag and the optional evidence.
export function buildBoard(
  cfg: BoardConfig,
  rows: Classified[],
  safety: SafetyResult | undefined,
  accepted: boolean,
  snapshot?: ScanSnapshot,
  previous?: ScanSnapshot,
  health?: Record<string, ProjectHealth>,
  extra?: BoardExtra
): BoardModel {
  const all: BoardItem[] = [];
  const ctx = makeContext(cfg, rows, accepted, snapshot, previous, health, extra);
  const projects = orderedDefs(cfg).map((def) => buildProject(def, ctx, all));
  // Groups, linkages and chains need every open item, so they are computed once all
  // projects are built.
  const order = orderLists(cfg.order);
  const links = resolveLinks(rows, collectNeeds(rows, snapshot, extra?.needs), cfg.projects);
  const grouping = buildOrg(rows, snapshot, cfg, links, extra?.orgPrevious);
  markOnlyLinks(links, collectNeeds(rows, snapshot, undefined));
  const byKey = new Map(all.map((it) => [itemKey(it.project, it.path), it]));
  attachLinks(all, links, grouping, byKey);
  attachOrder(projects, all, extra?.order);
  flagMakeDep(all, links);
  const { suggestions, proposals } = suggestionsAndProposals(all, links, byKey, ctx.names, cfg, snapshot, extra);
  attachChats(all, extra?.outside);
  const liveUnnamed = extra?.live ? attachLive(all, ctx, extra.live) : undefined;
  const customParts = customizedParts(cfg.severity);
  const finished = finishedOf(links, rows, snapshot);
  return {
    tidy: extra?.tidy ? buildTidyView(all, ctx, extra.tidy) : undefined,
    inProgress: extra?.inProgress ? pickInProgress(all, new Set(extra.inProgress.edited), extra.inProgress.max) : undefined,
    liveUnnamed,
    sittings: extra?.sittings ? sittingsView(cfg, rows, snapshot, byKey, extra.sittings) : undefined,
    projects,
    orgLayouts: grouping.layouts,
    orgDocs: grouping.docs,
    linkCtx: { docs: linkDocsOf(all, snapshot), existing: links.filter((l) => l.toProject && l.toPath), rejected: extra?.rejected ?? [] },
    ...(finished.length > 0 ? { finished } : {}),
    ...(cfg.skipped && cfg.skipped.length > 0 ? { skipped: cfg.skipped } : {}),
    ...(cfg.hidden && cfg.hidden > 0 ? { hidden: cfg.hidden } : {}),
    ...(customParts.length > 0 ? { severityCustom: customParts } : {}),
    chains: buildChainSteps(links, byKey, ctx.names),
    links,
    flags: linkFlags(links, ctx.names),
    items: all,
    ...(Object.keys(order).length > 0 ? { order } : {}),
    // Once the user accepts (or the scan was clean) neither banner shows.
    safetyHold: !accepted && safety !== undefined && !safety.baseline && !safety.clean,
    baseline: !accepted && (safety?.baseline ?? false),
    profile: ctx.profile,
    suggestions,
    proposals,
    rejectedCount: extra?.rejected?.length ?? 0,
    sharedRejectedCount: extra?.sharedRejected ?? 0,
    outside: extra?.outside?.groups ?? [],
    needsRule: needsRuleFolders(cfg, snapshot),
    ...(ctx.byUser.count > 0 ? { byUser: ctx.byUser } : {}),
  };
}
