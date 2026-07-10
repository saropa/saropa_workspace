// AUTO-GENERATED from @vscode/codicons metadata (dist/metadata.json) — do NOT edit by
// hand. Regenerate with the codicon catalog generator when the codicons package is
// upgraded. Every id here is a real product icon (it came straight from the icon font's
// own metadata), so the "verify every ThemeIcon id" rule is satisfied by construction.
//
// This is the single source of truth for the icon set offered by the Customize panel and
// the Quick icon QuickPick. ICON_CATEGORIES drives the grouped display order (each id maps
// to a customize.iconGroup.<id> label); ICON_KEYWORDS are search-match aids taken from the
// upstream icon metadata (tags + description), not display prose — they are matched as the
// user types but never shown as a translated string, so they live here rather than in the
// l10n catalog. 536 icons across 28 categories.

export interface IconCategory {
  // The codicon metadata category id; the panel maps it to a customize.iconGroup.<id> label.
  id: string;
  // The icon ids in this category, in the icon font's own order.
  ids: readonly string[];
}

// The grouped icon catalog itself: 28 categories in display order, each holding its icon
// ids in the icon font's own order (which the Customize icon grid preserves). Generated
// data — regenerate via the codicon catalog generator rather than hand-editing.
export const ICON_CATEGORIES: readonly IconCategory[] = [
  { id: "file", ids: ["archive", "file", "file-code", "files", "folder", "folder-opened", "new-file", "new-folder", "file-binary", "file-media", "file-pdf", "file-symlink-directory", "file-symlink-file", "file-text", "file-zip", "folder-active", "folder-library", "notebook-template", "root-folder", "root-folder-opened", "unarchive"] },
  { id: "development", ids: ["code", "json", "markdown", "notebook", "output", "package", "build", "edit-code", "mcp", "references", "surround-with", "type-hierarchy", "type-hierarchy-sub", "type-hierarchy-super"] },
  { id: "symbol", ids: ["symbol-class", "symbol-method", "array", "bracket-dot", "bracket-error", "index-zero", "percentage", "symbol-boolean", "symbol-color", "symbol-constant", "symbol-enum", "symbol-enum-member", "symbol-field", "symbol-file", "symbol-interface", "symbol-key", "symbol-keyword", "symbol-method-arrow", "symbol-misc", "symbol-module", "symbol-numeric", "symbol-operator", "symbol-parameter", "symbol-property", "symbol-reference", "symbol-ruler", "symbol-snippet", "symbol-string", "symbol-structure", "variable", "variable-group"] },
  { id: "text", ids: ["bold", "text-size", "horizontal-rule", "indent", "italic", "keyboard-tab", "keyboard-tab-above", "keyboard-tab-below", "newline", "no-newline", "quote", "quotes", "strikethrough", "whitespace", "word-wrap"] },
  { id: "content", ids: ["book", "checklist", "list-ordered", "list-unordered", "note", "list-flat", "list-selection", "list-tree", "table", "tasklist"] },
  { id: "action", ids: ["add", "bookmark", "check-all", "clear-all", "clippy", "close", "close-all", "cloud-download", "cloud-upload", "collapse-all", "copy", "edit", "eye", "eye-closed", "filter", "link-external", "merge", "mirror", "move", "new-session", "pin", "play", "preview", "record", "redo", "refresh", "remove", "replace", "save", "save-all", "trash", "watch", "zoom-in", "zoom-out", "add-small", "arrow-swap", "attach", "clone", "combine", "discard", "download", "edit-session", "eraser", "exclude", "expand-all", "export", "filter-filled", "fold", "fold-down", "fold-up", "go-to-editing-session", "grabber", "gripper", "group-by-ref-type", "insert", "lightbulb-autofix", "list-filter", "open-in-product", "open-in-window", "open-preview", "pinned", "pinned-dirty", "play-circle", "record-keys", "record-small", "remove-small", "rename", "replace-all", "run-above", "run-all", "run-below", "run-with-deps", "save-as", "screen-cut", "share", "skip", "sort-precedence", "stop-circle", "sync-ignored", "unfold", "ungroup-by-ref-type"] },
  { id: "navigation", ids: ["arrow-both", "arrow-circle-down", "arrow-circle-left", "arrow-circle-right", "arrow-circle-up", "arrow-down", "arrow-left", "arrow-right", "arrow-up", "chevron-down", "chevron-left", "chevron-right", "chevron-up", "home", "menu", "more", "arrow-small-down", "arrow-small-left", "arrow-small-right", "arrow-small-up", "compass", "compass-active", "compass-dot", "forward", "kebab-vertical", "three-bars"] },
  { id: "search", ids: ["case-sensitive", "regex", "search", "go-to-search", "preserve-case", "search-fuzzy", "search-large", "search-stop", "telescope", "whole-word"] },
  { id: "git", ids: ["diff", "diff-added", "diff-ignored", "diff-modified", "diff-removed", "diff-renamed", "git-branch", "git-commit", "git-merge", "git-pull-request", "repo", "source-control", "code-review", "diff-multiple", "diff-single", "file-submodule", "gist", "gist-fork", "gist-private", "gist-secret", "git-branch-changes", "git-branch-conflicts", "git-branch-staged-changes", "git-compare", "git-pull-request-closed", "git-pull-request-create", "git-pull-request-done", "git-pull-request-draft", "git-pull-request-go-to-changes", "git-pull-request-new-changes", "git-stash", "git-stash-apply", "git-stash-pop", "github-action", "github-project", "issue-draft", "issue-reopened", "merge-into", "repo-clone", "repo-fetch", "repo-force-push", "repo-pinned", "repo-pull", "repo-push", "repo-selected", "repo-sync", "request-changes", "versions"] },
  { id: "debug", ids: ["activate-breakpoints", "bug", "debug", "debug-alt", "debug-console", "coverage", "debug-all", "debug-alt-small", "debug-breakpoint-conditional", "debug-breakpoint-conditional-unverified", "debug-breakpoint-data", "debug-breakpoint-data-unverified", "debug-breakpoint-function", "debug-breakpoint-function-unverified", "debug-breakpoint-log", "debug-breakpoint-log-unverified", "debug-breakpoint-unsupported", "debug-connected", "debug-continue", "debug-continue-small", "debug-coverage", "debug-disconnect", "debug-line-by-line", "debug-pause", "debug-rerun", "debug-restart", "debug-restart-frame", "debug-reverse-continue", "debug-stackframe", "debug-stackframe-active", "debug-start", "debug-step-back", "debug-step-into", "debug-step-out", "debug-step-over", "debug-stop", "inspect", "run-all-coverage", "run-coverage", "run-errors"] },
  { id: "tool", ids: ["beaker", "circuit-board", "beaker-stop", "magnet", "paintcan", "tools", "wand"] },
  { id: "settings", ids: ["color-mode", "gear", "settings", "settings-gear"] },
  { id: "layout", ids: ["split-horizontal", "split-vertical", "window", "editor-layout", "layers", "layers-active", "layers-dot", "layout", "layout-activitybar-left", "layout-activitybar-right", "layout-centered", "layout-menubar", "layout-panel", "layout-panel-center", "layout-panel-dock", "layout-panel-justify", "layout-panel-left", "layout-panel-off", "layout-panel-right", "layout-sidebar-left", "layout-sidebar-left-dock", "layout-sidebar-left-off", "layout-sidebar-right", "layout-sidebar-right-dock", "layout-sidebar-right-off", "layout-statusbar"] },
  { id: "window", ids: ["chrome-close", "chrome-maximize", "chrome-minimize", "chrome-restore", "empty-window", "multiple-windows", "screen-full", "screen-normal", "window-active"] },
  { id: "application", ids: ["browser", "dashboard", "extensions", "terminal", "extensions-large", "terminal-bash", "terminal-cmd", "terminal-debian", "terminal-git-bash", "terminal-linux", "terminal-powershell", "terminal-tmux", "terminal-ubuntu"] },
  { id: "device", ids: ["device-camera", "device-camera-video", "device-mobile", "mic", "chip", "mic-filled", "mute", "unmute", "vm", "vm-active", "vm-connect", "vm-outline", "vm-running", "vm-small", "vr"] },
  { id: "storage", ids: ["cloud", "database", "cloud-small"] },
  { id: "connection", ids: ["remote", "remote-explorer", "send-to-remote-agent"] },
  { id: "communication", ids: ["ask", "broadcast", "call-incoming", "call-outgoing", "comment", "comment-discussion", "mail", "comment-discussion-quote", "comment-draft", "comment-unresolved", "feedback", "inbox", "live-share", "mail-read", "mail-reply", "megaphone", "mention", "radio-tower", "reactions", "rss", "send"] },
  { id: "notification", ids: ["bell", "bell-dot", "bell-slash", "bell-slash-dot"] },
  { id: "user", ids: ["account", "organization", "person", "log-in", "log-out", "person-add"] },
  { id: "status", ids: ["check", "circle-slash", "error", "info", "loading", "pass", "verified", "workspace-trusted", "alert", "error-small", "flag", "flame", "pass-filled", "pulse", "session-in-progress", "unverified", "verified-filled", "workspace-unknown", "workspace-untrusted"] },
  { id: "security", ids: ["key", "shield", "unlock", "lock-small"] },
  { id: "shape", ids: ["circle-filled", "circle-large-filled", "circle-large", "circle-outline", "circle-small", "circle-small-filled", "primitive-square", "triangle-down", "triangle-left", "triangle-right", "triangle-up"] },
  { id: "visualization", ids: ["graph", "graph-left", "graph-line", "graph-scatter", "pie-chart"] },
  { id: "brand", ids: ["azure", "azure-devops", "code-oss", "github-alt", "github-inverted", "logo-github", "octoface", "python", "ruby", "twitter", "vscode", "vscode-insiders"] },
  { id: "ai", ids: ["copilot", "sparkle", "agent", "chat-sparkle", "chat-sparkle-error", "chat-sparkle-warning", "comment-discussion-sparkle", "copilot-blocked", "copilot-error", "copilot-in-progress", "copilot-large", "copilot-not-connected", "copilot-snooze", "copilot-success", "copilot-unavailable", "copilot-warning", "copilot-warning-large", "edit-sparkle", "hubot", "lightbulb-sparkle", "robot", "search-sparkle", "sparkle-filled", "thinking"] },
  { id: "general", ids: ["briefcase", "calendar", "coffee", "credit-card", "dash", "globe", "heart", "issues", "law", "library", "lightbulb", "link", "location", "plug", "project", "question", "report", "rocket", "server", "star", "tag", "blank", "clockface", "collection", "collection-small", "cursor", "game", "gift", "heart-filled", "history", "jersey", "lightbulb-empty", "map", "map-filled", "map-vertical", "map-vertical-filled", "milestone", "mortar-board", "music", "new-collection", "piano", "server-environment", "server-process", "smiley", "snake", "squirrel", "star-full", "star-half", "target", "thumbsdown", "thumbsdown-filled", "thumbsup", "thumbsup-filled", "zap"] },
];

// Every offered icon id, flattened — used to validate a stored icon and to seed search.
export const ALL_ICON_IDS: readonly string[] = ICON_CATEGORIES.flatMap((c) => c.ids);

// The icon-id -> search-keyword map is generated data; it lives in iconKeywords.ts
// (merged from two parts) to keep this file under the line cap. Re-exported here so
// the catalog stays the single import surface for the Customize panel and its tests.
export { ICON_KEYWORDS } from "./iconKeywords";
