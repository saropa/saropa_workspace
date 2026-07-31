import * as vscode from "vscode";
import { Shortcut } from "./shortcut";

// Centralized display-name resolution for shortcuts. Every surface that shows a
// shortcut's name (tree row, launcher card, panel title, toast) resolves through
// here so the title-case preference applies uniformly.

export function shortcutDisplayName(shortcut: Shortcut): string {
  if (shortcut.label) {
    return shortcut.label;
  }
  const basename = shortcut.path.split("/").pop() ?? shortcut.path;
  if (isTitleCaseEnabled()) {
    return toTitleCase(basename);
  }
  return basename;
}

function isTitleCaseEnabled(): boolean {
  return vscode.workspace
    .getConfiguration("saropaWorkspace")
    .get<boolean>("displayNames.titleCase", false);
}

// "setup_arb_translate.py" → "Setup Arb Translate"
// Strips the file extension, replaces underscores/hyphens with spaces,
// then capitalizes the first letter of each word.
export function toTitleCase(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  return stem
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
