import * as vscode from "vscode";
import { PinStore } from "./model/pinStore";
import { PinsTreeProvider } from "./views/pinsTreeProvider";
import { DoubleClickDispatcher } from "./exec/doubleClick";
import { registerPinCommands } from "./commands/pinCommands";
import { registerTerminalCleanup } from "./exec/runner";
import { detectFavoritesFiles, importAllDetected } from "./import/favoritesImport";
import { l10n } from "./i18n/l10n";

// Gate flag so the one-time "import existing favorites" prompt does not reappear
// once the user has answered (imported or dismissed) for this workspace.
const IMPORT_PROMPT_KEY = "saropaWorkspace.favoritesImportOffered";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const store = new PinStore(context);

  // Click dispatcher: single click opens, double click runs. It carries only the
  // pin id, so callbacks look the pin back up from the store's current cache.
  const dispatcher = new DoubleClickDispatcher(
    (id) => {
      const pin = store.findPin(id);
      if (pin) {
        void vscode.commands.executeCommand("saropaWorkspace.openPin", pin);
      }
    },
    (id) => {
      const pin = store.findPin(id);
      if (pin) {
        void vscode.commands.executeCommand("saropaWorkspace.runPin", pin);
      }
    }
  );
  context.subscriptions.push({ dispose: () => dispatcher.dispose() });

  const tree = new PinsTreeProvider(store);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("saropaWorkspace.pins", tree)
  );

  registerTerminalCleanup(context);
  registerPinCommands(context, store, dispatcher);

  // Re-seed auto-pins and refresh when folders change or the auto-pin patterns
  // setting is edited.
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => void store.refresh()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("saropaWorkspace.autoPins.patterns")) {
        void store.refresh();
      }
    })
  );

  await store.init();

  // Offer to import favorites from other extensions once per workspace, only
  // when such a file actually exists, so first-time users keep their old pins
  // without being nagged on every launch.
  void maybeOfferFavoritesImport(context, store);
}

async function maybeOfferFavoritesImport(
  context: vscode.ExtensionContext,
  store: PinStore
): Promise<void> {
  if (context.workspaceState.get<boolean>(IMPORT_PROMPT_KEY, false)) {
    return;
  }
  const detected = await detectFavoritesFiles();
  if (detected.length === 0) {
    return;
  }
  // Record that the offer was made before awaiting the user's answer, so a
  // dismissal (or window reload mid-prompt) does not re-trigger it.
  await context.workspaceState.update(IMPORT_PROMPT_KEY, true);

  const first = detected[0];
  const action = l10n("import.promptAction");
  const choice = await vscode.window.showInformationMessage(
    l10n("import.prompt", { file: first.fileName, count: detected.length }),
    action
  );
  if (choice === action) {
    const total = await importAllDetected(store);
    vscode.window.showInformationMessage(
      l10n("import.done", {
        count: total,
        file: detected.map((d) => d.fileName).join(", "),
      })
    );
  }
}

export function deactivate(): void {
  // Subscriptions (tree, commands, terminal cleanup, dispatcher) are disposed by
  // VS Code via context.subscriptions; nothing extra to tear down in Phase 1.
}
