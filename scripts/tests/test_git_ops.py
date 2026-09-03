#!/usr/bin/env python3
"""
Regression tests for the git-sync divergence/debounce logic in modules/_git_ops.py.

sync_with_remote() shells out to git for every step, so these tests mock
modules._git_ops.run and modules._git_ops.time.sleep rather than touching a
real repository. Focused on the branches that are easy to get backwards: no
divergence (skip entirely), a clean tree (no stash needed), a dirty tree (the
full stash/rebase/sleep/pop sequence), a failed rebase (stash must be left in
place, never popped), and the debounce value clamp.

Run:  python scripts/tests/test_git_ops.py
"""

from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

_SCRIPTS_DIR = str(Path(__file__).resolve().parent.parent)
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

from modules import _git_ops  # noqa: E402


def _completed(stdout: str = "", returncode: int = 0) -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(args=[], returncode=returncode, stdout=stdout, stderr="")


class SyncWithRemoteTest(unittest.TestCase):
    def _run_side_effect(self, responses: dict[str, subprocess.CompletedProcess]):
        """Build a run() side_effect that answers by the command's second token.

        e.g. ["git", "rev-list", ...] is looked up under "rev-list".
        """
        calls: list[list[str]] = []

        def _side_effect(args, cwd, *, check=True, capture=False):  # noqa: ANN001
            calls.append(args)
            key = args[1] if len(args) > 1 else args[0]
            result = responses.get(key, _completed())
            if check and result.returncode != 0:
                raise subprocess.CalledProcessError(result.returncode, args)
            return result

        return _side_effect, calls

    def test_up_to_date_skips_stash_and_rebase(self) -> None:
        side_effect, calls = self._run_side_effect(
            {"rev-list": _completed("0\t0\n")},
        )
        with patch.object(_git_ops, "run", side_effect=side_effect), \
                patch.object(_git_ops.time, "sleep") as mock_sleep:
            code = _git_ops.sync_with_remote(3)

        self.assertEqual(code, 0)
        mock_sleep.assert_not_called()
        commands = [c[1] for c in calls]
        self.assertNotIn("rebase", commands)
        self.assertNotIn("stash", commands)

    def test_diverged_clean_tree_rebases_without_stash(self) -> None:
        side_effect, calls = self._run_side_effect(
            {
                "rev-list": _completed("0\t2\n"),
                "status": _completed(""),  # clean tree
            },
        )
        with patch.object(_git_ops, "run", side_effect=side_effect), \
                patch.object(_git_ops.time, "sleep") as mock_sleep:
            code = _git_ops.sync_with_remote(3)

        self.assertEqual(code, 0)
        commands = [c[1] for c in calls]
        self.assertIn("rebase", commands)
        self.assertNotIn("stash", commands)
        mock_sleep.assert_not_called()

    def test_diverged_dirty_tree_stashes_rebases_sleeps_then_pops_in_order(self) -> None:
        side_effect, calls = self._run_side_effect(
            {
                "rev-list": _completed("0\t2\n"),
                "status": _completed(" M file.py\n"),  # dirty tree
            },
        )
        with patch.object(_git_ops, "run", side_effect=side_effect), \
                patch.object(_git_ops.time, "sleep") as mock_sleep:
            code = _git_ops.sync_with_remote(5)

        self.assertEqual(code, 0)
        mock_sleep.assert_called_once_with(5)
        # stash -u, rebase, then stash pop, in that order.
        ordered = [c[1] for c in calls if c[1] in ("stash", "rebase")]
        self.assertEqual(ordered, ["stash", "rebase", "stash"])
        self.assertEqual(calls[[c[1] for c in calls].index("stash")], ["git", "stash", "-u"])
        self.assertEqual(calls[-1], ["git", "stash", "pop"])

    def test_debounce_zero_disables_sleep(self) -> None:
        side_effect, _calls = self._run_side_effect(
            {
                "rev-list": _completed("0\t2\n"),
                "status": _completed(" M file.py\n"),
            },
        )
        with patch.object(_git_ops, "run", side_effect=side_effect), \
                patch.object(_git_ops.time, "sleep") as mock_sleep:
            code = _git_ops.sync_with_remote(0)

        self.assertEqual(code, 0)
        mock_sleep.assert_not_called()

    def test_debounce_is_clamped_to_max(self) -> None:
        side_effect, _calls = self._run_side_effect(
            {
                "rev-list": _completed("0\t2\n"),
                "status": _completed(" M file.py\n"),
            },
        )
        with patch.object(_git_ops, "run", side_effect=side_effect), \
                patch.object(_git_ops.time, "sleep") as mock_sleep:
            _git_ops.sync_with_remote(999)

        mock_sleep.assert_called_once_with(_git_ops.MAX_REBASE_DEBOUNCE_SECONDS)

    def test_failed_rebase_leaves_stash_and_never_pops(self) -> None:
        def _side_effect(args, cwd, *, check=True, capture=False):  # noqa: ANN001
            key = args[1] if len(args) > 1 else args[0]
            if key == "rev-list":
                return _completed("0\t2\n")
            if key == "status":
                return _completed(" M file.py\n")
            if key == "rebase":
                raise subprocess.CalledProcessError(1, args)
            if args == ["git", "stash", "pop"]:
                self.fail("stash pop must not run after a failed rebase")
            return _completed()

        with patch.object(_git_ops, "run", side_effect=_side_effect) as mock_run, \
                patch.object(_git_ops.time, "sleep") as mock_sleep:
            code = _git_ops.sync_with_remote(3)

        self.assertEqual(code, 7)
        mock_sleep.assert_not_called()
        # Only the initial `stash -u` should have run; the pop never fires.
        stash_calls = [c for c in mock_run.call_args_list if c.args[0][1] == "stash"]
        self.assertEqual(len(stash_calls), 1)
        self.assertEqual(stash_calls[0].args[0], ["git", "stash", "-u"])


if __name__ == "__main__":
    unittest.main()
