import { Pin, PinAction, PinExecConfig, PinSchedule, pinKind } from "../model/pin";
import { l10n } from "../i18n/l10n";

// "Share this Pin" (roadmap WOW #4). A pin's configuration is encoded into a
// clickable VS Code URI so a perfected run/macro/recipe can be pasted into chat and
// imported by a teammate in one click, instead of recreated by hand.
//
// The link carries ONLY the portable configuration — never the id, scope, or order,
// which are recreated on import. Importing adds the pin but never runs it (a shared
// shell command must be a deliberate, visible choice), so a malicious link can at
// worst add a pin the user can inspect and delete.

// Extension id (publisher.name from package.json), used as the URI authority so the
// link routes back to this extension's registered handler.
const EXTENSION_ID = "saropa.saropa-workspace";
// Bumped if the shared shape changes incompatibly; decode rejects other versions.
const SCHEMA_VERSION = 1;

// The portable subset of a pin carried in a share link.
export interface SharedPin {
  v: number;
  label?: string;
  // File pins only (relative for a project pin — resolves in the same repo; absolute
  // for a global pin — only round-trips on the same machine). The real value is
  // sharing path-light action/exec pins.
  path?: string;
  action?: PinAction;
  exec?: PinExecConfig;
  icon?: string;
  color?: string;
  schedule?: PinSchedule;
}

// Reduce a pin to its shareable fields.
export function toSharedPin(pin: Pin): SharedPin {
  return {
    v: SCHEMA_VERSION,
    label: pin.label,
    path: pinKind(pin) === "file" ? pin.path : undefined,
    action: pin.action,
    exec: pin.exec,
    icon: pin.icon,
    color: pin.color,
    schedule: pin.schedule,
  };
}

// Encode a pin as a clickable import link. base64url (no '+' '/' '=') survives a
// chat client or URL parser that would otherwise mangle standard base64.
export function encodePinLink(pin: Pin): string {
  const json = JSON.stringify(toSharedPin(pin));
  const data = Buffer.from(json, "utf8").toString("base64url");
  return `vscode://${EXTENSION_ID}/import?data=${data}`;
}

// Decode the ?data= payload back into a SharedPin, or undefined if it is missing,
// not valid base64/JSON, the wrong schema version, or carries nothing
// runnable/openable. Never throws — a bad link degrades to "invalid", not a crash.
export function decodeSharedPin(
  data: string | null | undefined
): SharedPin | undefined {
  if (!data) {
    return undefined;
  }
  try {
    const json = Buffer.from(data, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as SharedPin;
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

// One-line human summary of what an imported pin would do, shown in the import
// confirm dialog so the user sees the command/URL before adding it. Reuses the
// recipe-description strings so the wording matches the rest of the product.
export function describeSharedPin(shared: SharedPin): string {
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
