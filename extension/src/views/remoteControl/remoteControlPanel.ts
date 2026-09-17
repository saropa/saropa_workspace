import * as vscode from "vscode";
import { AndroidProjectProfile, getAndroidProjectProfile } from "../../model/androidProjectProfile";
import { ShortcutStore } from "../../model/shortcutStore";
import { adbRunHistory } from "../../exec/adbRunHistory";
import { buildRemoteControlPayload } from "./remoteControlData";
import { pinAdbCommand, runAdbCommand } from "./remoteControlActions";
import { renderRemoteControlHtml } from "./remoteControlShell";
import { l10n } from "../../i18n/l10n";

// The Mobile Remote Control webview panel (MOBILE_REMOTE_CONTROL_PLAN section 3,
// build-order step 3): the searchable, grouped card list over the adb command catalog.
// Host and protocol side only — the markup lives in remoteControlShell.ts and the wire
// model in remoteControlData.ts, the same three-way split configureRunPanel.ts uses.
//
// A WebviewPanel (an editor tab), not a WebviewViewProvider, matching every other rich
// surface in this extension (Configure Run, Set Params, the dashboard, the schedule
// editor and the planner are all panels; the launcher is the one WebviewView, because it
// docks in the Panel container). The plan also calls for a section that contributes no
// tree view at all, which is exactly what a panel gives.
//
// The `run` and `pin` intents are handled in remoteControlActions.ts (substitution,
// prompt resolution, the dry-run confirm modal, the run through exec/runner.ts, the
// Shortcuts-store add); this file only routes the messages and re-posts the payload, so
// an open panel's Recent group reflects a run the moment it happens.
//
// DELIBERATELY NOT IMPLEMENTED HERE (later build-order steps):
//   - device discovery and the connection health check, so nothing here knows whether a
//     device is attached; `requiresDevice` is still only a badge.
//   - multi-device fan-out, the permission inspector, the live device chip and the
//     persistent run-history table.
// The profile is accepted, resolved, reported as a header chip and used to substitute
// every row's command, but it does NOT filter the catalog: relevance-based hiding needs
// the connected device's API level too, so it lands with discovery rather than guessing
// here.

// The command id the plan reserves for opening this panel. Registered (and contributed
// in package.json) by the entry-points step; exported here so that step, and any caller
// wanting to reveal the panel, names the same string.
export const OPEN_REMOTE_CONTROL_COMMAND = "saropaWorkspace.openRemoteControl";

// What the webview may post. Anything else is ignored — the client is ours, but a
// webview is still an untrusted boundary.
interface RemoteControlMessage {
  type?: string;
  query?: string;
  id?: string;
}

/** Webview panel listing the adb command catalog as a searchable, grouped card list. */
export class RemoteControlPanel {
  private static current: RemoteControlPanel | undefined;
  private static readonly viewType = "saropaWorkspace.remoteControl";

  private readonly disposables: vscode.Disposable[] = [];
  // The live search query, kept host-side so a re-post (e.g. after a profile refresh)
  // redraws the list the user is actually looking at rather than resetting it.
  private query = "";

  // Open the panel, or reveal and refresh the one already open. Both arguments are
  // optional: the profile is resolved from the first workspace folder when none is passed
  // (the cached read — see getAndroidProjectProfile), and without a store the Pin action
  // says it cannot pin rather than failing silently.
  static show(store?: ShortcutStore, profile?: AndroidProjectProfile): void {
    const column = vscode.window.activeTextEditor?.viewColumn;
    if (RemoteControlPanel.current) {
      RemoteControlPanel.current.repoint(store, profile);
      RemoteControlPanel.current.panel.reveal(column);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      RemoteControlPanel.viewType,
      l10n("remoteControl.title"),
      column ?? vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    RemoteControlPanel.current = new RemoteControlPanel(panel, store, profile);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private store: ShortcutStore | undefined,
    private profile: AndroidProjectProfile | undefined
  ) {
    this.panel.webview.html = renderRemoteControlHtml();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: unknown) => void this.onMessage(message),
      null,
      this.disposables
    );
  }

  // Re-point an open panel at a (possibly newly resolved) profile and redraw. The HTML
  // shell is static, so unlike Configure Run this never rebuilds the document — only the
  // posted payload changes, which keeps the search box's text and focus intact.
  private repoint(store?: ShortcutStore, profile?: AndroidProjectProfile): void {
    if (store) {
      this.store = store;
    }
    if (profile) {
      this.profile = profile;
    }
    void this.postCatalog();
  }

  // ---- message protocol -------------------------------------------------

  private async onMessage(message: unknown): Promise<void> {
    if (typeof message !== "object" || message === null) {
      return;
    }
    const msg = message as RemoteControlMessage;
    switch (msg.type) {
      case "ready":
        await this.resolveProfile();
        await this.postCatalog();
        return;
      case "search":
        this.query = typeof msg.query === "string" ? msg.query : "";
        await this.postCatalog();
        return;
      case "run":
        if (typeof msg.id === "string") {
          await runAdbCommand(msg.id, this.profile);
          // Re-post so the Recent group reflects the run that just happened (or does not,
          // when the confirm was declined — runAdbCommand records only a real run).
          await this.postCatalog();
        }
        return;
      case "pin":
        if (typeof msg.id === "string") {
          await this.onPin(msg.id);
        }
        return;
    }
  }

  // Pin a catalog row into the real Shortcuts tree. Without a store (the panel was opened
  // by a caller that had none) this says so rather than doing nothing — a button that
  // silently no-ops reads as broken.
  private async onPin(id: string): Promise<void> {
    if (!this.store) {
      vscode.window.showWarningMessage(l10n("remoteControl.pin.noStore"));
      return;
    }
    await pinAdbCommand(this.store, id, this.profile);
  }

  // Resolve the workspace's Android profile once, on the client's ready handshake, when
  // the caller did not supply one. Never throws (the detector degrades to the empty
  // profile) and never blocks the first paint: the catalog is posted right after.
  private async resolveProfile(): Promise<void> {
    if (this.profile) {
      return;
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    this.profile = await getAndroidProjectProfile(folder);
  }

  // Post the filtered, grouped, l10n-resolved catalog. Every string the client renders is
  // resolved here, so the webview never sees an l10n key.
  private async postCatalog(): Promise<void> {
    await this.panel.webview.postMessage({
      type: "catalog",
      payload: buildRemoteControlPayload({
        query: this.query,
        ...(this.profile ? { profile: this.profile } : {}),
        recent: adbRunHistory.recent(),
        counts: adbRunHistory.counts(),
      }),
    });
  }

  private dispose(): void {
    RemoteControlPanel.current = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

// The body the entry-points step binds to OPEN_REMOTE_CONTROL_COMMAND. Kept a plain
// exported function (not a registration) so nothing is contributed to the palette until
// package.json declares it.
export function openRemoteControlPanel(
  store?: ShortcutStore,
  profile?: AndroidProjectProfile
): void {
  RemoteControlPanel.show(store, profile);
}
