import * as vscode from "vscode";
import { ShortcutKind } from "../model/shortcut";

// Single source of truth for the Shortcuts tree's row glyphs and tints (UI plan,
// Phase 4). Every codicon id and ThemeColor a shortcut row can wear lives here, so the
// visual language is learnable and consistent and no call site invents a glyph.
//
// Two concerns are kept separate on purpose:
//  - resolveShortcutRowIcon owns the PRIORITY — which state wins when several apply.
//  - the branches below own the APPEARANCE — which glyph/tint each state uses.
//
// The priority is deliberate: transient, actionable states (running, a missing
// target, a locked prerequisite) win over resting ones (a user's custom icon, the
// auto/explicit default), so the row always shows the most actionable fact rather
// than a stale resting glyph. A green "last run passed" check must never sit on a
// file that has since been deleted, paused, or gone over budget — hence those
// states are tested first.
//
// Legend (what each reads as to the user):
//   loading~spin            — a run is in progress (or being stopped)
//   warning (untinted)      — a file shortcut whose target is missing/unresolvable
//   lock                    — blocked on an unmet prerequisite shortcut
//   <glyph> + disabled tint — paused: kept but not running on its own
//   <glyph> + warning tint  — a live metric is over its size threshold
//   pass / error            — the last run's outcome (green pass / red fail)
//   watch + yellow          — a time-bombed shortcut counting down to self-removal
//   star-empty              — an auto-shortcut (seeded, removable)
//   pin                     — a plain explicit shortcut

// The inputs the row icon decision reads. A flat value object (not the live Shortcut)
// so the decision is pure and testable, and so the call site states each signal
// explicitly rather than the resolver reaching into shortcut internals.
export interface ShortcutRowIconInput {
  readonly isRunning: boolean;
  readonly isStopping: boolean;
  readonly isFile: boolean;
  readonly hasResolvedUri: boolean;
  readonly missing: boolean;
  readonly locked: boolean;
  // Masked / vault shortcut (WOW #26): renders a lock glyph instead of the file-type or
  // custom icon, so a resting masked shortcut reveals nothing about its target.
  readonly masked: boolean;
  readonly paused: boolean;
  readonly metricOver: boolean;
  readonly lastRunOutcome: "success" | "failure" | undefined;
  readonly customIcon: string | undefined;
  readonly customColor: string | undefined;
  readonly hasExpiry: boolean;
  readonly isAuto: boolean;
  readonly kind: ShortcutKind;
  // Basename of a file shortcut's target (e.g. "pubspec.yaml"), used to pick a
  // file-type glyph + tint at rest. Undefined for non-file shortcuts.
  readonly fileName: string | undefined;
}

