import * as vscode from "vscode";
import {
  PinFilterState,
  isScriptsChipOn,
  isFilesChipOn,
} from "../views/pinFilter";
import { l10n } from "../i18n/l10n";

// The Pins-view filter (WOW #28). A TreeView has no API for a persistent header
// input field, so the "find it now" bar is delivered as a single InputBox that
// stays the filter surface: typing applies the text facet live (the tree updates
// on every keystroke), and three title-bar buttons toggle the Scripts / Files /
// Failed facets, with a Clear button. The active filter is always reflected in
// the view title (TreeView.message, set in extension.ts) so it reads as a
// persistent bar even though the InputBox is modal while open.

// A title-bar button on the filter InputBox, tagged so onDidTriggerButton can
// tell which chip (or Clear) was pressed without comparing icon identity.
interface ChipButton extends vscode.QuickInputButton {
  readonly id: "scripts" | "files" | "failed" | "clear";
}

export function registerFilterCommands(
  context: vscode.ExtensionContext,
  filterState: PinFilterState
): void {
  // The title button and its active-state twin both open the same find bar; the
  // two command ids exist only so the manifest can swap the icon (outline vs
  // filled) by the saropaWorkspace.filterActive context key.
  const openFilter = (): void => showFilterInput(filterState);

  context.subscriptions.push(
    vscode.commands.registerCommand("saropaWorkspace.filterPins", openFilter),
    vscode.commands.registerCommand(
      "saropaWorkspace.filterPinsActive",
      openFilter
    ),
    vscode.commands.registerCommand("saropaWorkspace.clearPinFilter", () => {
      filterState.clear();
      // Name the outcome so the cleared filter is an acknowledged action, not a
      // silent state change (no silent async).
      void vscode.window.showInformationMessage(l10n("filter.cleared"));
    }),
    // The facet toggles are also standalone commands so they work from the
    // command palette and are reusable by #17's tag mode; the find-bar buttons
    // call the same PinFilterState mutators.
    vscode.commands.registerCommand(
      "saropaWorkspace.toggleFilterScripts",
      () => filterState.toggleScripts()
    ),
    vscode.commands.registerCommand("saropaWorkspace.toggleFilterFiles", () =>
      filterState.toggleFiles()
    ),
    vscode.commands.registerCommand("saropaWorkspace.toggleFilterFailed", () =>
      filterState.toggleFailed()
    )
  );
}

// Open the find bar. Reads/writes the shared PinFilterState so its state survives
// closing and reopening the box, and so the title-bar message stays in sync.
function showFilterInput(filterState: PinFilterState): void {
  const input = vscode.window.createInputBox();
  input.title = l10n("filter.input.title");
  input.prompt = l10n("filter.input.prompt");
  input.placeholder = l10n("filter.input.placeholder");
  input.value = filterState.get().text ?? "";
  input.buttons = chipButtons(filterState);

  // Rebuild the chip icons whenever any facet changes (including changes made by
  // a button press below), so an on chip shows its lit ($(check)) glyph.
  const sub = filterState.onDidChange(() => {
    input.buttons = chipButtons(filterState);
  });

  // Live text search: every keystroke updates the filter, so the tree collapses
  // to matches as the user types rather than only on Enter.
  input.onDidChangeValue((value) => filterState.setText(value));

  input.onDidTriggerButton((button) => {
    const id = (button as ChipButton).id;
    if (id === "scripts") {
      filterState.toggleScripts();
    } else if (id === "files") {
      filterState.toggleFiles();
    } else if (id === "failed") {
      filterState.toggleFailed();
    } else {
      // Clear: drop every facet and empty the text field in place so the box
      // reflects the reset without closing.
      filterState.clear();
      input.value = "";
    }
  });

  // Enter just dismisses the box; the filter is already applied live and persisted.
  input.onDidAccept(() => input.hide());
  input.onDidHide(() => {
    sub.dispose();
    input.dispose();
  });
  input.show();
}

// The current chip buttons, with each lit facet showing a $(check) so its on/off
// state is visible at a glance (the title-bar buttons themselves carry no toggled
// styling). Order is stable so positions are learnable.
function chipButtons(filterState: PinFilterState): ChipButton[] {
  const filter = filterState.get();
  const scriptsOn = isScriptsChipOn(filter);
  const filesOn = isFilesChipOn(filter);
  const failedOn = filter.failedOnly === true;
  return [
    {
      id: "scripts",
      iconPath: new vscode.ThemeIcon(scriptsOn ? "check" : "terminal"),
      tooltip: l10n(scriptsOn ? "filter.button.scriptsOn" : "filter.button.scripts"),
    },
    {
      id: "files",
      iconPath: new vscode.ThemeIcon(filesOn ? "check" : "file"),
      tooltip: l10n(filesOn ? "filter.button.filesOn" : "filter.button.files"),
    },
    {
      id: "failed",
      iconPath: new vscode.ThemeIcon(failedOn ? "check" : "error"),
      tooltip: l10n(failedOn ? "filter.button.failedOn" : "filter.button.failed"),
    },
    {
      id: "clear",
      iconPath: new vscode.ThemeIcon("clear-all"),
      tooltip: l10n("filter.button.clear"),
    },
  ];
}
