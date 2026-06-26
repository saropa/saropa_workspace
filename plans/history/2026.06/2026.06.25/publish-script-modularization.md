# Publish script modularization and quality audit

The release script `scripts/publish.py` had grown to a single ~1,300-line file
holding output helpers, version logic, the publish pipeline, store verification,
and the audit in one module, which made it hard to read and impossible to test a
piece in isolation. This change splits that file into a `scripts/modules/`
package of small single-responsibility modules and adds a dedicated
`scripts/audit.py` entry point with code-quality gates (file length, function
length, documentation coverage, unit test coverage, and more).

## Finish Report (2026-06-25)

### Scope

Docs/scripts only. Touches Python release tooling under `scripts/` and the new
`scripts/modules/` and `scripts/tests/` packages. No Flutter/Dart code, no VS
Code extension TypeScript (the extension's `src/**/*.ts` is read by the new audit
but never modified), and no user-facing strings.

### What changed

**Modularization.** `scripts/publish.py` is now a thin launcher (argument
parsing, ANSI setup, logo, mode dispatch). The workflow moved into
`scripts/modules/`:

- `_utils.py` — repository paths, shared constants and regexes, the `Color`
  enum and colored-output helpers, the quiet toggle, the command runner, and the
  logo. The leaf module every other one imports.
- `_timing.py` — `StepTimer` and the end-of-run timing summary.
- `_version_changelog.py` — `package.json` / `CHANGELOG.md` reconciliation, the
  empty-stub and Overview/`[log]` validators, the editable version prompt, and
  `resolve_version()`.
- `_audit.py` — the release-correctness pre-flight: version/changelog agreement,
  empty-stub guard, i18n key coverage for both catalogs, and the
  no-AI-attribution scan.
- `_quality.py` — new code-quality analysis (see below).
- `_build.py` — doc sync, TypeScript type check, build, and `.vsix` package.
- `_publish.py` — token prompting, Marketplace + Open VSX publish, store
  propagation verification, and the success banner.
- `_git_ops.py` — working-tree report, release commit/tag/push, GitHub release.
- `_ci.py` — the manual-release playbook and local `.vsix` install.
- `_workflow.py` — prerequisite check, mode menu, and the per-mode pipelines.

The entry scripts add `scripts/` to `sys.path` and import `modules.*`, so the
toolchain resolves the same files regardless of the caller's working directory.
All public behavior (mode names, prompts, exit codes) is unchanged, so the
publishing skill and any existing invocation of `python scripts/publish.py`
continue to work.

A literal `.modules` / `.shared` directory name was rejected because a
dot-prefixed directory cannot be imported as a Python package; `modules/`
matches the layout already used by the sibling toolchain.

**Code-quality audit.** A new `scripts/audit.py` runs two read-only gates and
changes nothing: the existing release-correctness audit and the new
`_quality.py` report. The quality report covers source file length (soft and
hard caps), function length (a brace-matched heuristic), comment-line density and
exported-symbol JSDoc coverage, unit test coverage (source modules with a
matching `*.test.ts`), `any` usage, TODO/FIXME/HACK debt, and hardcoded
`show*Message()` strings that should use `l10n`. Only the hard file-length cap is
a blocking failure; the debt metrics are warnings so a release is never blocked
by gaps that predate the gate. `publish.py` runs the quality gate in its full and
dry-run pipelines.

### Defect fixed during implementation

The quality tokenizer initially had no handling for JS/TS regex literals. A regex
such as `/[\s"]/` contains a double-quote, which the lexer read as the start of a
string literal, swallowing the rest of the expression and desyncing brace
counting — a 3-line `quote()` function in `runner.ts` was reported as spanning
721 lines. The tokenizer now disambiguates a regex literal from a `/` division by
the preceding significant token (operators/openers and a set of keywords such as
`return`/`typeof` precede a regex; an identifier, number, `)`, `]`, or string
precede division) and blanks the regex body while tracking `[...]` character
classes. After the fix the same function reports 3 lines, and genuinely long
functions (for example `detectOnDemandRecipes`, lines 160–488 of `detectors.ts`)
report their true span.

### Verification

- All modules and entry scripts byte-compile (`py_compile`).
- `scripts/audit.py` runs end-to-end (full, `--quality`, `--release`) and
  `publish.py --mode audit` / `--mode ci-fallback` run with correct exit codes
  against the real repository.
- A new stdlib `unittest` suite, `scripts/tests/test_quality.py`, pins the
  tokenizer and function-length heuristics — including a regression case for the
  regex-literal desync — with 9 passing tests and no added dependency.

### Notes for maintainers

The release audit surfaces pre-existing issues owned by other workstreams and
not addressed here: missing i18n keys for the scratchpad feature
(`command.newScratchpad.title` and seven `scratch.*` keys) and an AI-attribution
string in `plans/history/2026.06/2026.06.25/publish-script-overhaul.md`. These
are the new tooling correctly reporting existing gaps, not regressions from this
change.
