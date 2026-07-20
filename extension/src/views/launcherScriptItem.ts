import { l10n } from "../i18n/l10n";
import type { LauncherItem, LauncherMenuEntry } from "./launcherItems";

// The plain inputs the host distills a LibraryScript into. Kept minimal: the
// launcher card needs the display facets and the id to route a Run back to the
// host, but never the full config (the host resolves that by id).
export interface ScriptItemInput {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly icon: string;
  readonly tags: readonly string[];
  // Whether the manifest args/command/cwd carry an interactive token
  // (${prompt:}/${pick:}/${pickFolder:}) — gates the "Set Params…" menu entry so
  // a script with nothing to configure does not offer an empty editor. Computed by
  // the caller (launcherViewData.ts), which already has promptTokens available.
  readonly hasParams: boolean;
}

// Build the launcher card for one bundled library script. Scripts are always
// runnable (the extension ships them, so the entry file exists by construction);
// the card leads with a Run head button. Tags drive the group header, mirroring
// the sidebar's tag-folder structure. When a script carries multiple tags it
// appears under each group — same as the sidebar tree.
export function scriptLauncherItem(s: ScriptItemInput): LauncherItem {
  const menu: LauncherMenuEntry[] = s.hasParams
    ? [
        {
          command: "saropaWorkspace.setScriptParams",
          label: l10n("launcher.menu.setParams"),
          icon: "list-flat",
          group: "configure",
        },
      ]
    : [];
  return {
    id: `library:${s.id}`,
    label: s.label,
    sub: s.tags.join(", "),
    desc: s.description,
    pane: "scripts",
    section: l10n("launcher.scriptsSection"),
    groupId: "scripts",
    groupIcon: "library",
    groupColor: "charts.yellow",
    icon: s.icon,
    color: "charts.yellow",
    kind: "script",
    runnable: true,
    openable: false,
    headAction: "run",
    copyable: false,
    menu,
  };
}
