import * as vscode from "vscode";
import { BriefPanel } from "../views/briefPanel";
import { peekLastBrief, latestBrief } from "../exec/lastBrief";
import { l10n } from "../i18n/l10n";

export function registerMorningBriefCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "saropaWorkspace.openMorningBrief",
      (pinId?: string) => {
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