// Resolve the single ThemeIcon a resting/active shortcut row shows, applying the
// priority documented above. Annotation rows (comment/separator) never reach here
// — they are inert and set their own glyph before this is consulted.
export function resolveShortcutRowIcon(input: ShortcutRowIconInput): vscode.ThemeIcon {
  if (input.isRunning || input.isStopping) {
    return new vscode.ThemeIcon("loading~spin");
  }
  // Unresolvable folder OR a target deleted on disk: a green check on a gone file
  // misleads, so this wins over any stale last-run badge below.
  if (input.isFile && (!input.hasResolvedUri || input.missing)) {
    return new vscode.ThemeIcon("warning");
  }
  // Blocked on an unmet prerequisite: a prior session's green check does not mean
  // the dependency is satisfied now, so "not runnable yet" wins.
  if (input.locked) {
    return new vscode.ThemeIcon("lock");
  }
  // Masked / vault shortcut (WOW #26): a lock glyph that overrides the resting cosmetic
  // glyphs below (custom icon, last-run pass/fail, the file-type or default shortcut
  // icon), since any of those would leak a hint about the masked target on a shared
  // screen. Placed under the transient running/missing/locked states, which convey
  // actionable live state worth showing and reveal nothing about the file's identity.
  if (input.masked) {
    return new vscode.ThemeIcon("lock");
  }
  // Paused: the shortcut's own glyph, muted, so the row reads as "not running on its
  // own" while a manual run stays possible — a resting state, not an error tint.
  if (input.paused) {
    return new vscode.ThemeIcon(
      input.customIcon ?? (input.isFile ? "circle-slash" : kindIcon(input.kind)),
      new vscode.ThemeColor("disabledForeground")
    );
  }
  // Over its size threshold (#24): warning tint so "this file is too big" reads at
  // a glance; keeps the shortcut's own glyph when it has one, else a warning triangle.
  if (input.metricOver) {
    return new vscode.ThemeIcon(
      input.customIcon ?? "warning",
      new vscode.ThemeColor("list.warningForeground")
    );
  }
  // Last completed run outcome: green pass / red error.
  if (input.lastRunOutcome) {
    return input.lastRunOutcome === "success"
      ? new vscode.ThemeIcon("pass", new vscode.ThemeColor("testing.iconPassed"))
      : new vscode.ThemeIcon("error", new vscode.ThemeColor("testing.iconFailed"));
  }
  // Default glyph per action kind for a non-file shortcut with no custom icon.
  if (!input.isFile && !input.customIcon) {
    return new vscode.ThemeIcon(kindIcon(input.kind));
  }
  // User-chosen icon/color for the resting state (5.1); the transient states above
  // win, since they convey actionable state.
  if (input.customIcon) {
    return new vscode.ThemeIcon(
      input.customIcon,
      input.customColor ? new vscode.ThemeColor(input.customColor) : undefined
    );
  }
  // Time-bombed shortcut (WOW #9) at rest: a watch glyph so the pending self-removal
  // reads at a glance, filling the otherwise-idle slot for a default-glyph shortcut.
  if (input.hasExpiry) {
    return new vscode.ThemeIcon("watch", new vscode.ThemeColor("charts.yellow"));
  }
  // File shortcut at rest with no custom icon: a file-type glyph + tint derived from
  // the name, so .yaml/.json/.py/.dart read at a glance instead of one generic pin.
  // Falls through to the pin/star default for unmapped types, so nothing regresses.
  if (input.isFile) {
    const typed = fileTypeIcon(input.fileName);
    if (typed) {
      return new vscode.ThemeIcon(typed.icon, new vscode.ThemeColor(typed.color));
    }
  }
  // Auto-shortcut (seeded, removable) vs a plain explicit shortcut.
  return new vscode.ThemeIcon(input.isAuto ? "star-empty" : "pin");
}

// A default glyph + tint for a common file type. ThemeColor ids are the chart palette
// (theme-aware), so a tint always resolves in light/dark/high-contrast themes.
interface FileTypeIcon {
  readonly icon: string;
  readonly color: string;
}

// Common files VS Code recognizes by NAME, not extension (no dot, or a dot-prefixed
// name). Checked before the extension map so "Dockerfile" and ".gitignore" land on a
// meaningful glyph instead of falling through to the generic pin.
const FILE_NAME_ICONS: Readonly<Record<string, FileTypeIcon>> = {
  "dockerfile": { icon: "vm", color: "charts.blue" },
  "makefile": { icon: "settings-gear", color: "charts.foreground" },
  ".gitignore": { icon: "git-commit", color: "charts.foreground" },
  ".gitattributes": { icon: "git-commit", color: "charts.foreground" },
  "license": { icon: "law", color: "charts.yellow" },
  "license.md": { icon: "law", color: "charts.yellow" },
  "license.txt": { icon: "law", color: "charts.yellow" },
};

