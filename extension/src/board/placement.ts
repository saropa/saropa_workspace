// Where the Release Board tab opens. Pure: the host passes plain values and gets a view column.

// The same numbers as vscode.ViewColumn.Active and vscode.ViewColumn.Beside.
export const COLUMN_ACTIVE = -1;
export const COLUMN_BESIDE = -2;

export type BoardPlacement = "beside" | "sameGroup";

export interface PlacementInput {
  setting: BoardPlacement;
  // The column the board was last in (from workspace state), if any.
  stored: unknown;
  // How many editor groups are open now.
  groupCount: number;
  // The column of the active text editor, if there is one.
  activeColumn: number | undefined;
  // True when the board opens in the background (window start).
  background: boolean;
}

// A stored column is usable when it is an existing group, or the one next to the last group.
function usableColumn(stored: unknown, groupCount: number): stored is number {
  return typeof stored === "number" && Number.isInteger(stored) && stored >= 1 && stored <= Math.max(1, groupCount) + 1;
}

export function chooseColumn(input: PlacementInput): number {
  if (input.setting === "sameGroup") {
    return input.activeColumn ?? (input.background ? COLUMN_ACTIVE : 1);
  }
  if (usableColumn(input.stored, input.groupCount)) {
    return input.stored;
  }
  return input.activeColumn === undefined ? COLUMN_ACTIVE : COLUMN_BESIDE;
}

// Reads the setting value; anything unknown is the default.
export function parsePlacement(value: unknown): BoardPlacement {
  return value === "sameGroup" ? "sameGroup" : "beside";
}
