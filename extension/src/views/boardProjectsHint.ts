import * as vscode from "vscode";
import { BoardConfig } from "../board/types";
import { chosenFolders } from "../commands/boardExtraProjects";

// The one-line hint at the top of the board: "Only this project is shown. Add more
// projects". Shown while no extra project is chosen; once dismissed it stays gone. The
// dismissal is a per-viewer convenience, kept in the extension's global state.

export const HINT_DISMISSED_KEY = "saropaWorkspace.releaseBoard.projectsHintDismissed";

// True when the hint should be drawn: no extra project is chosen (and none is on the
// board) and the user has not dismissed it.
export function hintVisible(context: vscode.ExtensionContext, cfg: BoardConfig): boolean {
  if (context.globalState.get<boolean>(HINT_DISMISSED_KEY, false)) {
    return false;
  }
  return chosenFolders().paths.length === 0 && !cfg.projects.some((p) => p.extra === true) && (cfg.skipped?.length ?? 0) === 0;
}

export async function dismissHint(context: vscode.ExtensionContext): Promise<void> {
  await context.globalState.update(HINT_DISMISSED_KEY, true);
}
