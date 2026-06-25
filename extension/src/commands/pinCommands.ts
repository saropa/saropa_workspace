import * as vscode from "vscode";
import { PinStore } from "../model/pinStore";
import { Pin, PinScope } from "../model/pin";
import { PinTreeItem } from "../views/pinTreeItem";
import { DoubleClickDispatcher } from "../exec/doubleClick";
import { runPin as execRunPin, getOutputChannel, isRunnable } from "../exec/runner";
import { processRegistry } from "../exec/processRegistry";
import { runStatusRegistry } from "../exec/runStatus";
import {
  detectFavoritesFiles,
  importAllDetected,
  detectSiblingFavorites,
  importSiblingFavorites,
  SiblingFavorites,
} from "../import/favoritesImport";
import { configureRun } from "./configureRun";
import { configureSchedule } from "./configureSchedule";
import { l10n } from "../i18n/l10n";

// Menu/command invocations hand us either a PinTreeItem (context menus, inline
// buttons) or a raw Pin (the click dispatcher). Normalize to a Pin.
function asPin(arg: unknown): Pin | undefined {
  if (arg instanceof PinTreeItem) {
    return arg.pin;
  }
  if (arg && typeof arg === "object" && "id" in arg && "scope" in arg) {
    return arg as Pin;
  }
  return undefined;
}

async function openPin(store: PinStore, pin: Pin): Promise<void> {
  const uri = store.resolveUri(pin);
  if (!uri) {
    vscode.window.showWarningMessage(l10n("pin.missingFile", { path: pin.path }));
    return;
  }
  await vscode.window.showTextDocument(uri, { preview: false });
}

async function runPinCommand(store: PinStore, pin: Pin): Promise<void> {
  const uri = store.resolveUri(pin);
  if (!uri) {
    vscode.window.showWarningMessage(l10n("pin.missingFile", { path: pin.path }));
    return;
  }
  // A pin with no way to execute (a text doc, markdown, image — anything without
  // an interpreter) should not be flung at the shell on a double-click. Open it
  // instead (opening is itself the visible feedback) and say why "run" did not
  // run, naming the file so the message ties to a concrete pin.
  if (!isRunnable(pin, uri.fsPath)) {
    const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    await vscode.window.showTextDocument(uri, { preview: false });
    vscode.window.showInformationMessage(l10n("run.openedNotRunnable", { name }));
    return;
  }
  await execRunPin(pin, uri);
}

async function pinUri(store: PinStore, uri: vscode.Uri, scope: PinScope): Promise<void> {
  const name = uri.path.split("/").pop() ?? uri.fsPath;
  const added = await store.addPin(uri, scope);
  if (added) {
    vscode.window.showInformationMessage(l10n("pin.added", { name }));
  } else {
    vscode.window.showInformationMessage(l10n("pin.alreadyPinned", { name }));
  }
}

function activeFileUri(): vscode.Uri | undefined {
  return vscode.window.activeTextEditor?.document.uri;
}

