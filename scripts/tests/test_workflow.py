#!/usr/bin/env python3
"""
Regression tests for _attempt()'s headless failure-policy handling in modules/_workflow.py.

Covers two bugs found by review of the --headless mode: (1) the retry-used flag
was module-global and only ever cleared inside prompt_on_failure() on a
non-retry outcome, so a step that failed once, retried, and then succeeded left
the flag set — the *next* step's first failure then read that stale True and
escalated straight to abort instead of getting its own single retry; and (2) a
critical step (Git sync, Git + release) reused the generic ignore path, so
--on-failure=ignore could skip past a failed rebase/stash-pop and let the
pipeline build on top of an unresolved conflict.

These tests exercise _attempt() directly against modules._utils's headless
globals rather than a real git repository, resetting the module state around
each test since it is process-global.

Run:  python scripts/tests/test_workflow.py
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_SCRIPTS_DIR = str(Path(__file__).resolve().parent.parent)
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

from modules import _utils  # noqa: E402
from modules._workflow import _attempt  # noqa: E402


class HeadlessRetryTest(unittest.TestCase):
    def setUp(self) -> None:
        _utils.set_headless(True)
        _utils.set_on_failure("retry")
        self.addCleanup(_utils.set_headless, False)
        self.addCleanup(_utils.set_on_failure, "abort")

    def test_retry_cap_does_not_leak_into_the_next_step(self) -> None:
        # Step A: fails once, then succeeds on its single headless retry.
        calls_a = {"n": 0}

        def step_a() -> int:
            calls_a["n"] += 1
            return 0 if calls_a["n"] >= 2 else 1

        code_a, aborted_a = _attempt("Step A", step_a)
        self.assertEqual((code_a, aborted_a), (0, False))
        self.assertEqual(calls_a["n"], 2)

        # Step B: fails once. Without the reset, the leftover retry-used flag
        # from Step A makes this look like a second consecutive failure and
        # escalates straight to abort — it must instead get its own retry.
        calls_b = {"n": 0}

        def step_b() -> int:
            calls_b["n"] += 1
            return 0 if calls_b["n"] >= 2 else 1

        code_b, aborted_b = _attempt("Step B", step_b)
        self.assertEqual((code_b, aborted_b), (0, False))
        self.assertEqual(calls_b["n"], 2, "Step B did not get its own retry")

    def test_retry_still_escalates_to_abort_on_repeated_failure(self) -> None:
        # A step that keeps failing must still abort after its one retry —
        # the per-step reset must not turn "retry" into unlimited retries.
        calls = {"n": 0}

        def always_fails() -> int:
            calls["n"] += 1
            return 1

        code, aborted = _attempt("Always fails", always_fails)
        self.assertTrue(aborted)
        self.assertEqual(code, 1)
        self.assertEqual(calls["n"], 2, "expected exactly one retry before abort")


class AllowIgnoreTest(unittest.TestCase):
    def setUp(self) -> None:
        _utils.set_headless(True)
        _utils.set_on_failure("ignore")
        self.addCleanup(_utils.set_headless, False)
        self.addCleanup(_utils.set_on_failure, "abort")

    def test_ignore_policy_is_honored_by_default(self) -> None:
        code, aborted = _attempt("Non-critical", lambda: 1)
        self.assertEqual((code, aborted), (0, False))

    def test_allow_ignore_false_forces_abort_even_under_ignore_policy(self) -> None:
        # A failed Git sync can leave the repo mid-rebase or mid-conflict;
        # --on-failure=ignore must not be able to wave that through.
        code, aborted = _attempt("Git sync", lambda: 7, allow_ignore=False)
        self.assertTrue(aborted)
        self.assertEqual(code, 7)


if __name__ == "__main__":
    unittest.main()
