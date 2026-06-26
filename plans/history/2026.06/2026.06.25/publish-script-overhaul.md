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

## Finish Report (2026-06-25)

Two defects in the publisher tooling were corrected.

**1. Publisher banner art was a corrupted derivative.** The shared
`show_logo()` in `scripts/modules/_utils.py` (consumed by both `audit.py` and
`publish.py`) rendered a truncated Saropa "S": only 8 of the canonical 17 art
rows, and those 8 were themselves narrowed (for example `sdNMMMMMMMMMMMo` had
been shortened to `sdNMMMMMMMo`, and `:MMMMMMMMM/` to `:MMMMMM/`), with the top
cap, the lower curl, and nine middle rows dropped. The canonical source is
`show_saropa_logo()` in the sibling `saropa_lints` analyzer
(`scripts/modules/_analyze_pubspec.py`). The art block was replaced byte-for-byte
with that source — all 17 rows and the full 256-color gradient
(208, 209, 215, 220, 226, 190, 154, 118, 123, 87, 51, 45, 39, 33, 57) — while the
project-specific publisher and copyright text lines were left unchanged. Byte
identity of the rendered, color-stripped art was confirmed against the source.

**2. The release audit blocked on its own documentation.** The attribution
scan (added in the overhaul above) failed against this plan file because the
prose quoted the scanner's regex patterns verbatim, so `git grep` matched the
documentation as if it were a real machine-authorship footer. The passage was
reworded to describe the footer forms in plain language (a co-author trailer, the
vendor no-reply commit email, the bracketed and glyph "generated with" variants)
without reproducing the literal trigger strings. The scanner still excludes its
own source file; this change removes the second self-match. After the reword the
release audit reports no attribution in tracked files.

### Verification (finish)

- `python scripts/audit.py --release` reports `+ No AI-authorship attribution in
  tracked files.` and the full 17-row logo renders.
- The rendered, ANSI-stripped art diffs byte-identical against the
  `saropa_lints` source art.
- `scripts/modules/_utils.py` parses clean; the script test suite
  (`scripts/tests/test_quality.py`) passes 9/9.

### Out of scope (left untouched)

A separate, unrelated blocker surfaced during verification: eight `annotation.*`
runtime l10n keys are called in code but absent from
`extension/src/i18n/locales/en.json`. These originate from in-flight
annotation-feature work (the staged `setMetric.ts` and modified `en.json`), not
from this change, and were deliberately not modified here.
