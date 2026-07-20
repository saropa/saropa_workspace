#!/usr/bin/env python3
"""Reliable Flutter test runner for Windows.

WHY THIS EXISTS
---------------
`flutter test` on Windows copies native code assets (e.g. ``sqlite3.dll``) into
``build/native_assets/windows/`` on every run. When a previous, orphaned headless
test engine (``flutter_tester.exe``) is still alive it keeps that DLL memory-mapped,
so the next run's "delete the old copy, then recopy" step crashes with:

    PathAccessException: Deletion failed,
    path = '...build/native_assets/windows/sqlite3.dll'
    (OS Error: Access is denied, errno = 5)

This is the recurring "flutter test always times out / crashes on Windows"
problem. The fix is to release the lock before launching the new run.

WHAT IT DOES
------------
1. Kills any lingering ``flutter_tester.exe`` processes. That image is the
   *headless test engine* `flutter test` spawns — orphans survive a crashed or
   killed test run and keep the native-asset DLLs locked. The app running on a
   device (Android) or a ``flutter run -d windows`` desktop instance is a
   different image (``<appname>.exe``), so this never touches the user's app.
2. Runs ``flutter test --no-pub`` against the test paths passed in. ``--no-pub``
   skips the redundant implicit ``pub get`` (safe when pubspec is unchanged).

USAGE
-----
    python scripts/test/run_test.py test/path/to/foo_test.dart [more_test.dart ...]

Always prefer this over a bare ``flutter test`` on Windows. Scope it to the
touched test file(s); never pass the whole ``test/`` tree.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

# The library runner sets cwd to $workspaceRoot, so the working directory is
# already the project root.
PROJECT_ROOT = Path.cwd()

# The headless engine image `flutter test` spawns. Safe to force-kill orphans:
# it is never the user's app (device app / desktop app run as <appname>.exe).
TEST_ENGINE_IMAGE = "flutter_tester.exe"


def _release_native_asset_lock() -> None:
    """Kill orphaned test engines so they release the native-asset DLLs.

    `taskkill` is a no-op (non-zero exit, ignored) when no orphan exists, which
    is the common, healthy case. Windows-only; on other platforms the lock does
    not occur, so this is skipped.
    """
    if not sys.platform.startswith("win"):
        return

    subprocess.run(
        ["taskkill", "/F", "/IM", TEST_ENGINE_IMAGE],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def main() -> int:
    test_paths = sys.argv[1:]
    if not test_paths:
        # Default to the whole test/ directory so the script is runnable
        # (and schedulable) without explicit arguments.
        test_paths = ["test/"]

    _release_native_asset_lock()

    # flutter resolves to flutter.bat on Windows; shutil.which finds it on PATH.
    flutter = shutil.which("flutter") or "flutter"
    cmd = [flutter, "test", "--no-pub", *test_paths]
    print(f"+ {' '.join(cmd)}", flush=True)

    completed = subprocess.run(cmd, cwd=PROJECT_ROOT, check=False)
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
