import * as vscode from "vscode";
import { BoardRun } from "../commands/releaseBoardCommands";
import { BoardModel } from "../board/boardModel";
import { PathToGo, clampMaxSteps } from "../board/pathToGo";
import { escapeHtml } from "../board/boardHtml";
import { l10n } from "../i18n/l10n";
import { safeUrl } from "../board/outside";
import { readSittingsSettings, readSittingsChoice, saveSittingsChoice } from "../commands/boardSittings";
import { asTimeBox } from "../board/sittings";
import { readTidySettings } from "../commands/boardTidy";
import { LiveSettings, liveFold, readLiveSettings } from "../commands/boardLive";
import { LiveSignals } from "../board/liveEvidence";
import { copyHandPrompt, readHandSettings } from "../commands/boardHandToChat";
import { formatPrompt, itemTarget, lineTarget, stepTarget, HandTarget } from "../board/handToChat";
import { updateLocalMarks } from "../commands/boardMarks";

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
// settings' limits; undefined when the feature is off.
export function sittingsInput(context: vscode.ExtensionContext): { selection: { have: string[]; timeBox: ReturnType<typeof asTimeBox>; maxSteps: number }; onlyOwner: boolean } | undefined {
  const s = readSittingsSettings();
  if (!s.enabled) {
    return undefined;
  }
  const choice = readSittingsChoice(context) ?? { have: s.defaultHave, timeBox: s.defaultTimeBox };
  return { selection: { have: choice.have, timeBox: choice.timeBox, maxSteps: s.maxSteps }, onlyOwner: s.onlyOwnerDocuments };
}

/** The live-signals input for the board, or undefined when the live feature is off. */
export function liveInput(live: LiveSignals): { signals: LiveSignals; includeWarnings: boolean; fold: boolean; unnamedBox: boolean } | undefined {
  const s: LiveSettings = readLiveSettings();
  return s.enabled ? { signals: live, includeWarnings: s.includeWarnings, fold: liveFold, unnamedBox: s.unnamedBox } : undefined;
}

// The Tidy sweep's settings with the time now; undefined when the sweep is off.
export function tidyInput(): { now: number; afterDays: number; archiveFolder: string } | undefined {
  const s = readTidySettings();
  return s ? { now: Date.now(), ...s } : undefined;
}

function showFailed(e: unknown): void {
  void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
}

// Opens a document the page was shown, optionally at a line.
export async function openDocument(uri: vscode.Uri, selection?: vscode.Range): Promise<void> {
  try {
    await vscode.window.showTextDocument(uri, selection ? { preview: true, selection } : { preview: true });
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
        local.rejected = [...new Set([...local.rejected, shown.key])];
      } else {
        local.needs[shown.fromKey] = [...new Set([...(local.needs[shown.fromKey] ?? []), `${shown.toProject}:${shown.toPath}`])];
      }
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

// Hand to chat: the page names an item, a step or a Sittings line by index; the prompt is
// built from the model the panel rendered and copied to the clipboard.
export async function handToChat(model: BoardModel | undefined, paths: PathToGo[] | undefined, run: BoardRun | undefined, m: { k?: unknown; i?: unknown; p?: unknown; s?: unknown }): Promise<void> {
  const settings = readHandSettings();
  if (!settings.enabled || !model) {
    return;
  }
  let target: HandTarget | undefined;
  let file: { project: string; path: string; chats?: number } | undefined;
  if (m.k === "item" && typeof m.i === "number" && model.items[m.i]) {
    const it = model.items[m.i];
    target = itemTarget(model, it);
    file = it;
  } else if (m.k === "line" && typeof m.i === "number" && model.sittings?.lines[m.i]) {
    const l = model.sittings.lines[m.i];
    target = lineTarget(model, l);
    file = l;
  } else if (m.k === "step" && typeof m.p === "number" && typeof m.s === "number") {
    const project = model.projects[m.p];
    const step = paths?.[m.p]?.steps[m.s];
    if (project && step) {
      target = stepTarget(model, project, step);
      const item = step.kind === "item" && step.itemId !== undefined ? model.items[step.itemId] : undefined;
      file = item;
    }
  }
  if (!target) {
    return;
  }
  const def = run?.cfg.projects.find((p) => p.id === file?.project);
  const doc = def && file ? vscode.Uri.joinPath(vscode.Uri.parse(def.path), file.path) : undefined;
  try {
    await copyHandPrompt(formatPrompt(target, settings.detail), doc, settings.openChat, file?.chats);
  } catch (e) {
    showFailed(e);
  }
}