export function registerPinCommands(
  context: vscode.ExtensionContext,
  store: PinStore,
  dispatcher: DoubleClickDispatcher
): void {
  const reg = (id: string, handler: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));

  reg("saropaWorkspace.refresh", () => store.refresh());

  // Click dispatcher entry point: defer to single/double-click logic by pin id.
  reg("saropaWorkspace.activatePin", (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      dispatcher.activate(pin.id);
    }
  });

  reg("saropaWorkspace.openPin", (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      void openPin(store, pin);
    }
  });

  reg("saropaWorkspace.runPin", (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      void runPinCommand(store, pin);
    }
  });

  reg("saropaWorkspace.renamePin", async (arg: unknown) => {
    const pin = asPin(arg);
    if (!pin) {
      return;
    }
    const current = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    const label = await vscode.window.showInputBox({
      prompt: l10n("pin.renamePrompt", { name: current }),
      value: pin.label ?? "",
    });
    if (label !== undefined) {
      await store.renamePin(pin, label);
    }
  });

  reg("saropaWorkspace.configureRun", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await configureRun(store, pin);
    }
  });

  reg("saropaWorkspace.stopPin", (arg: unknown) => {
    const pin = asPin(arg);
    if (!pin) {
      return;
    }
    const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    const stopped = processRegistry.stop(pin.id);
    if (stopped) {
      // Reflect the stop in the output channel, distinct from a normal exit.
      getOutputChannel().appendLine(
        l10n("run.stopped", { time: new Date().toLocaleString(), name })
      );
      vscode.window.showInformationMessage(l10n("run.stopMessage", { name }));
    } else {
      vscode.window.showInformationMessage(l10n("run.notRunning", { name }));
    }
  });

  reg("saropaWorkspace.configureSchedule", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await configureSchedule(store, pin);
    }
  });

  reg("saropaWorkspace.unpin", async (arg: unknown) => {
    const pin = asPin(arg);
    if (!pin) {
      return;
    }
    const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    await store.removePin(pin);
    // Drop any last-run badge so it does not outlive the pin (the id is reused
    // for an identical re-pin only after a fresh run records a new result).
    runStatusRegistry.clear(pin.id);
    vscode.window.showInformationMessage(l10n("pin.removed", { name }));
  });

  // Reveal the shared output channel (background-run output, scheduled-run log,
  // and the "Show Output" target from a failed-run toast).
  reg("saropaWorkspace.showOutput", () => getOutputChannel().show(true));

  reg("saropaWorkspace.pinActiveFile", () => {
    const uri = activeFileUri();
    if (!uri) {
      vscode.window.showWarningMessage(l10n("pin.noActiveFile"));
      return;
    }
    void pinUri(store, uri, "project");
  });

  reg("saropaWorkspace.pinActiveFileGlobal", () => {
    const uri = activeFileUri();
    if (!uri) {
      vscode.window.showWarningMessage(l10n("pin.noActiveFile"));
      return;
    }
    void pinUri(store, uri, "global");
  });

  // Explorer context: VS Code passes (clickedUri, selectedUris[]).
  reg("saropaWorkspace.pinFile", (uri: vscode.Uri) => {
    if (uri) {
      void pinUri(store, uri, "project");
    }
  });

  reg("saropaWorkspace.pinFileGlobal", (uri: vscode.Uri) => {
    if (uri) {
      void pinUri(store, uri, "global");
    }
  });

  reg("saropaWorkspace.restoreAutoPins", async () => {
    const count = await store.restoreAutoPins();
    vscode.window.showInformationMessage(
      count > 0
        ? l10n("pin.autoRestored", { count })
        : l10n("pin.autoNoneRemoved")
    );
  });

  reg("saropaWorkspace.importFavorites", async () => {
    const detected = await detectFavoritesFiles();
    if (detected.length === 0) {
      vscode.window.showInformationMessage(l10n("import.none"));
      return;
    }
    const total = await importAllDetected(store);
    const fileList = detected.map((d) => d.fileName).join(", ");
    vscode.window.showInformationMessage(
      total > 0
        ? l10n("import.done", { count: total, file: fileList })
        : l10n("import.nothingNew", { file: fileList })
    );
  });

  // Scan immediate sibling projects (one directory level up) for favorites files
  // and import the user's selection as GLOBAL pins. Explicit and user-invoked, so
  // cross-project disk reads only happen on demand.
  reg("saropaWorkspace.scanSiblingFavorites", async () => {
    const found = await detectSiblingFavorites();
    if (found.length === 0) {
      vscode.window.showInformationMessage(l10n("import.sibling.none"));
      return;
    }

    // Pre-checked multi-select: the user confirms which siblings to pull in.
    type SiblingItem = vscode.QuickPickItem & { sibling: SiblingFavorites };
    const items: SiblingItem[] = found.map((s) => ({
      label: s.siblingName,
      description: s.fileLabel,
      detail: s.fileUri.fsPath,
      picked: true,
      sibling: s,
    }));
    const picks = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: l10n("import.sibling.placeholder"),
    });
    if (!picks || picks.length === 0) {
      return;
    }

    let total = 0;
    for (const pick of picks) {
      total += await importSiblingFavorites(pick.sibling, store);
    }
    vscode.window.showInformationMessage(
      total > 0
        ? l10n("import.sibling.done", { count: total })
        : l10n("import.sibling.nothingNew")
    );
  });
}
