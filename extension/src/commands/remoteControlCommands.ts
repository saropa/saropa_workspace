import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { getAndroidProjectProfile } from "../model/androidProjectProfile";
import {
  OPEN_REMOTE_CONTROL_COMMAND,
  openRemoteControlPanel,
} from "../views/remoteControl/remoteControlPanel";

// The entry point for the Mobile Remote Control section (MOBILE_REMOTE_CONTROL_PLAN
// section 5, build-order step 9): exactly ONE contributed command, which opens the
// webview panel.
//
// One command on purpose. The plan's UI-restructure section measures 78 palette-visible
// commands already and names this section as the pattern every future one should follow:
// every individual adb command is DATA in model/adbCommandCatalog.ts, reached through the
// panel's own search box, never a `contributes.commands` entry. No tree view and no
// activity-bar container is contributed either — the panel is the surface.
//
// The profile is resolved here rather than inside the panel so the first paint already
// carries the project chip and the substituted command lines; the panel still resolves it
// itself when opened by a caller that passes none (see RemoteControlPanel.show).

export function registerRemoteControlCommands(
  context: vscode.ExtensionContext,
  store: ShortcutStore
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(OPEN_REMOTE_CONTROL_COMMAND, async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      // Cached after the first read and invalidated by the profile's own file watchers,
      // so opening the panel repeatedly does not re-parse build.gradle each time.
      const profile = folder ? await getAndroidProjectProfile(folder) : undefined;
      openRemoteControlPanel(store, profile);
    })
  );
}
