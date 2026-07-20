#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Flutter dependency report with optional upgrade capabilities.

Default mode is read-only: shows project info, dependency tree, outdated
packages, and overrides in a timestamped log file.

Flags:
  --interactive   Prompt y/n before each upgrade step (Kotlin, Firebase, packages)
  --upgrade       Auto-upgrade all packages without prompting
  --verbose       Show blocked packages and debug output

Version:   2.0
Copyright: (c) 2026 Saropa. All rights reserved.
"""

import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Type, Union

# ---------------------------------------------------------------------------
# Optional dependencies with graceful fallbacks
# ---------------------------------------------------------------------------

try:
    import yaml
except ImportError:
    print("Error: PyYAML is required. Install with: pip install PyYAML")
    sys.exit(1)

_tqdm_available: bool = False
try:
    from tqdm import tqdm as _tqdm_iter
    from tqdm import tqdm as _tqdm_cls

    _tqdm_available = True
except ImportError:
    pass

# Fallback tqdm that just yields items
def _fallback_tqdm(iterable, *args, **kwargs):
    yield from iterable

tqdm_iter = _tqdm_iter if _tqdm_available else _fallback_tqdm

# Import shared branding
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "_shared"))
from saropa_branding import show_logo  # noqa: E402

# ---------------------------------------------------------------------------
# ANSI color helpers
# ---------------------------------------------------------------------------

class _AnsiColors:
    """ANSI escape codes for colored terminal output."""
    RESET = "\033[0m"
    BOLD = "\033[1m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    RED = "\033[91m"
    BLUE = "\033[94m"
    CYAN = "\033[96m"
    MAGENTA = "\033[95m"

class _NoColors:
    """Empty strings when colorama is unavailable."""
    RESET = BOLD = GREEN = YELLOW = RED = BLUE = CYAN = MAGENTA = ""

_colorama_available: bool = False
try:
    import colorama
    colorama.init(autoreset=True)
    C: Union[Type[_AnsiColors], Type[_NoColors]] = _AnsiColors
    _colorama_available = True
except ImportError:
    C = _NoColors


def _info(text: str) -> str:
    return f"{C.CYAN}{text}{C.RESET}"


def _success(text: str) -> str:
    return f"{C.GREEN}{text}{C.RESET}"


def _warn(text: str) -> str:
    return f"{C.YELLOW}{text}{C.RESET}"


def _error(text: str) -> str:
    return f"{C.RED}{text}{C.RESET}"


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_SCRIPT_VERSION: str = "2.0"
_PROJECT_ROOT: Path = Path(__file__).resolve().parent.parent.parent
_GRADLE_FILE: Path = _PROJECT_ROOT / "android" / "build.gradle"
_APP_GRADLE_FILE: Path = _PROJECT_ROOT / "android" / "app" / "build.gradle"
# ANSI escape stripper for writing clean log files
_ANSI_PATTERN = re.compile(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])")

# ---------------------------------------------------------------------------
# Flutter CLI helpers
# ---------------------------------------------------------------------------


def _run_flutter_command(
    project_path: Path,
    command_args: List[str],
) -> Optional[str]:
    """Run a flutter command and return stdout, or None on failure."""
    flutter_exe: Optional[str] = shutil.which("flutter")
    if not flutter_exe:
        print(_error("CRITICAL: 'flutter' executable not found in PATH."))
        return None
    full_command: List[str] = [flutter_exe] + command_args
    try:
        process: subprocess.CompletedProcess = subprocess.run(
            full_command,
            capture_output=True,
            text=True,
            check=True,
            encoding="utf-8",
            errors="replace",
            cwd=project_path,
        )
        return process.stdout
    except subprocess.CalledProcessError as e:
        print(_error(f"Error running '{' '.join(full_command)}'. Code: {e.returncode}"))
        if e.stderr:
            print(_error(f"Stderr: {e.stderr.strip()}"))
        return None
    except FileNotFoundError:
        print(_error(f"Command not found: {flutter_exe}"))
        return None
    except Exception as e:
        print(_error(f"Unexpected error: {type(e).__name__} - {e}"))
        return None


def _parse_pubspec(project_path: Path) -> Optional[Dict]:
    """Parse pubspec.yaml and return its contents as a dict."""
    pubspec_file: Path = project_path / "pubspec.yaml"
    if not pubspec_file.is_file():
        print(_error(f"pubspec.yaml not found in {project_path}"))
        return None
    try:
        with open(pubspec_file, "r", encoding="utf-8") as f:
            return yaml.safe_load(f)
    except (yaml.YAMLError, IOError) as e:
        print(_error(f"Error reading pubspec.yaml: {e}"))
        return None


def _get_outdated_packages(project_path: Path) -> Optional[List[Dict]]:
    """Run flutter pub outdated --json and return the packages list."""
    output: Optional[str] = _run_flutter_command(
        project_path, ["pub", "outdated", "--json"]
    )
    if not output:
        return None
    try:
        # Find the JSON object start (flutter may print non-JSON preamble)
        json_start: int = output.find("{")
        if json_start == -1:
            json_start = output.find("[")
        if json_start == -1:
            print(_warn("No valid JSON in 'flutter pub outdated --json' output."))
            return []
        data = json.loads(output[json_start:])
        if isinstance(data, dict):
            return data.get("packages", [])
        return data if isinstance(data, list) else []
    except json.JSONDecodeError as e:
        print(_error(f"JSON parse error from 'flutter pub outdated': {e}"))
        return None


# ---------------------------------------------------------------------------
# Dependency tree parsing
# ---------------------------------------------------------------------------


def _parse_deps_output(
    deps_lines: List[str],
) -> Tuple[List[str], List[str]]:
    """Parse flutter pub deps output into top-level and all-resolved lists."""
    if not deps_lines:
        return [], []
    top_level: List[str] = []
    all_packages: Dict[str, str] = {}
    pkg_re = re.compile(
        r"^\s*(?:[├│└]\s*|──\s*)*([\w_.-]+)\s+([\d\w.+-]+)"
        r"(?:\s+from\s+.*|\s+already\s+listed)?$"
    )
    top_re = re.compile(r"^\s*(?:├──|└──)\s*([\w_.-]+)\s+([\d\w.+-]+)")
    skipped_first: bool = False
    for line in deps_lines:
        line = line.rstrip()
        if not line:
            continue
        # Skip the first line (project name)
        if not skipped_first:
            skipped_first = True
            continue
        if line.strip() == "dev_dependencies:":
            continue
        match_all = pkg_re.match(line)
        if match_all:
            name: str = match_all.group(1)
            version: str = match_all.group(2)
            all_packages[name] = version
            if top_re.match(line):
                top_level.append(f"{name} {version}")
    unique_top: List[str] = sorted(set(top_level))
    formatted_all: List[str] = sorted(
        [f"{n} {v}" for n, v in all_packages.items()]
    )
    return unique_top, formatted_all


def _get_override_deps(
    project_path: Path,
    override_path_str: str,
) -> Dict[str, str]:
    """Get direct dependencies of a local dependency override."""
    data: Optional[Dict] = _parse_pubspec(project_path / override_path_str)
    if not data or "dependencies" not in data:
        return {}
    deps_section = data["dependencies"]
    if not isinstance(deps_section, dict):
        return {}
    result: Dict[str, str] = {}
    for name, info in deps_section.items():
        if isinstance(info, str):
            result[name] = info
        elif isinstance(info, dict) and "version" in info:
            result[name] = info["version"]
    return result


# ---------------------------------------------------------------------------
# Report generation (read-only analysis)
# ---------------------------------------------------------------------------


def _generate_report(
    pubspec_data: Dict,
    outdated_packages: List[Dict],
    deps_output: Optional[str],
) -> List[str]:
    """Build report sections as a list of formatted strings."""
    sections: List[str] = []

    # --- Project information ---
    lines: List[str] = [f"{C.BOLD}Project Information:{C.RESET}"]
    lines.append(f"  Name: {pubspec_data.get('name', 'N/A')}")
    lines.append(f"  Version: {pubspec_data.get('version', 'N/A')}")
    lines.append(f"  Description: {pubspec_data.get('description', 'N/A')}")
    lines.append(f"  Homepage: {pubspec_data.get('homepage', 'N/A')}")
    if "publish_to" in pubspec_data:
        lines.append(f"  Publish to: {pubspec_data.get('publish_to')}")
    env = pubspec_data.get("environment")
    if env:
        lines.append("  Environment:")
        for sdk, constr in env.items():
            lines.append(f"    {sdk}: {constr}")
    sections.append("\n".join(lines))

    # --- Top-level packages ---
    top_level: List[str] = []
    all_resolved: List[str] = []
    tree_raw: str = "Could not retrieve dependency tree."
    if deps_output:
        tree_raw = deps_output
        top_level, all_resolved = _parse_deps_output(deps_output.splitlines())

    sec_a: List[str] = [f"{C.BOLD}A) Top-Level Packages:{C.RESET}"]
    if top_level:
        sec_a.extend([f"- {p}" for p in top_level])
    else:
        sec_a.append("No top-level packages found.")
    sections.append("\n".join(sec_a))

    # --- All resolved dependencies ---
    sec_b: List[str] = [f"{C.BOLD}B) All Resolved Dependencies:{C.RESET}"]
    if all_resolved:
        sec_b.extend([f"- {p}" for p in all_resolved])
    else:
        sec_b.append("No dependencies found.")
    sections.append("\n".join(sec_b))

    # --- Full dependency tree ---
    sec_c: List[str] = [f"{C.BOLD}C) Dependency Tree:{C.RESET}", tree_raw]
    sections.append("\n".join(sec_c))

    # --- Outdated packages ---
    sec_d: List[str] = [f"{C.BOLD}D) Outdated Packages:{C.RESET}"]
    if outdated_packages:
        for pkg in outdated_packages:
            if not pkg:
                continue
            name: str = pkg.get("package", "N/A")
            # Handle explicit None values for version dicts
            current: str = (pkg.get("current") or {}).get("version", "N/A")
            upgradable: Optional[str] = (pkg.get("upgradable") or {}).get("version")
            resolvable: Optional[str] = (pkg.get("resolvable") or {}).get("version")
            latest: Optional[str] = (pkg.get("latest") or {}).get("version")
            line: str = f"- {C.YELLOW}{name}{C.RESET}: Current: {current}"
            if upgradable:
                line += f", Upgradable: {C.GREEN}{upgradable}{C.RESET}"
            if resolvable and resolvable != upgradable:
                line += f", Resolvable: {C.CYAN}{resolvable}{C.RESET}"
            if latest and latest != upgradable and latest != resolvable:
                line += f", Latest: {C.MAGENTA}{latest}{C.RESET}"
            line += f" (https://pub.dev/packages/{name})"
            sec_d.append(line)
    else:
        sec_d.append("No outdated packages found.")
    sections.append("\n".join(sec_d))

    # --- Dependency overrides ---
    sec_e: List[str] = [f"{C.BOLD}E) Dependency Overrides:{C.RESET}"]
    overrides = pubspec_data.get("dependency_overrides")
    if overrides:
        for pkg_name, override_info in overrides.items():
            path_info = override_info.get("path", "N/A (not a path override)")
            sec_e.append(f"- {C.YELLOW}{pkg_name}{C.RESET}: Path: {path_info}")
            if path_info != "N/A (not a path override)":
                local_deps: Dict[str, str] = _get_override_deps(
                    _PROJECT_ROOT, path_info
                )
                if local_deps:
                    sec_e.append(
                        f"    {C.CYAN}Dependencies of '{pkg_name}':{C.RESET}"
                    )
                    for dep_name, dep_ver in local_deps.items():
                        sec_e.append(f"      - {dep_name}: {dep_ver}")
    else:
        sec_e.append("No dependency overrides found.")
    sections.append("\n".join(sec_e))

    return sections


# ---------------------------------------------------------------------------
# Report file writing
# ---------------------------------------------------------------------------


def _write_report(sections: List[str]) -> Optional[Path]:
    """Write report sections to a timestamped log file. Returns the path."""
    reports_dir: Path = _PROJECT_ROOT / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    timestamp: str = datetime.now().strftime("%Y%m%d_%H%M%S")
    filepath: Path = reports_dir / f"flutter_deps_report_{timestamp}.log"

    parts: List[str] = [
        "Flutter Project Dependencies Report",
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"Project Path: {_PROJECT_ROOT}",
    ]
    for section in sections:
        parts.append("=" * 70)
        # Strip ANSI codes for the file
        parts.append(_ANSI_PATTERN.sub("", section))
    content: str = "\n\n".join(parts)

    try:
        filepath.write_text(content, encoding="utf-8")
        print(_success(f"Report written: {filepath}"))
        return filepath
    except IOError as e:
        print(_error(f"Error writing report: {e}"))
        return None


def _prompt_open_file(filepath: Path) -> None:
    """Ask user whether to open the report file."""
    try:
        choice: str = input(
            _info("Open the report file now? (y/n): ")
        ).strip().lower()
    except EOFError:
        return
    if choice not in ("y", "yes"):
        return
    try:
        if platform.system() == "Windows":
            os.startfile(filepath)
        elif platform.system() == "Darwin":
            subprocess.call(("open", str(filepath)))
        else:
            subprocess.call(("xdg-open", str(filepath)))
    except Exception as e:
        print(_error(f"Could not open file: {e}"))
        print(_warn(f"Open manually: {filepath}"))


# ---------------------------------------------------------------------------
# Upgrade helpers (destructive — only with --upgrade or --interactive)
# ---------------------------------------------------------------------------


def _get_current_kotlin_version() -> Optional[str]:
    """Read kotlin_version from project-level build.gradle."""
    if not _GRADLE_FILE.is_file():
        return None
    content: str = _GRADLE_FILE.read_text(encoding="utf-8")
    match = re.search(
        r"(?:ext\s*\.)?kotlin_version\s*=\s*['\"]([^'\"]+)['\"]", content
    )
    return match.group(1) if match else None


def _get_latest_kotlin_version() -> str:
    """Return latest stable Kotlin version (hardcoded, update as needed)."""
    return "2.3.0"


def _get_latest_firebase_bom_version() -> str:
    """Fetch latest Firebase BoM version from release notes, with fallback."""
    try:
        import urllib.request

        url: str = "https://firebase.google.com/support/release-notes/android"
        with urllib.request.urlopen(url, timeout=10) as response:
            html: str = response.read().decode("utf-8")
        match = re.search(r"firebase-bom:([\d.]+)", html)
        if match:
            return match.group(1)
        match = re.search(r"BoM[\s\-]+([\d.]+)", html)
        if match:
            return match.group(1)
    except Exception as e:
        print(_warn(f"Could not fetch latest Firebase BoM version: {e}"))
    # Fallback value
    return "34.7.0"


def _get_current_firebase_bom_version() -> Optional[str]:
    """Read firebase-bom version from app-level build.gradle."""
    if not _APP_GRADLE_FILE.is_file():
        return None
    content: str = _APP_GRADLE_FILE.read_text(encoding="utf-8")
    match = re.search(r"firebase-bom:([\d.]+)", content)
    return match.group(1) if match else None


def _update_kotlin_version(new_version: str) -> None:
    """Update kotlin_version in project-level build.gradle."""
    if not _GRADLE_FILE.is_file():
        print(_error("Could not find project-level build.gradle"))
        return
    content: str = _GRADLE_FILE.read_text(encoding="utf-8")
    pattern: str = r"(kotlin_version\s*=\s*['\"])(.+)(['\"])"
    new_content: str = re.sub(
        pattern, lambda m: m.group(1) + new_version + m.group(3), content
    )
    _GRADLE_FILE.write_text(new_content, encoding="utf-8")
    print(_success(f"Kotlin updated to {new_version}"))


def _update_firebase_bom(new_version: str) -> None:
    """Update firebase-bom version in app-level build.gradle."""
    if not _APP_GRADLE_FILE.is_file():
        print(_error("Could not find app-level build.gradle"))
        return
    content: str = _APP_GRADLE_FILE.read_text(encoding="utf-8")
    new_content: str = re.sub(
        r"(firebase-bom:)([\d.]+)", rf"\g<1>{new_version}", content
    )
    _APP_GRADLE_FILE.write_text(new_content, encoding="utf-8")
    print(_success(f"Firebase BoM updated to {new_version}"))


def _add_junit_resolution() -> None:
    """Append JUnit 4.13.2 resolution strategy to build.gradle."""
    if not _GRADLE_FILE.is_file():
        print(_error("Could not find project-level build.gradle"))
        return
    content: str = _GRADLE_FILE.read_text(encoding="utf-8")
    # Skip if already forced
    if (
        "details.requested.group == 'junit'" in content
        and "details.useVersion '4.13.2'" in content
    ):
        print(_success("JUnit already forced to 4.13.2"))
        return
    # Append resolution strategy block
    strategy: str = """
