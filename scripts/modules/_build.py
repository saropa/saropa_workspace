#!/usr/bin/env python3
"""
Build and package the .vsix.

Regenerates the extension's README/CHANGELOG from the root source of truth,
runs the TypeScript type-check gate, builds the production bundle, and packages
the .vsix with vsce — confirming the packaged file matches the intended version.

Version:   1.0
Copyright: (c) 2026 Saropa
"""

from __future__ import annotations

import shutil
import subprocess
import time
from pathlib import Path

from modules._utils import (
    EXTENSION_DIR,
    GENERATED_DOC_PAIRS,
    REPO_ROOT,
    fail,
    detail,
    header,
    info,
    print_failure_tail,
    run,
    success,
    warn,
)

# Seconds before a hung child process is killed.
TSC_TIMEOUT = 600
NPM_INSTALL_TIMEOUT = 900


def sync_extension_docs() -> None:
    """Regenerate extension/README.md and extension/CHANGELOG.md from the root.

    The Marketplace renders extension/README.md and ships extension/CHANGELOG.md,
    but the repo authors a single source for each at the root. Copying here (not
    hand-maintaining two files) guarantees the packaged .vsix always matches the
    root docs. The copies are git-ignored, so overwriting them never dirties the
    working tree.
    """
    header("SYNC DOCS")
    for src, dst in GENERATED_DOC_PAIRS:
        shutil.copyfile(src, dst)
        success(f"Synced extension/{dst.name} <- {src.name}")


def ensure_dependencies() -> int:
    """Install extension dependencies when node_modules is missing or stale.

    Without this, `npx tsc` finds no local TypeScript and tries to download an
    unrelated package behind an install prompt, which hangs a captured run.
    Stale means package-lock.json (or package.json) is newer than npm's own
    node_modules/.package-lock.json marker.
    """
    modules = EXTENSION_DIR / "node_modules"
    marker = modules / ".package-lock.json"
    manifests = [p for p in (EXTENSION_DIR / "package-lock.json", EXTENSION_DIR / "package.json") if p.exists()]
    fresh = marker.exists() and all(p.stat().st_mtime <= marker.stat().st_mtime for p in manifests)
    if fresh:
        return 0
    header("DEPENDENCIES")
    why = "node_modules missing" if not modules.exists() else "node_modules older than package manifest"
    info(f"{why}; installing.")
    cmd = "ci" if (EXTENSION_DIR / "package-lock.json").exists() else "install"
    result = run(["npm", cmd, "--no-audit", "--no-fund"], EXTENSION_DIR,
                 capture=True, check=False, timeout=NPM_INSTALL_TIMEOUT, label=f"npm {cmd}")
    if result.returncode != 0:
        print_failure_tail(result)
        return fail(f"npm {cmd} failed (exit {result.returncode}).", 4)
    success(f"Dependencies installed (npm {cmd}).")
    return 0


def type_check() -> int:
    """Full TypeScript type-check; the fast structural gate before packaging."""
    code = ensure_dependencies()
    if code:
        return code
    header("TYPE CHECK")
    # Use the project's own compiler. Never npx: it can prompt to download.
    local_tsc = EXTENSION_DIR / "node_modules" / "typescript" / "bin" / "tsc"
    if not local_tsc.exists():
        return fail("TypeScript not found in extension/node_modules; add 'typescript' to devDependencies.", 4)
    started = time.monotonic()
    result = run(["node", str(local_tsc), "-p", "./", "--noEmit", "--pretty", "false"], EXTENSION_DIR,
                 capture=True, check=False, timeout=TSC_TIMEOUT, label="tsc --noEmit")
    elapsed = time.monotonic() - started
    if result.returncode != 0:
        output = (result.stdout or "") + (result.stderr or "")
        errors = [ln for ln in output.splitlines() if ": error TS" in ln]
        if errors:
            warn(f"{len(errors)} type error(s):")
            for ln in errors[:10]:
                detail(ln)
            if len(errors) > 10:
                warn(f"... {len(errors) - 10} more")
        else:
            print_failure_tail(result)
        if result.returncode == 124:
            return fail(f"Type check timed out after {TSC_TIMEOUT}s.", 4)
        return fail("Type check failed (tsc --noEmit).", 4)
    success(f"Type check passed ({elapsed:.1f}s).")
    return 0


def build() -> int:
    sync_extension_docs()
    header("BUILD")
    code = ensure_dependencies()
    if code:
        return code
    try:
        run(["npm", "run", "package"], EXTENSION_DIR, timeout=NPM_INSTALL_TIMEOUT)
    except subprocess.CalledProcessError:
        return fail("Build failed (npm run package).", 4)
    return 0


def newest_vsix() -> Path | None:
    candidates = sorted(REPO_ROOT.glob("*.vsix"), key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0] if candidates else None


def package_vsix(version: str | None) -> int:
    header("PACKAGE")
    # Remove stale .vsix files first so newest_vsix() can never resolve an old
    # build (the root cause of a prior version "never reaching the Marketplace").
    for old in REPO_ROOT.glob("*.vsix"):
        old.unlink()
    try:
        run(["npx", "--yes", "@vscode/vsce", "package", "--no-dependencies"], EXTENSION_DIR)
    except subprocess.CalledProcessError:
        return fail("vsce package failed.", 5)
    # vsce packages to EXTENSION_DIR; move it to REPO_ROOT.
    packaged = sorted(EXTENSION_DIR.glob("*.vsix"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not packaged:
        return fail("No .vsix produced.", 5)
    vsix = packaged[0]
    vsix_dest = REPO_ROOT / vsix.name
    shutil.move(str(vsix), str(vsix_dest))
    vsix = vsix_dest
    # vsce names the file <name>-<version>.vsix; confirm it matches the version
    # we intend to publish so a desynced package.json can't ship the wrong file.
    if version and f"-{version}.vsix" not in vsix.name:
        return fail(f"Packaged {vsix.name} does not match expected version {version}.", 5)
    success(f"Packaged: {vsix.name}")
    return 0
