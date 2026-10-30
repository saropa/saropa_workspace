import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";
import type { BoardItem, BoardModel } from "../board/boardModel";
import { Link, needTarget, wouldCircle } from "../board/links";
import { readsNeeds } from "../board/docFacts";
import { BoardRun } from "../commands/boardScanStore";
import { DocRef, NeedsChange } from "../commands/boardNeeds";

// The Waits on and Blocks pickers of the Release Board row menu. The row is the one this panel
// painted; the candidates are the open items of that model, so the page never names a document.

// "waits": this item gets the line. "blocks": the chosen item gets the line, naming this one.
export type NeedsDirection = "waits" | "blocks";

// What the person decided: the document that gets the change, the change, and the words for Undo.
export interface NeedsPick {
  doc: DocRef;
  change: NeedsChange;
  label: string;
}

interface Pick extends vscode.QuickPickItem {
  // The candidate to link, or the link to remove.
  item?: BoardItem;
  link?: Link;
}

const SHAPES: Record<string, string> = { red: "●", amber: "◆", purple: "◐" };
const node = (i: DocRef): DocRef => ({ project: i.project, path: i.path });

// Asks which document to link or which link to remove, shows the line that would be written, and
// asks to confirm an addition. Returns undefined when cancelled or refused.
export async function pickNeeds(run: BoardRun, model: BoardModel, item: BoardItem, dir: NeedsDirection): Promise<NeedsPick | undefined> {
  const byKey = new Map(model.items.map((i) => [i.project + "\t" + i.path, i]));
  const at = (project: string, path: string): BoardItem | undefined => byKey.get(project + "\t" + path);
  // The links of this document in the chosen direction: what it waits on, or what waits on it.
  const mine = model.links.filter((l) => (dir === "waits" ? l.fromProject === item.project && l.fromPath === item.path : l.toProject === item.project && l.toPath === item.path));
  const other = (l: Link): BoardItem | undefined => (dir === "waits" ? (l.toProject && l.toPath ? at(l.toProject, l.toPath) : undefined) : at(l.fromProject, l.fromPath));
  const linked = new Set(mine.map((l) => other(l)?.id));
  // Only a link a Needs line holds can be removed here: an accepted link has no line to take out.
  const picks: Pick[] = mine
    .filter((l) => !l.markOnly && readsNeeds(l.fromPath))
    .map((link) => {
      const o = other(link);
      return { label: l10n("releaseBoard.needs.remove", { name: o?.title ?? link.target }), description: link.state === "open" ? "" : l10n("releaseBoard.needs.state." + link.state), link };
    });
  const projects = new Map(model.projects.map((p) => [p.id, p.name]));
  // Proposed links for this document come first, with the reason as the detail line.
  const me = `${item.project}:${item.path}`;
  const proposed = new Map(model.proposals.filter((p) => (dir === "waits" ? p.item : p.on) === me).map((p) => [dir === "waits" ? p.on : p.item, p]));
  const rank = (x: BoardItem): number => (proposed.has(`${x.project}:${x.path}`) ? 0 : 1);
  for (const i of model.items.filter((x) => x.id !== item.id && !linked.has(x.id) && (dir === "waits" || readsNeeds(x.path))).sort((a, b) => rank(a) - rank(b) || a.project.localeCompare(b.project) || a.title.localeCompare(b.title))) {
    const p = proposed.get(`${i.project}:${i.path}`);
    picks.push(p
      ? { label: `${SHAPES[i.status] ?? "○"} ${i.title}`, description: l10n("releaseBoard.needs.proposed", { confidence: l10n(`releaseBoard.linkConfidence.${p.confidence}`) }) + " · " + (projects.get(i.project) ?? i.project), detail: p.why, item: i }
      : { label: `${SHAPES[i.status] ?? "○"} ${i.title}`, description: projects.get(i.project) ?? i.project, detail: i.path, item: i });
  }
  const chosen = await vscode.window.showQuickPick(picks, { title: l10n(dir === "waits" ? "releaseBoard.needs.titleWaits" : "releaseBoard.needs.titleBlocks", { title: item.title }), placeHolder: l10n("releaseBoard.needs.search"), matchOnDescription: true, matchOnDetail: true });
  if (!chosen) {
    return undefined;
  }
  if (chosen.link) {
    const o = other(chosen.link);
    // Taking away a link edits the document that holds the line.
    const doc = dir === "waits" ? item : at(chosen.link.fromProject, chosen.link.fromPath);
    return doc ? { doc: node(doc), change: { kind: "remove", target: chosen.link.target }, label: l10n("releaseBoard.needs.undoRemove", { title: doc.title, name: o?.title ?? chosen.link.target }) } : undefined;
  }
  const to = chosen.item as BoardItem;
  const [from, onto] = dir === "waits" ? [item, to] : [to, item];
  if (wouldCircle(model.links, node(from), node(onto))) {
    void vscode.window.showInformationMessage(l10n("releaseBoard.needs.circle", { from: from.title, to: onto.title }));
    return undefined;
  }
  const target = needTarget(run.result.rows, run.cfg.projects, node(from), node(onto));
  if (target === undefined) {
    void vscode.window.showInformationMessage(l10n("releaseBoard.needs.unnamed", { to: onto.title }));
    return undefined;
  }
  const add = l10n("releaseBoard.needs.add");
  if ((await vscode.window.showInformationMessage(l10n("releaseBoard.needs.preview", { line: `Needs: ${target}`, title: from.title }), { modal: true }, add)) !== add) {
    return undefined;
  }
  return { doc: node(from), change: { kind: "add", target, to: node(onto) }, label: l10n("releaseBoard.needs.undoAdd", { title: from.title, name: onto.title }) };
}
