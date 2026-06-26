# Publish script overhaul

The release script `scripts/publish.py` required the operator to hand-cut the
version (edit `package.json`, rename the changelog `[Unreleased]` heading, ensure
the two agreed) before a full publish, and offered no pre-publish auditing or
post-publish confirmation. This change automates version numbering, adds a
read-only audit, and hardens the publish flow, while keeping the script
self-contained in one file per the repository convention.

## Finish Report (2026-06-25)

### Scope

Docs/scripts only. Touches `scripts/publish.py` (Python release tooling),
`.claude/skills/publishing/SKILL.md` (operator documentation), and the
`[Unreleased]` Maintenance section of `CHANGELOG.md`. No Flutter/Dart code, no
VS Code extension TypeScript, and no user-facing strings are affected.

### What changed

**Version-numbering automation.** A full publish now resolves the version
itself in `resolve_version()`:

- Default offered: a patch bump when `CHANGELOG.md` has an `[Unreleased]`
  section, otherwise the current `package.json` value, never lowered below a
  `## [x.y.z]` heading the author already wrote ahead by hand.
- Editable prompt with a timeout (Windows pre-fills and edits in place; Unix
  shows the default in brackets), validated against a semver pattern.
- Writes `package.json` via a targeted regex (one-line diff, preserves
  formatting), renames `## [Unreleased]` to `## [version]`, and reconciles the
  package version against the top changelog version.
- Bumps past any tag already present on the remote (`git ls-remote --tags`),
  promoting the top changelog heading to match, so a release cannot collide with
  a published tag.
- Refuses to proceed while any `## [x.y.z]` section is an empty stub (guards the
  silent-version-skip failure mode).

**Audit.** A new `audit` mode and a gate at the start of every build mode run
six read-only checks: version/changelog agreement, no empty changelog sections,
the cut version's Overview intro plus pinned `[log]` link, manifest i18n key
coverage (`%key%` in `package.json` resolved in `package.nls.json`), runtime
i18n key coverage (`l10n('key')` in `src/` resolved in `locales/en.json`), and
an AI-authorship attribution scan. A full publish aborts on a blocking finding.

The attribution scan targets only the canonical machine-authorship footer forms
(a co-author trailer naming the assistant, the vendor no-reply commit email, and
the "generated with" footer in both its bracketed and glyph variants), not the
words "AI"/"Claude" themselves, because the extension ships an "Active AI
Threads" feature that names those tools as integration targets on purpose. The
scanner excludes itself from its own scan, since it necessarily contains the
patterns as literal regex source.

**Publish resilience.** Missing `VSCE_PAT` / `OVSX_PAT` are prompted for with
platform-specific permanent-set instructions; the Marketplace gates the run
while Open VSX is best-effort. After publishing, both stores are polled until
they serve the new version (a `vsce` exit of 0 that never propagated is caught).
Stale `.vsix` files are removed before packaging and the packaged filename is
checked against the intended version. Added: `ci-fallback` (manual release
playbook), `--quiet`, colored output with Windows VT/UTF-8 enablement, a Saropa
logo, a step-timing summary, and a `tsc --noEmit` type-check gate.

### Verification

- `python scripts/publish.py --mode audit` exits 0 with all six checks passing.
- `python scripts/publish.py --mode ci-fallback` prints the playbook with the
  correct identity (`saropa.saropa-workspace`, repo `saropa/saropa_workspace`).
- `npx tsc -p ./ --noEmit` in `extension/` is clean (the build gate).
- The `full` and `dry-run` modes were not executed, as they trigger an
  `npm install` and a full rebuild; the read-only modes and the type-check
  exercise the new code paths.

### Known limitation

The Overview `[log]` link check runs only before the version is cut (it cannot
know the tag earlier) and is not re-run after `resolve_version()` renames the
`[Unreleased]` heading. The `[Unreleased]` section carries a `v1.0.x`
placeholder in its link; after the rename that placeholder is not auto-corrected
to the cut tag, and the audit will not flag it on the same run. Fixing the
placeholder remains the author's step. A post-cut re-validation was not added to
avoid forcing a mid-publish edit of an intentional placeholder.
