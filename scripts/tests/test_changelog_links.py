#!/usr/bin/env python3
"""
Tests for the CHANGELOG release links (modules/_changelog_links.py) and for the
VERSION step that rewrites them (modules/_version_changelog.py).

Every test works on temporary files. resolve_version() is driven with its
package.json, prompt and remote-tag functions patched, so nothing in the real
repository is read or written and git is never run.

Run:  python scripts/tests/test_changelog_links.py
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

_SCRIPTS_DIR = str(Path(__file__).resolve().parent.parent)
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

from modules import _version_changelog as vc  # noqa: E402
from modules._changelog_links import (  # noqa: E402
    saropa_release_url,
    stale_site_link_problems,
    sync_release_links,
)
from modules._timing import StepTimer  # noqa: E402
from modules._utils import GITHUB_REPO, SAROPA_CHANGELOG_URL  # noqa: E402


def _log(tag: str) -> str:
    return f"[log](https://github.com/{GITHUB_REPO}/blob/{tag}/CHANGELOG.md)"


def _site(suffix: str) -> str:
    return f"[saropa.com]({SAROPA_CHANGELOG_URL}{suffix})"


def _entry(heading: str, tag: str, suffix: str) -> str:
    """One release section with an overview line and one bullet."""
    return f"## [{heading}]\n\nSummary. {_log(tag)} · {_site(suffix)}\n\n### Changed\n- Item.\n\n"


class _TempFiles(unittest.TestCase):
    def setUp(self) -> None:
        tmp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(tmp_dir.cleanup)
        self.root = Path(tmp_dir.name) / "CHANGELOG.md"
        self.history = Path(tmp_dir.name) / "CHANGELOG_HISTORY.md"

    def write(self, path: Path, text: str) -> None:
        path.write_bytes(text.encode("utf-8"))

    def read(self, path: Path) -> str:
        return path.read_bytes().decode("utf-8")


class ReleaseUrlTest(unittest.TestCase):
    def test_current_major_uses_the_main_page_and_older_majors_their_own(self) -> None:
        self.assertEqual(saropa_release_url("2.7.1", "2.13.0"), f"{SAROPA_CHANGELOG_URL}#v2-7-1")
        self.assertEqual(saropa_release_url("1.6.0", "2.13.0"), f"{SAROPA_CHANGELOG_URL}1.x/#v1-6-0")


class SyncLinksTest(_TempFiles):
    def test_new_major_moves_older_entries_and_keeps_their_log_tags(self) -> None:
        self.write(self.root, _entry("3.0.0", "v3.0.0", "#v3-0-0") + _entry("2.1.0", "main", "#v2-1-0"))
        self.assertTrue(sync_release_links(self.root, "3.0.0", released="3.0.0"))
        text = self.read(self.root)
        self.assertIn(_site("2.x/#v2-1-0"), text)
        self.assertIn(_site("#v3-0-0"), text)
        # Only the released entry's [log] link is repinned.
        self.assertIn(_log("main"), text)

    def test_links_below_the_overview_and_line_endings_are_left_alone(self) -> None:
        bullet = f"- Quoting {_log('vX.Y.Z')} here.\n"
        text = (_entry("2.0.0", "vX.Y.Z", "#vX-Y-Z") + bullet).replace("\n", "\r\n")
        self.write(self.root, text)
        sync_release_links(self.root, "2.0.0", released="2.0.0")
        result = self.read(self.root)
        self.assertIn(bullet.strip(), result)
        self.assertEqual(result.count("\r\n"), text.count("\r\n"))
        self.assertIn(_site("#v2-0-0"), result)

    def test_correct_file_is_not_rewritten(self) -> None:
        self.write(self.root, _entry("2.0.0", "v2.0.0", "#v2-0-0"))
        self.assertFalse(sync_release_links(self.root, "2.0.0", released="2.0.0"))
        self.assertFalse(sync_release_links(self.history, "2.0.0"))


class DetectionTest(_TempFiles):
    def test_stale_and_missing_links_are_reported_once_each(self) -> None:
        missing = f"## [1.9.0]\n\nSummary. {_log('v1.9.0')}\n"
        self.write(self.root, _entry("3.0.0", "v3.0.0", "#v3-0-0") + _entry("2.1.0", "v2.1.0", "#v2-1-0") + missing)
        problems = stale_site_link_problems(self.root, "3.0.0")
        self.assertEqual(len(problems), 2)
        self.assertIn("[2.1.0]", problems[0])
        self.assertIn("[1.9.0]", problems[1])
        self.assertEqual(len(stale_site_link_problems(self.root, "3.0.0", skip="2.1.0")), 1)


class ResolveVersionTest(_TempFiles):
    def resolve(self, chosen: str, taken_tags: tuple[str, ...] = ()) -> str | None:
        """Run the real VERSION step against the temporary files."""
        patches = {
            "ROOT_CHANGELOG": self.root,
            "ROOT_CHANGELOG_HISTORY": self.history,
            "read_package_version": lambda: "2.12.0",
            "set_package_version": lambda _version: None,
            "prompt_version_until_valid": lambda _default: chosen,
            "tag_exists_on_remote": lambda version: version in taken_tags,
        }
        with patch.multiple(vc, **patches):
            return vc.resolve_version(StepTimer())

    def test_unreleased_rename_rewrites_both_links(self) -> None:
        self.write(self.root, _entry("Unreleased", "vX.Y.Z", "#vX-Y-Z") + _entry("2.12.0", "v2.12.0", "#v2-12-0"))
        self.assertEqual(self.resolve("2.13.0"), "2.13.0")
        text = self.read(self.root)
        self.assertIn(f"{_log('v2.13.0')} · {_site('#v2-13-0')}", text)
        self.assertIn(f"{_log('v2.12.0')} · {_site('#v2-12-0')}", text)

    def test_tag_clash_bump_moves_both_links_to_the_new_version(self) -> None:
        self.write(self.root, _entry("2.13.0", "v2.13.0", "#v2-13-0"))
        self.assertEqual(self.resolve("2.13.0", taken_tags=("2.13.0",)), "2.13.1")
        self.assertIn(f"{_log('v2.13.1')} · {_site('#v2-13-1')}", self.read(self.root))

    def test_new_major_rewrites_root_and_history(self) -> None:
        self.write(self.root, _entry("Unreleased", "vX.Y.Z", "#vX-Y-Z") + _entry("2.12.0", "v2.12.0", "#v2-12-0"))
        self.write(self.history, _entry("2.0.0", "v2.0.0", "#v2-0-0"))
        self.assertEqual(self.resolve("3.0.0"), "3.0.0")
        self.assertIn(_site("2.x/#v2-12-0"), self.read(self.root))
        self.assertIn(_site("2.x/#v2-0-0"), self.read(self.history))

    def test_released_entry_without_links_stops_the_publish(self) -> None:
        self.write(self.root, "## [Unreleased]\n\nSummary only.\n\n### Changed\n- Item.\n")
        self.assertIsNone(self.resolve("2.13.0"))


if __name__ == "__main__":
    unittest.main()
