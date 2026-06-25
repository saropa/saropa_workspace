#!/usr/bin/env python3
"""
Manual-release helpers: the CI fallback playbook and the local .vsix install.

Both are read-only or local-only. ci_fallback() prints the exact commands, URLs,
and files a maintainer needs to publish by hand when the automated path can't
run; prompt_local_install() offers to side-load the packaged .vsix into the
local VS Code after a package-only build.

Version:   1.0
Copyright: (c) 2026 Saropa
"""

from __future__ import annotations

import shutil

from modules._build import newest_vsix
from modules._publish import _extension_identity
from modules._utils import (
    Color,
    EXTENSION_DIR,
    GITHUB_REPO,
    MARKETPLACE_MANAGE_URL,
    _c,
    detail,
    header,
    info,
    print_failure_tail,
    run,
    success,
    warn,
)
from modules._version_changelog import read_package_version


def ci_fallback() -> int:
    """Print the manual release playbook: exact commands, URLs, and files.

    Read-only — changes nothing. Use it when the automated path can't run
    (missing tool, token trouble) and a maintainer must publish by hand.
    """
    version = read_package_version()
    publisher, name = _extension_identity()
    vsix = newest_vsix()
    header("CI FALLBACK PLAYBOOK (MANUAL RELEASE)")
    warn("Use this when the automated publish can't run.")
    print()
    detail(_c("  1) Build and package", Color.WHITE))
    detail(_c("      cd extension && npm ci && npm run package", Color.CYAN))
    detail(_c("      npx vsce package --no-dependencies", Color.CYAN))
    print()
    detail(_c("  2) Publish to the stores (needs VSCE_PAT / OVSX_PAT)", Color.WHITE))
    detail(_c(f"      npx vsce publish --packagePath {name}-{version}.vsix", Color.CYAN))
    detail(_c(f"      npx ovsx publish {name}-{version}.vsix", Color.CYAN))
    detail(_c(f"      Manual upload: {MARKETPLACE_MANAGE_URL}", Color.CYAN))
    print()
    detail(_c("  3) Tag and GitHub release", Color.WHITE))
    detail(_c(f"      git tag -a v{version} -m \"Release v{version}\"", Color.CYAN))
    detail(_c(f"      git push origin v{version}", Color.CYAN))
    detail(_c(
        f"      gh release create v{version} --repo {GITHUB_REPO} --title v{version} --notes-file CHANGELOG.md",
        Color.CYAN,
    ))
    print()
    detail(_c("  4) Files / URLs", Color.WHITE))
    if vsix is not None:
        detail(_c(f"      VSIX on disk: {vsix}", Color.CYAN))
    else:
        detail(_c("      VSIX on disk: none (run step 1 first)", Color.YELLOW))
    if publisher and name:
        detail(_c(f"      Listing: https://marketplace.visualstudio.com/items?itemName={publisher}.{name}", Color.CYAN))
    detail(_c(f"      Release: https://github.com/{GITHUB_REPO}/releases/tag/v{version}", Color.CYAN))
    print()
    info("Playbook printed. No files changed.")
    return 0


def prompt_local_install() -> None:
    """Offer to install the packaged .vsix into the local VS Code."""
    vsix = newest_vsix()
    if vsix is None or shutil.which("code") is None:
        return
    try:
        answer = input("  Install the .vsix into VS Code locally? [y/N] ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        return
    if answer.startswith("y"):
        result = run(["code", "--install-extension", str(vsix)], EXTENSION_DIR, capture=True, check=False)
        if result.returncode == 0:
            success(f"Installed {vsix.name} locally.")
        else:
            print_failure_tail(result)
            warn("Local install failed.")
