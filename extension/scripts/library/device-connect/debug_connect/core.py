"""Shared foundation: console, logging, config, command execution, validation.

Every other debug_connect module imports from here. This module intentionally
holds the singletons that must be shared process-wide — the rich `console`, the
per-run log file path, and the on-disk config/state file locations — so all
modules write to the SAME console and the SAME daily log.
"""

import os
import re
import json
import shutil
import socket
import platform
import subprocess
from datetime import datetime

from rich.console import Console
from rich.progress import (
    Progress,
    SpinnerColumn,
    BarColumn,
    TextColumn,
    MofNCompleteColumn,
    TimeElapsedColumn,
)

# Desktop toast notifications (optional nicety; failures are swallowed).
from plyer import notification

# The single rich rendering engine shared by every module. Importing this name
# (`from .core import console`) hands every module the same instance.
console = Console()

# =============================================================================
# CONFIGURATION & LOGGING SETUP
# =============================================================================
PROJECT_ROOT = os.getcwd()

# Config + power-state filenames are deliberately UNCHANGED from the tool's
# Wi-Fi-only era: they hold live user state (the saved last_ip_port, the
# power-saving restore snapshot). Renaming them to match the new tool name would
# silently orphan that state, so they keep their original names.
CONFIG_FILE = os.path.join(PROJECT_ROOT, "wifi_debug_config.json")
# Records what power-saving turned off + each setting's ORIGINAL value, so a
# later run can put the device back exactly as it was. Its presence (active:true)
# is also how the toggle knows whether the next run should apply or restore.
POWER_STATE_FILE = os.path.join(PROJECT_ROOT, "wifi_power_state.json")

now = datetime.now()
date_folder = now.strftime("%Y%m%d")
# Per-run log filename follows the new tool name (cosmetic, holds no state).
log_filename = f"{now.strftime('%Y%m%d_%H%M%S')}_debug_connect.log"

log_dir = os.path.join(PROJECT_ROOT, "reports", date_folder)
os.makedirs(log_dir, exist_ok=True)
log_path = os.path.join(log_dir, log_filename)


def write_log(entry_type, text):
    """Appends execution timestamps and formatted text to the daily log file."""
    timestamp = datetime.now().strftime("[%H:%M:%S]")
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(f"{timestamp} [{entry_type}] {text}\n")


def load_config():
    """Reads the JSON config file to remember your last successful connection."""
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {"last_ip_port": "", "last_ip_only": ""}


def save_config(key, value):
    """Updates a specific key in the JSON config file and saves it to disk."""
    config = load_config()
    config[key] = value
    try:
        with open(CONFIG_FILE, "w") as f:
            json.dump(config, f, indent=4)
    except Exception as e:
        console.print(f"[bold red]Error saving config: {e}[/bold red]")


def run_command(command, show_output=True, success_msg=None):
    """Executes a shell command on your OS, logs it, and returns the output."""
    write_log("CMD", f"Executing: {command}")
    try:
        # CREATE_NO_WINDOW (Windows only) stops adb.exe — and the cmd.exe that
        # shell=True spawns — from flashing a transient black console window on
        # every invocation. Without it, each adb/flutter call pops a window for
        # a fraction of a second (3-6 flashes across an Express run). Guarded by
        # platform because the flag does not exist on POSIX subprocess.
        creation_flags = 0
        startup_info = None
        if platform.system().lower() == "windows":
            creation_flags = subprocess.CREATE_NO_WINDOW
            # CREATE_NO_WINDOW hides the cmd.exe that shell=True spawns, but adb.exe
            # (a console app) can still briefly pop its OWN window; SW_HIDE on the
            # startup info suppresses that too. Belt-and-suspenders against flashing.
            startup_info = subprocess.STARTUPINFO()
            startup_info.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startup_info.wShowWindow = subprocess.SW_HIDE

        result = subprocess.run(
            command, shell=True, text=True, capture_output=True,
            encoding="utf-8", errors="replace",
            creationflags=creation_flags,
            startupinfo=startup_info,
        )

        output = result.stdout.strip()
        error_output = result.stderr.strip()
        full_output = output if output else error_output

        if full_output:
            write_log("OUT", full_output)
            if show_output:
                console.print(full_output, style="dim")

        if success_msg and result.returncode == 0:
            console.print(success_msg, style="bold green")

        return full_output
    except Exception as e:
        error_msg = f"Error running '{command}': {e}"
        console.print(f"[bold red]{error_msg}[/bold red]")
        write_log("ERROR", error_msg)
        return ""


def send_os_notification(title, message):
    """Triggers a native desktop toast notification on the host OS."""
    try:
        notification.notify(
            title=title,
            message=message,
            app_name="Flutter Debug Assistant",
            timeout=5,
        )
        write_log("NOTIFY", f"Desktop notification sent: {title}")
    except Exception as e:
        write_log("NOTIFY_ERR", f"Failed to send OS notification: {e}")


