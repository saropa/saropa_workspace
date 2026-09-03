# BUG-010: Default auto-pin patterns and project file groups are Dart/Flutter-specific

**Status: Fixed**

<!-- Status values: Open → Investigating → Fix Ready → Closed -->

Created: 2026-09-02
Area: Packaging
File(s): `extension/package.json` (`contributes.configuration`)
Severity: Low
Extension version: 1.6.12

---

## Summary

The default configuration values are biased toward Dart/Flutter projects:

- `autoPins.patterns` defaults to `["pubspec.yaml", "analysis_options.yaml"]` — Dart-specific files that do not exist in most projects.
- `projectFiles.groups` default includes `android/`, `ios/`, `web/` paths — Flutter-specific directory structures.

For non-Dart users, these defaults produce empty auto-pin results and irrelevant project file groupings. A general-purpose extension should ship with language-agnostic defaults or detect the project type.

---

## Attribution Evidence

Both settings are declared in `extension/package.json` under `contributes.configuration`. The defaults are static values in the manifest.

---

## Reproducer

1. Install the extension in a non-Dart project (e.g. a Node.js, Python, or Go project).
2. Check the auto-pins — `pubspec.yaml` and `analysis_options.yaml` do not exist, so no auto-pins are created.
3. Check the project file groups — `android/`, `ios/`, `web/` directories do not exist, so those groups are empty.

**Frequency:** Always, for any non-Dart/Flutter project.

---

## Expected vs Actual

| | Behavior |
|---|---|
| **Expected** | Default auto-pin patterns and project file groups are language-agnostic (e.g. `package.json`, `README.md`, `Makefile`, `.gitignore`) or the extension detects the project type and adjusts defaults accordingly. |
| **Actual** | Defaults assume a Dart/Flutter project. Non-Dart users get empty auto-pins and irrelevant groups on first use. |

---

## State / Flow Context

```
package.json contributes.configuration
  └─ saropaWorkspace.autoPins.patterns
      └─ default: ["pubspec.yaml", "analysis_options.yaml"]   ← Dart-specific

  └─ saropaWorkspace.projectFiles.groups
      └─ default includes android/, ios/, web/   ← Flutter-specific
```

---

## Root Cause

The extension was originally developed for Dart/Flutter projects and the defaults reflect that origin. They were not updated to be language-agnostic when the extension became a general-purpose tool.

---

## Suggested Fix

Two approaches (not mutually exclusive):

1. **Language-agnostic defaults**: Change the default `autoPins.patterns` to files common across ecosystems (e.g. `package.json`, `README.md`, `Makefile`, `.env.example`). Change `projectFiles.groups` to remove Flutter-specific paths and use general directory structures.

2. **Project-type detection**: Use the existing detection helpers to identify the project type at activation and apply appropriate defaults. Keep Dart/Flutter defaults for Dart/Flutter projects, but use different defaults for other project types.

Option 1 is simpler and lower-risk. Option 2 provides a better experience but adds complexity.

---

## Changes Made

Applied option 1 (language-agnostic defaults) in `extension/package.json`:

- `saropaWorkspace.autoPins.patterns` default changed from `["pubspec.yaml", "analysis_options.yaml"]` to `["package.json", "README.md", "Makefile", ".env.example"]`.
- `saropaWorkspace.projectFiles.groups` default: removed the Dart/Flutter-only entries `pubspec.yaml`, `analysis_options.yaml`, `l10n.yaml` from the `Project` group, and removed the `Android`, `iOS`, and `Web` groups entirely (all Flutter-specific paths). The `Project` group now lists only cross-ecosystem files: `README.md`, `CHANGELOG.md`, `ROADMAP.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, `LICENSE.md`, `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`.

No `package.nls.json` change needed — these are default values, not display strings.

---

## Verification

- [x] `tsc -p ./ --noEmit` clean
- [x] `npm run build` (`node esbuild.js`) succeeds
- [ ] Manual smoke test: open a non-Dart project, confirm auto-pins and project file groups produce useful results with the new defaults

---

## Commits

<!-- Add commit hashes as fixes land. -->

---

## Environment

- saropa_workspace version: 1.6.12
- VS Code version: any
- OS: any
- Pin scope (project / global): project
- Settings Sync enabled (yes / no): n/a

---

## Reflection

### Hardening items

- `extension/src/model/shortcutStoreDefaultGroups.ts` still carries a Dart-specific default binding: `"flutter.dance": "default:build"` (line 111). This is the same class of bias this bug fixed in `package.json` — a hardcoded Flutter recipe key in a general-purpose default group map. Not in scope for this bug (different file, different setting), but it is the same root cause and should get its own bug report if the `default:build` group is meant to be ecosystem-neutral.
- The `default:code` file-type regex in the same file (line 84) lists `dart` alongside `ts|tsx|js|...|py|go|rs|java|...` — this one is fine (it is a superset covering many languages, not Dart-biased), but it is worth confirming during any future audit that no single-language regex list creeps back in as ecosystems are added.
- `extension/src/recipes/detectorEcosystem.ts` already does correct multi-ecosystem detection (Flutter/`pubspec.yaml`, Django, Cargo.toml, pyproject.toml, go.mod — see lines 31-34, 86, 204-215) and should be treated as the reference pattern for "detect, don't assume" — worth pointing future auto-pin/project-file-group work at this file instead of re-deriving Option 2 (project-type detection) from scratch.
- The fix (Option 1, static language-agnostic defaults) does not cover the case an actual Dart/Flutter project now faces post-fix: `pubspec.yaml`, `analysis_options.yaml`, and the Android/iOS/Web groups were removed from defaults entirely, so a fresh Dart/Flutter install now gets weaker out-of-the-box coverage than before (users must add these back manually). This is an accepted trade-off per the bug's own Option 1 vs Option 2 analysis, but it is a real regression for the extension's original user base and should be flagged if Dart/Flutter usage telemetry or feedback surfaces it.
- Manual smoke test in `## Verification` is still unchecked (`open a non-Dart project, confirm auto-pins and project file groups produce useful results with the new defaults`) — the fix is verified only by type-check and build, not by an actual non-Dart-project run.

### Suggestions

- Run `detectorEcosystem.ts`'s existing detection at first-activation time to seed `autoPins.patterns` per-project (Option 2), rather than shipping one static language-agnostic list — this would restore full Dart/Flutter coverage without reintroducing bias for other ecosystems, and reuses code that already exists instead of adding a parallel detection path.
- Grep the rest of `extension/src/**` for other `pubspec.yaml` / `flutter` / `android`/`ios`/`web`-literal defaults (e.g. `pubspecOutdated.ts`, `shortcutStoreDefaultGroups.ts`) as a follow-up sweep, since this bug was scoped to `package.json` only and the same bias pattern is confirmed to exist at least once more elsewhere.
- Complete the outstanding manual smoke test (open a non-Dart project, e.g. this repo's own `extension/` folder minus `pubspec.yaml`, and confirm auto-pins/groups populate) before closing this out as fully verified.
