import * as vscode from "vscode";
import { BoardModel } from "../board/boardModel";
import type { BoardRun } from "../commands/releaseBoardCommands";

// One small publisher for the Release Board model. Whoever scans (the board tab while it
// is open, the background scan otherwise) publishes here; the sidebar, the status bar light
// and the editor lines only listen. It holds no scan logic of its own.

export interface BoardSnapshot {
  // Changes with every publish, so a click on a stale row can be told apart.
  stamp: number;
  model: BoardModel;
  run: BoardRun;
}

let board: BoardSnapshot | undefined;
let stamp = 0;
let scanning = false;
// The board tab is showing (not hidden behind another tab, not closed).
let panelVisible = false;
// A board tab has been opened in this window, by hand or at startup.
let panelOpened = false;
let firstScanDone = false;
// The last scan failed; the previous board, if any, stays on screen.
let failed = false;
const changed = new vscode.EventEmitter<void>();
const refreshAsked = new vscode.EventEmitter<void>();
const visibility = new vscode.EventEmitter<boolean>();

export const onDidChangeBoard = changed.event;
// "Scan now" asked from the sidebar; the board tab answers it when open, else the background scan does.
export const onDidAskRefresh = refreshAsked.event;

export const onDidChangePanelVisible = visibility.event;

export const currentBoard = (): BoardSnapshot | undefined => board;
export const isScanning = (): boolean => scanning;
export const isFirstScanDone = (): boolean => firstScanDone;
// True only while the board tab is showing: it then owns the scan.
export const isPanelVisible = (): boolean => panelVisible;
export const hasPanelOpened = (): boolean => panelOpened;
export const hasFailed = (): boolean => failed;

export function setBoard(model: BoardModel | undefined, run: BoardRun | undefined): void {
  board = model && run ? { stamp: ++stamp, model, run } : undefined;
  changed.fire();
}

export function setScanning(on: boolean): void {
  scanning = on;
  if (!on) {
    firstScanDone = true;
  }
  changed.fire();
}

// A scan ended (the tab's or the background one), which ends the sidebar's loading state.
export function markScanDone(): void {
  firstScanDone = true;
  changed.fire();
}

export function setFailed(on: boolean): void {
  if (failed !== on) {
    failed = on;
    changed.fire();
  }
}

export function setPanelVisible(visible: boolean): void {
  panelOpened = panelOpened || visible;
  if (panelVisible !== visible) {
    panelVisible = visible;
    visibility.fire(visible);
  }
}

// Called when a tab is created, even if it opens in the background.
export function markPanelOpened(): void {
  panelOpened = true;
}

export function askRefresh(): void {
  refreshAsked.fire();
}

export function disposeFeed(): void {
  changed.dispose();
  refreshAsked.dispose();
  visibility.dispose();
}
