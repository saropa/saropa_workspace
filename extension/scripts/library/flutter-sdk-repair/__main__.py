#!/usr/bin/env python3
# cspell:ignore LOCALAPPDATA dartaotruntime IMAGENAME
"""
Flutter SDK & Analyzer Plugin Repair Script.

This script performs a comprehensive repair of the Flutter SDK and Dart analyzer
plugin system. It is designed to fix issues like:

- "Unable to find AOT snapshot for dartdev"
- "Could not find directory at .../devtools"
- "'dart compile' does not support build hooks"
- "No response for request CustomLintRequest.analyzerPluginRequest"
- custom_lint/saropa_lints not working

The script:
1. Terminates all Dart, Java, and related processes that may hold file locks.
2. Deletes the Flutter SDK cache (bin/cache) to force a complete rebuild.
3. Clears the Dart analyzer plugin manager cache (.dartServer/.plugin_manager).
4. Clears local VS Code extension caches that may be corrupted.
5. Cleans the global pub cache to remove potentially corrupted packages.
6. Rebuilds the Flutter SDK by running flutter doctor.
7. Restores project dependencies with flutter pub get.
8. Optionally tests custom_lint to verify the fix.

CHANGELOG:
---------------------------------------------------------------------------
Version 1.0.0 (2026-01-17)
  - Initial release
  - Comprehensive Flutter SDK cache repair
  - Analyzer plugin manager cache cleanup
  - VS Code extension cache cleanup
  - Process termination with retries
  - Verification steps with custom_lint test
---------------------------------------------------------------------------

Author:    Saropa
Copyright: (c) 2026 Saropa. All rights reserved.
License:   MIT
Usage:     Close VS Code and all IDEs, then run from an ELEVATED terminal:
           python flutter_sdk_repair.py
"""

import os
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

# Import shared branding from .shared directory
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "_shared"))
from saropa_branding import show_logo

# --- SCRIPT CONFIGURATION ---
SCRIPT_VERSION = "1.0.0"
SCRIPT_DATE = "2026-01-17"

# Use a temp directory on the same drive as the script
_script_drive = Path(__file__).resolve().anchor  # e.g., "C:\\" on Windows
FLUTTER_TEMP_DIR = Path(_script_drive) / "saropa-build-temp"

# Processes to terminate (without .exe extension)
PROCESSES_TO_KILL = [
    "dart",
    "dartaotruntime",
    "dartdev",
    "java",
    "gradle",
    "analyzer",
]


def print_colored(message: str, color: str):
    """Print a message with ANSI color codes."""
    colors = {
        "green": "\033[92m",
        "yellow": "\033[93m",
        "red": "\033[91m",
        "cyan": "\033[96m",
        "magenta": "\033[95m",
        "blue": "\033[94m",
        "reset": "\033[0m",
    }
    print(f"{colors.get(color, '')}{message}{colors['reset']}")


def print_header(message: str):
    """Print a section header."""
    print()
    print_colored(f"{'=' * 70}", "cyan")
    print_colored(f"  {message}", "cyan")
    print_colored(f"{'=' * 70}", "cyan")
    print()


def print_subheader(message: str):
    """Print a subsection header."""
    print()
    print_colored(f"--- {message} ---", "cyan")


def run_command(command: str, timeout: int = 120) -> tuple[int, str]:
    """Run a shell command and return exit code and output."""
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return result.returncode, result.stdout + result.stderr
    except subprocess.TimeoutExpired:
        return -1, "Command timed out"
    except Exception as e:
        return -1, str(e)


def invoke_command_or_exit(command: str, success_message: str, failure_message: str):
    """Run a command and exit on failure."""
    print_colored(f"   Running: {command}", "yellow")
    exit_code, output = run_command(command)
    if output.strip():
        print(output)
    if exit_code != 0:
        print_colored(f"   FATAL: {failure_message} (Exit Code: {exit_code})", "red")
        sys.exit(1)
    print_colored(f"   {success_message}", "green")
    print()


