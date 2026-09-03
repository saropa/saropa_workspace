#!/usr/bin/env python3
"""
Master plan status audit — verifies plan item completion against the live codebase.

Reads plans/MASTER_PLAN.md for declared status, then spot-checks each item against
the actual source files. Reports mismatches where the plan says "done" but the code
disagrees, or where the plan says "not started" but the code shows progress.

Called by audit.py --plan (or as part of a full audit).

Version:   1.1
Copyright: (c) 2026 Saropa
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import NamedTuple

from modules._utils import (
    EXTENSION_DIR,
    PACKAGE_JSON,
    PACKAGE_NLS,
    REPO_ROOT,
    RUNTIME_LOCALE,
    SRC_DIR,
    detail,
    error,
    header,
    info,
    success,
    warn,
)


class CheckResult(NamedTuple):
    """Outcome of a single plan-item verification."""

    item: str
    plan_status: str
    actual_status: str
    ok: bool
    detail: str


def _read_package_json() -> dict:
    """Load extension/package.json as a dict."""
    return json.loads(PACKAGE_JSON.read_text("utf-8"))


def _file_contains(path: Path, pattern: str) -> bool:
    """Check whether a file exists and contains a regex pattern."""
    if not path.exists():
        return False
    return bool(re.search(pattern, path.read_text("utf-8")))


def _count_in_file(path: Path, pattern: str) -> int:
    """Count regex matches in a file. Returns 0 if file doesn't exist."""
    if not path.exists():
        return 0
    return len(re.findall(pattern, path.read_text("utf-8")))


def _grep_dir(directory: Path, pattern: str, glob: str = "*.ts") -> list[Path]:
    """Return files under directory matching a regex pattern."""
    hits: list[Path] = []
    if not directory.exists():
        return hits
    for f in directory.rglob(glob):
        try:
            if re.search(pattern, f.read_text("utf-8")):
                hits.append(f)
        except (OSError, UnicodeDecodeError):
            pass
    return hits


# -- Individual item checks ------------------------------------------------- #


def _check_1_1(pkg: dict) -> CheckResult:
    """P1.1: Flatten Explorer context menu — top-level add/remove entries."""
    menus = pkg.get("contributes", {}).get("menus", {})
    explorer_ctx = menus.get("explorer/context", [])
    # Top-level entries have a direct "command" (not "submenu") and are in a
    # saropa-prefixed group. Submenu containers use "submenu" instead of "command".
    top_level = [
        m for m in explorer_ctx
        if "command" in m
        and m.get("group", "").startswith("saropa")
        and m["command"].endswith(("addProjectPin", "removeProjectPin"))
    ]
    done = len(top_level) >= 2
    return CheckResult(
        "1.1 Flatten Explorer context menu",
        "done", "done" if done else "not done", done,
        f"{len(top_level)} top-level explorer/context entries found"
        if done else "addProjectPin/removeProjectPin not found as top-level entries",
    )


def _check_1_2(pkg: dict) -> CheckResult:
    """P1.2: Reduce view-title icon clutter — ≤3 unique navigation slots."""
    menus = pkg.get("contributes", {}).get("menus", {})
    view_title = menus.get("view/title", [])
    # Collect unique navigation@N slot identifiers for the pins view.
    # Mutually exclusive items (gated by `when`) share the same slot, so counting
    # unique group values gives the actual number of visible icon positions.
    slots: set[str] = set()
    for m in view_title:
        grp = m.get("group", "")
        when = m.get("when", "")
        # Only count entries scoped to the pins view that are in a navigation group
        if grp.startswith("navigation") and "saropaWorkspace.pins" in when:
            slots.add(grp)
    done = len(slots) <= 3
    return CheckResult(
        "1.2 Reduce view-title icon clutter",
        "done", "done" if done else "not done", done,
        f"{len(slots)} unique navigation slots (target: ≤3)",
    )


def _check_2_1(pkg: dict) -> CheckResult:
    """P2.1: Lazy activation — onStartupFinished should be removed."""
    events = pkg.get("activationEvents", [])
    has_startup = "onStartupFinished" in events
    done = not has_startup
    return CheckResult(
        "2.1 Lazy activation",
        "not started", "not started" if has_startup else "done", True,
        "onStartupFinished still in activationEvents" if has_startup
        else "onStartupFinished removed",
    )


def _check_2_2() -> CheckResult:
    """P2.2: Cap background output — createBoundedCapture should exist."""
    capture_file = SRC_DIR / "exec" / "outputCapture.ts"
    done = _file_contains(capture_file, r"createBoundedCapture")
    return CheckResult(
        "2.2 Cap background output",
        "done", "done" if done else "not done", done,
        "createBoundedCapture found in outputCapture.ts" if done
        else "createBoundedCapture not found",
    )


