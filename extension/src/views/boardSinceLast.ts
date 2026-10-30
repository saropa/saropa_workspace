import * as vscode from "vscode";
import { BoardModel } from "../board/boardModel";
import { SeenRecord, SinceLabels, SinceLast, SinceView, clampListed, diffSeen, digestOf, readSeen, sinceLines } from "../board/sinceLast";
import { l10n } from "../i18n/l10n";
import { currentBoard, isStoredOnly, onDidChangeBoard } from "./boardFeed";

// "Since you last looked", host side. It keeps the last seen record in workspace state
// (extension storage, never a document), decides when the board counts as seen, and hands
// the sidebar, the status bar tooltip and the board page the same change.
//
// Seen means: the owner dismissed the strip on the board (or pressed "mark as seen" on the
// sidebar). Then the record is written, the baseline moves to it and everything clears. There
// is no timer: the strip and the change log stay until dismissed. The very first board is
// recorded silently: there is nothing to compare it with.

const SETTINGS = "saropaWorkspace.releaseBoard";
const KEY = "saropaWorkspace.releaseBoard.sinceLast.seen";

const changed = new vscode.EventEmitter<void>();
// Fires when the baseline moved or the setting changed.
export const onDidChangeSinceLast = changed.event;

let store: vscode.Memento | undefined;
// The record changes are measured against.
let seen: SeenRecord | undefined;

function save(rec: SeenRecord): void {
  void Promise.resolve(store?.update(KEY, rec)).catch(() => undefined);
}

const on = (): boolean => {
  const c = vscode.workspace.getConfiguration(SETTINGS);
  return c.get<boolean>("enabled", true) && c.get<boolean>("sinceLast.enabled", true);
};

// How many changes are listed before "and more"; clamped.
export const maxListed = (): number => clampListed(vscode.workspace.getConfiguration(SETTINGS).get("sinceLast.maxListed", 5));

function labels(): SinceLabels {
  return {
    newOne: l10n("releaseBoard.sinceLast.newOne"),
    newMany: l10n("releaseBoard.sinceLast.newMany", { count: "{count}" }),
    clearedOne: l10n("releaseBoard.sinceLast.clearedOne"),
    clearedMany: l10n("releaseBoard.sinceLast.clearedMany", { count: "{count}" }),
    lightMoved: l10n("releaseBoard.sinceLast.lightMoved", { from: "{from}", to: "{to}" }),
    more: l10n("releaseBoard.sinceLast.more", { count: "{count}" }),
    reportStandup: l10n("releaseBoard.sinceLast.reportStandup", { count: "{count}" }),
    reportDelta: l10n("releaseBoard.sinceLast.reportDelta", { count: "{count}" }),
    light: { "no-go": l10n("releaseBoard.panel.noGo"), unverified: l10n("releaseBoard.panel.unverified"), go: l10n("releaseBoard.panel.go") },
  };
}

// The time of the last look in the user's own format.
// Within the last 6 days the weekday and time; older, the date and time.
export function whenText(since: number, now = Date.now()): string {
  const recent = now - since < 6 * 24 * 3600 * 1000;
  return new Date(since).toLocaleString(undefined, recent ? { weekday: "short", hour: "2-digit", minute: "2-digit" } : { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// The change on the sidebar and in the status bar: the published board against the baseline.
// Nothing while the setting is off or while only a stored result is on screen.
export function currentChange(): SinceLast | undefined {
  const board = currentBoard();
  if (!on() || !board || isStoredOnly()) {
    return undefined;
  }
  return diffSeen(seen, digestOf(board.model, Date.now(), seen));
}

// The change as sidebar lines.
export function sidebarLines(change: SinceLast): ReturnType<typeof sinceLines> {
  return sinceLines(change, labels(), maxListed());
}

// The strip for the board page, from the model the page is drawing. Only for a finished board.
export function viewFor(model: BoardModel): SinceView | undefined {
  if (!on()) {
    return undefined;
  }
  const change = diffSeen(seen, digestOf(model, Date.now(), seen));
  return change ? { heading: l10n("releaseBoard.sinceLast.heading", { time: whenText(change.since) }), lines: sinceLines(change, labels(), maxListed()), marked: change.changes.flatMap((c) => c.addedKeys) } : undefined;
}

// The tab painted a finished board. The very first board is the baseline at once; after that
// only a dismiss moves it.
export function panelShowed(model: BoardModel): void {
  if (on() && !seen) {
    seen = digestOf(model, Date.now());
    save(seen);
  }
}

// The sidebar's "mark as seen" button: the board as published becomes the baseline.
// The board page passes the model it drew, so the baseline matches what the person saw.
export function markSeenNow(model?: BoardModel): void {
  const board = currentBoard();
  if (on() && board && !isStoredOnly()) {
    seen = digestOf(model ?? board.model, Date.now(), seen);
    save(seen);
    changed.fire();
  }
}

// Loads the last seen record and registers the "mark as seen" command.
export function registerSinceLast(context: vscode.ExtensionContext): void {
  store = context.workspaceState;
  seen = readSeen(store.get(KEY));
  context.subscriptions.push(
    changed,
    // The first board of a workspace is recorded silently.
    onDidChangeBoard(() => {
      const board = currentBoard();
      if (!seen && board && on() && !isStoredOnly()) {
        seen = digestOf(board.model, Date.now());
        save(seen);
      }
    }),
    vscode.commands.registerCommand("saropaWorkspace.releaseBoard.sinceLast.markSeen", () => markSeenNow()),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration(`${SETTINGS}.sinceLast`) && changed.fire())
  );
}
