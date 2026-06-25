#!/usr/bin/env python3
"""
Marketplace / Open VSX publishing and store-propagation verification.

Prompts for any missing publish token, publishes the newest .vsix to the VS Code
Marketplace (the gating store) and then Open VSX (best-effort), and polls both
stores until they actually serve the new version — because vsce can exit 0 while
the Marketplace silently drops an upload.

Version:   1.0
Copyright: (c) 2026 Saropa
"""

from __future__ import annotations

import json
import os
import platform
import subprocess
import time
import urllib.request

from modules._build import newest_vsix
from modules._utils import (
    Color,
    EXTENSION_DIR,
    GITHUB_REPO,
    MARKETPLACE_MANAGE_URL,
    PACKAGE_JSON,
    _c,
    detail,
    error,
    fail,
    header,
    info,
    run,
    success,
    warn,
)


def _extension_identity() -> tuple[str, str]:
    data = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    return data.get("publisher", ""), data.get("name", "")


# --------------------------------------------------------------------------- #
# PAT prompting and marketplace publish.
# --------------------------------------------------------------------------- #


def _prompt_for_pat(env_var: str, label: str, token_url: str, extra: list[str]) -> str:
    """Prompt for a missing publish token and set it for this process.

    Returns the token, or empty string to skip that store. Setting os.environ
    lets vsce/ovsx (which read the env var) pick it up without re-prompting.
    """
    warn(f"{env_var} is not set.")
    info(f"{label} requires a Personal Access Token to publish.")
    for line in extra:
        detail(f"      {line}")
    detail(f"      Token page: {token_url}")
    if platform.system() == "Windows":
        detail(_c("  Set permanently (PowerShell):", Color.DIM))
        detail(_c(f'    [Environment]::SetEnvironmentVariable("{env_var}", "your-token", "User")', Color.WHITE))
    else:
        detail(_c("  Set permanently (~/.bashrc or ~/.zshrc):", Color.DIM))
        detail(_c(f'    export {env_var}="your-token"', Color.WHITE))
    try:
        token = input(f"  Paste your {label} PAT now (or press Enter to skip): ").strip()
    except (EOFError, KeyboardInterrupt):
        return ""
    if token:
        os.environ[env_var] = token
    return token


def publish_marketplaces() -> int:
    """Publish to the VS Code Marketplace, then Open VSX.

    The Marketplace is the primary store and gates the run: a failure there
    returns non-zero. Open VSX is best-effort — a failure is warned and the run
    continues, because the build is already live on the primary store.
    """
    header("PUBLISH")
    vsix = newest_vsix()
    if vsix is None:
        return fail("No .vsix to publish; run package first.", 6)

    if not os.environ.get("VSCE_PAT", "").strip():
        token = _prompt_for_pat(
            "VSCE_PAT",
            "VS Code Marketplace",
            "https://dev.azure.com (User settings -> Personal Access Tokens)",
            [
                "Scopes: Marketplace -> Manage. Organization: All accessible.",
                f"Publisher page: {MARKETPLACE_MANAGE_URL}",
            ],
        )
        if not token:
            return fail("Skipping publish: no Marketplace PAT provided.", 6)
    try:
        run(["npx", "vsce", "publish", "--packagePath", vsix.name], EXTENSION_DIR)
        success("Published to the VS Code Marketplace.")
    except subprocess.CalledProcessError:
        error("vsce publish failed (PAT expired or missing 'Marketplace -> Manage' scope?).")
        info(f"  Manage / manual upload: {MARKETPLACE_MANAGE_URL}")
        info(f"  File to upload: {vsix.name}")
        return 6

    if not os.environ.get("OVSX_PAT", "").strip():
        _prompt_for_pat(
            "OVSX_PAT",
            "Open VSX",
            "https://open-vsx.org/user-settings/tokens",
            ["Open VSX is a separate registry; the token is independent of VSCE_PAT."],
        )
    if os.environ.get("OVSX_PAT", "").strip():
        try:
            run(["npx", "ovsx", "publish", vsix.name], EXTENSION_DIR)
            success("Published to Open VSX.")
        except subprocess.CalledProcessError:
            warn("Open VSX publish failed (check OVSX_PAT). The Marketplace publish stands.")
    else:
        info("Skipped Open VSX (no OVSX_PAT).")
    return 0


