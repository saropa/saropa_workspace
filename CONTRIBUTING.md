# Contributing to Saropa Workspace

Thank you for your interest in contributing! This guide will help you get
started.

Saropa Workspace is a Visual Studio Code extension written in TypeScript. It
lets you pin files and scripts as favorites: single-click opens a pin,
double-click runs a script, with per-pin run parameters (command prefix,
args, working directory, environment). Pins are scoped per project
(`.vscode/saropa-workspace.json`) or globally (synced via Settings Sync).

## Code of Conduct

Be respectful and constructive. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## How to Contribute

### Reporting Issues

1. Search existing issues first.
2. Include: VS Code version, your OS, the extension version, a minimal
   reproduction, and expected vs actual behavior.
3. For a structured bug report inside this repo, see
   [bugs/BUG_REPORT_GUIDE.md](bugs/BUG_REPORT_GUIDE.md).

### Suggesting a Feature

1. Open an issue describing the workflow you want.
2. Include:
   - What the feature does and where it appears (sidebar, command palette,
     context menu, settings).
   - Why it matters (the manual step it removes, the mistake it prevents).
   - Any new settings keys, commands, or pin fields it would need.

### Submitting Code

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/short-description`.
3. Make your changes.
4. Run the verification steps under **Build, Run, and Verify** below.
5. Update [CHANGELOG.md](CHANGELOG.md) (see **Changelog Requirement**).
6. Open a pull request (see **Pull Request Checklist**).

## Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/saropa_workspace.git
cd saropa_workspace/extension

# Install dependencies
npm install
```

All extension code and tooling live under `extension/`. Run `npm` commands
from inside that directory.

## Project Layout

The extension source lives in `extension/src/`, grouped by concern:

| Folder | Purpose |
|--------|---------|
| `model/` | Pin data model and storage (`pin.ts`, `pinStore.ts`) — project file + `globalState`. |
| `views/` | Activity-bar tree view (`pinsTreeProvider.ts`, `pinTreeItem.ts`). |
| `commands/` | Command handlers (`pinCommands.ts`): pin, open, run, rename, unpin, restore. |
| `exec/` | Script execution (`runner.ts`) and double-click detection (`doubleClick.ts`). |
| `schedule/` | Scheduled runs for pinned scripts. |
| `i18n/` | Runtime string lookup (`l10n.ts`) reading `i18n/locales/en.json`. |

Other key files:

| File | Purpose |
|------|---------|
| `extension/src/extension.ts` | Activation entry point; wires up the view, commands, and stores. |
| `extension/package.json` | Manifest: commands, menus, views, settings, activation. |
| `extension/package.nls.json` | Display strings for manifest (`%key%` references). |
| `extension/src/i18n/locales/en.json` | Runtime user-facing strings (looked up by `l10n()`). |
| `extension/esbuild.js` | Bundler config. |
| `extension/tsconfig.json` | TypeScript compiler config (strict). |

## Build, Run, and Verify

From `extension/`:

```bash
npm install          # install dependencies
npm run build        # bundle once with esbuild
npm run watch        # rebuild on change while developing
npm run package      # production bundle (used by vsce / vscode:prepublish)
```

To try the extension interactively, open the repo in VS Code and press **F5**.
This launches the **Extension Development Host** — a second VS Code window
with the extension loaded. Make a change, then reload that window (or rely on
`npm run watch`) to pick it up.

### Verification (required before opening a PR)

There is no Dart, no analyzer, and no `dart test` here. Verify a change by:

1. **TypeScript compiles clean** — `tsc -p ./ --noEmit` reports no errors.
2. **The bundle builds** — `npm run build` succeeds.
3. **Manual smoke test** in the Extension Development Host — exercise the
   behavior you changed (pin a file, run a script, rename, unpin, restore
   auto-pins, etc.) and confirm it works and shows the right feedback.

State which of these you ran in the PR description.

## Coding Conventions

- **Strict TypeScript.** Keep `strict` mode satisfied; no `any` escapes where
  a real type is knowable. Prefer narrow, explicit types on public functions.
- **Comment WHY, not WHAT.** Explain non-obvious decisions, ordering
  dependencies, and the failure mode a guard prevents — not what the line
  literally does. Bug fixes get a short comment saying what was wrong and why
  the new code is correct.
- **Single source of truth.** Each value (a settings key, a command id, a
  default) lives in exactly one place. Reference it; do not duplicate the
  literal. Command ids and settings keys declared in `package.json` are the
  source of truth — match them exactly in code.