// Default glyph + tint per lowercase extension. The tints are grouped by ROLE so the
// language is learnable rather than per-extension noise: source code reads blue (JS
// yellow, Rust/JVM orange, Ruby red by ecosystem convention), config purple/orange,
// data/db purple-green, shells green, docs/media neutral-to-purple.
const FILE_EXT_ICONS: Readonly<Record<string, FileTypeIcon>> = {
  // Source code
  dart: { icon: "symbol-class", color: "charts.blue" },
  ts: { icon: "file-code", color: "charts.blue" },
  tsx: { icon: "file-code", color: "charts.blue" },
  mts: { icon: "file-code", color: "charts.blue" },
  cts: { icon: "file-code", color: "charts.blue" },
  js: { icon: "file-code", color: "charts.yellow" },
  jsx: { icon: "file-code", color: "charts.yellow" },
  mjs: { icon: "file-code", color: "charts.yellow" },
  cjs: { icon: "file-code", color: "charts.yellow" },
  py: { icon: "snake", color: "charts.blue" },
  go: { icon: "file-code", color: "charts.blue" },
  rs: { icon: "file-code", color: "charts.orange" },
  java: { icon: "file-code", color: "charts.orange" },
  kt: { icon: "file-code", color: "charts.orange" },
  c: { icon: "file-code", color: "charts.blue" },
  cpp: { icon: "file-code", color: "charts.blue" },
  h: { icon: "file-code", color: "charts.blue" },
  hpp: { icon: "file-code", color: "charts.blue" },
  rb: { icon: "file-code", color: "charts.red" },
  php: { icon: "file-code", color: "charts.purple" },
  swift: { icon: "file-code", color: "charts.orange" },
  // Config & manifests
  yaml: { icon: "settings-gear", color: "charts.purple" },
  yml: { icon: "settings-gear", color: "charts.purple" },
  toml: { icon: "settings-gear", color: "charts.orange" },
  ini: { icon: "settings-gear", color: "charts.foreground" },
  cfg: { icon: "settings-gear", color: "charts.foreground" },
  conf: { icon: "settings-gear", color: "charts.foreground" },
  properties: { icon: "settings-gear", color: "charts.foreground" },
  json: { icon: "json", color: "charts.yellow" },
  jsonc: { icon: "json", color: "charts.yellow" },
  xml: { icon: "code", color: "charts.orange" },
  env: { icon: "key", color: "charts.yellow" },
  // Data
  sql: { icon: "database", color: "charts.purple" },
  db: { icon: "database", color: "charts.blue" },
  sqlite: { icon: "database", color: "charts.blue" },
  csv: { icon: "graph", color: "charts.green" },
  tsv: { icon: "graph", color: "charts.green" },
  // Docs
  md: { icon: "markdown", color: "charts.blue" },
  markdown: { icon: "markdown", color: "charts.blue" },
  rst: { icon: "book", color: "charts.foreground" },
  txt: { icon: "file", color: "charts.foreground" },
  pdf: { icon: "file-pdf", color: "charts.red" },
  // Shells
  sh: { icon: "terminal-bash", color: "charts.green" },
  bash: { icon: "terminal-bash", color: "charts.green" },
  zsh: { icon: "terminal-bash", color: "charts.green" },
  ps1: { icon: "terminal-powershell", color: "charts.blue" },
  psm1: { icon: "terminal-powershell", color: "charts.blue" },
  bat: { icon: "terminal", color: "charts.foreground" },
  cmd: { icon: "terminal", color: "charts.foreground" },
  // Web
  html: { icon: "code", color: "charts.orange" },
  htm: { icon: "code", color: "charts.orange" },
  css: { icon: "paintcan", color: "charts.blue" },
  scss: { icon: "paintcan", color: "charts.purple" },
  sass: { icon: "paintcan", color: "charts.purple" },
  less: { icon: "paintcan", color: "charts.purple" },
  // Media
  png: { icon: "file-media", color: "charts.purple" },
  jpg: { icon: "file-media", color: "charts.purple" },
  jpeg: { icon: "file-media", color: "charts.purple" },
  gif: { icon: "file-media", color: "charts.purple" },
  webp: { icon: "file-media", color: "charts.purple" },
  ico: { icon: "file-media", color: "charts.purple" },
  svg: { icon: "symbol-color", color: "charts.purple" },
  // Locks & logs
  lock: { icon: "lock", color: "charts.foreground" },
  log: { icon: "output", color: "charts.foreground" },
};

// Resolve a file shortcut's default glyph + tint from its basename, or undefined for
// an unmapped type (the caller keeps the generic pin/star). Exact-name match wins over
// extension so "pubspec.lock" reads as a lock and "Dockerfile" gets its own glyph; the
// LAST dot decides the extension so "foo.test.ts" → ts and ".gitignore" (no extension)
// falls back to its name entry.
export function fileTypeIcon(fileName: string | undefined): FileTypeIcon | undefined {
  if (!fileName) {
    return undefined;
  }
  const lower = fileName.toLowerCase();
  const byName = FILE_NAME_ICONS[lower];
  if (byName) {
    return byName;
  }
  const dot = lower.lastIndexOf(".");
  // No dot, or a leading-dot dotfile with nothing after it: no extension to key on.
  if (dot <= 0) {
    return undefined;
  }
  return FILE_EXT_ICONS[lower.slice(dot + 1)];
}

// Default codicon for a non-file action kind when the shortcut has no custom icon. Part
// of the token map (kind → glyph) so the default glyphs live beside the state ones.
export function kindIcon(kind: ShortcutKind): string {
  switch (kind) {
    case "url":
      return "link-external";
    case "shell":
      return "terminal";
    case "command":
      return "symbol-event";
    case "macro":
      return "list-ordered";
    case "routine":
      // A routine runs a block of recipes back-to-back, so it reads as "run all"
      // rather than a single task.
      return "run-all";
    default:
      return "pin";
  }
}
