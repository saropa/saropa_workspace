import { l10n } from "../i18n/l10n";
import type { LauncherItem } from "./launcherItems";

export interface NoteItemInput {
  readonly path: string;
  readonly filename: string;
  readonly scope: "project" | "global";
  readonly relative: string;
  readonly preview: string;
}

export function noteLauncherItem(n: NoteItemInput): LauncherItem {
  const label = n.filename.replace(/\.[^.]+$/, "");
  const scopeLabel = n.scope === "global"
    ? l10n("launcher.notesGlobal")
    : l10n("launcher.notesProject");
  return {
    id: n.path,
    label,
    sub: n.relative,
    desc: n.preview || undefined,
    pane: "notes",
    section: scopeLabel,
    groupId: `notes:${n.scope}`,
    groupIcon: n.scope === "global" ? "globe" : "note",
    groupColor: "foreground",
    icon: "note",
    color: "foreground",
    kind: "file",
    runnable: false,
    openable: true,
    copyable: false,
    menu: [],
  };
}