def invoke_command_warn_on_fail(command: str, success_message: str, failure_message: str):
    """Run a command and warn (but continue) on failure."""
    print_colored(f"   Running: {command}", "yellow")
    exit_code, output = run_command(command, timeout=300)
    if output.strip():
        # Limit output to avoid flooding console
        lines = output.strip().split('\n')
        if len(lines) > 50:
            print('\n'.join(lines[:25]))
            print_colored(f"   ... ({len(lines) - 50} lines omitted) ...", "yellow")
            print('\n'.join(lines[-25:]))
        else:
            print(output)
    if exit_code != 0:
        print_colored(f"   WARNING: {failure_message} (Exit Code: {exit_code})", "yellow")
    else:
        print_colored(f"   {success_message}", "green")
    print()


def kill_processes(process_names: list[str], retries: int = 3) -> bool:
    """
    Kill processes by name with retries.

    Returns True if all processes were successfully terminated.
    """
    all_killed = True

    for attempt in range(retries):
        remaining_processes = []

        for process_name in process_names:
            try:
                if sys.platform == "win32":
                    # Check if process is running
                    check_result = subprocess.run(
                        ["tasklist", "/FI", f"IMAGENAME eq {process_name}.exe"],
                        capture_output=True,
                        text=True,
                        check=False,
                    )
                    if process_name.lower() in check_result.stdout.lower():
                        # Process is running, try to kill it
                        result = subprocess.run(
                            ["taskkill", "/F", "/IM", f"{process_name}.exe"],
                            capture_output=True,
                            check=False,
                        )
                        if result.returncode != 0:
                            remaining_processes.append(process_name)
                else:
                    # Unix-like systems
                    subprocess.run(
                        ["pkill", "-9", process_name],
                        capture_output=True,
                        check=False,
                    )
            except Exception:
                pass

        if not remaining_processes:
            break

        if attempt < retries - 1:
            time.sleep(1)  # Wait before retry
        else:
            all_killed = False
            print_colored(f"   Could not terminate: {', '.join(remaining_processes)}", "yellow")

    return all_killed


def remove_path(path: Path, description: str | None = None) -> bool:
    """
    Remove a file or directory, with optional description.

    Returns True if successfully removed or didn't exist.
    """
    try:
        if path.exists():
            if path.is_file():
                path.unlink()
            elif path.is_dir():
                shutil.rmtree(path)
            if description:
                print_colored(f"   Removed: {description}", "green")
            return True
        else:
            if description:
                print_colored(f"   Skipped (not found): {description}", "cyan")
            return True
    except PermissionError as e:
        if description:
            print_colored(f"   PERMISSION DENIED: {description}", "red")
            print_colored(f"      {e}", "yellow")
        return False
    except Exception as e:
        if description:
            print_colored(f"   ERROR removing {description}: {e}", "red")
        return False


def find_flutter_sdk() -> Path | None:
    """Find Flutter SDK from FLUTTER_HOME or PATH."""
    # First try FLUTTER_HOME
    flutter_home = os.environ.get("FLUTTER_HOME")
    if flutter_home:
        sdk_path = Path(flutter_home)
        if sdk_path.exists():
            return sdk_path.resolve()

    # Try to find from PATH
    flutter_executable = "flutter.bat" if sys.platform == "win32" else "flutter"
    path_entries = os.environ.get("Path", os.environ.get("PATH", "")).split(os.pathsep)

    for entry in path_entries:
        if not entry:
            continue
        entry_path = Path(entry)
        flutter_path = entry_path / flutter_executable
        if flutter_path.exists():
            # Flutter executable is in <sdk>/bin/, so parent.parent gets sdk root
            return entry_path.parent.resolve()

    return None


def get_local_app_data() -> Path:
    """Get the LocalAppData directory (Windows) or equivalent."""
    if sys.platform == "win32":
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            return Path(local_app_data)
        return Path.home() / "AppData" / "Local"
    else:
        # macOS/Linux equivalent
        return Path.home() / ".local" / "share"


