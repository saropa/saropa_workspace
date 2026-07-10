import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { ShortcutScope } from "../model/shortcut";
import { l10n } from "../i18n/l10n";
import { asShortcut } from "./shortcutArgResolution";

// Comment/separator list annotations and hand-authored URL "shortcuts" — entries with
// no file backing. Split out of shortcutSelection.ts.

// Add a comment or separator annotation that labels / divides the shortcut list. When
// invoked from a shortcut's context menu the annotation is inserted right after that
// shortcut (same scope + group), so it lands where the user clicked; from the view
// title it appends to the project scope's top level. A comment prompts for its
// text; a separator carries none. Reports the added entry, naming its text.
export async function addAnnotation(
  store: ShortcutStore,
  kind: "comment" | "separator",
  arg: unknown
): Promise<void> {
  const after = asShortcut(arg);
  let label: string | undefined;
  if (kind === "comment") {
    label = await vscode.window.showInputBox({
      prompt: l10n("annotation.commentPrompt"),
      placeHolder: l10n("annotation.commentPlaceholder"),
      validateInput: (value) =>
        value.trim().length === 0 ? l10n("annotation.commentEmptyError") : undefined,
    });
    // Esc / empty cancels — nothing is added.
    if (label === undefined) {
      return;
    }
  }
  const scope: ShortcutScope = after?.scope ?? "project";
  const added = await store.addAnnotationShortcut(kind, scope, label, after);
  if (!added) {
    // The only failure path is a project annotation with no workspace folder open.
    vscode.window.showWarningMessage(l10n("annotation.noWorkspace"));
    return;
  }
  vscode.window.showInformationMessage(
    kind === "comment"
      ? l10n("annotation.commentAdded", { text: label?.trim() ?? "" })
      : l10n("annotation.separatorAdded")
  );
}

// A bare host/path with no scheme (e.g. "github.com/saropa") is treated as https so it
// just works; an explicit scheme (http/https/mailto/vscode/file/...) is preserved. The
// runner opens the stored value verbatim via Uri.parse, so normalizing here is what
// makes a scheme-less entry openable rather than parsed as a relative reference.
function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// Add a website/URL shortcut the user authored by hand. Prompts for the URL (required)
// then an optional display label; a single click opens the site directly. When invoked
// from a shortcut's context menu the shortcut is inserted right after that shortcut
// (same scope + group), so it lands where the user clicked; from a view-title entry it
// appends to the given scope's top level. Reports the added shortcut, naming it.
export async function addUrl(
  store: ShortcutStore,
  scope: ShortcutScope,
  arg: unknown
): Promise<void> {
  const after = asShortcut(arg);
  const url = await vscode.window.showInputBox({
    prompt: l10n("url.addPrompt"),
    placeHolder: l10n("url.addPlaceholder"),
    validateInput: (value) =>
      value.trim().length === 0 ? l10n("url.emptyError") : undefined,
  });
  // Esc / empty cancels — nothing is added.
  if (url === undefined) {
    return;
  }
  // The label is optional: submitting empty ("") keeps the URL as the display name;
  // Esc (undefined) backs out of the whole gesture, matching a multi-step input flow.
  const label = await vscode.window.showInputBox({
    prompt: l10n("url.labelPrompt"),
    placeHolder: l10n("url.labelPlaceholder"),
  });
  if (label === undefined) {
    return;
  }
  const normalized = normalizeUrl(url);
  const targetScope: ShortcutScope = after?.scope ?? scope;
  const added = await store.addUrlShortcut(normalized, targetScope, label, after);
  if (!added) {
    // The only failure path is a project entry with no workspace folder open.
    vscode.window.showWarningMessage(l10n("url.noWorkspace"));
    return;
  }
  vscode.window.showInformationMessage(
    l10n("url.added", { name: label.trim() || normalized, url: normalized })
  );
}
