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


def prompt_on_failure(label: str) -> str:
    """Ask how to handle a failed step: 'ignore', 'retry' (default), or 'abort'.

    Retry is the default because most publish failures are transient — a flaky
    npm registry, a tag that has not propagated yet, a PAT just refreshed — so
    re-running the single failed step is cheaper than restarting the pipeline.
    Ignore continues as though the step passed (only safe when the failure is
    known-benign); abort stops the run.

    A non-interactive stdin (CI, piped input) can't answer, so it defaults to
    abort: an unattended run must never hang on the prompt nor silently swallow a
    real failure by defaulting to retry forever.
    """
    if not sys.stdin or not sys.stdin.isatty():
        error(f"{label} failed; non-interactive session, aborting.")
        return "abort"
    while True:
        try:
            choice = input(f"  {label} failed. [i]gnore / [r]etry / [a]bort (default retry): ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print()
            return "abort"
        if choice in ("", "r", "retry"):
            return "retry"
        if choice in ("i", "ignore"):
            return "ignore"
        if choice in ("a", "abort"):
            return "abort"
        warn("Enter i, r, or a.")


# cspell:disable
def show_logo() -> None:
    """Print the Saropa 'S' logo. Pure branding; never references any tooling."""
    logo = """
\033[38;5;208m                               ....\033[0m
\033[38;5;208m                       `-+shdmNMMMMNmdhs+-\033[0m
\033[38;5;209m                    -odMMMNyo/-..````.++:+o+/-\033[0m
\033[38;5;215m                 `/dMMMMMM/`          ``````````\033[0m
\033[38;5;220m                `dMMMMMMMMNdhhhdddmmmNmmddhs+-\033[0m
\033[38;5;226m                /MMMMMMMMMMMMMMMMMMMMMMMMMMMMMNh\\\033[0m
\033[38;5;190m              . :sdmNNNNMMMMMNNNMMMMMMMMMMMMMMMMm+\033[0m
\033[38;5;154m              o     `..~~~::~+==+~:/+sdNMMMMMMMMMMMo\033[0m
\033[38;5;118m              m                        .+NMMMMMMMMMN\033[0m
\033[38;5;123m              m+                         :MMMMMMMMMm\033[0m
\033[38;5;87m              /N:                        :MMMMMMMMM/\033[0m
\033[38;5;51m               oNs.                    `+NMMMMMMMMo\033[0m
\033[38;5;45m                :dNy/.              ./smMMMMMMMMm:\033[0m
\033[38;5;39m                 `/dMNmhyso+++oosydNNMMMMMMMMMd/\033[0m
\033[38;5;33m                    .odMMMMMMMMMMMMMMMMMMMMdo-\033[0m
\033[38;5;57m                       `-+shdNNMMMMNNdhs+-\033[0m
\033[38;5;57m                               ````\033[0m
"""
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
    """Run a command and return the completed process.

    Commands are not echoed to the log: the step headers and result lines already
    say what is happening, and printing the raw argv adds noise (and would surface
    internal tooling invocations the operator does not need to read).

    shell=False (args list) to avoid quoting pitfalls with paths that contain
    spaces. On Windows, npm/vsce/ovsx/gh are .cmd shims, so resolve them via
    shutil.which to get an executable path subprocess can launch directly.
    Output is forced to UTF-8 with replacement so a stray byte never crashes the
    run on a Windows cp1252 console.
    """
    exe = shutil.which(args[0]) or args[0]
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