def get_app_data() -> Path:
    """Get the AppData/Roaming directory (Windows) or equivalent."""
    if sys.platform == "win32":
        app_data = os.environ.get("APPDATA")
        if app_data:
            return Path(app_data)
        return Path.home() / "AppData" / "Roaming"
    else:
        return Path.home() / ".config"


def clean_analyzer_plugin_caches():
    """
    Clean Dart analyzer plugin caches.

    This is critical for fixing custom_lint issues where the analyzer plugin
    gets into a bad state (e.g., compiled with incompatible dependencies).
    """
    print_subheader("Cleaning Analyzer Plugin Caches")

    local_app_data = get_local_app_data()

    # Primary analyzer plugin manager cache
    # This is where custom_lint's analyzer plugin gets compiled and cached
    plugin_manager_path = local_app_data / ".dartServer" / ".plugin_manager"
    remove_path(plugin_manager_path, "Dart analyzer plugin manager cache")

    # Alternative locations that may exist
    alt_paths = [
        local_app_data / ".dart" / ".plugin_manager",
        local_app_data / "Pub" / "Cache" / "_plugin_manager",
        Path.home() / ".dartServer" / ".plugin_manager",
    ]

    for alt_path in alt_paths:
        if alt_path.exists():
            remove_path(alt_path, f"Alternative plugin cache: {alt_path.name}")


def clean_vscode_extension_caches():
    """
    Clean VS Code extension caches related to Dart/Flutter.

    These caches can become corrupted and cause analyzer issues.
    """
    print_subheader("Cleaning VS Code Extension Caches")

    app_data = get_app_data()

    # VS Code user data locations
    vscode_paths = [
        app_data / "Code" / "User" / "workspaceStorage",
        app_data / "Code - Insiders" / "User" / "workspaceStorage",
        app_data / "Cursor" / "User" / "workspaceStorage",  # Cursor editor
    ]

    for vscode_path in vscode_paths:
        if vscode_path.exists():
            # Don't delete all workspace storage, just look for dart-related caches
            try:
                for workspace_dir in vscode_path.iterdir():
                    if workspace_dir.is_dir():
                        # Look for Dart extension data
                        dart_analysis = workspace_dir / "dart-code.dart-code"
                        if dart_analysis.exists():
                            remove_path(dart_analysis, f"VS Code Dart analysis cache: {workspace_dir.name}")
            except PermissionError:
                print_colored(f"   Could not access: {vscode_path}", "yellow")
            except Exception as e:
                print_colored(f"   Error scanning {vscode_path}: {e}", "yellow")

    # Also clean the Dart extension's global cache
    local_app_data = get_local_app_data()
    dart_ext_cache = local_app_data / "Dart-Code"
    if dart_ext_cache.exists():
        remove_path(dart_ext_cache, "Dart-Code extension cache")


def clean_flutter_sdk_cache(sdk_path: Path) -> bool:
    """
    Delete Flutter SDK's internal cache.

    Returns True if successful.
    """
    print_subheader("Deleting Flutter SDK Cache")

    cache_path = sdk_path / "bin" / "cache"
    print_colored(f"   SDK cache path: {cache_path}", "cyan")

    if not cache_path.exists():
        print_colored("   Cache directory doesn't exist (already clean)", "green")
        return True

    success = remove_path(cache_path, "Flutter SDK cache (bin/cache)")

    if not success:
        print()
        print_colored("   " + "=" * 60, "red")
        print_colored("   CRITICAL: Could not delete Flutter SDK cache!", "red")
        print_colored("   " + "=" * 60, "red")
        print()
        print_colored("   This usually means a process is still holding file locks.", "yellow")
        print_colored("   Please ensure:", "yellow")
        print_colored("     1. VS Code is completely closed (not just minimized)", "yellow")
        print_colored("     2. Android Studio is closed", "yellow")
        print_colored("     3. No terminal windows are running flutter/dart commands", "yellow")
        print_colored("     4. This script is running with Administrator privileges", "yellow")
        print()
        print_colored("   Try running this script from an elevated PowerShell:", "cyan")
        print_colored("     Start-Process powershell -Verb RunAs", "cyan")
        print()
        return False

    return True


