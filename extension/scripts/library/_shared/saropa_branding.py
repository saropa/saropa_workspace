#!/usr/bin/env python3
"""
Shared Saropa branding — logo, copyright, and color helpers.

Import this module instead of duplicating the ASCII logo in every script.
Usage:
    from scripts/.shared/saropa_branding import show_logo, print_cyan, ...

Or add the .shared directory to sys.path and import directly:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / ".shared"))
    from saropa_branding import show_logo

Version:   1.0
Author:    Saropa
Copyright: © 2026 Saropa
"""

import io
import os
import platform
import sys


def enable_windows_ansi() -> None:
    """Enable ANSI escape sequences and UTF-8 output on Windows 10+.

    Wraps both ``sys.stdout`` AND ``sys.stderr`` because Python on Windows
    defaults stderr to ``cp1252`` with ``errors='backslashreplace'`` — which
    silently turns block-drawing characters like ``█`` (U+2588) into the
    literal ASCII string ``\\u2588`` when written to a piped stderr. That's
    how subprocess output ended up showing ``[\\u2588\\u2588\\u2588...]`` in
    the parent's `[RTL-bg]` log instead of the actual progress bar.

    IDEMPOTENT: must be safe to call multiple times in one process.
    setup_arb_translate.py imports saropa_branding (which calls this) AND
    later imports fill_arb_machine_translate (which ALSO calls this at
    module top level so it works as a standalone subprocess too). Without
    the early-return below, the second call replaces the wrapper a second
    time — the first wrapper's reference to the underlying buffer becomes
    orphaned, and the next ``print`` from any code holding a stale handle
    triggers ``ValueError: I/O operation on closed file. lost sys.stderr``
    at interpreter exit. This crashed the whole pipeline before any work
    got done.
    """
    if platform.system() != "Windows":
        return
    # Detect prior wrap by checking the encoding. The default Windows stdout
    # is cp1252 / cp65001 / mbcs; our wrapper sets it to "utf-8" with
    # errors="replace". If both already match, somebody (us, or a parent
    # process that exec()d us) already wrapped — leaving it alone preserves
    # the existing pipe connection.
    already_wrapped = (
        getattr(sys.stdout, "encoding", None) == "utf-8"
        and getattr(sys.stdout, "errors", None) == "replace"
        and getattr(sys.stderr, "encoding", None) == "utf-8"
        and getattr(sys.stderr, "errors", None) == "replace"
    )
    if already_wrapped:
        return
    os.system("")
    # Force UTF-8 stdout so block chars don't crash. Use line buffering so
    # builtin print() flushes after each newline; otherwise the new
    # TextIOWrapper defaults to block buffering and operators see a blank
    # terminal while the script is already blocking on stdin (looks hung).
    sys.stdout = io.TextIOWrapper(
        sys.stdout.buffer,
        encoding="utf-8",
        errors="replace",
        line_buffering=True,
    )
    # Same treatment for stderr — fill_arb_machine_translate.py and other
    # subprocess-launched fill scripts write progress lines to stderr, and
    # the parent setup_arb_translate.py captures them via stderr→stdout
    # redirection. Without this wrapper, block-bar chars get escaped to
    # ``\\uXXXX`` literals before reaching the parent. errors='replace' over
    # backslashreplace so a non-encodable byte becomes U+FFFD (visible
    # garbage) rather than a 6-char escape that looks like real output.
    sys.stderr = io.TextIOWrapper(
        sys.stderr.buffer,
        encoding="utf-8",
        errors="replace",
        line_buffering=True,
    )


# ---------------------------------------------------------------------------
# ANSI color helpers
# ---------------------------------------------------------------------------

def _c(code: str, msg: str) -> str:
    """Wrap message in ANSI color escape codes."""
    return f"\033[{code}m{msg}\033[0m"


def green(msg: str) -> str:
    return _c("32", msg)


def yellow(msg: str) -> str:
    return _c("33", msg)


def cyan(msg: str) -> str:
    return _c("36", msg)


def red(msg: str) -> str:
    return _c("31", msg)


def blue(msg: str) -> str:
    """ANSI blue. Use for *informational* diagnostics — values the operator
    should notice but that don't indicate an error (red) or a warning (yellow).

    Distinct from cyan: cyan is reserved for interactive prompts and
    column headers, so blue carries the "info data" role without
    visually colliding with prompt text."""
    return _c("34", msg)


def light_blue(msg: str) -> str:
    """ANSI bright blue (code 94). Higher-contrast alternative to ``blue``
    for terminals where the standard blue (34) is too dark to read against
    a dark background — e.g. dense tabular output where a whole row of
    blue cells would otherwise blur into the background.

    Use sparingly: only when the standard ``blue`` is genuinely too dim
    to scan; everywhere else stick with ``blue`` to keep the palette tight."""
    return _c("94", msg)


def bold(msg: str) -> str:
    return _c("1", msg)


def print_green(msg: str) -> None:
    print(green(msg))


def print_yellow(msg: str) -> None:
    print(yellow(msg))


def print_cyan(msg: str) -> None:
    print(cyan(msg))


def print_red(msg: str) -> None:
    print(red(msg))


def print_blue(msg: str) -> None:
    print(blue(msg))


def print_bold(msg: str) -> None:
    print(bold(msg))


# ---------------------------------------------------------------------------
# Saropa ASCII logo
# ---------------------------------------------------------------------------

# cspell: disable
_SAROPA_LOGO = """

\033[38;5;208m                               ....\033[0m
\033[38;5;208m                       `-+shdmNMMMMNmdhs+-\033[0m
\033[38;5;209m                    -odMMMNyo/-..````.++:+o+/-\033[0m
\033[38;5;215m                 `/dMMMMMM/`           ````````\033[0m
\033[38;5;220m                `dMMMMMMMMNdhhhdddmmmNmmddhs+-\033[0m
\033[38;5;226m                QMMMMMMMMMMMMMMMMMMMMMMMMMMMMMNhs\033[0m
\033[38;5;190m              . :sdmNNNNMMMMMNNNMMMMMMMMMMMMMMMMm+\033[0m
\033[38;5;154m              o     `..~~~::~+==+~:/+sdNMMMMMMMMMMMo\033[0m
\033[38;5;118m              m                        .+NMMMMMMMMMN\033[0m
\033[38;5;123m              m+                         :MMMMMMMMMm\033[0m
\033[38;5;87m              qN:                        :MMMMMMMMMF\033[0m
\033[38;5;51m               oNs.                    `+NMMMMMMMMo\033[0m
\033[38;5;45m                :dNy\\.              ./smMMMMMMMMm:\033[0m
\033[38;5;39m                 `TdMNmhyso+++oosydNNMMMMMMMMMdP+\033[0m
\033[38;5;33m                    .odMMMMMMMMMMMMMMMMMMMMdo-\033[0m
\033[38;5;57m                       `-+shdNNMMMMNNdhs+-\033[0m
\033[38;5;57m                               ````\033[0m
"""
# cspell: enable

_COPYRIGHT_YEAR = "2026"


def show_logo() -> None:
    """Display the Saropa ASCII art logo, copyright, and contact info."""
    enable_windows_ansi()
    print(_SAROPA_LOGO)
    print(f"\033[38;5;195m  \u00a9 {_COPYRIGHT_YEAR} Saropa. All rights reserved.\033[0m")
    print("\033[38;5;117m  https://saropa.com\033[0m")
    email = "dev.tools@saropa.com"
    print(f"    \033]8;;mailto:{email}\033\\Email {email}\033]8;;\033\\")
    print()
