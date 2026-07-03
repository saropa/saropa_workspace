# Add Website Shortcuts from Project

Website (`url`) shortcuts could be authored one at a time by hand, but nothing
surfaced the URLs a project already declares, so a user had to retype the
repository page, issues link, or docs site that the manifests and git remote
already spelled out. This change adds a command that reads those structured
sources and offers the discovered addresses as project shortcuts in one
multi-select step.

## Finish Report (2026-07-03)

### Scope

VS Code extension (TypeScript) plus documentation. No Flutter/Dart, no
dependency changes.

### What changed

- **New `extension/src/recipes/urlCandidates.ts`.** Reuses the existing
  URL-opener recipe derivation (`pushUrlRecipes`) rather than text-scraping the
  source tree: the candidate set is exactly what the recipe engine already
  proves is real (git remote web views, `package.json` / `pubspec.yaml` /
  `pyproject.toml` listings, `mkdocs.yml` docs site), so it is near-zero noise.
  - `urlCandidatesFromRecipes(results)` — a pure mapper from `RecipeResult[]` to
    plain `{ label, url, description, icon }` candidates, deduped by href
    (keeping the first label). Exported so it is unit-testable without the
    extension host.
  - `detectUrlCandidates()` — iterates every open workspace folder, reads each
    folder's `package.json` and git remote, runs `pushUrlRecipes`, and flattens
    the results through the mapper.
- **New `extension/src/commands/scanUrls.ts`** — `scanProjectUrls(store)`.
  Gathers candidates, removes any whose href is already stored as a `url`
  shortcut in either scope (so a re-run surfaces only new addresses), then shows
  a pre-checked multi-select QuickPick. Each pick is added as a project-scoped
  `url` shortcut via `store.addUrlShortcut`. The empty result distinguishes
  "nothing declared" (`scanUrls.none`) from "all already pinned"
  (`scanUrls.allAdded`); the completion toast names the count and destination.
- **Registration** in `shortcutManagementCommands.ts`
  (`saropaWorkspace.scanProjectUrls`, no anchor argument — a bulk title-bar
  action).
- **i18n / manifest**: `scanUrls.*` runtime strings in
  `src/i18n/locales/en.json`, `command.scanProjectUrls.title`
  ("Add Website Shortcuts from Project...") in `package.nls.json`, and the
  command declaration (`$(search)` icon) plus add-submenu entry (`1_add@5`,
  after the two hand-authored URL entries) in `package.json`.
- **Docs**: a CHANGELOG Unreleased bullet, a README addition under Website
  Shortcuts, and STYLEGUIDE section 1.5a recording the convention this gesture
  establishes (discover from structured sources rather than scrape; pre-checked
  multi-select; never re-offer what exists; discovered project data lands in
  project scope).
- **Test**: `extension/src/test/urlCandidates.test.ts` — four cases pinning the
  mapper contract (map all four fields, dedup keeping first label, empty input +
  undefined passthrough, skip non-url / href-less results).

### Design decisions

- **Structured sources only, not a source scrape.** The reused derivation reads
  well-known files at each folder root; it never crawls or regexes file
  contents. This keeps the candidate list short and free of XML schemas,
  `localhost`, and test-fixture URLs. A full source scan (long-tail URLs behind
  a noise blocklist) was considered and deliberately deferred — the
  structured-only variant was the chosen scope.
- **Reuse over duplication.** `pushUrlRecipes` is called directly rather than
  `detectOnDemandRecipes`, which would also run the run-target and workspace
  pushers and then require filtering their non-url actions out.
- **Project scope.** Discovered URLs are derived from the repository, so they
  land in the shared (committed) project scope; a user can move one to global
  afterward.

### Known limitations (pre-existing, not introduced here)

- In a multi-root workspace, a URL discovered from a secondary folder's git
  remote is written into the first folder's project file, because the anchorless
  add path resolves to `workspaceFolders[0]`. This mirrors the existing
  hand-authored `addUrl` title-bar path and is a property of the store's
  add-without-anchor model, not of this change.

### Verification

- `npx tsc -p ./ --noEmit` — clean.
- `node esbuild.js` — bundle builds clean.
- Affected tests run under Node's built-in runner against the vscode stub:
  `urlCandidates.test.ts` (4), `menuStructure.test.ts` (6), `l10n.test.ts` (8)
  — all pass. `menuStructure`'s "every menu command is a declared command"
  confirms the new command's manifest wiring is consistent.
- The QuickPick flow itself requires the extension host (no
  `@vscode/test-electron` harness exists in the repo) and was audited by
  inspection.
