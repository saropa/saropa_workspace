import { l10n } from "../i18n/l10n";
import type { LauncherItem } from "./launcherItems";

/** The note facts needed to build its launcher card, already formatted for display. */
export interface NoteItemInput {
  readonly path: string;
  readonly filename: string;
  readonly scope: "project" | "global";
  readonly relative: string;
  readonly preview: string;
}

/** Builds the launcher card for a note: name without extension, its age as the subtitle, grouped by project or global scope, with the preview in the drawer. */
export function noteLauncherItem(n: NoteItemInput): LauncherItem {
  // The card shows the note name without its extension (".md" adds nothing to a title).
  const label = n.filename.replace(/\.[^.]+$/, "");
  const scopeLabel = n.scope === "global"
    ? l10n("launcher.notesGlobal")
    : l10n("launcher.notesProject");
  // Notes are plain files the user reads or edits, never run: runnable and copyable are
  // off, openable is on. The id is the absolute path, which the host checks against its
  // own note list when the webview asks to open it, so an unknown path is ignored.
  return {
    id: n.path,
    label,
    sub: n.relative,
    // An empty preview becomes undefined so the drawer shows nothing instead of a blank box.
    desc: n.preview || undefined,
    pane: "notes",
    section: scopeLabel,
    // One group per scope so project and global notes sort into separate sections.
    groupId: `notes:${n.scope}`,
    groupIcon: n.scope === "global" ? "globe" : "note",
    groupColor: "foreground",
    icon: "note",
    color: "foreground",
    kind: "file",
    runnable: false,
    openable: true,
    copyable: false,
    // Notes carry no right-click menu entries on the launcher.
    menu: [],
  };
}
