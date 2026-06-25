#!/usr/bin/env python3
"""
Shared primitives for the Saropa Workspace release toolchain.

Holds the things every other module needs: the repository layout (resolved from
this file so the tools work regardless of the caller's cwd), shared regexes and
identity constants, colored terminal output that degrades gracefully on Windows,
and the command runner. Kept dependency-free (stdlib only) so the toolchain runs
on a clean Python with no virtualenv.

Version:   1.0
Copyright: (c) 2026 Saropa
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from enum import Enum
from pathlib import Path

# --------------------------------------------------------------------------- #
# Repository layout. This file lives at <repo>/scripts/modules/_utils.py, so the
# repo root is three parents up. Every path below is derived from it so the
# toolchain resolves the same files no matter where it is invoked from.
# --------------------------------------------------------------------------- #
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
EXTENSION_DIR = REPO_ROOT / "extension"
PACKAGE_JSON = EXTENSION_DIR / "package.json"
PACKAGE_NLS = EXTENSION_DIR / "package.nls.json"
RUNTIME_LOCALE = EXTENSION_DIR / "src" / "i18n" / "locales" / "en.json"
SRC_DIR = EXTENSION_DIR / "src"
ROOT_README = REPO_ROOT / "README.md"
EXTENSION_README = EXTENSION_DIR / "README.md"
ROOT_CHANGELOG = REPO_ROOT / "CHANGELOG.md"
EXTENSION_CHANGELOG = EXTENSION_DIR / "CHANGELOG.md"

# The extension's README and CHANGELOG are generated copies of the repo-root
# files, not authored separately. The root pair is the single source of truth;
# _build.sync_extension_docs() regenerates these before every package so the
# published .vsix can never drift from the root docs. They are git-ignored and a
# write hook blocks hand-edits (scripts/hooks/generated_docs_guard.py).
GENERATED_DOC_PAIRS = ((ROOT_README, EXTENSION_README), (ROOT_CHANGELOG, EXTENSION_CHANGELOG))

# Marketplace / GitHub identity. publisher + name from package.json form the
# extension id used in store URLs and the propagation queries.
GITHUB_REPO = "saropa/saropa_workspace"
MARKETPLACE_MANAGE_URL = "https://marketplace.visualstudio.com/manage/publishers/saropa"

# Semantic version with optional pre-release suffix (1.0.1, 1.0.1-beta.2).
VERSION_RE = r"\d+\.\d+\.\d+(?:-[\w]+(?:\.[\w]+)*)?"


# --------------------------------------------------------------------------- #
# Colored output. ANSI codes degrade to plain text where the terminal can't
# render them; enable_ansi_support() turns on virtual-terminal processing on
# Windows so the same codes work in CMD and PowerShell.
# --------------------------------------------------------------------------- #


class Color(Enum):
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    RED = "\033[91m"
    CYAN = "\033[96m"
    WHITE = "\033[97m"
    DIM = "\033[2m"
    BOLD = "\033[1m"
    RESET = "\033[0m"


# When True (set by --quiet), only warnings and errors print. Info/success/
# headers are suppressed so a CI log stays terse. Module-level so the output
# helpers below read it directly; set_quiet()/is_quiet() are the public surface.
_QUIET = False


def set_quiet(value: bool) -> None:
    global _QUIET
    _QUIET = value


def is_quiet() -> bool:
    return _QUIET


def enable_ansi_support() -> None:
    """Enable ANSI escape sequences on Windows and force UTF-8 stdout.

    No-op for ANSI on macOS/Linux (native). On Windows the default cp1252 stdout
    cannot print the check/cross glyphs and bar characters, so reconfigure to
    UTF-8 too.
    """
    if sys.platform == "win32":
        try:
            import ctypes
            from ctypes import wintypes

            kernel32 = ctypes.windll.kernel32
            handle = kernel32.GetStdHandle(-11)  # STD_OUTPUT_HANDLE
            mode = wintypes.DWORD()
            kernel32.GetConsoleMode(handle, ctypes.byref(mode))
            # 0x0004 = ENABLE_VIRTUAL_TERMINAL_PROCESSING
            kernel32.SetConsoleMode(handle, mode.value | 0x0004)
        except Exception:
            # A locked-down console may refuse; colored output just degrades.
            pass
        if "TERM" not in os.environ:
            os.environ["TERM"] = "xterm-256color"
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except (AttributeError, OSError):
        pass


def _c(msg: str, color: Color) -> str:
    return f"{color.value}{msg}{Color.RESET.value}"


def header(title: str) -> None:
    if _QUIET:
        return
    print()
    print(_c("=" * 64, Color.CYAN))
    print(_c(f"  {title}", Color.CYAN))
    print(_c("=" * 64, Color.CYAN))


def info(msg: str) -> None:
    if not _QUIET:
        print(_c(f"  i {msg}", Color.CYAN))


def detail(msg: str) -> None:
    if not _QUIET:
        print(f"  {msg}")


def success(msg: str) -> None:
    if not _QUIET:
        print(_c(f"  + {msg}", Color.GREEN))


def warn(msg: str) -> None:
    print(_c(f"  ! {msg}", Color.YELLOW))


def error(msg: str) -> None:
    print(_c(f"  x {msg}", Color.RED))


def fail(msg: str, code: int) -> int:
    print()
    error(msg)
    return code


# cspell:disable
def show_logo() -> None:
    """Print the Saropa 'S' logo. Pure branding; never references any tooling."""
    logo = (
        "\033[38;5;208m                       `-+shdmNMMMMNmdhs+-\033[0m\n"
        "\033[38;5;215m                 `/dMMMMMM/`          ``````\033[0m\n"
        "\033[38;5;226m                /MMMMMMMMMMMMMMMMMMMMMMMMMMMNh\\\033[0m\n"
        "\033[38;5;154m              o     `..~~~::~+==+~:/+sdNMMMMMMMo\033[0m\n"
        "\033[38;5;87m              /N:                        :MMMMMM/\033[0m\n"
        "\033[38;5;45m                :dNy/.              ./smMMMMMMm:\033[0m\n"
        "\033[38;5;33m                    .odMMMMMMMMMMMMMMMMMMdo-\033[0m\n"
        "\033[38;5;57m                       `-+shdNNMMMMNNdhs+-\033[0m"
    )
    print()
    print(logo)
    print(_c("  Saropa Workspace publisher", Color.WHITE))
    print(_c("  (c) 2026 Saropa  -  https://saropa.com", Color.DIM))
# cspell:enable


# --------------------------------------------------------------------------- #
# Command execution.
# --------------------------------------------------------------------------- #


def run(
    args: list[str],
    cwd: Path,
    *,
    check: bool = True,
    capture: bool = False,
) -> subprocess.CompletedProcess:
    """Run a command, echoing it first so the log shows exactly what ran.

    shell=False (args list) to avoid quoting pitfalls with paths that contain
    spaces. On Windows, npm/vsce/ovsx/gh are .cmd shims, so resolve them via
    shutil.which to get an executable path subprocess can launch directly.
    Output is forced to UTF-8 with replacement so a stray byte never crashes the
    run on a Windows cp1252 console.
    """
    exe = shutil.which(args[0]) or args[0]
    detail(_c(f"$ {' '.join(args)}", Color.DIM))
    return subprocess.run(
        [exe, *args[1:]],
        cwd=str(cwd),
        check=check,
        text=True,
        capture_output=capture,
        encoding="utf-8",
        errors="replace",
    )


def print_failure_tail(result: subprocess.CompletedProcess, *, limit: int = 12) -> None:
    """Print the last few lines of a captured failed command for triage."""
    combined = ((result.stdout or "") + (result.stderr or "")).strip()
    if not combined:
        return
    lines = combined.splitlines()
    tail = lines[-limit:]
    if len(lines) > limit:
        warn(f"... ({len(lines) - limit} earlier line(s) omitted)")
    for line in tail:
        print(f"      {line}")
