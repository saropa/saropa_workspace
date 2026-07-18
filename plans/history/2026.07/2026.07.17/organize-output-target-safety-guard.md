# organize-output target safety guard

A bare, argument-less invocation of the bundled `organize-output` script
defaulted its target to the current working directory. Run directly from a
terminal positioned inside the script's own installed folder, it reorganized
the script's own source files into a dated subfolder, breaking that installed
copy until the files were moved back.

## Finish Report (2026-07-17)

### What changed

**`extension/scripts/library/organize-output/__main__.py`**: the `folder`
positional argument is now required — no `default="."`, no `nargs="?"`, and no
"blank means the current directory" fallback. A bare invocation now fails at
argparse with a clear "the following arguments are required: folder" message;
a whitespace-only argument prints an explicit required-argument message and
exits 2 rather than silently resolving to `.`.

**`extension/scripts/library/organize-output/modules/organizer.py`**: added
`unsafe_target_reason(target)`, enforced inside `organize_and_prune` itself (not
only at the CLI boundary), so any caller — the extension, a manual terminal
run, or a future script importing the module directly — gets the same guard.
Two checks:
- `target` is this script's own install directory, an ancestor of it, or a
  descendant of it (covers `organize-output/` itself and its `modules/`
  subfolder).
- `target` is itself a repository root (a `.git` directory sits directly
  inside it). A log/report folder this tool is meant for is a subfolder of a
  project, not the project root — `.git` lives only at the root, so a nested
  `reports/`/`logs/` target is unaffected. Does not detect a git worktree or
  submodule root, where `.git` is a file rather than a directory (see
  Handoff reflection).

A failing check raises `UnsafeTargetError` (a `ValueError` subclass); the CLI
catches it and prints `Refusing to organize: <reason>`, exit code 2, before any
file is touched.

**`extension/scripts/library/library.json`**: the manifest's `${prompt:...}`
text no longer advertises "blank = project root" (that affordance is removed).

**`extension/src/i18n/locales/en.json`**: `scripts.organizeOutput.description`
updated to describe the required-argument, root-refusing behavior instead of
the removed default-to-project-folder behavior.

**`CHANGELOG.md`**: added an `## [Unreleased]` section (none existed — the
prior release had just shipped) with a `### Fixed` bullet.

### Review findings addressed

A delegated review (general-purpose agent, read-only) covered logic/safety,
architecture, CLI behavior, TypeScript integration, docs, and i18n. Findings
acted on:
- **[GAP]** No test exercised the CLI level (argparse's own required-argument
  error, and the whitespace-only branch in `main()`) — all existing tests
  called `modules.organizer` functions directly. Added a `CliTest` class in
  `tests/test_safety.py` that runs `__main__.py` as a subprocess for the
  no-argument, whitespace-only, and own-install-directory cases.
- **[NIT]** No test proved the guard doesn't over-fire on a real adjacent
  bundled script folder (only a synthetic tempdir case existed). Added
  `test_sibling_bundled_script_folder_is_safe`, which walks
  `scripts/library/` for an actual sibling folder.
- **[NIT]** The incident narrative (why the guard exists) was retold with
  slightly different wording in three places — the `__main__.py` module
  docstring, the `_SCRIPT_DIR` comment, and `unsafe_target_reason`'s
  docstring. Trimmed to state the incident once (at `_SCRIPT_DIR`, the check
  it explains) and have the other two state only what they separately add.

Findings noted but not acted on:
- **[GAP]** `.git`-as-a-file (git worktrees, submodules) is not detected by
  the repository-root check — out of scope for the incident this guard
  targets (a literal `.git` directory is the common case), documented in the
  function's docstring and in the reflection below rather than fixed.

### Tests

`python extension/scripts/library/organize-output/tests/test_safety.py` — 11
tests pass, 0 failures (up from the initial 7; 3 new CLI-subprocess tests + 1
new sibling-folder test added during the review pass).

### Verification

- All three CLI error paths manually walked (no args, own directory as
  target, whitespace-only argument) and now covered by automated tests.
- `library.json` and `en.json` confirmed to still parse as valid JSON after
  editing.
- No TypeScript file assumed the removed default-to-cwd behavior or the old
  optional-argument CLI shape (confirmed by the review agent's grep of
  `extension/src/exec/promptTokens.ts` and `scriptRunner.ts`); the extension's
  own prompt-token flow already substitutes an empty string rather than
  omitting the argument on a blank answer, which now surfaces as the new
  clean required-argument error instead of a silent default.
