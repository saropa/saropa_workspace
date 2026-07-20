#!/usr/bin/env python3
"""
Kill the leaked Dart/Flutter tool-host process swarm that hangs VS Code.

WHY THIS EXISTS
---------------
Repeated `flutter` invocations on Windows (test / pub get / gen-l10n, the
saropa_lints PostToolUse hook, backgrounded test runs that hit the known
`sqlite3.dll` native-asset lock) spawn a `dart.exe` flutter_tools host plus a
`dartvm.exe` VM child each time. When those runs are killed or crash, the hosts
are orphaned. They are DETACHED from VS Code, so restarting the editor does NOT
reclaim them — they accumulate (observed: 142 processes, ~2.8 GB) until CPU and
RAM saturate. The VS Code extension host then starves (all chats hang at once)
and the Dart analysis server churns (Problems tab refreshes continuously).

This script enumerates every dart-family process, classifies each as KEEP (a
real service VS Code needs) or KILL (a leaked host), reports the split, and
terminates only the leaked set. The legitimate services — analysis
`language-server`, `tooling-daemon`, `devtools`, the debug `development-service`
(DDS), and `flutter_agent_lens` — are spared so the editor keeps working.

WHAT IT KILLS (default)
-----------------------
  - every `dartvm.exe`          (flutter CLI VM host; services run as dart.exe)
  - `dart.exe` whose command line is a flutter_tools host
  - orphaned `flutter_tester.exe` (the native-asset-lock test-runner leak)

WHAT IT KEEPS
-------------
  - dart.exe running language-server / tooling-daemon / devtools /
    development-service / flutter_agent_lens

Pass --include-dds to ALSO kill a stale `development-service` (only safe when no
app is actively being debugged). Pass --include-build-runner to also kill a
`build_runner` host (only safe when no `build_runner watch` is intentionally
running).

Version:   1.0
Author:    Saropa
Copyright: © 2026 Saropa
Usage:
  python scripts/clean/dart_process_clean.py            # report + confirm + kill
  python scripts/clean/dart_process_clean.py --dry-run  # report only, kill nothing
  python scripts/clean/dart_process_clean.py --yes      # skip the confirmation
"""

import argparse
import json
import platform
import subprocess
import sys
import time
from pathlib import Path

# Reuse the house branding + ANSI helpers (also enables Windows ANSI / UTF-8).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "_shared"))
from saropa_branding import (  # noqa: E402
    show_logo,
    enable_windows_ansi,
    green,
    yellow,
    cyan,
    red,
    blue,
    bold,
    print_red,
    print_green,
    print_yellow,
    print_cyan,
)

# Command-line substrings that mark a dart.exe as a SERVICE we must never kill —
# terminating any of these breaks the live VS Code session.
_PROTECTED_MARKERS = (
    "language-server",
    "tooling-daemon",
    "devtools",
    "development-service",
    "flutter_agent_lens",
    "analysis_server",
)

# Command-line substring that identifies a dart.exe as a flutter_tools CLI host
# (the leaked kind). Backslash form matches the Windows path the host runs from.
_FLUTTER_TOOLS_MARKER = "flutter_tools\\.dart_tool"


def _gather_processes() -> list[dict]:
    """Query Win32_Process for the dart-family swarm via PowerShell -> JSON.

    Shelling out to PowerShell avoids a psutil dependency (a new third-party
    package would be a blast-radius change). Win32_Process carries CommandLine
    — which `Get-Process` alone does not — and that is what classification needs.
    """
    ps = (
        "Get-CimInstance Win32_Process -Filter "
        "\"Name='dart.exe' OR Name='dartvm.exe' OR Name='dartaotruntime.exe' "
        "OR Name='flutter_tester.exe'\" | ForEach-Object { "
        "$p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; "
        "[PSCustomObject]@{ Id=$_.ProcessId; Name=$_.Name; "
        "CommandLine=$_.CommandLine; "
        "CPU= if ($p) { [math]::Round($p.CPU,1) } else { 0 }; "
        "WS= if ($p) { $p.WorkingSet64 } else { 0 } } } | "
        "ConvertTo-Json -Depth 2"
    )
    result = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
        capture_output=True,
        text=True,
    )
    raw = (result.stdout or "").strip()
    if not raw:
        return []

    parsed = json.loads(raw)
    # ConvertTo-Json emits a bare object (not a list) for a single match.
    if isinstance(parsed, dict):
        return [parsed]
    return parsed


def _classify(proc: dict, include_dds: bool, include_build_runner: bool) -> tuple[bool, str]:
    """Return (should_kill, role_label) for one process.

    The role label is the short human reason shown in the report so the operator
    can see WHY each row is kept or killed without reading the full command line.
    """
    name = (proc.get("Name") or "").lower()
    cmd = proc.get("CommandLine") or ""

    if name == "flutter_tester.exe":
        return True, "orphaned test runner"

    if name in ("dartvm.exe", "dartaotruntime.exe"):
        return True, "flutter CLI VM host"

    # From here it is dart.exe — keep the real services, kill the tool hosts.
    if "development-service" in cmd:
        return (include_dds, "stale debug service (DDS)" if include_dds else "debug service (DDS)")

    if "build_runner" in cmd:
        return (
            include_build_runner,
            "build_runner host" if include_build_runner else "build_runner (kept)",
        )

    for marker in _PROTECTED_MARKERS:
        if marker in cmd:
            return False, marker

    if _FLUTTER_TOOLS_MARKER in cmd:
        return True, "flutter_tools host"

    # Unknown dart.exe with no recognized marker — keep it (conservative: never
    # kill something we cannot positively identify as a leaked host).
    return False, "unrecognized — kept"


