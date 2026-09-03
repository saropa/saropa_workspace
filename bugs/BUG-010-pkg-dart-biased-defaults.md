# BUG-010: Default auto-pin patterns and project file groups are Dart/Flutter-specific

**Status: Open**

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

<!-- Fill in when a fix is written. -->

---

## Verification

- [ ] `tsc -p ./ --noEmit` clean
- [ ] `npm run build` succeeds
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
