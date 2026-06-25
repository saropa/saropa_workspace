#!/usr/bin/env python3
"""
Publish the Saropa Workspace VS Code extension.

Single entry point for the release workflow: validate -> build -> package the
.vsix -> (optionally) publish to the VS Code Marketplace and Open VSX -> commit,
tag, push, and create a GitHub release.

Unlike the larger Saropa toolchains, this extension is a single TypeScript
package with no Dart side and no translation pipeline, so this script is
deliberately self-contained (one file, no scripts/modules split). It shells out
to the same tools a human would use: npm, vsce, ovsx, git, and gh.

Run from the repository root:

    python scripts/publish.py

Modes (interactive menu, or pass --mode):
    full                Validate -> build -> package -> publish -> git + release
    package             Validate -> build -> package the .vsix only (no publish)
    publish-existing    Publish the newest existing .vsix (skip packaging)
    dry-run             Validate + build + package, never publish or touch git

The single source of truth for the version is extension/package.json. The top
"## [x.y.z]" heading in CHANGELOG.md must match it before a full publish.

Version:   1.0
Copyright: (c) 2026 Saropa

Exit codes:
    0  Success
    1  Prerequisites failed (missing tool / wrong directory)
    2  Working tree check failed
    3  Validation failed (version / changelog mismatch)
    4  Build failed
    5  Packaging failed
    6  Publish failed
    7  Git operations failed
    8  GitHub release failed
    10 User canceled
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

# Repository layout. This script lives in <repo>/scripts/, the extension is in
# <repo>/extension/. Resolve both from this file so the script works regardless
# of the caller's current directory.
REPO_ROOT = Path(__file__).resolve().parent.parent
EXTENSION_DIR = REPO_ROOT / "extension"
PACKAGE_JSON = EXTENSION_DIR / "package.json"
ROOT_README = REPO_ROOT / "README.md"
EXTENSION_README = EXTENSION_DIR / "README.md"
ROOT_CHANGELOG = REPO_ROOT / "CHANGELOG.md"
EXTENSION_CHANGELOG = EXTENSION_DIR / "CHANGELOG.md"

# The extension's README and CHANGELOG are generated copies of the repo-root
# files, not authored separately. The root pair is the single source of truth;
# sync_extension_docs() regenerates these before every package so the published
# .vsix can never drift from the root docs. They are git-ignored and a write hook
# blocks hand-edits (scripts/hooks/generated_docs_guard.py).
GENERATED_DOC_PAIRS = ((ROOT_README, EXTENSION_README), (ROOT_CHANGELOG, EXTENSION_CHANGELOG))

# Marketplace identity. publisher.name from package.json forms the extension id.
GITHUB_REPO = "saropa/saropa_workspace"


# --------------------------------------------------------------------------- #
# Small output helpers (ASCII-only so Windows consoles never choke on Unicode).
# --------------------------------------------------------------------------- #


def info(msg: str) -> None:
    print(f"  {msg}")


def header(title: str) -> None:
    print()
    print("=" * 60)
    print(f"  {title}")
    print("=" * 60)


def fail(msg: str, code: int) -> "int":
    print()
    print(f"  ERROR: {msg}")
    return code


def run(
    args: list[str],
    cwd: Path,
    *,
    check: bool = True,
    capture: bool = False,
) -> subprocess.CompletedProcess:
    """Run a command, echoing it first so the log shows exactly what ran.

    shell=False (args list) to avoid quoting pitfalls with paths that contain
    spaces. On Windows, npm/vsce/ovsx/gh are .cmd shims, so resolve them via
    shutil.which to get an executable path subprocess can launch directly.
    """
    exe = shutil.which(args[0]) or args[0]
    printable = " ".join(args)
    info(f"$ {printable}")
    return subprocess.run(
        [exe, *args[1:]],
        cwd=str(cwd),
        check=check,
        text=True,
        capture_output=capture,
    )


# --------------------------------------------------------------------------- #
# Prerequisites and validation.
# --------------------------------------------------------------------------- #


def check_prerequisites(mode: str) -> int:
    """Verify the directory layout and that required CLIs are installed."""
    if not PACKAGE_JSON.exists():
        return fail(f"extension/package.json not found at {PACKAGE_JSON}", 1)

    # npm + vsce are always needed; ovsx/gh only for a full publish.
    required = ["npm", "npx"]
    if mode == "full":
        required += ["git", "gh"]
    missing = [tool for tool in required if shutil.which(tool) is None]
    if missing:
        return fail(f"Required tools not found on PATH: {', '.join(missing)}", 1)
    return 0


def read_package_version() -> str:
    data = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    version = data.get("version")
    if not version:
        raise ValueError("extension/package.json has no 'version' field")
    return version


def top_changelog_version(changelog: Path) -> str | None:
    """Return the version in the first '## [x.y.z]' heading, or None.

    '## [Unreleased]' is skipped so a full publish forces a real cut version.
    """
    if not changelog.exists():
        return None
    pattern = re.compile(r"^##\s*\[(\d+\.\d+\.\d+)\]", re.MULTILINE)
    match = pattern.search(changelog.read_text(encoding="utf-8"))
    return match.group(1) if match else None


def validate_version_and_changelog(mode: str) -> int:
    """For a full publish, the package version must match the top CHANGELOG cut.

    This is the single guard against publishing a build whose changelog still
    says [Unreleased] or points at a different version than the .vsix.
    """
    version = read_package_version()
    header(f"VALIDATE  (package version {version})")

    if mode != "full":
        info("Non-full mode: skipping strict changelog match.")
        return 0

    root_cut = top_changelog_version(ROOT_CHANGELOG)
    if root_cut is None:
        return fail(
            "CHANGELOG.md has no '## [x.y.z]' heading. Cut the [Unreleased] "
            "section to the release version before a full publish.",
            3,
        )
    if root_cut != version:
        return fail(
            f"Version mismatch: package.json {version} != CHANGELOG.md {root_cut}.",
            3,
        )
    info(f"CHANGELOG.md top version matches package.json ({version}).")
    return 0


def check_working_tree() -> int:
    """A full publish requires a clean working tree so the tag points at code."""
    result = run(
        ["git", "status", "--porcelain"], REPO_ROOT, capture=True, check=False
    )
    if result.stdout.strip():
        return fail(
            "Working tree is not clean. Commit or stash changes before a full "
            "publish so the git tag matches the published build.",
            2,
        )
    return 0


# --------------------------------------------------------------------------- #
# Build and package.
# --------------------------------------------------------------------------- #


def sync_extension_docs() -> None:
    """Regenerate extension/README.md and extension/CHANGELOG.md from the root.

    The Marketplace renders extension/README.md and ships extension/CHANGELOG.md,
    but the repo authors a single source for each at the root. Copying here (not
    hand-maintaining two files) guarantees the packaged .vsix always matches the
    root docs and removes the silent drift that two editable copies invite. The
    copies are git-ignored, so overwriting them never dirties the working tree
    that a full publish requires to be clean.
    """
    header("SYNC DOCS")
    for src, dst in GENERATED_DOC_PAIRS:
        shutil.copyfile(src, dst)
        info(f"Synced extension/{dst.name} <- {src.name}")


def build() -> int:
    # Sync the generated docs first so the .vsix that build/package produces
    # carries the current root README and CHANGELOG.
    sync_extension_docs()
    header("BUILD")
    # npm ci when a lockfile exists for a reproducible install; else npm install.
    install_cmd = "ci" if (EXTENSION_DIR / "package-lock.json").exists() else "install"
    try:
        run(["npm", install_cmd], EXTENSION_DIR)
        # 'package' script runs esbuild with --production (minified, no sourcemap).
        run(["npm", "run", "package"], EXTENSION_DIR)
    except subprocess.CalledProcessError:
        return fail("Build failed (npm install / npm run package).", 4)
    return 0


def package_vsix() -> int:
    header("PACKAGE")
    try:
        # vsce reads version from package.json and names the .vsix accordingly.
        run(["npx", "vsce", "package", "--no-dependencies"], EXTENSION_DIR)
    except subprocess.CalledProcessError:
        return fail("vsce package failed.", 5)
    vsix = newest_vsix()
    if vsix is None:
        return fail("No .vsix produced.", 5)
    info(f"Packaged: {vsix.name}")
    return 0


def newest_vsix() -> Path | None:
    candidates = sorted(
        EXTENSION_DIR.glob("*.vsix"), key=lambda p: p.stat().st_mtime, reverse=True
    )
    return candidates[0] if candidates else None


# --------------------------------------------------------------------------- #
# Publish, git, release.
# --------------------------------------------------------------------------- #


def publish_marketplaces() -> int:
    """Publish to the VS Code Marketplace and Open VSX.

    Auth is taken from the environment the way the CLIs expect it:
      VSCE_PAT  for the VS Code Marketplace (vsce publish)
      OVSX_PAT  for Open VSX (ovsx publish)
    Open VSX is best-effort: a failure there does not fail the run, since the
    primary marketplace is the VS Code one.
    """
    header("PUBLISH")
    vsix = newest_vsix()
    if vsix is None:
        return fail("No .vsix to publish; run package first.", 6)

    try:
        run(["npx", "vsce", "publish", "--packagePath", vsix.name], EXTENSION_DIR)
    except subprocess.CalledProcessError:
        return fail("vsce publish failed (check VSCE_PAT).", 6)

    try:
        run(["npx", "ovsx", "publish", vsix.name], EXTENSION_DIR)
    except subprocess.CalledProcessError:
        # Non-fatal: the build is already live on the primary marketplace.
        info("WARNING: Open VSX publish failed (check OVSX_PAT). Continuing.")
    return 0


def git_tag_and_push(version: str) -> int:
    header(f"GIT  (tag v{version})")
    try:
        run(["git", "tag", "-a", f"v{version}", "-m", f"Release v{version}"], REPO_ROOT)
        run(["git", "push", "origin", "HEAD"], REPO_ROOT)
        run(["git", "push", "origin", f"v{version}"], REPO_ROOT)
    except subprocess.CalledProcessError:
        return fail("git tag/push failed.", 7)
    return 0


def github_release(version: str) -> int:
    """Create a GitHub release with the .vsix attached.

    Release notes are pulled from the matching CHANGELOG section. The notes must
    not reference any internal authoring tools; the changelog is the source.
    """
    header("GITHUB RELEASE")
    vsix = newest_vsix()
    notes = extract_changelog_section(ROOT_CHANGELOG, version) or f"Release v{version}"
    notes_file = REPO_ROOT / f".release-notes-{version}.md"
    notes_file.write_text(notes, encoding="utf-8")
    try:
        args = [
            "gh", "release", "create", f"v{version}",
            "--repo", GITHUB_REPO,
            "--title", f"v{version}",
            "--notes-file", str(notes_file),
        ]
        if vsix is not None:
            args.append(str(vsix))
        run(args, REPO_ROOT)
    except subprocess.CalledProcessError:
        return fail("gh release create failed.", 8)
    finally:
        notes_file.unlink(missing_ok=True)
    return 0


def extract_changelog_section(changelog: Path, version: str) -> str | None:
    """Return the body of the '## [version]' section, without the heading."""
    if not changelog.exists():
        return None
    text = changelog.read_text(encoding="utf-8")
    pattern = re.compile(
        rf"^##\s*\[{re.escape(version)}\].*?$(.*?)(?=^##\s*\[|\Z)",
        re.MULTILINE | re.DOTALL,
    )
    match = pattern.search(text)
    return match.group(1).strip() if match else None


# --------------------------------------------------------------------------- #
# Mode orchestration.
# --------------------------------------------------------------------------- #


def prompt_mode() -> str:
    header("PUBLISH OPTIONS")
    print("  1) Full publish (validate -> build -> package -> publish -> git + release)")
    print("  2) Package only (build + .vsix, no publish)")
    print("  3) Publish existing .vsix (skip build/package)")
    print("  4) Dry run (validate + build + package, never publish)")
    try:
        choice = input("  Choice [1]: ").strip() or "1"
    except (EOFError, KeyboardInterrupt):
        return "full"
    return {"1": "full", "2": "package", "3": "publish-existing", "4": "dry-run"}.get(
        choice, "full"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Publish the Saropa Workspace extension.")
    parser.add_argument(
        "--mode",
        choices=["full", "package", "publish-existing", "dry-run"],
        help="Run non-interactively in the given mode.",
    )
    parsed = parser.parse_args()
    mode = parsed.mode or prompt_mode()

    code = check_prerequisites(mode)
    if code:
        return code

    version = read_package_version()
    info(f"Saropa Workspace extension — version {version}, mode '{mode}'.")

    # publish-existing skips straight to publishing the newest built .vsix.
    if mode == "publish-existing":
        return publish_marketplaces()

    code = validate_version_and_changelog(mode)
    if code:
        return code

    if mode == "full":
        code = check_working_tree()
        if code:
            return code

    code = build() or package_vsix()
    if code:
        return code

    if mode in ("package", "dry-run"):
        header("DONE")
        info("Package built. No publish performed for this mode.")
        return 0

    # Full publish: marketplaces, then git tag/push, then GitHub release.
    return (
        publish_marketplaces()
        or git_tag_and_push(version)
        or github_release(version)
    )


if __name__ == "__main__":
    sys.exit(main())
