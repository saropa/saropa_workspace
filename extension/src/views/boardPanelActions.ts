import * as vscode from "vscode";
import { BoardRun, logBoardError } from "../commands/releaseBoardCommands";
import { BoardModel } from "../board/boardModel";
import type { BoardExtra } from "../board/boardModelParts";
import { PathToGo, clampMaxSteps } from "../board/pathToGo";
import { escapeHtml } from "../board/boardHtml";
import { l10n } from "../i18n/l10n";
import { safeUrl } from "../board/outside";
import { readSittingsSettings, readSittingsChoice, saveSittingsChoice } from "../commands/boardSittings";
import { asTimeBox } from "../board/sittings";
import { readTidySettings } from "../commands/boardTidy";
import { LiveSettings, liveFold, readLiveSettings } from "../commands/boardLive";
import { LiveSignals } from "../board/liveEvidence";
import { updateLocalMarks } from "../commands/boardMarks";
import { addRejected } from "../board/marks";
import { readInProgressSettings } from "../commands/boardInProgress";
import { chooseDocumentColumn, parseOpenBeside } from "../board/openBeside";
import { parsePlacement } from "../board/placement";

// Helpers for the Release Board panel: the settings it reads, the page for a disabled
// board, and the handlers for the page's messages. Each handler resolves the page's
// indexes against the model the panel rendered; none of them reads a path from the page.

// Path to GO settings, read from the editor settings. Undefined when the feature is off.
export function pathSettings(): { maxSteps: number; showRunButtons: boolean } | undefined {
  const c = vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard.pathToGo");
  if (!c.get<boolean>("enabled", true)) {
    return undefined;
  }
  return { maxSteps: clampMaxSteps(c.get<number>("maxSteps", 8)), showRunButtons: c.get<boolean>("showRunButtons", true) };
}

/** A bare page with one escaped line of text, for a board that has nothing to show. */
export function emptyPage(text: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"></head><body style="font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:16px"><p>${escapeHtml(text)}</p></body></html>`;
}

// The Sittings choice (remembered per machine, else the settings' defaults) with the
// settings' limits; undefined when the feature is off. With no remembered choice and no
// default list, `have` is left out and the board treats every context as in hand, so nothing
// is hidden until the user changes a choice.
export function sittingsInput(context: vscode.ExtensionContext): NonNullable<BoardExtra["sittings"]> | undefined {
  const s = readSittingsSettings();
  if (!s.enabled) {
    return undefined;
  }
  const choice = readSittingsChoice(context);
  const have = choice ? choice.have : s.defaultHave.length > 0 ? s.defaultHave : undefined;
  return { selection: { have, timeBox: choice ? choice.timeBox : s.defaultTimeBox, maxSteps: s.maxSteps }, onlyOwner: s.onlyOwnerDocuments };
}

const ORG_KEY = "saropaWorkspace.releaseBoard.orgLayouts";

// Band and MAX of each project from the last build, so the group layout stays stable between builds.
export function orgPreviousInput(context: vscode.ExtensionContext): BoardExtra["orgPrevious"] {
  return context.workspaceState.get<BoardExtra["orgPrevious"]>(ORG_KEY);
}

// Remembers the layout of this build for the next one.
export function saveOrgLayouts(context: vscode.ExtensionContext, model: BoardModel): void {
  const out = Object.fromEntries(Object.entries(model.orgLayouts ?? {}).map(([p, l]) => [p, { band: l.band, max: l.max }]));
  if (JSON.stringify(out) !== JSON.stringify(orgPreviousInput(context) ?? {})) {
    void context.workspaceState.update(ORG_KEY, out);
  }
}

// The In progress input: the edited documents the panel found and the list limit; undefined
// when the feature is off (the list is then every document marked in progress).
export function inProgressInput(edited: string[]): NonNullable<BoardExtra["inProgress"]> | undefined {
  const s = readInProgressSettings();
  return s.enabled ? { edited, max: s.max } : undefined;
}

/** The live-signals input for the board, or undefined when the live feature is off. */
export function liveInput(live: LiveSignals): { signals: LiveSignals; includeWarnings: boolean; fold: boolean; unnamedBox: boolean } | undefined {
  const s: LiveSettings = readLiveSettings();
  return s.enabled ? { signals: live, includeWarnings: s.includeWarnings, fold: liveFold, unnamedBox: s.unnamedBox } : undefined;
}

// The Tidy sweep's settings with the time now; undefined when the sweep is off.
export function tidyInput(): { now: number; afterDays: number; archiveFolder: string; reports?: boolean } | undefined {
  const s = readTidySettings();
  return s ? { now: Date.now(), ...s } : undefined;
}

function showFailed(e: unknown): void {
  void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
}

// Where the board tab is now; the panel sets this so the actions need no import of the panel.
let boardColumn: () => number | undefined = () => undefined;

export function setBoardColumnSource(source: () => number | undefined): void {
  boardColumn = source;
}

