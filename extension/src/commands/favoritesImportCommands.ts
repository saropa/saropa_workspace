import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import {
  detectFavoritesFiles,
  detectSettingsFavoritesCount,
  detectSabitovvtFavoritesCount,
  importAllDetected,
  detectSiblingFavorites,
  importSiblingFavorites,
  SiblingFavorites,
} from "../import/favoritesImport";
import { l10n } from "../i18n/l10n";
import { shortcutCommandRegistrar } from "./registerHelpers";

// The favorites-import command registrations, split out of pinManagementCommands so
// that file stays under the size cap. Two user-invoked entry points: import every
// favorites source detected in this workspace, and scan sibling projects for their
// favorites files. Both name every source they drew from in the result toast.
export function registerFavoritesImportCommands(
  context: vscode.ExtensionContext,
  store: ShortcutStore
): void {
  const { reg } = shortcutCommandRegistrar(context);

  reg("saropaWorkspace.importFavorites", async () => {
    const detected = await detectFavoritesFiles();
    const settingsCount = detectSettingsFavoritesCount();
    const sabitovvtCount = await detectSabitovvtFavoritesCount();
    if (detected.length === 0 && settingsCount === 0 && sabitovvtCount === 0) {
      vscode.window.showInformationMessage(l10n("import.none"));
      return;
    }
    const result = await importAllDetected(store);
    // Name every source the import drew from (files plus the settings keys) so the
    // toast tells the user exactly where the shortcuts came from.
    const sources = [
      ...detected.map((d) => d.fileName),
      ...(settingsCount > 0 ? ["favorites.resources"] : []),
      ...(sabitovvtCount > 0 ? ["favoritesPanel.commands"] : []),
    ];
    const fileList = sources.join(", ");
    if (result.added === 0) {
      vscode.window.showInformationMessage(l10n("import.nothingNew", { file: fileList }));
      return;
    }
    // Skipped entries (unsupported or malformed) are detailed in the output
    // channel; offer a one-click jump to it rather than burying the count.
    if (result.skipped > 0) {
      const showOutput = l10n("run.showOutput");
      const choice = await vscode.window.showInformationMessage(
        l10n("import.doneWithSkips", {
          count: result.added,
          file: fileList,
          skipped: result.skipped,
        }),
        showOutput
      );
      if (choice === showOutput) {
        void vscode.commands.executeCommand("saropaWorkspace.showOutput");
      }
      return;
    }
    vscode.window.showInformationMessage(
      l10n("import.done", { count: result.added, file: fileList })
    );
  });

  // Scan immediate sibling projects (one directory level up) for favorites files
  // and import the user's selection as GLOBAL shortcuts. Explicit and user-invoked, so
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
