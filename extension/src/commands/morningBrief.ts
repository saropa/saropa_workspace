import * as vscode from "vscode";
import { BriefPanel } from "../views/briefPanel";
import { peekLastBrief, latestBrief } from "../exec/lastBrief";
import { l10n } from "../i18n/l10n";

/** Registers the command that opens the Morning Brief for a routine, or the latest brief when no routine is named. */
export function registerMorningBriefCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "saropaWorkspace.openMorningBrief",
      (pinId?: string) => {
        // With a routine id, show that routine's last brief; without one (palette), show the
        // newest brief of any routine.
        const brief = pinId ? peekLastBrief(pinId) : latestBrief();
        if (!brief) {
          vscode.window.showInformationMessage(l10n("brief.none"));
          return;
        }
        BriefPanel.show(brief);
      }
    )
  );
}
