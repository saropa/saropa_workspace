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
let panelOpen = false;
let firstScanDone = false;
const changed = new vscode.EventEmitter<void>();
const refreshAsked = new vscode.EventEmitter<void>();

export const onDidChangeBoard = changed.event;
// "Scan now" asked from the sidebar; the board tab answers it when open, else the background scan does.
export const onDidAskRefresh = refreshAsked.event;

export const currentBoard = (): BoardSnapshot | undefined => board;
export const isScanning = (): boolean => scanning;
export const isFirstScanDone = (): boolean => firstScanDone;
export const isPanelOpen = (): boolean => panelOpen;

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

export function setPanelOpen(open: boolean): void {
  panelOpen = open;
}

export function askRefresh(): void {
  refreshAsked.fire();
}

export function disposeFeed(): void {
  changed.dispose();
  refreshAsked.dispose();
}