def _fmt_mb(byte_count: int) -> str:
    """Bytes -> right-aligned megabyte string."""
    return f"{round(byte_count / (1024 * 1024)):>5} MB"


def _print_report(rows: list[tuple[dict, bool, str]]) -> tuple[int, int]:
    """Render the classification table. Returns (kill_count, kill_bytes)."""
    width = 78
    print()
    print(bold(cyan("  Dart / Flutter process audit")))
    print(cyan("  " + "─" * width))
    header = f"  {'PID':>6}  {'PROCESS':<16}  {'CPU(s)':>7}  {'MEMORY':>8}  {'VERDICT':<8} ROLE"
    print(bold(header))
    print(cyan("  " + "─" * width))

    kill_count = 0
    kill_bytes = 0
    for proc, kill, role in sorted(rows, key=lambda r: (not r[1], -r[0].get("WS", 0))):
        verdict = red("KILL") if kill else green("KEEP")
        pid = proc.get("Id", 0)
        name = (proc.get("Name") or "")[:16]
        cpu = proc.get("CPU", 0)
        mem = _fmt_mb(proc.get("WS", 0))
        role_text = red(role) if kill else blue(role)
        # Verdict is padded BEFORE coloring so ANSI codes don't break alignment.
        print(f"  {pid:>6}  {name:<16}  {cpu:>7}  {mem:>8}  {verdict:<8} {role_text}")
        if kill:
            kill_count += 1
            kill_bytes += proc.get("WS", 0)

    print(cyan("  " + "─" * width))
    keep_count = len(rows) - kill_count
    summary = (
        f"  {len(rows)} dart-family processes  ·  "
        f"{green(str(keep_count) + ' keep')}  ·  "
        f"{red(str(kill_count) + ' kill')}  ·  "
        f"reclaim ~{round(kill_bytes / (1024 * 1024))} MB"
    )
    print(summary)
    print()
    return kill_count, kill_bytes


def _progress_bar(done: int, total: int, width: int = 40) -> str:
    """A single filled/empty progress bar string with percentage."""
    filled = round(width * done / total) if total else width
    pct = round(100 * done / total) if total else 100
    return f"[{green('█' * filled)}{'░' * (width - filled)}] {pct:>3}%  ({done}/{total})"


def _kill_rows(rows: list[tuple[dict, bool, str]]) -> tuple[int, int]:
    """Terminate every KILL row with a live progress bar. Returns (killed, bytes)."""
    targets = [proc for proc, kill, _ in rows if kill]
    total = len(targets)
    killed = 0
    freed = 0
    for proc in targets:
        pid = proc.get("Id", 0)
        subprocess.run(
            ["powershell", "-NoProfile", "-Command", f"Stop-Process -Id {pid} -Force -ErrorAction SilentlyContinue"],
            capture_output=True,
            text=True,
        )
        killed += 1
        freed += proc.get("WS", 0)
        # \r keeps the bar on one line; flush so it animates instead of buffering.
        sys.stdout.write("\r  " + _progress_bar(killed, total))
        sys.stdout.flush()
    print()
    return killed, freed


def main() -> int:
    """Audit, report, confirm, and kill the leaked dart-family swarm."""
    parser = argparse.ArgumentParser(
        description="Kill the leaked Dart/Flutter tool-host process swarm.",
    )
    parser.add_argument("--dry-run", action="store_true", help="report only; kill nothing")
    parser.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    parser.add_argument(
        "--include-dds",
        action="store_true",
        help="also kill a stale development-service (only when not debugging an app)",
    )
    parser.add_argument(
        "--include-build-runner",
        action="store_true",
        help="also kill a build_runner host (only when no watch is running)",
    )
    args = parser.parse_args()

    enable_windows_ansi()
    show_logo()

    if platform.system() != "Windows":
        print_yellow("This cleaner targets the Windows dart-host leak; nothing to do here.")
        return 0

    print_cyan("Scanning for dart / dartvm / flutter_tester processes...")
    try:
        procs = _gather_processes()
    except (json.JSONDecodeError, OSError) as error:
        print_red(f"Could not enumerate processes: {error}")
        return 1

    if not procs:
        print_green("✓ No dart-family processes running. Nothing to clean.")
        return 0

    rows = [(p, *_classify(p, args.include_dds, args.include_build_runner)) for p in procs]
    kill_count, _ = _print_report(rows)

    if kill_count == 0:
        print_green("✓ No leaked hosts found — only protected services are running.")
        return 0

    if args.dry_run:
        print_yellow("Dry run — no processes were killed. Re-run without --dry-run to clean.")
        return 0

    if not args.yes:
        print(bold(yellow(f"  About to kill {kill_count} leaked process(es).")))
        answer = input(cyan("  Proceed? [y/N] ")).strip().lower()
        if answer not in ("y", "yes"):
            print_yellow("Aborted — nothing killed.")
            return 0

    print()
    print_cyan("Terminating leaked hosts...")
    killed, freed = _kill_rows(rows)

    # Brief settle so cascade-exits (flutter_tools hosts whose VM child we killed)
    # finish before the final count, otherwise the reclaim figure reads low.
    time.sleep(1)
    print()
    print_green(f"✓ Killed {killed} process(es), reclaimed ~{round(freed / (1024 * 1024))} MB.")
    print_cyan(
        "If the Problems tab still churns, run "
        "'Dart: Restart Analysis Server' (Ctrl+Shift+P) to reset the analyzer."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
