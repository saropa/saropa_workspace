# Ignore generated Saropa cache and the project pin store

Generated diagnostic/index files under `.saropa/` and the project-scoped pin
store at `.vscode/saropa-workspace.json` were tracked by git. The former churns
on every run (timestamps, `buildTime`, trigram search indexes); the latter can
hold sensitive file names a user pins and would publish them to a public remote.

## Finish Report (2026-06-26)

### Defect
- `.saropa/` held machine-generated, per-run output (advisor/history/log-capture
  diagnostics, the reports index, and the trigram search manifest). Five files
  were tracked and three showed perpetual modifications in the working tree —
  pure generated churn, not source.
- `.vscode/saropa-workspace.json` is the project-scoped pin store. Its `pins[].path`
  values are whatever the user pins. A sensitive file name pinned there would be
  committed and pushed, leaking it on a public repository or the Marketplace.

### Change
- `.gitignore`: replaced the two narrow `.saropa/index/reports.idx.json` and
  `.saropa/diagnostics/log-capture.json` entries with a folder-level `.saropa/`
  ignore (covers advisor.json, history.json, search/manifest.json, and any future
  cache file), and added `.vscode/saropa-workspace.json`.
- Both paths were removed from tracking with `git rm --cached` (the deletions
  landed via commit `4556402`); the local files remain on disk.

### Scope considered, left tracked
- `.vscode/launch.json`, `.vscode/tasks.json`: portable (`${workspaceFolder}`,
  relative `extension` path). Shared dev setup — kept tracked.
- `.vscode/settings.json`: kept tracked, but carries one machine-specific path
  (`python.defaultInterpreterPath` → a user-home Python install). Flagged as an
  open question — either drop that line or move it out of the shared file; the
  remaining tree-indent settings are genuinely shareable.

### Verification
- `git check-ignore` confirms `.saropa/index/reports.idx.json` and
  `.vscode/saropa-workspace.json` are ignored.
- `git ls-tree -r HEAD` confirms neither path is tracked.