- **Use existing utilities.** Read pins through `pinStore`, run scripts
  through `runner`, look up strings through `l10n()`. Do not reimplement these
  inline.
- **Small, readable functions.** Favor early returns and vertical spacing over
  dense nested blocks.
- **American English** in all code, comments, strings, and docs (color,
  behavior, organize, "license" as a noun, etc.).
- **Safe collection access.** Do not index or take `.first` on a collection
  whose emptiness you have not proven; handle the empty/undefined case.

## Externalize User-Facing Strings (i18n)

Every string a user can read must be externalized — never hardcoded inline.
There are two catalogs, by where the string appears:

1. **Manifest strings** (titles, descriptions, view names, setting
   descriptions in `package.json`) use the `%key%` syntax and are defined in
   **`extension/package.nls.json`**.

   ```json
   // package.json
   { "command": "saropaWorkspace.runPin", "title": "%command.runPin.title%" }
   ```
   ```json
   // package.nls.json
   { "command.runPin.title": "Run Pin" }
   ```

2. **Runtime strings** (anything shown from TypeScript at run time — messages,
   prompts, input-box placeholders, tree labels you author) are looked up with
   `l10n('namespace.key')` and defined in
   **`extension/src/i18n/locales/en.json`**.

Rules:

- Never concatenate English around a dynamic value. Use a parameterized value
  in the catalog (`"Running {name}"`) and pass the token, so word order can
  differ per locale.
- Adding a new user-facing string means adding its key to the right catalog in
  the same change — this is routine, not a separate task.
- Exempt (leave literal): log/console/debug strings, command ids, settings
  keys, event names, file paths, and pure symbols.

## How to Add a Command

1. Declare the command in `extension/package.json` under
   `contributes.commands` (with a `%key%` title, a `category`, and an icon if
   it appears inline).
2. Add the title string to `extension/package.nls.json`.
3. If the command should appear in a menu (view title, view item context,
   Explorer context, editor title context) add it under `contributes.menus`
   with the right `when` clause. If it should be hidden from the command
   palette, add a `commandPalette` entry with `"when": "false"`.
4. Register the handler in `extension/src/extension.ts`, implementing it in
   `extension/src/commands/` (e.g. extend `pinCommands.ts`).
5. Verify: compile, build, and exercise the command in the dev host.

## How to Add a View Item / Change the Tree

The activity-bar view is driven by `views/pinsTreeProvider.ts` (the
`TreeDataProvider`) and `views/pinTreeItem.ts` (the items). To change what the
tree shows:

1. Update the provider to produce the items/groups you want.
2. Update `pinTreeItem.ts` for label, icon, `contextValue`, tooltip, and the
   `command` fired on selection.
3. If a new context-menu action is needed, gate it in `package.json` menus by
   `viewItem` (the item's `contextValue`).
4. Call the provider's refresh after any state change so the view updates.

## Changelog Requirement

Update [CHANGELOG.md](CHANGELOG.md) (root) in the **same change** as any
user-visible work — new or changed commands, settings, pin behavior, view
behavior, or packaging. Add bullets under `## [Unreleased]` in the correct
subsection (`Added` / `Changed` / `Fixed` / `Removed`). Never append to an
already-released version section. Pure internal refactors with no user-visible
effect do not need an entry.

## Pull Request Checklist

- [ ] TypeScript compiles clean (`tsc -p ./ --noEmit`).
- [ ] `npm run build` succeeds.
- [ ] Manual smoke test in the Extension Development Host passed for the
      changed behavior.
- [ ] User-facing strings externalized (`package.nls.json` / `l10n()`), not
      hardcoded.
- [ ] Command ids, settings keys, and `package.json` entries are consistent
      with the code.
- [ ] American English throughout.
- [ ] CHANGELOG.md updated under `[Unreleased]` for user-visible changes.
- [ ] No unrelated changes bundled in.

## Commit Messages

Use conventional commits:

```
feat: add scheduled runs for pinned scripts
fix: correct double-click detection on slow machines
docs: clarify project vs global pin storage
refactor: extract pin lookup into pinStore
```

**Only human authors as contributors.** Do not add trailers or lines that
credit any tool as a co-author or generator. Keep commit messages clean of
attribution lines.

## Questions?

Open an issue or discussion. We're happy to help.

**Email**: [dev@saropa.com](mailto:dev@saropa.com)
