#!/usr/bin/env python3
"""Flutter Device Debug Assistant — launcher.

Self-contained bundled script: this launcher plus the ``debug_connect/`` package
beside it. Connects a physical Android device to Flutter for on-device debugging
over Wi-Fi or USB, mirrors the screen (scrcpy), and reports device health.

Only the standard library is imported before the dependency check runs, because
the package modules import third-party packages (rich, plyer, zeroconf) at load
time. So the check must complete — and the user must consent to any install —
BEFORE the package is imported.
"""

from __future__ import annotations

import argparse
import importlib.util
import subprocess
import sys

# import-name -> pip install-name for the packages the debug_connect package needs.
_REQUIRED = {"rich": "rich", "plyer": "plyer", "zeroconf": "zeroconf"}


def ensure_dependencies() -> None:
    """Check for the required third-party packages; install only with consent.

    Deliberately NOT a silent auto-installer: it names every missing package and
    asks before touching the environment. Declining aborts the run — nothing is
    installed, and the package (which imports these at load) is never reached.
    Plain print/input are used because rich itself may be one of the missing
    packages, so it cannot be assumed available for the prompt.
    """
    missing = {
        name: pip_name
        for name, pip_name in _REQUIRED.items()
        if importlib.util.find_spec(name) is None
    }
    if not missing:
        return

    names = ", ".join(sorted(missing))
    print(f"{len(missing)} required package(s) not installed: {names}")
    answer = input("Install them now with pip? [y/N] ").strip().lower()
    if answer not in ("y", "yes"):
        print("Aborted — nothing was installed.")
        sys.exit(1)

    for pip_name in sorted(missing.values()):
        print(f"Installing {pip_name} ...")
        try:
            # sys.executable installs into the SAME interpreter running this
            # script, so an active virtual environment is respected.
            subprocess.check_call(
                [sys.executable, "-m", "pip", "install", pip_name],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.STDOUT,
            )
        except subprocess.CalledProcessError as error:
            print(f"Failed to install {pip_name}: {error}")
            print(f"Install it manually: {sys.executable} -m pip install {pip_name}")
            sys.exit(1)


# Consent-gated dependency check BEFORE importing the package (its modules import
# the third-party packages at load time).
ensure_dependencies()

# Imported only AFTER the check. Python has already put this file's own directory
# on sys.path[0], so the sibling ``debug_connect`` package resolves regardless of
# the working directory (which is the Flutter project the tool acts on).
from rich.panel import Panel  # noqa: E402
from rich.traceback import install as install_rich_traceback  # noqa: E402

from debug_connect.connect import main, MENU_ACTIONS  # noqa: E402
from debug_connect.core import console, log_path, write_log  # noqa: E402

# Syntax-highlight any uncaught traceback; show_locals=False keeps device IPs and
# tokens out of the rendered frames.
install_rich_traceback(show_locals=False)


_HELP = """[bold cyan]Flutter Device Debug Assistant[/bold cyan]

Connects a physical Android device to Flutter for on-device debugging over Wi-Fi
or USB, then mirrors the screen (scrcpy) and reports device health. Run from the
root of the Flutter project you are debugging.

[bold]Usage[/bold]
  python device-connect                    run the interactive menu
  python device-connect --action express   run 'Express' non-interactively
  python device-connect -h                 show this help

[bold]--action names[/bold] (stable — survive menu renumbering)
  {actions}
"""


def _render_help() -> str:
    """Help text with the CURRENT --action names substituted from MENU_ACTIONS.

    Sourced from the menu rather than hardcoded so the help cannot drift out of
    sync with the slugs the CLI actually accepts.
    """
    return _HELP.format(actions=", ".join(sorted(MENU_ACTIONS.keys())))


def _run() -> int:
    """Run the menu with friendly Ctrl+C and last-resort error handling."""
    if any(arg in ("-h", "--help") for arg in sys.argv[1:]):
        console.print(Panel(_render_help(), border_style="cyan", expand=False))
        return 0

    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument(
        "--action",
        choices=sorted(MENU_ACTIONS.keys()),
        default=None,
        help="Run a menu option non-interactively by NAME (see -h for the list).",
    )
    args = parser.parse_args()
    # Resolve the stable name to the menu's CURRENT numeric key at the CLI boundary,
    # so reordering the menu can never silently repoint a saved --action command at
    # the wrong option (a raw digit would).
    action_key = MENU_ACTIONS.get(args.action) if args.action else None

    try:
        main(action=action_key)
        return 0
    except KeyboardInterrupt:
        # Ctrl+C is a normal way to abort a connection attempt — exit quietly with
        # the conventional 130, not a scary traceback.
        console.print("\n[yellow]Canceled by user (Ctrl+C). Goodbye.[/yellow]")
        return 130
    except Exception as error:  # noqa: BLE001 — last-resort top-level guard
        write_log("FATAL", f"Unhandled error: {error}")
        console.print_exception(show_locals=False)
        console.print(f"\n[bold red]Unexpected error:[/bold red] {error}")
        console.print(f"[dim]Full log: {log_path}[/dim]")
        return 1


if __name__ == "__main__":
    sys.exit(_run())
