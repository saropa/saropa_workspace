import { Shortcut, ShortcutAction, ShortcutExecConfig, ShortcutSchedule, shortcutKind } from "../model/shortcut";
import { l10n } from "../i18n/l10n";

// "Share this Shortcut" (roadmap WOW #4). A shortcut's configuration is encoded into
// a clickable VS Code URI so a perfected run/macro/recipe can be pasted into chat and
// imported by a teammate in one click, instead of recreated by hand.
//
// The link carries ONLY the portable configuration — never the id, scope, or order,
// which are recreated on import. Importing adds the shortcut but never runs it (a
// shared shell command must be a deliberate, visible choice), so a malicious link can
// at worst add a shortcut the user can inspect and delete.

// Extension id (publisher.name from package.json), used as the URI authority so the
// link routes back to this extension's registered handler.
const EXTENSION_ID = "saropa.saropa-workspace";
// Bumped if the shared shape changes incompatibly; decode rejects other versions.
const SCHEMA_VERSION = 1;

// The portable subset of a shortcut carried in a share link.
export interface SharedShortcut {
  v: number;
  label?: string;
  // File shortcuts only (relative for a project shortcut — resolves in the same repo;
  // absolute for a global shortcut — only round-trips on the same machine). The real
  // value is sharing path-light action/exec shortcuts.
  path?: string;
  action?: ShortcutAction;
  exec?: ShortcutExecConfig;
  icon?: string;
  color?: string;
  schedule?: ShortcutSchedule;
}

// Reduce a shortcut to its shareable fields.
export function toSharedShortcut(shortcut: Shortcut): SharedShortcut {
  return {
    v: SCHEMA_VERSION,
    label: shortcut.label,
    path: shortcutKind(shortcut) === "file" ? shortcut.path : undefined,
    action: shortcut.action,
    exec: shortcut.exec,
    icon: shortcut.icon,
    color: shortcut.color,
    schedule: shortcut.schedule,
  };
}

// Encode a shortcut as a clickable import link. base64url (no '+' '/' '=') survives a
// chat client or URL parser that would otherwise mangle standard base64.
export function encodeShortcutLink(shortcut: Shortcut): string {
  const json = JSON.stringify(toSharedShortcut(shortcut));
  const data = Buffer.from(json, "utf8").toString("base64url");
  return `vscode://${EXTENSION_ID}/import?data=${data}`;
}

// Decode the ?data= payload back into a SharedShortcut, or undefined if it is missing,
// not valid base64/JSON, the wrong schema version, or carries nothing
// runnable/openable. Never throws — a bad link degrades to "invalid", not a crash.
export function decodeSharedShortcut(
  data: string | null | undefined
): SharedShortcut | undefined {
  if (!data) {
    return undefined;
  }
  try {
    const json = Buffer.from(data, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as SharedShortcut;
    if (!parsed || parsed.v !== SCHEMA_VERSION) {
      return undefined;
    }
    if (!parsed.path && !parsed.action) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

// One-line human summary of what an imported shortcut would do, shown in the import
// confirm dialog so the user sees the command/URL before adding it. Reuses the
// recipe-description strings so the wording matches the rest of the product.
export function describeSharedShortcut(shared: SharedShortcut): string {
  const action = shared.action;
  if (action) {
    switch (action.kind) {
      case "url":
        return l10n("recipe.desc.url", { url: action.url ?? "" });
      case "shell":
        return l10n("recipe.desc.shell", { command: action.shellCommand ?? "" });
      case "command":
        return l10n("recipe.desc.command", { id: action.commandId ?? "" });
      case "macro":
        return l10n("recipe.desc.macro", {
          steps: (action.steps ?? [])
            .map((s) => s.label ?? s.kind)
            .join(" -> "),
        });
    }
  }
  return shared.path ?? "";
}
