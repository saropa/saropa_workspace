import { ShortcutKind } from "../model/shortcut";

// The pure (vscode-free) half of the shortcut row visual language: the default codicon
// glyph + theme-color a shortcut wears at rest, keyed by file type or action kind. Split
// out of shortcutRowTokens.ts — which imports `vscode` to return ThemeIcon/ThemeColor —
// so the launcher's unit-tested, vscode-free data layer can reuse the SAME maps instead
// of duplicating the palette. shortcutRowTokens re-exports these, so the tree code keeps
// its single import surface and the maps live in exactly one place.

// A default glyph + tint for a common file type. The color is a theme-color id (the
// chart palette), theme-aware, so a tint resolves in light/dark/high-contrast.
export interface FileTypeIcon {
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

// Default tint per non-file action kind, so an action card in the launcher always
// carries a meaningful color (the tree leaves these untinted, but the launcher's design
// bar is "color for every item"). A learnable family: shells green, links blue, commands
// purple, macros orange, routines yellow — matching the recipe-group palette so a shell
// recipe and a hand-made shell shortcut read as the same color of thing.
export function kindColor(kind: ShortcutKind): string {
  switch (kind) {
    case "url":
      return "charts.blue";
    case "shell":
      return "charts.green";
    case "command":
      return "charts.purple";
    case "macro":
      return "charts.orange";
    case "routine":
      return "charts.yellow";
    default:
      return "charts.foreground";
  }
}
