import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";
import {
  AndroidProjectProfile,
  getAndroidProjectProfile,
} from "../model/androidProjectProfile";
import { SectionDescriptor, orderedSections } from "../model/sections";

// The "Control Center" view (MOBILE_REMOTE_CONTROL_PLAN, "UI restructure" item 2):
// a one-row-per-section index built from SECTION_REGISTRY, where clicking a row runs
// that section's entryCommand and opens its surface.
//
// ADDITIVE ONLY. This is a seventh view sitting alongside the six that exist today;
// none of them is hidden, gated or altered. Its job is discoverability — a section
// with no permanent tree view of its own (Mobile Remote Control, Dashboard, Schedule,
// Planner) is otherwise reachable only by knowing its palette command exists. Whether
// the older views should later fold into this hub is a judgement to make after using
// it, not something this change decides.
//
// Flat, read-only, no drag-and-drop and no context menu, like the Watches and Recipes
// trees it is modeled on. All of the ordering logic lives in orderedSections() in
// model/sections.ts, so this class is only the VS Code glue around it.
export class ControlCenterProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // The project shape the rows are currently sorted for. `undefined` means "not read
  // yet", which every relevance function must treat as "do not know" — so the first
  // paint shows every section rather than guessing one away.
  private profile: AndroidProjectProfile | undefined;

  constructor() {
    // Cached and shared with activation/sectionContext.ts's read, so this is a lookup
    // rather than a second parse of the same four build files. Not awaited: the view
    // paints immediately from the unresolved profile and repaints when this answers.
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder) {
      void getAndroidProjectProfile(folder).then((profile) =>
        this.setProfile(profile)
      );
    }
  }

  /**
   * Adopt a freshly read project profile and repaint if it changed the answer.
   *
   * Activation calls this from the single watchAndroidProjectProfile subscription in
   * sectionContext.ts (via its onSectionProfileChange event) rather than this view
   * starting file watchers of its own — one watcher, two consumers.
   */
  setProfile(profile: AndroidProjectProfile | undefined): void {
    this.profile = profile;
    this._onDidChangeTreeData.fire();
  }

  /** Repaint from the profile already held. */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    // Flat index: every section is a root row, and no row has children.
    if (element) {
      return [];
    }
    return orderedSections(this.profile).map(
      (section) => new SectionTreeItem(section)
    );
  }
}

// One section row: the section's own title and codicon, and a click that runs its
// entry command. The command is taken from the descriptor rather than re-derived
// here, so a section that changes how it opens changes in exactly one place.
export class SectionTreeItem extends vscode.TreeItem {
  constructor(readonly section: SectionDescriptor) {
    const title = l10n(section.titleKey);
    super(title, vscode.TreeItemCollapsibleState.None);

    this.iconPath = new vscode.ThemeIcon(section.icon);
    this.tooltip = l10n("controlCenter.rowTooltip", { section: title });
    // Stable, section-scoped so a later per-section menu entry can match one row
    // without matching every row.
    this.contextValue = `section:${section.id}`;
    this.command = {
      command: section.entryCommand,
      title,
    };
  }
}