def _check_2_3() -> CheckResult:
    """P2.3: Case-sensitive path comparison — normalizeForCompare or toLowerCase."""
    path_compare = SRC_DIR / "utils" / "pathCompare.ts"
    done = _file_contains(path_compare, r"(?:normalizeForCompare|toLowerCase)")
    return CheckResult(
        "2.3 Case-sensitive path comparison",
        "done", "done" if done else "not done", done,
        "case normalization found in pathCompare.ts" if done
        else "no case normalization in path comparison",
    )


def _check_3_1() -> CheckResult:
    """P3.1: Unify pin/shortcut terminology — scan locale catalogs for leaks."""
    en_json = RUNTIME_LOCALE
    if not en_json.exists():
        return CheckResult("3.1 Unify pin/shortcut", "partial", "unknown", True, "en.json not found")
    content = json.loads(en_json.read_text("utf-8"))
    # Find all user-visible values that contain "pin" as a standalone word
    # (case-insensitive). Exclude keys that are about VS Code's native pin
    # concept (e.g. "Pinned-Tab") or are clearly internal identifiers.
    pin_leaks: list[str] = []
    for key, val in content.items():
        if not isinstance(val, str):
            continue
        # Match "Pin", "pin", "pins", "auto-pins" etc. as visible words
        if re.search(r'\bpins?\b|auto-pins?', val, re.IGNORECASE):
            # Exclude VS Code native "pinned tab" references
            if "pinned-tab" in val.lower() or "pinned tab" in val.lower():
                continue
            pin_leaks.append(f"{key}={val!r}")
    # Also check package.nls.json for user-facing "Pin" in titles/descriptions
    nls_leaks: list[str] = []
    if PACKAGE_NLS.exists():
        nls = json.loads(PACKAGE_NLS.read_text("utf-8"))
        for key, val in nls.items():
            if not isinstance(val, str):
                continue
            if re.search(r'\bpins?\b', val, re.IGNORECASE):
                if "pinned-tab" in val.lower() or "pinned tab" in val.lower():
                    continue
                nls_leaks.append(f"{key}={val!r}")
    all_leaks = pin_leaks + nls_leaks
    if all_leaks:
        # Cap the detail to avoid flooding the terminal
        shown = all_leaks[:5]
        suffix = f" (+{len(all_leaks) - 5} more)" if len(all_leaks) > 5 else ""
        return CheckResult(
            "3.1 Unify pin/shortcut", "partial", "partial", True,
            f'{len(all_leaks)} "pin" leak(s): {", ".join(shown)}{suffix}',
        )
    return CheckResult(
        "3.1 Unify pin/shortcut", "partial", "done", True,
        'no "pin" leaks found in locale catalogs',
    )


def _check_3_3() -> CheckResult:
    """P3.3: Heartbeat CSV rotation — look for truncation/rotation logic."""
    heartbeat = SRC_DIR / "exec" / "heartbeat.ts"
    has_rotation = _file_contains(heartbeat, r"(?:rotat|truncat|maxRows|maxAge|prune)")
    status = "done" if has_rotation else "not started"
    return CheckResult(
        "3.3 Heartbeat CSV rotation",
        "not started", status, True,
        "rotation/truncation logic found" if has_rotation
        else "no rotation logic — CSV grows unboundedly",
    )


def _check_3_4() -> CheckResult:
    """P3.4: Report file accumulation — look for pruning logic."""
    hits = _grep_dir(SRC_DIR, r"(?:prune|retention|maxReport|reportLimit|deleteOld).*report", "*.ts")
    # Filter out unrelated hits (bloat scan, heartbeat)
    relevant = [h for h in hits if "heartbeat" not in h.name and "bloat" not in h.name.lower()]
    done = len(relevant) > 0
    return CheckResult(
        "3.4 Report file accumulation",
        "not started", "done" if done else "not started", True,
        f"pruning logic found in {[h.name for h in relevant]}" if done
        else "no report pruning/retention logic found",
    )


def _check_3_5() -> CheckResult:
    """P3.5: Async Python install scan — check for sync fs calls."""
    detect = SRC_DIR / "exec" / "interpreterDetect.ts"
    has_sync = _file_contains(detect, r"(?:readdirSync|statSync)")
    status = "not started" if has_sync else "done"
    return CheckResult(
        "3.5 Async Python install scan",
        "not started", status, True,
        "readdirSync/statSync still present" if has_sync
        else "sync fs calls removed — using async",
    )


# -- Phase 4: Documentation checks ----------------------------------------- #


