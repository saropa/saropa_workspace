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
from pathlib import Path

from modules._utils import (
    EXTENSION_DIR,
    GENERATED_DOC_PAIRS,
    fail,
    header,
    print_failure_tail,
    run,
    success,
)


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


def type_check() -> int:
    """Full TypeScript type-check; the fast structural gate before packaging."""
    header("TYPE CHECK")
    result = run(["npx", "tsc", "-p", "./", "--noEmit"], EXTENSION_DIR, capture=True, check=False)
    if result.returncode != 0:
        print_failure_tail(result)
        return fail("Type check failed (tsc --noEmit).", 4)
    success("Type check passed.")
    return 0


def build() -> int:
    sync_extension_docs()
    header("BUILD")
    install_cmd = "ci" if (EXTENSION_DIR / "package-lock.json").exists() else "install"
    try:
        run(["npm", install_cmd], EXTENSION_DIR)
        run(["npm", "run", "package"], EXTENSION_DIR)
    except subprocess.CalledProcessError:
        return fail("Build failed (npm install / npm run package).", 4)
    return 0


def newest_vsix() -> Path | None:
    candidates = sorted(EXTENSION_DIR.glob("*.vsix"), key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0] if candidates else None


def package_vsix(version: str | None) -> int:
    header("PACKAGE")
    # Remove stale .vsix files first so newest_vsix() can never resolve an old
    # build (the root cause of a prior version "never reaching the Marketplace").
    for old in EXTENSION_DIR.glob("*.vsix"):
        old.unlink()
    try:
        run(["npx", "vsce", "package", "--no-dependencies"], EXTENSION_DIR)
    except subprocess.CalledProcessError:
        return fail("vsce package failed.", 5)
    vsix = newest_vsix()
    if vsix is None:
        return fail("No .vsix produced.", 5)
    # vsce names the file <name>-<version>.vsix; confirm it matches the version
    # we intend to publish so a desynced package.json can't ship the wrong file.
    if version and f"-{version}.vsix" not in vsix.name:
        return fail(f"Packaged {vsix.name} does not match expected version {version}.", 5)
    success(f"Packaged: {vsix.name}")
    return 0
