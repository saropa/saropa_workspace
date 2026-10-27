// Which editor group a document opened from the board goes to. Pure: the host passes plain values.

import { COLUMN_BESIDE } from "./placement";
import type { BoardPlacement } from "./placement";

export interface OpenBesideInput {
  // The releaseBoard.openBeside setting.
  openBeside: boolean;
  // The releaseBoard.placement setting.
  placement: BoardPlacement;
  // The column the board tab is in now; undefined when it is not known.
  boardColumn: number | undefined;
  // The column of every open editor group.
  groupColumns: number[];
  // The column of the active editor group, if any.
  activeColumn: number | undefined;
}

// The column to open the document in; undefined keeps the editor's own choice.
export function chooseDocumentColumn(input: OpenBesideInput): number | undefined {
  if (!input.openBeside || input.placement === "sameGroup" || input.boardColumn === undefined) {
    return undefined;
  }
  const others = input.groupColumns.filter((c) => c !== input.boardColumn);
  if (input.activeColumn !== undefined && others.includes(input.activeColumn)) {
    return input.activeColumn;
  }
  return others.length > 0 ? Math.min(...others) : COLUMN_BESIDE;
}

// Reads the setting value; anything but false is the default (on).
export function parseOpenBeside(value: unknown): boolean {
  return value !== false;
}