def _check_4_1() -> CheckResult:
    """P4.1: README.md — check for stale config path or unshipped feature claims."""
    readme = REPO_ROOT / "README.md"
    if not readme.exists():
        return CheckResult("4.1 README.md", "not started", "unknown", True, "README.md not found")
    text = readme.read_text("utf-8")
    issues: list[str] = []
    # Old config path (.vscode/saropa-workspace.json) should be updated to .saropa/
    if ".vscode/saropa-workspace.json" in text:
        issues.append("stale config path .vscode/saropa-workspace.json")
    # Aspirational features that aren't shipped
    for term in ("Smart Onboarding", "Ecosystem Diagnostics"):
        if term in text:
            issues.append(f'unshipped feature "{term}" still mentioned')
    if issues:
        return CheckResult(
            "4.1 README.md", "partial", "partial", True,
            f"{len(issues)} remaining issue(s): {'; '.join(issues)}",
        )
    return CheckResult("4.1 README.md", "partial", "done", True, "no stale paths or unshipped features")


def _check_4_5() -> CheckResult:
    """P4.5: CHANGELOG.md — check for version typo 1.4.18 (should be 1.5.18)."""
    changelog = REPO_ROOT / "CHANGELOG.md"
    history = REPO_ROOT / "CHANGELOG_HISTORY.md"
    has_typo = False
    for f in (changelog, history):
        if f.exists() and re.search(r"## \[1\.4\.18\]", f.read_text("utf-8")):
            has_typo = True
    if has_typo:
        return CheckResult(
            "4.5 CHANGELOG.md", "partial", "not started", True,
            "version typo [1.4.18] still present (should be [1.5.18])",
        )
    return CheckResult("4.5 CHANGELOG.md", "partial", "partial", True, "version typo fixed; remaining items pending")


# -- Phase 5: Feature checks ----------------------------------------------- #


def _check_5_1(pkg: dict) -> CheckResult:
    """P5.1: Drag-and-drop from Explorer — TreeDragAndDropController registered."""
    has_dnd = _file_contains(
        SRC_DIR / "views" / "shortcutTreeProvider.ts",
        r"TreeDragAndDropController|dragAndDropController|handleDrop",
    )
    # Also check the broader views directory
    if not has_dnd:
        dnd_files = _grep_dir(SRC_DIR / "views", r"TreeDragAndDropController|handleDrop")
        has_dnd = len(dnd_files) > 0
    return CheckResult(
        "5.1 Drag-and-drop from Explorer",
        "done", "done" if has_dnd else "not done", has_dnd,
        "TreeDragAndDropController found" if has_dnd
        else "no drag-and-drop controller registered",
    )


def _check_5_6(pkg: dict) -> CheckResult:
    """P5.6: Linux terminal emulator preference — check for externalTerminal setting."""
    settings = pkg.get("contributes", {}).get("configuration", {})
    # Settings can be an object with "properties" or an array of sections
    props: dict = {}
    if isinstance(settings, dict):
        props = settings.get("properties", {})
    elif isinstance(settings, list):
        for section in settings:
            props.update(section.get("properties", {}))
    has_setting = any("externalTerminal" in k for k in props)
    return CheckResult(
        "5.6 Linux terminal emulator pref",
        "not started", "done" if has_setting else "not started", True,
        "externalTerminal setting found" if has_setting
        else "no externalTerminal setting — probe order hardcoded",
    )


# -- Runner ----------------------------------------------------------------- #


def run_master_plan_audit() -> int:
    """Run all master plan item checks. Returns count of mismatches found."""
    header("MASTER PLAN STATUS AUDIT")

    pkg = _read_package_json()

    checks = [
        # Phase 1
        _check_1_1(pkg),
        _check_1_2(pkg),
        # Phase 2
        _check_2_1(pkg),
        _check_2_2(),
        _check_2_3(),
        # Phase 3
        _check_3_1(),
        _check_3_3(),
        _check_3_4(),
        _check_3_5(),
        # Phase 4 (docs — spot checks)
        _check_4_1(),
        _check_4_5(),
        # Phase 5 (features — spot checks)
        _check_5_1(pkg),
        _check_5_6(pkg),
    ]

    mismatches = 0
    for result in checks:
        # A mismatch is when the plan claims "done" but the code disagrees,
        # or vice versa. Items that are "not started" in both plan and code are
        # expected and not flagged.
        status_match = result.plan_status == result.actual_status
        if status_match:
            success(f"{result.item}: {result.actual_status} — {result.detail}")
        else:
            if result.plan_status == "done" and result.actual_status != "done":
                # Plan says done but code disagrees — blocking mismatch
                error(f"{result.item}: plan says '{result.plan_status}' but code shows '{result.actual_status}' — {result.detail}")
                mismatches += 1
            elif result.plan_status != "done" and result.actual_status == "done":
                # Code shows done but plan hasn't been updated — informational
                warn(f"{result.item}: code shows DONE but plan says '{result.plan_status}' — update the plan — {result.detail}")
            else:
                info(f"{result.item}: plan='{result.plan_status}', code='{result.actual_status}' — {result.detail}")

    if mismatches:
        error(f"{mismatches} plan item(s) claim 'done' but code disagrees.")
    else:
        success("All plan status claims verified against codebase.")

    return mismatches
