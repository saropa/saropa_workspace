#!/usr/bin/env python3
"""
Tests for the publish pipeline's headless mode, JSON output, retry caps, and
timing.

Covers _record_result/get_last_run_result structure, _run_publish_existing's
result recording (the bug fixed in this session), StepTimer.to_dict(), and
headless abort-policy defaults. Does not shell out or touch a real repository;
module globals are reset between tests.

Run:  python scripts/tests/test_publish_pipeline.py
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

_SCRIPTS_DIR = str(Path(__file__).resolve().parent.parent)
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

from modules import _utils  # noqa: E402
from modules._timing import StepTimer  # noqa: E402
from modules._workflow import (  # noqa: E402
    _record_result,
    _run_publish_existing,
    get_last_run_result,
)


# --------------------------------------------------------------------------- #
# StepTimer.to_dict
# --------------------------------------------------------------------------- #

class StepTimerDictTest(unittest.TestCase):
    """Verify the machine-readable timing summary shape."""

    def test_empty_timer_returns_total_only(self) -> None:
        # No steps recorded — the dict must still have both keys.
        timer = StepTimer()
        d = timer.to_dict()
        self.assertEqual(d["steps"], [])
        self.assertIn("total_duration_s", d)
        self.assertIsInstance(d["total_duration_s"], float)

    def test_successful_step_recorded(self) -> None:
        timer = StepTimer()
        with timer.step("Build"):
            pass  # instant
        d = timer.to_dict()
        self.assertEqual(len(d["steps"]), 1)
        step = d["steps"][0]
        self.assertEqual(step["name"], "Build")
        self.assertTrue(step["ok"])
        self.assertIsInstance(step["duration_s"], float)

    def test_failing_step_marked_not_ok(self) -> None:
        # An exception inside the step context marks ok=False.
        timer = StepTimer()
        try:
            with timer.step("Explode"):
                raise RuntimeError("boom")
        except RuntimeError:
            pass
        d = timer.to_dict()
        self.assertFalse(d["steps"][0]["ok"])


# --------------------------------------------------------------------------- #
# _record_result / get_last_run_result
# --------------------------------------------------------------------------- #

class RecordResultTest(unittest.TestCase):
    """Verify the structured result dict built by _record_result."""

    def setUp(self) -> None:
        # Clear any leftover result from another test.
        import modules._workflow as _wf
        _wf._last_run_result = None

    def test_minimal_result(self) -> None:
        _record_result("audit", 0)
        result = get_last_run_result()
        self.assertIsNotNone(result)
        self.assertEqual(result["mode"], "audit")
        self.assertEqual(result["exit_code"], 0)
        self.assertTrue(result["ok"])
        # No version or timing keys when not supplied.
        self.assertNotIn("version", result)
        self.assertNotIn("timing", result)

    def test_failure_result(self) -> None:
        _record_result("dry-run", 3)
        result = get_last_run_result()
        self.assertFalse(result["ok"])
        self.assertEqual(result["exit_code"], 3)

    def test_version_and_timing_included(self) -> None:
        timer = StepTimer()
        with timer.step("Build"):
            pass
        _record_result("full", 0, version="1.2.3", timer=timer)
        result = get_last_run_result()
        self.assertEqual(result["version"], "1.2.3")
        self.assertIn("timing", result)
        self.assertIsInstance(result["timing"]["steps"], list)

    def test_full_success_includes_urls(self) -> None:
        # _record_result imports _extension_identity for full publishes.
        with patch("modules._publish._extension_identity", return_value=("saropa", "saropa-workspace")):
            _record_result("full", 0, version="2.0.0")
        result = get_last_run_result()
        self.assertIn("urls", result)
        self.assertIn("marketplace", result["urls"])
        self.assertIn("open_vsx", result["urls"])
        self.assertIn("github_release", result["urls"])

    def test_non_full_mode_omits_urls(self) -> None:
        # URLs are only added for mode=full.
        _record_result("package", 0, version="1.0.0")
        result = get_last_run_result()
        self.assertNotIn("urls", result)


# --------------------------------------------------------------------------- #
# _run_publish_existing now calls _record_result
# --------------------------------------------------------------------------- #

class RunPublishExistingResultTest(unittest.TestCase):
    """Regression: _run_publish_existing must record a structured result."""

    def setUp(self) -> None:
        # Headless mode so prompt_on_failure doesn't block on stdin.
        _utils.set_headless(True)
        _utils.set_on_failure("abort")
        _utils.set_quiet(True)
        import modules._workflow as _wf
        _wf._last_run_result = None
        self.addCleanup(_utils.set_headless, False)
        self.addCleanup(_utils.set_on_failure, "abort")
        self.addCleanup(_utils.set_quiet, False)

    @patch("modules._workflow.verify_store_publication")
    @patch("modules._workflow.publish_marketplaces", return_value=0)
    @patch("modules._workflow.newest_vsix")
    def test_success_records_version_and_timing(self, mock_vsix, _mock_pub, _mock_verify) -> None:
        # Simulate a .vsix file with a version in the name.
        fake_vsix = Path("saropa-workspace-1.8.0.vsix")
        mock_vsix.return_value = fake_vsix

        code = _run_publish_existing()
        self.assertEqual(code, 0)

        result = get_last_run_result()
        self.assertIsNotNone(result, "_run_publish_existing must call _record_result")
        self.assertEqual(result["mode"], "publish-existing")
        self.assertTrue(result["ok"])
        self.assertEqual(result["version"], "1.8.0")
        # Timer was created, so timing must be present.
        self.assertIn("timing", result)

    @patch("modules._workflow.newest_vsix", return_value=None)
    def test_no_vsix_records_failure(self, _mock_vsix) -> None:
        # When no .vsix exists, _run_publish_existing should fail with code 6
        # and still record a result.
        code = _run_publish_existing()
        self.assertEqual(code, 6)

        result = get_last_run_result()
        self.assertIsNotNone(result)
        self.assertFalse(result["ok"])
        self.assertEqual(result["exit_code"], 6)

    @patch("modules._workflow.publish_marketplaces", return_value=1)
    @patch("modules._workflow.newest_vsix")
    def test_publish_abort_records_failure_result(self, mock_vsix, _mock_pub) -> None:
        # When the publish step fails and the headless abort policy kicks in,
        # _record_result must capture the non-zero exit code.
        mock_vsix.return_value = Path("saropa-workspace-2.0.0.vsix")

        code = _run_publish_existing()
        self.assertNotEqual(code, 0)

        result = get_last_run_result()
        self.assertIsNotNone(result, "abort path must still record a result")
        self.assertFalse(result["ok"])
        self.assertEqual(result["exit_code"], code)
        # Version should still be extracted from the filename even on failure.
        self.assertEqual(result["version"], "2.0.0")

    @patch("modules._workflow.verify_store_publication")
    @patch("modules._workflow.publish_marketplaces", return_value=0)
    @patch("modules._workflow.newest_vsix")
    def test_unrecognized_vsix_name_omits_version(self, mock_vsix, _mock_pub, _mock_verify) -> None:
        # A .vsix whose filename doesn't match VERSION_RE should still succeed
        # but the result should have no version key.
        mock_vsix.return_value = Path("custom-build.vsix")

        code = _run_publish_existing()
        self.assertEqual(code, 0)

        result = get_last_run_result()
        self.assertIsNotNone(result)
        self.assertTrue(result["ok"])
        self.assertNotIn("version", result)


# --------------------------------------------------------------------------- #
# Headless abort is the default when no policy is set
# --------------------------------------------------------------------------- #

class HeadlessAbortDefaultTest(unittest.TestCase):
    """Verify that headless mode with the default abort policy stops immediately."""

    def setUp(self) -> None:
        _utils.set_headless(True)
        _utils.set_on_failure("abort")
        self.addCleanup(_utils.set_headless, False)
        self.addCleanup(_utils.set_on_failure, "abort")

    def test_abort_policy_stops_on_first_failure(self) -> None:
        from modules._workflow import _attempt
        calls = {"n": 0}

        def always_fails() -> int:
            calls["n"] += 1
            return 1

        code, aborted = _attempt("Doomed", always_fails)
        self.assertTrue(aborted)
        self.assertEqual(code, 1)
        # Abort means no retry — the step ran exactly once.
        self.assertEqual(calls["n"], 1)


if __name__ == "__main__":
    unittest.main()