def clean_pub_hosted_cache():
    """
    Clean specific problematic packages from the pub cache.

    This targets packages known to cause analyzer plugin issues.
    """
    print_subheader("Cleaning Problematic Pub Cache Packages")

    # Get pub cache location
    pub_cache = os.environ.get("PUB_CACHE")
    if pub_cache:
        pub_cache_path = Path(pub_cache)
    elif sys.platform == "win32":
        # Windows default
        pub_cache_path = Path(os.environ.get("LOCALAPPDATA", "")) / "Pub" / "Cache"
        if not pub_cache_path.exists():
            pub_cache_path = Path.home() / ".pub-cache"
    else:
        # Unix default
        pub_cache_path = Path.home() / ".pub-cache"

    hosted_path = pub_cache_path / "hosted" / "pub.dev"

    if not hosted_path.exists():
        print_colored(f"   Pub cache not found at: {hosted_path}", "cyan")
        return

    # Packages that can cause analyzer issues when corrupted
    problematic_prefixes = [
        "custom_lint-",
        "custom_lint_builder-",
        "custom_lint_core-",
        "custom_lint_visitor-",
        "analyzer_plugin-",
        "objective_c-",  # The build hooks package causing issues
        "path_provider_foundation-",  # The package that pulls in objective_c
    ]

    removed_count = 0
    try:
        for package_dir in hosted_path.iterdir():
            if package_dir.is_dir():
                for prefix in problematic_prefixes:
                    if package_dir.name.startswith(prefix):
                        if remove_path(package_dir, f"Pub cache: {package_dir.name}"):
                            removed_count += 1
                        break
    except Exception as e:
        print_colored(f"   Error scanning pub cache: {e}", "yellow")

    if removed_count == 0:
        print_colored("   No problematic packages found in cache", "cyan")
    else:
        print_colored(f"   Removed {removed_count} cached packages", "green")


def rebuild_flutter_sdk():
    """Rebuild Flutter SDK by running flutter doctor."""
    print_subheader("Rebuilding Flutter SDK")

    print_colored("   This will download and rebuild Flutter SDK tools...", "cyan")
    print_colored("   (This may take several minutes)", "cyan")
    print()

    invoke_command_warn_on_fail(
        "flutter doctor -v",
        "Flutter SDK rebuilt successfully",
        "flutter doctor encountered issues (may be normal during rebuild)",
    )


def restore_dependencies(project_dir: Path):
    """Restore project dependencies."""
    print_subheader("Restoring Project Dependencies")

    # Clean local project caches first
    remove_path(project_dir / "pubspec.lock", "pubspec.lock")
    remove_path(project_dir / ".dart_tool", ".dart_tool directory")

    invoke_command_or_exit(
        "flutter pub get",
        "Dependencies restored",
        "flutter pub get failed",
    )


def test_custom_lint(project_dir: Path) -> bool:
    """
    Test if custom_lint is working.

    Returns True if custom_lint runs successfully.
    """
    print_subheader("Testing custom_lint")

    print_colored("   Running: dart run custom_lint", "yellow")
    exit_code, output = run_command("dart run custom_lint", timeout=180)

    # Check for known error patterns
    error_patterns = [
        "Unable to find AOT snapshot",
        "dart compile' does not support build hooks",
        "No response for request CustomLintRequest",
        "PLUGIN_ERROR",
    ]

    has_error = exit_code != 0 or any(pattern in output for pattern in error_patterns)

    if has_error:
        print_colored("   custom_lint test FAILED", "red")
        if output.strip():
            # Show first few lines of error
            lines = output.strip().split('\n')[:10]
            for line in lines:
                print(f"      {line}")
        return False
    else:
        # Count issues found (this is expected and good!)
        if output.strip():
            lines = output.strip().split('\n')
            # Look for the summary line or count lint issues
            issue_count = output.count(" - ")  # Rough estimate of issues
            if "No issues found" in output:
                print_colored("   custom_lint is working (no issues reported)", "green")
            else:
                print_colored(f"   custom_lint is working ({issue_count}+ lint issues found)", "green")
        else:
            print_colored("   custom_lint completed (no output)", "green")
        return True