allprojects {
    configurations.all {
        resolutionStrategy.eachDependency { details ->
            if (details.requested.group == 'junit' && details.requested.name == 'junit') {
                details.useVersion '4.13.2'
            }
        }
    }
}
"""
    _GRADLE_FILE.write_text(content + strategy, encoding="utf-8")
    print(_success("Forced junit:junit to 4.13.2"))


def _prompt_yn(message: str) -> bool:
    """Prompt user for y/n, default no."""
    try:
        choice: str = input(_info(f"{message} (y/n): ")).strip().lower()
        return choice in ("y", "yes")
    except EOFError:
        return False


def _run_upgrades(interactive: bool) -> None:
    """Run upgrade steps — either auto or with y/n prompts.

    Handles: Flutter package upgrades, Kotlin version, Firebase BoM, JUnit fix.
    """
    print(f"\n{C.BOLD}--- UPGRADE MODE ---{C.RESET}")

    # --- Flutter packages ---
    if interactive:
        do_upgrade: bool = _prompt_yn("Upgrade Flutter packages?")
    else:
        do_upgrade = True
    if do_upgrade:
        print(_info("Running: flutter pub upgrade --major-versions"))
        os.system("flutter pub upgrade --major-versions")

    # --- Kotlin version ---
    current_kotlin: Optional[str] = _get_current_kotlin_version()
    latest_kotlin: str = _get_latest_kotlin_version()
    if current_kotlin:
        print(_info(f"Current Kotlin: {current_kotlin}"))
    print(_info(f"Latest Kotlin: {latest_kotlin}"))
    if current_kotlin != latest_kotlin:
        if interactive:
            do_kotlin: bool = _prompt_yn(
                f"Update Kotlin from {current_kotlin or 'unknown'} to {latest_kotlin}?"
            )
        else:
            do_kotlin = True
        if do_kotlin:
            _update_kotlin_version(latest_kotlin)
    else:
        print(_success("Kotlin is already up to date."))

    # --- Firebase BoM ---
    current_bom: Optional[str] = _get_current_firebase_bom_version()
    latest_bom: str = _get_latest_firebase_bom_version()
    if current_bom:
        print(_info(f"Current Firebase BoM: {current_bom}"))
    else:
        print(_warn("Firebase BoM version not found in build.gradle"))
    print(_info(f"Latest Firebase BoM: {latest_bom}"))
    if current_bom and current_bom != latest_bom:
        if interactive:
            do_bom: bool = _prompt_yn(
                f"Update Firebase BoM from {current_bom} to {latest_bom}?"
            )
        else:
            do_bom = True
        if do_bom:
            _update_firebase_bom(latest_bom)
    elif current_bom:
        print(_success("Firebase BoM is already up to date."))

    # --- JUnit demotion fix ---
    if interactive:
        do_junit: bool = _prompt_yn("Force JUnit to 4.13.2 to fix demotion warnings?")
    else:
        do_junit = True
    if do_junit:
        _add_junit_resolution()

    # --- Final clean/build ---
    print(f"\n{C.BOLD}--- FINAL STEPS ---{C.RESET}")
    print(_info("Running: flutter pub upgrade --major-versions"))
    os.system("flutter pub upgrade --major-versions")
    print(_info("Running: flutter clean"))
    os.system("flutter clean")
    print(_info("Running: flutter pub get"))
    os.system("flutter pub get")
    print(_success("All upgrade steps completed."))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    parser: argparse.ArgumentParser = argparse.ArgumentParser(
        description="Flutter dependency report with optional upgrades.",
    )
    parser.add_argument(
        "--upgrade",
        action="store_true",
        help="Auto-upgrade all packages without prompting",
    )
    parser.add_argument(
        "--interactive",
        "-i",
        action="store_true",
        help="Prompt y/n before each upgrade step",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Show additional debug output",
    )
    args: argparse.Namespace = parser.parse_args()

    # --- Show intro ---
    show_logo()
    print(_info(f"Dependency Report v{_SCRIPT_VERSION}"))
    if not _colorama_available:
        print(_warn("Install colorama for colored output: pip install colorama"))
    if not _tqdm_available:
        print(_warn("Install tqdm for progress bars: pip install tqdm"))
    print("-" * 70)
    print(_info(f"Project root: {_PROJECT_ROOT}"))

    # --- Parse pubspec ---
    pubspec_data: Optional[Dict] = _parse_pubspec(_PROJECT_ROOT)
    if pubspec_data is None:
        print(_error("Cannot continue without pubspec.yaml."))
        return 1

    # --- Fetch dependency data ---
    print(_info("Fetching dependency data..."))
    deps_output: Optional[str] = _run_flutter_command(
        _PROJECT_ROOT, ["pub", "deps"]
    )
    if not deps_output:
        print(_warn("Could not retrieve dependency tree."))

    print(_info("Fetching outdated packages..."))
    outdated: Optional[List[Dict]] = _get_outdated_packages(_PROJECT_ROOT)
    if outdated is None:
        print(_warn("Could not get outdated package info."))
        outdated = []

    # --- Generate and write report ---
    sections: List[str] = _generate_report(pubspec_data, outdated, deps_output)
    # Print sections to console
    for section in sections:
        print(section)
        print()

    filepath: Optional[Path] = _write_report(sections)

    # --- Optionally upgrade ---
    if args.interactive:
        _run_upgrades(interactive=True)
    elif args.upgrade:
        _run_upgrades(interactive=False)

    # --- Prompt to open report ---
    if filepath:
        _prompt_open_file(filepath)

    return 0


if __name__ == "__main__":
    sys.exit(main())