def _adb_shell(target, shell_cmd):
    """Runs a single `adb -s <target> shell <cmd>` and returns trimmed output."""
    return run_command(f"adb -s {target} shell {shell_cmd}", show_output=False).strip()


def _adb_shell_many(target, commands):
    """Runs several device-shell commands in ONE `adb shell` invocation.

    Batched on purpose: every separate `adb ... shell` call spawns a short-lived
    adb/cmd process on Windows that can flash a console window, and power saving
    issues a dozen+ of them per run. Joining with ';' so they run inside the
    device's own shell collapses that to a single host process (and is faster).
    """
    joined = "; ".join(commands)
    return _adb_shell(target, f'"{joined}"')


# =============================================================================
# VALIDATION UTILITIES
# =============================================================================
def validate_ip_port(input_str):
    return re.match(r"^\d{1,3}(\.\d{1,3}){3}:\d+$", input_str) is not None


def validate_ip_only(input_str):
    return re.match(r"^\d{1,3}(\.\d{1,3}){3}$", input_str) is not None


def test_tcp_connectable(ip_and_port, timeout=3.0):
    """
    Opens a raw TCP socket to IP:PORT to confirm the debug port is actually
    reachable BEFORE we hand off to 'adb connect'.

    We test the socket directly (not via adb) because 'adb connect' against a
    dead/firewalled endpoint blocks for its own long internal timeout and then
    reports a confusing failure. A quick socket probe with a short timeout tells
    us up front whether the port is open, so we can skip the adb round-trip
    entirely when the device is unreachable.

    Returns (reachable: bool, detail: str) — detail carries the OS error text
    on failure so the caller can show why the probe failed.
    """
    try:
        ip_str, port_str = ip_and_port.split(":")
        port = int(port_str)
    except (ValueError, IndexError) as e:
        return False, f"Malformed IP:PORT '{ip_and_port}': {e}"

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        sock.connect((ip_str, port))
        return True, "Port is open"
    except (socket.timeout, OSError) as e:
        # Connection refused / host unreachable / timed out all land here.
        return False, str(e)
    finally:
        sock.close()


# =============================================================================
# SHARED UX HELPERS
# =============================================================================
# One place for the four status-line shapes so every module renders ✔/⚠/✖/·
# identically (icon + color + weight). New code uses these instead of hand-
# writing the rich markup, which kept drifting (different icons, bold vs not).
def print_ok(message):
    """Green success line with a check."""
    console.print(f"✔ [bold green]{message}[/bold green]")


def print_warn(message):
    """Yellow caution line — recoverable / advisory."""
    console.print(f"⚠ [bold yellow]{message}[/bold yellow]")


def print_err(message):
    """Red failure line — the action did not succeed."""
    console.print(f"✖ [bold red]{message}[/bold red]")


def print_info(message):
    """Dim secondary line — context the user can skim past."""
    console.print(f"[dim]{message}[/dim]")


def make_scan_progress():
    """A determinate Progress for the full-range TCP port sweep.

    `transient=True` so the bar erases itself once the scan finishes, leaving
    only the result line — the 65k-port sweep is a means to an end, not output
    worth keeping on screen. Shared here so the scan and any future long sweep
    render the same bar.
    """
    return Progress(
        SpinnerColumn(),
        TextColumn("[bold cyan]{task.description}"),
        BarColumn(),
        MofNCompleteColumn(),
        TextColumn("[dim]ports[/dim]"),
        TimeElapsedColumn(),
        console=console,
        transient=True,
    )


# =============================================================================
# CROSS-MODULE RUN STATE
# =============================================================================
# scrcpy's real outcome for this run, so the final Flutter-sync summary
# (check_flutter in connect.py) can reflect it instead of always declaring
# "Ready!" even when mirroring silently failed (headless zombie, crash on
# launch). None = never attempted; True = window confirmed; False = attempted
# and failed.
_scrcpy_outcome = {"ok": None}


def set_scrcpy_outcome(ok):
    """Records whether the last scrcpy launch attempt actually produced a mirror."""
    _scrcpy_outcome["ok"] = ok


def get_scrcpy_outcome():
    """Returns the last scrcpy launch outcome: True, False, or None (not attempted)."""
    return _scrcpy_outcome["ok"]


def require_adb():
    """Pre-flight: confirm `adb` is callable before any menu action needs it.

    Without this, a missing platform-tools install surfaces as a confusing wall
    of empty `run_command` outputs ("device offline / not reachable") several
    steps later. Checking once up front turns that into one clear, actionable
    message. Returns True when adb is on PATH, False (with guidance) otherwise.
    """
    if shutil.which("adb") is not None:
        return True
    print_err("adb was not found on your PATH.")
    print_info(
        "Install Android platform-tools and add it to PATH, then retry: "
        "https://developer.android.com/tools/releases/platform-tools"
    )
    write_log("PREFLIGHT", "adb not on PATH")
    return False
