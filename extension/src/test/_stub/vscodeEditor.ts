// Text editor stand-ins for the test stub: Range and Selection, the reveal-type enum, and
// a fake editor that showTextDocument returns. The editor reads its lines from the file on
// disk (an absent file is an empty document) and records reveals and decorations, so a test
// can assert where the view was scrolled. Split out of vscode.ts to keep that file small.

import * as nodeFs from "node:fs";
import { Position, Uri } from "./vscodeTypes";

/** vscode.Range: two positions. Accepts positions or line/character numbers like the real one. */
export class Range {
  readonly start: Position;
  readonly end: Position;
  constructor(a: Position | number, b: Position | number, c?: number, d?: number) {
    if (typeof a === "number") {
      this.start = new Position(a, b as number);
      this.end = new Position(c ?? 0, d ?? 0);
    } else {
      this.start = a;
      this.end = b as Position;
    }
  }
}

/** vscode.Selection: a range with an anchor and an active end. */
export class Selection extends Range {
  readonly anchor: Position;
  readonly active: Position;
  constructor(anchor: Position, active: Position) {
    super(anchor, active);
    this.anchor = anchor;
    this.active = active;
  }
}

/** vscode.TextEditorRevealType values. */
export const TextEditorRevealType = {
  Default: 0,
  InCenter: 1,
  InCenterIfOutsideViewport: 2,
  AtTop: 3,
} as const;

/** One recorded reveal. */
export interface RevealCall {
  readonly range: Range;
  readonly type: number | undefined;
}

/** One recorded setDecorations call. */
export interface DecorationCall {
  readonly type: unknown;
  readonly ranges: readonly Range[];
}

/** The editor showTextDocument returns. */
export interface FakeTextEditor {
  readonly document: {
    readonly uri: Uri;
    readonly lineCount: number;
    lineAt(line: number): { readonly text: string; readonly range: Range };
    getText(): string;
  };
  selection: Selection;
  readonly viewColumn: number | undefined;
  readonly options: unknown;
  readonly reveals: RevealCall[];
  readonly decorations: DecorationCall[];
  revealRange(range: Range, type?: number): void;
  setDecorations(type: unknown, ranges: readonly Range[]): void;
}

function readLines(uri: Uri): string[] {
  try {
    return nodeFs.readFileSync(uri.fsPath, "utf8").split("\n");
  } catch {
    return [""];
  }
}

/** Builds an editor over the file at `uri` (empty when the file does not exist). */
export function fakeTextEditor(uri: Uri, options?: { viewColumn?: number }): FakeTextEditor {
  const lines = readLines(uri);
  const origin = new Position(0, 0);
  return {
    document: {
      uri,
      lineCount: lines.length,
      lineAt(line: number) {
        const text = lines[line];
        if (text === undefined) {
          throw new Error(`no line ${line}`);
        }
        return { text, range: new Range(new Position(line, 0), new Position(line, text.length)) };
      },
      getText: () => lines.join("\n"),
    },
    selection: new Selection(origin, origin),
    viewColumn: options?.viewColumn,
    options,
    reveals: [],
    decorations: [],
    revealRange(range: Range, type?: number): void {
      this.reveals.push({ range, type });
    },
    setDecorations(type: unknown, ranges: readonly Range[]): void {
      this.decorations.push({ type, ranges });
    },
  };
}

const openedDocuments: string[] = [];
const shownEditors: FakeTextEditor[] = [];

/** The editors open in the window; `window.visibleTextEditors` is this same array. */
export const visibleTextEditors: FakeTextEditor[] = [];

/** Stub of `window.showTextDocument`: logs the path, returns a fake editor over the file. */
export async function showTextDocument(
  doc: { uri: Uri } | Uri,
  options?: { viewColumn?: number }
): Promise<FakeTextEditor> {
  const uri = "uri" in doc ? doc.uri : doc;
  openedDocuments.push(uri.fsPath);
  const editor = fakeTextEditor(uri, options);
  shownEditors.push(editor);
  return editor;
}

/** The documents showTextDocument was called with since the last reset, in order. */
export function __openedDocuments(): readonly string[] {
  return openedDocuments;
}

/** The editors showTextDocument returned since the last reset, in order. */
export function __shownEditors(): readonly FakeTextEditor[] {
  return shownEditors;
}

/** Test hook: sets which editors `window.visibleTextEditors` reports. */
export function __setVisibleEditors(editors: readonly FakeTextEditor[]): void {
  visibleTextEditors.splice(0, visibleTextEditors.length, ...editors);
}

/** Test hook: clears the opened-document log, the shown editors and the visible editors. */
export function __resetOpenedDocuments(): void {
  openedDocuments.length = 0;
  shownEditors.length = 0;
  visibleTextEditors.length = 0;
}