// The group a document opens in, or undefined to leave it to the editor.
export function documentColumn(): number | undefined {
  const c = vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard");
  const groups = vscode.window.tabGroups;
  return chooseDocumentColumn({
    openBeside: parseOpenBeside(c.get("openBeside")),
    placement: parsePlacement(c.get("placement")),
    boardColumn: boardColumn(),
    groupColumns: groups.all.map((g) => g.viewColumn),
    activeColumn: groups.activeTabGroup?.viewColumn
  });
}

// Opens a document the page was shown, optionally at a line, in a group beside the board.
export async function openDocument(uri: vscode.Uri, selection?: vscode.Range): Promise<void> {
  try {
    const viewColumn = documentColumn();
    await vscode.window.showTextDocument(uri, { preview: true, ...(selection ? { selection } : {}), ...(viewColumn !== undefined ? { viewColumn } : {}) });
  } catch (e) {
    showFailed(e);
  }
}

// Only a suggestion the page was actually shown can be acted on.
export async function applySuggestion(context: vscode.ExtensionContext, model: BoardModel | undefined, key: string, value: "accept" | "reject"): Promise<void> {
  const shown = model?.suggestions.find((s) => s.key === key);
  if (shown) {
    await updateLocalMarks(context, (local) => {
      if (value === "reject") {
        local.rejected = addRejected(local.rejected, [shown.key]);
      } else {
        local.needs[shown.fromKey] = [...new Set([...(local.needs[shown.fromKey] ?? []), `${shown.toProject}:${shown.toPath}`])];
      }
      return local;
    });
  }
}

// Remembers proposed links the person turned down, so they are not proposed again. Returns the keys
// this call newly added to the local marks (what an Undo reject takes back).
export async function rejectProposals(context: vscode.ExtensionContext, keys: string[]): Promise<string[]> {
  const added: string[] = [];
  if (keys.length > 0) {
    await updateLocalMarks(context, (local) => {
      const had = new Set(local.rejected);
      added.push(...new Set(keys.filter((k) => !had.has(k))));
      local.rejected = addRejected(local.rejected, keys);
      return local;
    });
  }
  return added;
}

// Takes back exactly the keys the last reject added to the local marks; rejections from the shared file stay.
export async function undoRejected(context: vscode.ExtensionContext, keys: readonly string[]): Promise<void> {
  if (keys.length > 0) {
    const drop = new Set(keys);
    await updateLocalMarks(context, (local) => {
      local.rejected = local.rejected.filter((k) => !drop.has(k));
      return local;
    });
  }
}

// Only a link the page was actually shown can be opened, and only over https.
export async function openExternalLink(model: BoardModel | undefined, g: number, i: number): Promise<void> {
  const url = safeUrl(model?.outside[g]?.items[i]?.url);
  if (url) {
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }
}

// Only toggles the page was shown can be chosen; the remembered choice is saved here and the
// panel repaints.
export async function saveSitting(context: vscode.ExtensionContext, model: BoardModel | undefined, m: { have?: unknown; box?: unknown }): Promise<void> {
  const known = new Set(model?.sittings?.contexts.map((c) => c.id));
  const have = Array.isArray(m.have) ? m.have.filter((x): x is string => typeof x === "string" && known.has(x)) : [];
  await saveSittingsChoice(context, { have, timeBox: asTimeBox(m.box) });
}

// A line the page was shown opens its document at the step's line.
export async function openSittingsLine(model: BoardModel | undefined, run: BoardRun | undefined, i: number): Promise<void> {
  const line = model?.sittings?.lines[i];
  const project = run?.cfg.projects.find((p) => p.id === line?.project);
  if (line && project) {
    const uri = vscode.Uri.joinPath(vscode.Uri.parse(project.path), line.path);
    const pos = new vscode.Position(Math.max(0, line.line - 1), 0);
    await openDocument(uri, new vscode.Range(pos, pos));
  }
}

/** A tab whose setup failed is closed again so no blank tab is left; the owner sees one error, except at startup. */
export function closeFailedOpen(panel: vscode.WebviewPanel, e: unknown, background: boolean): void {
  logBoardError(e);
  panel.dispose();
  if (!background) {
    void vscode.window.showErrorMessage(l10n("releaseBoard.openFailed", { error: e instanceof Error ? e.message : String(e) }));
  }
}

export const PLACEMENT_KEY = "saropaWorkspace.releaseBoard.column";

/** Remembers where the tab is, also after the user drags it to another group. */
export function rememberColumn(context: vscode.ExtensionContext, panel: vscode.WebviewPanel): void {
  let lastColumn = panel.viewColumn;
  const remember = (): void => {
    if (panel.viewColumn !== undefined) {
      lastColumn = panel.viewColumn;
      void context.workspaceState.update(PLACEMENT_KEY, lastColumn);
    }
  };
  remember();
  panel.onDidChangeViewState(remember);
  setBoardColumnSource(() => panel.viewColumn);
  panel.onDidDispose(() => {
    setBoardColumnSource(() => undefined);
    void context.workspaceState.update(PLACEMENT_KEY, lastColumn);
  });
}