# --------------------------------------------------------------------------- #
# Store propagation verification.
# --------------------------------------------------------------------------- #


def _marketplace_latest(item_name: str) -> str | None:
    url = "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery"
    payload = {
        "filters": [{"criteria": [{"filterType": 7, "value": item_name}], "pageSize": 1}],
        "flags": 103,
    }
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json;api-version=7.2-preview.1",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            data = json.loads(response.read().decode("utf-8"))
        return data["results"][0]["extensions"][0]["versions"][0]["version"]
    except (OSError, ValueError, KeyError, IndexError, TypeError):
        return None


def _open_vsx_latest(publisher: str, name: str) -> str | None:
    try:
        with urllib.request.urlopen(f"https://open-vsx.org/api/{publisher}/{name}", timeout=15) as response:
            data = json.loads(response.read().decode("utf-8"))
        version = data.get("version")
        return version if isinstance(version, str) else None
    except (OSError, ValueError, KeyError, TypeError):
        return None


def verify_store_publication(version: str, interval: int = 30, timeout: int = 600) -> None:
    """Poll the Marketplace and Open VSX until both serve *version* or timeout.

    vsce can exit 0 while the Marketplace silently drops the upload (expired
    PAT, missing scope), so confirming actual propagation is the only reliable
    "it's live" signal. On timeout the failing store is named with the manual
    upload path; verification never fails the run since the publish already
    returned success.
    """
    publisher, name = _extension_identity()
    if not (publisher and name):
        warn("Could not resolve extension identity; skipping store verification.")
        return
    header("VERIFY STORE PUBLICATION")
    item = f"{publisher}.{name}"
    attempts = (timeout // interval) + 1
    market_ok = vsx_ok = False
    last_market = last_vsx = "unknown"
    for attempt in range(1, attempts + 1):
        if not market_ok:
            v = _marketplace_latest(item)
            last_market = v or "unavailable"
            market_ok = v == version
        if not vsx_ok:
            v = _open_vsx_latest(publisher, name)
            last_vsx = v or "unavailable"
            vsx_ok = v == version
        if market_ok and vsx_ok:
            success(f"Both stores serve v{version} (Marketplace, Open VSX).")
            return
        info(f"Attempt {attempt}/{attempts}: Marketplace={last_market}, Open VSX={last_vsx}")
        if attempt < attempts:
            time.sleep(interval)
    if not market_ok:
        warn(f"Marketplace still shows {last_market} (expected {version}).")
        info(f"  Upload the .vsix manually: {MARKETPLACE_MANAGE_URL}")
    else:
        success(f"Marketplace OK: {last_market}")
    if not vsx_ok:
        warn(f"Open VSX still shows {last_vsx} (expected {version}).")
        info("  Manage: https://open-vsx.org/user-settings/extensions")
    else:
        success(f"Open VSX OK: {last_vsx}")


def success_banner(version: str) -> None:
    publisher, name = _extension_identity()
    header(f"PUBLISHED v{version}")
    vsix = newest_vsix()
    if vsix is not None:
        detail(_c(f"  VSIX:        {vsix.name}", Color.CYAN))
    detail(_c(f"  Release:     https://github.com/{GITHUB_REPO}/releases/tag/v{version}", Color.CYAN))
    if publisher and name:
        detail(_c(f"  Marketplace: https://marketplace.visualstudio.com/items?itemName={publisher}.{name}", Color.CYAN))
        detail(_c(f"  Open VSX:    https://open-vsx.org/extension/{publisher}/{name}", Color.CYAN))
    detail(_c(f"  Manage:      {MARKETPLACE_MANAGE_URL}", Color.CYAN))
