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

## Finish Report (2026-07-17, hardening pass)

Addressed two items raised in the prior handoff reflection and added the
brainstormed `--force` escape hatch.

### What changed

**`extension/scripts/library/organize-output/modules/organizer.py`**:
- `unsafe_target_reason`'s repository-root check changed from
  `(target / ".git").is_dir()` to `(target / ".git").exists()`. A normal
  clone has `.git` as a directory; a git worktree or submodule has it as a
  FILE holding a `gitdir: <path>` pointer — the prior `is_dir()`-only check
  missed that case entirely, so a worktree or submodule root passed the guard
  undetected. `exists()` catches both forms. (Known residual gap: a dangling
  symlink named `.git` would still pass, since `exists()` follows the link
  and finds nothing — judged not worth guarding, noted here rather than
  fixed.)
- `organize_and_prune` gained a `force: bool = False` parameter. When `True`,
  the `unsafe_target_reason` check is skipped entirely and the move/prune
  proceeds; the function's docstring states the caller is responsible for
  having already surfaced the reason to the operator, since this function has
  no terminal to warn on itself.

**`extension/scripts/library/organize-output/__main__.py`**: added a
`--force` flag. `main()` now calls `unsafe_target_reason` directly (not only
relying on `organize_and_prune`'s internal check) so it can print a WARNING
naming the specific reason before proceeding when `--force` is passed. Without
`--force`, an unsafe target prints "Refusing to organize: <reason>" plus
"Pass --force to override this safety guard." and exits 2, same as before.
The CLI always calls `organize_and_prune(..., force=True)`, since the CLI has
already performed its own check — `organize_and_prune`'s internal guard is
therefore only reachable for a future caller that imports the module
directly (e.g. another script), not for the CLI path. This is intentional
and documented in both places; it does mean the CLI's check and the library's
check are two call sites that must be kept in sync if either changes.

**`tests/test_safety.py`**: added `test_worktree_or_submodule_root_is_unsafe`
(constructs a `.git` file with a `gitdir:` pointer), `test_force_bypasses_the_guard`
(module-level, `dry_run=True`), `test_own_install_directory_with_force_and_dry_run_proceeds`
and `test_repository_root_with_force_and_dry_run_proceeds` (CLI-level,
`--force --dry-run`, asserting the WARNING text and a clean exit). Also
hardened `test_no_arguments_is_an_argparse_error` to assert two independent
substrings ("required", "folder") instead of one exact phrase, since
argparse's precise error wording is not guaranteed stable across Python
releases — addresses the "least confident about" item from the prior
reflection concerning that same test.

**`CHANGELOG.md`**: extended the existing `Unreleased` → `Fixed` bullet to
mention worktree/submodule detection and the `--force` flag.

### Review findings addressed

A second delegated review (general-purpose agent, read-only, scoped to this
pass's diff) found the core logic correct. One finding acted on:
- **[NIT]** `test_force_bypasses_the_guard` asserted `isinstance(x, int)` on
  all three return values of `organize_and_prune` — tautological, since the
  function's own return type annotation already guarantees `tuple[int, int,
  int]`. Simplified to rely on the real assertion (no `UnsafeTargetError`
  raised, i.e. the call returning at all), with a comment stating that
  intent explicitly.

Findings noted but not acted on:
- **[GAP]** A dangling symlink named `.git` still passes the guard (documented
  above and in the code comment; judged too narrow an edge case to add
  symlink-resolution handling for).
- Design note (not a defect): the CLI always passes `force=True` to
  `organize_and_prune`, making that function's internal guard unreachable
  from the CLI path specifically. This was already the intended design (the
  CLI performs its own check first so it can print a targeted warning) and is
  documented in both files' docstrings.

### Tests

`python extension/scripts/library/organize-output/tests/test_safety.py` — 15
tests pass, 0 failures (up from 11: 1 worktree-detection test, 1
force-bypass test, 2 CLI `--force --dry-run` tests).

### Verification

- `--force --dry-run` runs against both the script's own install directory
  and a synthetic repository root confirmed to print the WARNING and exit 0
  without moving any file (dry-run output shows only "Would move" lines).
- `library.json` and `en.json` re-confirmed to parse as valid JSON.

### Handoff reflection response

The prior reflection named four items; this pass addresses them as follows:
1. *Least confident about (CLI error-text version stability)*: hardened —
   the CLI test suite no longer depends on argparse's exact phrasing.
2. *If this breaks in 3 months (worktree/submodule `.git`-as-file gap)*:
   fixed — `.exists()` now detects both forms.
3. *Unstated assumption (nested logs/ at arbitrary depth under a repo root)*:
   confirmed by design and documentation to already behave correctly — no
   code change was needed, since the check only ever inspects the target's
   own immediate `.git` entry, not any ancestor.
4. *One unrequested feature (`--force` escape hatch)*: built, per explicit
   request this pass.
