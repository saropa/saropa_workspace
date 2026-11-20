// Where the Release Board tab opens. Pure: the host passes plain values and gets a view column.

// The same numbers as vscode.ViewColumn.Active and vscode.ViewColumn.Beside.
export const COLUMN_ACTIVE = -1;
// Sentinel for "open beside"; negative so it can never be mistaken for a real editor column.
export const COLUMN_BESIDE = -2;

// The two placements the setting allows; a union so an unknown value is caught at the boundary.
export type BoardPlacement = "beside" | "sameGroup";

// Setting, remembered column and editor state as plain data, so the column choice is
// testable without the editor.
export interface PlacementInput {
  setting: BoardPlacement;
  // The column the board was last in (from workspace state), if any.
  stored: unknown;
  // How many editor groups are open now.
  groupCount: number;
  // The column of the active editor group; undefined when nothing is open in any group.
  activeColumn: number | undefined;
  // True when the board opens in the background (window start).
  background: boolean;
}

// A stored column is usable when it is an existing group, or the one next to the last group.
function usableColumn(stored: unknown, groupCount: number): stored is number {
  return typeof stored === "number" && Number.isInteger(stored) && stored >= 1 && stored <= Math.max(1, groupCount) + 1;
}

// Decides the editor column for the board; a stored column that no longer exists must not
// strand the board in a closed group.
export function chooseColumn(input: PlacementInput): number {
  const nothingOpen = input.activeColumn === undefined;
  if (input.setting === "sameGroup") {
    // Window start: beside the active editor, so no open file is covered.
    if (input.background) {
      return nothingOpen ? COLUMN_ACTIVE : COLUMN_BESIDE;
    }
    return input.activeColumn ?? 1;
  }
  // Window start with nothing open and one group: a stored column would leave an empty group 1.
  if (input.background && nothingOpen && input.groupCount <= 1) {
    return COLUMN_ACTIVE;
  }
  if (usableColumn(input.stored, input.groupCount)) {
    return input.stored;
  }
  return nothingOpen ? COLUMN_ACTIVE : COLUMN_BESIDE;
}

// Reads the setting value; anything unknown is the default.
export function parsePlacement(value: unknown): BoardPlacement {
  return value === "sameGroup" ? "sameGroup" : "beside";
}