def main():
    """Main entry point."""
    start_time = datetime.now()

    # Display branding
    show_logo()

    print_colored(f"Flutter SDK & Analyzer Plugin Repair Script v{SCRIPT_VERSION}", "magenta")
    print_colored(f"Release Date: {SCRIPT_DATE}", "cyan")
    print()

    # --- STEP 0: Prepare Environment ---
    print_header("STEP 0: Preparing Environment")

    FLUTTER_TEMP_DIR.mkdir(parents=True, exist_ok=True)
    os.environ["TEMP"] = str(FLUTTER_TEMP_DIR)
    os.environ["TMP"] = str(FLUTTER_TEMP_DIR)
    print_colored(f"   Temp directory: {FLUTTER_TEMP_DIR}", "cyan")

    # Navigate from scripts/clean/ to project root
    script_dir = Path(__file__).resolve().parent
    project_dir = script_dir.parent.parent
    os.chdir(project_dir)
    print_colored(f"   Project directory: {project_dir}", "cyan")

    # Find Flutter SDK
    flutter_sdk = find_flutter_sdk()
    if not flutter_sdk:
        print_colored("   FATAL: Could not find Flutter SDK!", "red")
        print_colored("   Set FLUTTER_HOME environment variable or add Flutter to PATH.", "yellow")
        sys.exit(1)
    print_colored(f"   Flutter SDK: {flutter_sdk}", "cyan")

    # --- STEP 1: Terminate Processes ---
    print_header("STEP 1: Terminating Processes")

    print_colored("   WARNING: This will terminate Dart, Java, and Gradle processes.", "yellow")
    print_colored("   Make sure VS Code, Android Studio, and other IDEs are closed!", "yellow")
    print()

    kill_processes(PROCESSES_TO_KILL)
    print_colored("   Process termination complete", "green")

    # Give processes time to fully terminate
    time.sleep(2)

    # --- STEP 2: Clean Caches ---
    print_header("STEP 2: Cleaning All Caches")

    # Clean analyzer plugin caches (critical for custom_lint)
    clean_analyzer_plugin_caches()

    # Clean VS Code extension caches
    clean_vscode_extension_caches()

    # Clean problematic pub cache packages
    clean_pub_hosted_cache()

    # Clean Flutter SDK cache
    if not clean_flutter_sdk_cache(flutter_sdk):
        print_colored("   Attempting to continue despite cache deletion failure...", "yellow")

    # --- STEP 3: Rebuild Flutter SDK ---
    print_header("STEP 3: Rebuilding Flutter SDK")

    rebuild_flutter_sdk()

    # --- STEP 4: Restore Project ---
    print_header("STEP 4: Restoring Project")

    restore_dependencies(project_dir)

    # --- STEP 5: Verify Fix ---
    print_header("STEP 5: Verifying Fix")

    custom_lint_ok = test_custom_lint(project_dir)

    # --- Summary ---
    print_header("REPAIR COMPLETE")

    end_time = datetime.now()
    duration = end_time - start_time
    minutes = int(duration.total_seconds() // 60)
    seconds = int(duration.total_seconds() % 60)

    if custom_lint_ok:
        print_colored("   STATUS: SUCCESS", "green")
        print_colored("   custom_lint/saropa_lints is working correctly!", "green")
    else:
        print_colored("   STATUS: PARTIAL SUCCESS", "yellow")
        print_colored("   Flutter SDK was repaired but custom_lint may need attention.", "yellow")
        print_colored("   Try restarting VS Code and running 'dart run custom_lint' manually.", "cyan")

    print()
    print_colored(f"   Total time: {minutes}m {seconds}s", "cyan")
    print()

    # Return appropriate exit code
    sys.exit(0 if custom_lint_ok else 1)


if __name__ == "__main__":
    main()
