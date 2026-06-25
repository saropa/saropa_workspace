# Open a throwaway in-memory scratchpad

Developers create temp.json / scratch.md / query.sql in the repo root to format a
snippet or test a query, dirtying the git tree. This adds a "New Scratchpad" action
that opens an untitled, in-memory buffer that never touches disk and never appears in
git status.

## Finish Report (2026-06-25)

### Scope
VS Code extension (TypeScript). No Flutter/Dart code.

### What changed
- **`commands/scratchpad.ts`** (new): `newScratchpad()` shows a format picker
  (Markdown / JSON / SQL / JavaScript / Plain text, each with a codicon), then opens
  a fresh untitled document via `workspace.openTextDocument({ language, content: "" })`
  and shows it. A toast names the chosen format and states the one fact that makes a
  scratchpad safe to use freely: it is memory-only and invisible to git until saved.
- **New command `saropaWorkspace.newScratchpad`** ("New Scratchpad..."): registered in
  `registerPinCommands` (no store argument — it is a pure editor action). Surfaced in
  the Pins view title `···` overflow (its own `0_new` group so it sits above the
  share/import actions) and in the command palette.

### Design note (button, not a persistent tree row)
The pitch described a scratchpad "pinned to the top" as a tree row. VS Code `untitled:`
documents cannot be reopened by URI once closed, so a persistent scratchpad pin would
dangle on reload — which contradicts the pitch's own "lives entirely in memory"
requirement. The faithful implementation is therefore a one-click title-bar action that
creates the in-memory buffer; the buffer then lives as a normal untitled editor tab
(itself one click away in the tab bar) for as long as VS Code is open. This delivers the
pitch's actual value — a format-highlighted scratch buffer that never dirties git —
without a row that would lie about persistence.

### Verification
`npx tsc -p ./ --noEmit` exit 0; `node esbuild.js` exit 0; all three manifests
parse-validated. No test harness in the extension; verified by type-check, build, and
inspection.

### Localization
`scratch.placeholder` / `scratch.format.*` / `scratch.created` in `en.json`;
`command.newScratchpad.title` in `package.nls.json`. No MT pipeline in this repo.
