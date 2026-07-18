#!/usr/bin/env python3
"""
Regression tests for organize-output's target-safety guard.

Covers the incident this guard exists to prevent: a bare, argument-less
invocation (or a bad manifest config) organizing the script's own install
folder or an entire repository root instead of a log/report subfolder.

Run:  python extension/scripts/library/organize-output/tests/test_safety.py
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

_ORGANIZE_OUTPUT_DIR = Path(__file__).resolve().parent.parent
if str(_ORGANIZE_OUTPUT_DIR) not in sys.path:
    sys.path.insert(0, str(_ORGANIZE_OUTPUT_DIR))

from modules.organizer import (  # noqa: E402
    UnsafeTargetError,
    organize_and_prune,
    unsafe_target_reason,
)

_MAIN_PY = _ORGANIZE_OUTPUT_DIR / "__main__.py"


class UnsafeTargetReasonTest(unittest.TestCase):
    def test_own_install_directory_is_unsafe(self) -> None:
        script_dir = Path(__file__).resolve().parent.parent
        self.assertIsNotNone(unsafe_target_reason(script_dir))

    def test_own_modules_subfolder_is_unsafe(self) -> None:
        modules_dir = Path(__file__).resolve().parent.parent / "modules"
        self.assertIsNotNone(unsafe_target_reason(modules_dir))

    def test_ancestor_of_install_directory_is_unsafe(self) -> None:
        # An ancestor two levels up still contains the script — organizing it
        # would still sweep the script's own files into a dated subfolder.
        ancestor = Path(__file__).resolve().parents[3]
        self.assertIsNotNone(unsafe_target_reason(ancestor))

    def test_repository_root_is_unsafe(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp)
            (target / ".git").mkdir()
            self.assertIsNotNone(unsafe_target_reason(target))

    def test_worktree_or_submodule_root_is_unsafe(self) -> None:
        # A git worktree/submodule has .git as a FILE (a "gitdir: <path>"
        # pointer), not a directory — the .is_dir()-only version of this check
        # missed this case; exists() must still catch it.
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp)
            (target / ".git").write_text("gitdir: ../.git/worktrees/example\n", encoding="utf-8")
            self.assertIsNotNone(unsafe_target_reason(target))

    def test_plain_folder_with_no_markers_is_safe(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(unsafe_target_reason(Path(tmp)))

    def test_subfolder_of_a_repository_is_safe(self) -> None:
        # The intended case: a logs/ or reports/ folder nested under a project
        # root. .git lives only at the root, so a nested target is unaffected.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".git").mkdir()
            reports = root / "reports"
            reports.mkdir()
            self.assertIsNone(unsafe_target_reason(reports))

    def test_sibling_bundled_script_folder_is_safe(self) -> None:
        # A real adjacent case, not just a synthetic tempdir: the guard must not
        # over-fire on a different script bundled next to this one in the library.
        library_dir = _ORGANIZE_OUTPUT_DIR.parent
        sibling = next(
            (p for p in library_dir.iterdir() if p.is_dir() and p != _ORGANIZE_OUTPUT_DIR),
            None,
        )
        if sibling is None:
            self.skipTest("no sibling script folder present under scripts/library/")
        self.assertIsNone(unsafe_target_reason(sibling))


class OrganizeAndPruneGuardTest(unittest.TestCase):
    def test_raises_on_unsafe_target_without_touching_disk(self) -> None:
        script_dir = Path(__file__).resolve().parent.parent
        with self.assertRaises(UnsafeTargetError):
            organize_and_prune(script_dir, dry_run=True)

    def test_force_bypasses_the_guard(self) -> None:
        # dry_run=True so a bypassed guard still can't touch this script's own
        # files. The real assertion is that this call does NOT raise
        # UnsafeTargetError (it would, without force=True, per the test above)
        # — reaching the return at all is the pass condition.
        script_dir = Path(__file__).resolve().parent.parent
        organize_and_prune(script_dir, dry_run=True, force=True)


class CliTest(unittest.TestCase):
    """Exercises __main__.py as a subprocess, since it is not import-safe (module
    name "__main__" would shadow the test runner's own entry module)."""

    def _run(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(_MAIN_PY), *args],
            capture_output=True,
            text=True,
            check=False,
        )

    def test_no_arguments_is_an_argparse_error(self) -> None:
        result = self._run()
        self.assertEqual(result.returncode, 2)
        # Two independent substrings rather than one exact phrase: argparse's
        # precise wording/spacing has shifted across Python releases before,
        # but "required" and the "folder" dest name are the stable parts.
        self.assertIn("required", result.stderr)
        self.assertIn("folder", result.stderr)

    def test_whitespace_only_argument_is_rejected(self) -> None:
        result = self._run(" ")
        self.assertEqual(result.returncode, 2)
        self.assertIn("A folder argument is required", result.stdout)

    def test_own_install_directory_argument_is_refused(self) -> None:
        result = self._run(str(_ORGANIZE_OUTPUT_DIR))
        self.assertEqual(result.returncode, 2)
        self.assertIn("Refusing to organize", result.stdout)
        self.assertIn("--force", result.stdout)

    def test_own_install_directory_with_force_and_dry_run_proceeds(self) -> None:
        # --dry-run so the override path is provable without letting a forced
        # run actually move this script's own files.
        result = self._run(str(_ORGANIZE_OUTPUT_DIR), "--force", "--dry-run")
        self.assertEqual(result.returncode, 0)
        self.assertIn("WARNING: --force overriding safety guard", result.stdout)
        self.assertIn("Done.", result.stdout)

    def test_repository_root_with_force_and_dry_run_proceeds(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp)
            (target / ".git").mkdir()
            result = self._run(str(target), "--force", "--dry-run")
            self.assertEqual(result.returncode, 0)
            self.assertIn("WARNING: --force overriding safety guard", result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
