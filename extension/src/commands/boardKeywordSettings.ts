import * as vscode from "vscode";

// Release Board, keyword editor settings. A bad value falls back to its default.

export interface KeywordSettings {
  enabled: boolean;
  // The most open documents the preview reads.
  previewMaxDocuments: number;
}

export const PREVIEW_DOCS = { def: 300, min: 20, max: 2000 } as const;

// A whole number inside the bounds, else the default.
export function asPreviewMax(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(PREVIEW_DOCS.max, Math.max(PREVIEW_DOCS.min, Math.floor(v))) : PREVIEW_DOCS.def;
}

export function readKeywordSettings(): KeywordSettings {
  const c = vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard.keywordEditor");
  return { enabled: c.get<boolean>("enabled", true) !== false, previewMaxDocuments: asPreviewMax(c.get<number>("previewMaxDocuments", PREVIEW_DOCS.def)) };
}
