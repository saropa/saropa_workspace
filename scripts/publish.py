#!/usr/bin/env python3
"""
Publish the Saropa Workspace VS Code extension.

Single entry point for the release workflow: audit -> resolve version ->
build -> package the .vsix -> (optionally) publish to the VS Code Marketplace
and Open VSX -> commit, tag, push, create a GitHub release, then verify the
stores actually serve the new version.

Unlike the larger Saropa toolchains this extension is a single TypeScript
package with no Dart side and no translation pipeline, so this script is
deliberately self-contained (one file, no scripts/modules split). It shells out
to the same tools a human would use: npm, vsce, ovsx, git, and gh.

Run from the repository root:

    python scripts/publish.py

Modes (interactive menu, or pass --mode):
    full                Audit -> version -> build -> package -> publish -> git + release -> verify
    package             Build + package the .vsix only (no publish), optional local install
    publish-existing    Publish the newest existing .vsix (skip packaging) + verify
    dry-run             Audit + build + package, never publish or touch git
    audit               Read-only pre-publish checks; change nothing
    ci-fallback         Print the manual release playbook (URLs, commands, files)

Version handling is automated. The single source of truth for the version is
extension/package.json; release notes live in the top "## [x.y.z]" section of
the root CHANGELOG.md. A full publish prompts for the version (defaulting to a
patch bump when the changelog has an [Unreleased] section), renames the
[Unreleased] heading to the chosen version, reconciles package.json with the
changelog, and bumps past any git tag that already exists on the remote so a
release can never collide with a published one.

Auth comes from the environment the CLIs expect:
    VSCE_PAT  VS Code Marketplace (vsce publish)
    OVSX_PAT  Open VSX (ovsx publish)
A missing token is prompted for interactively with platform-specific
instructions for setting it permanently.

Version:   2.0
Copyright: (c) 2026 Saropa

Exit codes:
    0  Success
    1  Prerequisites failed (missing tool / wrong directory)
    2  Working tree check failed
    3  Validation failed (version / changelog / audit)
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
import os
import platform
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from contextlib import contextmanager
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

# Repository layout. This script lives in <repo>/scripts/, the extension is in
# <repo>/extension/. Resolve both from this file so the script works regardless
# of the caller's current directory.
REPO_ROOT = Path(__file__).resolve().parent.parent
EXTENSION_DIR = REPO_ROOT / "extension"
PACKAGE_JSON = EXTENSION_DIR / "package.json"
PACKAGE_NLS = EXTENSION_DIR / "package.nls.json"
RUNTIME_LOCALE = EXTENSION_DIR / "src" / "i18n" / "locales" / "en.json"
SRC_DIR = EXTENSION_DIR / "src"
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

# Marketplace / GitHub identity. publisher + name from package.json form the
# extension id used in store URLs and the propagation queries.
GITHUB_REPO = "saropa/saropa_workspace"
MARKETPLACE_MANAGE_URL = "https://marketplace.visualstudio.com/manage/publishers/saropa"

# Semantic version with optional pre-release suffix (1.0.1, 1.0.1-beta.2).
VERSION_RE = r"\d+\.\d+\.\d+(?:-[\w]+(?:\.[\w]+)*)?"

# Terms that must never appear in any tracked, shippable artifact (HARD RULE in
# CLAUDE.md / .claude/rules). The scan is deliberately conservative: it lists
# only unambiguous assistant/vendor names so an ordinary English word can't
# false-positive (e.g. "cursor" the text caret, or a bare "AI", are excluded).
AI_REFERENCE_RE = re.compile(
    r"\b(claude|anthropic|copilot|windsurf|chatgpt|openai|llm)\b", re.IGNORECASE
)


# --------------------------------------------------------------------------- #
# Colored output. ANSI codes degrade to plain text where the terminal can't
# render them; enable_ansi_support() turns on virtual-terminal processing on
# Windows so the same codes work in CMD and PowerShell.
# --------------------------------------------------------------------------- #


class Color(Enum):
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    RED = "\033[91m"
    CYAN = "\033[96m"
    WHITE = "\033[97m"
    DIM = "\033[2m"
    BOLD = "\033[1m"
    RESET = "\033[0m"


# When True (set by --quiet), only warnings and errors print. Info/success/
# headers are suppressed so a CI log stays terse.
_QUIET = False


def enable_ansi_support() -> None:
    """Enable ANSI escape sequences on Windows and force UTF-8 stdout.

    No-op for ANSI on macOS/Linux (native). On Windows the default cp1252 stdout
    cannot print the check/cross glyphs and bar characters, so reconfigure to
    UTF-8 too.
    """
    if sys.platform == "win32":
        try:
            import ctypes
            from ctypes import wintypes

            kernel32 = ctypes.windll.kernel32
            handle = kernel32.GetStdHandle(-11)  # STD_OUTPUT_HANDLE
            mode = wintypes.DWORD()
            kernel32.GetConsoleMode(handle, ctypes.byref(mode))
            # 0x0004 = ENABLE_VIRTUAL_TERMINAL_PROCESSING
            kernel32.SetConsoleMode(handle, mode.value | 0x0004)
        except Exception:
            # A locked-down console may refuse; colored output just degrades.
            pass
        if "TERM" not in os.environ:
            os.environ["TERM"] = "xterm-256color"
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except (AttributeError, OSError):
        pass


def _c(msg: str, color: Color) -> str:
    return f"{color.value}{msg}{Color.RESET.value}"


def header(title: str) -> None:
    if _QUIET:
        return
    print()
    print(_c("=" * 64, Color.CYAN))
    print(_c(f"  {title}", Color.CYAN))
    print(_c("=" * 64, Color.CYAN))


def info(msg: str) -> None:
    if not _QUIET:
        print(_c(f"  i {msg}", Color.CYAN))


def detail(msg: str) -> None:
    if not _QUIET:
        print(f"  {msg}")


def success(msg: str) -> None:
    if not _QUIET:
        print(_c(f"  + {msg}", Color.GREEN))


def warn(msg: str) -> None:
    print(_c(f"  ! {msg}", Color.YELLOW))


def error(msg: str) -> None:
    print(_c(f"  x {msg}", Color.RED))


def fail(msg: str, code: int) -> int:
    print()
    error(msg)
    return code


# cspell:disable
def show_logo() -> None:
    """Print the Saropa 'S' logo. Pure branding; never references any tooling."""
    logo = (
        "\033[38;5;208m                       `-+shdmNMMMMNmdhs+-\033[0m\n"
        "\033[38;5;215m                 `/dMMMMMM/`          ``````\033[0m\n"
        "\033[38;5;226m                /MMMMMMMMMMMMMMMMMMMMMMMMMMMNh\\\033[0m\n"
        "\033[38;5;154m              o     `..~~~::~+==+~:/+sdNMMMMMMMo\033[0m\n"
        "\033[38;5;87m              /N:                        :MMMMMM/\033[0m\n"
        "\033[38;5;45m                :dNy/.              ./smMMMMMMm:\033[0m\n"
        "\033[38;5;33m                    .odMMMMMMMMMMMMMMMMMMdo-\033[0m\n"
        "\033[38;5;57m                       `-+shdNNMMMMNNdhs+-\033[0m"
    )
    print()
    print(logo)
    print(_c("  Saropa Workspace publisher", Color.WHITE))
    print(_c("  (c) 2026 Saropa  -  https://saropa.com", Color.DIM))
# cspell:enable


# --------------------------------------------------------------------------- #
# Command execution.
# --------------------------------------------------------------------------- #


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
    Output is forced to UTF-8 with replacement so a stray byte never crashes the
    run on a Windows cp1252 console.
    """
    exe = shutil.which(args[0]) or args[0]
    detail(_c(f"$ {' '.join(args)}", Color.DIM))
    return subprocess.run(
        [exe, *args[1:]],
        cwd=str(cwd),
        check=check,
        text=True,
        capture_output=capture,
        encoding="utf-8",
        errors="replace",
    )


def print_failure_tail(result: subprocess.CompletedProcess, *, limit: int = 12) -> None:
    """Print the last few lines of a captured failed command for triage."""
    combined = ((result.stdout or "") + (result.stderr or "")).strip()
    if not combined:
        return
    lines = combined.splitlines()
    tail = lines[-limit:]
    if len(lines) > limit:
        warn(f"... ({len(lines) - limit} earlier line(s) omitted)")
    for line in tail:
        print(f"      {line}")


# --------------------------------------------------------------------------- #
# Step timing. A small summary table at the end shows where the run spent time
# and which steps passed, mirroring the larger Saropa publishers.
# --------------------------------------------------------------------------- #


@dataclass
class _StepRecord:
    name: str
    duration: float
    ok: bool


class StepTimer:
    def __init__(self) -> None:
        self._steps: list[_StepRecord] = []
        self._start = time.monotonic()

    @contextmanager
    def step(self, name: str):
        start = time.monotonic()
        ok = True
        try:
            yield
        except BaseException:
            ok = False
            raise
        finally:
            self._steps.append(_StepRecord(name, time.monotonic() - start, ok))

    def print_summary(self) -> None:
        if _QUIET or not self._steps:
            return
        total = time.monotonic() - self._start
        longest = max(s.duration for s in self._steps)
        print()
        print(_c("=" * 64, Color.CYAN))
        print(_c("  Timing", Color.CYAN))
        print(_c("=" * 64, Color.CYAN))
        for s in self._steps:
            icon = _c("+", Color.GREEN) if s.ok else _c("x", Color.RED)
            # Bar length scales to the longest step so the slow ones stand out.
            bar = ""
            if s.duration >= 0.5 and longest > 0:
                bar = "  " + _c("#" * max(1, int(s.duration / longest * 15)), Color.DIM)
            print(f"  {icon}  {s.name:<28}{_fmt_duration(s.duration):>8}{bar}")
        print(f"    {'Total':<28}{_fmt_duration(total):>8}")
        print()


def _fmt_duration(seconds: float) -> str:
    if seconds < 1.0:
        return f"{int(seconds * 1000)}ms"
    if seconds < 60.0:
        return f"{seconds:.1f}s"
    return f"{int(seconds // 60)}m {int(seconds % 60):02d}s"


# --------------------------------------------------------------------------- #
# package.json / CHANGELOG version helpers (single source of truth).
# --------------------------------------------------------------------------- #


def read_package_version() -> str:
    data = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    version = data.get("version")
    if not version:
        raise ValueError("extension/package.json has no 'version' field")
    return version


def set_package_version(new_version: str) -> None:
    """Write a new version into package.json, touching only the version field.

    A targeted regex (not a json.dump round-trip) preserves the file's exact
    formatting, key order, and trailing newline so the diff is one line.
    """
    text = PACKAGE_JSON.read_text(encoding="utf-8")
    new_text, n = re.subn(
        r'("version"\s*:\s*")[^"]*(")', rf"\g<1>{new_version}\g<2>", text, count=1
    )
    if n == 0:
        raise ValueError("Could not find a 'version' field to update in package.json")
    PACKAGE_JSON.write_text(new_text, encoding="utf-8")


def top_changelog_version(changelog: Path) -> str | None:
    """Return the version in the first '## [x.y.z]' heading, or None.

    '## [Unreleased]' is skipped so a full publish forces a real cut version.
    Anchored to line start so a version-like token inside prose or a code span
    can't match before the first real heading.
    """
    if not changelog.exists():
        return None
    match = re.search(rf"^##\s*\[({VERSION_RE})\]", changelog.read_text(encoding="utf-8"), re.MULTILINE)
    return match.group(1) if match else None


def has_unreleased_section(changelog: Path) -> bool:
    if not changelog.exists():
        return False
    return bool(re.search(r"^##\s*\[Unreleased\]", changelog.read_text(encoding="utf-8"), re.MULTILINE))


def parse_version(version: str) -> tuple:
    """Sort key where a pre-release sorts before the matching stable version."""
    match = re.match(r"^(\d+\.\d+\.\d+)(?:-(.+))?$", version)
    if not match:
        raise ValueError(f"Invalid version: {version}")
    base = tuple(int(x) for x in match.group(1).split("."))
    pre = match.group(2)
    return (*base, 0, pre) if pre is not None else (*base, 1, "")


def increment_version(version: str) -> str:
    """Patch bump: 1.0.1 -> 1.0.2; 1.0.0-beta.1 -> 1.0.0-beta.2."""
    pre = re.match(r"^(\d+\.\d+\.\d+-\w+\.)(\d+)$", version)
    if pre:
        return f"{pre.group(1)}{int(pre.group(2)) + 1}"
    parts = version.split(".")
    parts[-1] = str(int(parts[-1]) + 1)
    return ".".join(parts)


def find_empty_changelog_sections(changelog: Path) -> list[str]:
    """Return versions whose '## [x.y.z]' section has no body (orphan stubs).

    An empty stub between two real releases implies a version that never
    shipped, and it can trip the [Unreleased]->[version] rename into a false
    collision. '[Unreleased]' is intentionally not flagged — an empty
    Unreleased section is the normal state right after a release.
    """
    if not changelog.exists():
        return []
    content = changelog.read_text(encoding="utf-8")
    pattern = re.compile(
        rf"^##\s*\[({VERSION_RE})\][^\n]*\n(.*?)(?=^##\s|\Z)", re.MULTILINE | re.DOTALL
    )
    empty: list[str] = []
    for match in pattern.finditer(content):
        body = re.sub(r"^\s*(?:---\s*)?$", "", match.group(2), flags=re.MULTILINE)
        if not body.strip():
            empty.append(match.group(1))
    return empty


def rename_unreleased_to_version(changelog: Path, version: str) -> bool:
    """Rename the '## [Unreleased]' heading to '## [version]'.

    Returns True if renamed, False if there was no Unreleased heading. Raises
    ValueError if a section for the target version already exists (the author
    must resolve which one is real before a tag is burned on it).
    """
    content = changelog.read_text(encoding="utf-8")
    if not re.search(r"^##\s*\[Unreleased\]", content, re.MULTILINE):
        return False
    if re.search(rf"^##\s*\[{re.escape(version)}\]", content, re.MULTILINE):
        raise ValueError(
            f"CHANGELOG.md has both [Unreleased] and [{version}]. Remove one before publishing."
        )
    content = re.sub(r"^##\s*\[Unreleased\]", f"## [{version}]", content, count=1, flags=re.MULTILINE)
    changelog.write_text(content, encoding="utf-8")
    return True


def changelog_overview_problems(changelog: Path, version: str) -> list[str]:
    """Validate the '[version]' section's Overview intro and pinned [log] link.

    The CHANGELOG maintenance notes require every released section to open with
    a one-line human summary that ends in a [log](.../vX.Y.Z/CHANGELOG.md) link
    pinned to THIS version's tag. A missing intro ships a release with no
    summary; a stale tag in the link points readers at the wrong snapshot.
    """
    if not changelog.exists():
        return ["CHANGELOG.md not found."]
    content = changelog.read_text(encoding="utf-8")
    body_match = re.search(
        rf"^##\s*\[{re.escape(version)}\][^\n]*\n(.*?)(?=^##\s|\Z)",
        content,
        re.MULTILINE | re.DOTALL,
    )
    if body_match is None:
        return [f"No [{version}] section found in CHANGELOG.md."]
    # Overview is the prose before the first '###' sub-heading.
    intro = body_match.group(1).split("\n###", 1)[0]
    intro = re.sub(r"^\s*-{3,}\s*$", "", intro, flags=re.MULTILINE).strip()
    expected = f"[log](https://github.com/{GITHUB_REPO}/blob/v{version}/CHANGELOG.md)"
    log_match = re.search(r"\[log\]\(([^)]+)\)", intro)
    prose = re.sub(r"\[log\]\([^)]*\)", "", intro).strip()
    problems: list[str] = []
    if not prose:
        problems.append(f"The [{version}] section has no Overview intro paragraph.")
    if log_match is None:
        problems.append(f"The [{version}] Overview has no [log](...) link. End it with: {expected}")
    elif f"/blob/v{version}/" not in log_match.group(1):
        problems.append(
            f"The [{version}] [log] link does not point at tag v{version}. "
            f"Found {log_match.group(0)} -- expected {expected}"
        )
    return problems


# --------------------------------------------------------------------------- #
# Interactive version prompt (timeout; editable on Windows, bracketed on Unix).
# --------------------------------------------------------------------------- #


def _prompt_version_windows(default: str, timeout: int) -> str:
    import msvcrt

    sys.stdout.write(f"  Version to publish: {default}")
    sys.stdout.flush()
    buffer = list(default)
    start = time.time()
    while time.time() - start < timeout:
        if not msvcrt.kbhit():
            time.sleep(0.05)
            continue
        ch = msvcrt.getwch()
        if ch in ("\r", "\n"):
            print()
            return "".join(buffer).strip() or default
        if ch == "\x08":  # Backspace
            if buffer:
                buffer.pop()
                sys.stdout.write("\b \b")
                sys.stdout.flush()
        elif ch == "\x03":  # Ctrl+C
            raise KeyboardInterrupt
        elif ch.isprintable():
            buffer.append(ch)
            sys.stdout.write(ch)
            sys.stdout.flush()
    print()
    return "".join(buffer).strip() or default


def _prompt_version_unix(default: str, timeout: int) -> str:
    import select

    sys.stdout.write(f"  Version to publish [{default}]: ")
    sys.stdout.flush()
    ready, _, _ = select.select([sys.stdin], [], [], timeout)
    if not ready:
        print()
        return default
    return sys.stdin.readline().strip() or default


def prompt_version_until_valid(default: str, timeout: int = 60) -> str:
    """Prompt for a version, defaulting after a timeout, until it is valid semver."""
    while True:
        if sys.platform == "win32":
            version = _prompt_version_windows(default, timeout)
        else:
            version = _prompt_version_unix(default, timeout)
        if re.match(rf"^{VERSION_RE}$", version):
            return version
        warn(f"Invalid version '{version}'. Use X.Y.Z or X.Y.Z-pre.N")


def tag_exists_on_remote(version: str) -> bool:
    """True if tag v{version} already exists on origin (would collide on push)."""
    result = run(
        ["git", "ls-remote", "--tags", "origin", f"refs/tags/v{version}"],
        REPO_ROOT,
        capture=True,
        check=False,
    )
    return bool(result.stdout.strip())


def resolve_version(timer: StepTimer) -> str | None:
    """Drive the full version-numbering workflow for a publish.

    1. Refuse to proceed while any '## [x.y.z]' section is an empty stub.
    2. Offer a default: a patch bump when [Unreleased] is present (work is
       pending), otherwise the current package.json value; never below the top
       changelog version if the author already cut one ahead by hand.
    3. Prompt (editable, with timeout); validate semver.
    4. Write package.json and rename [Unreleased] -> [version].
    5. Bump past a remote tag clash so a published version can't be reused.

    Returns the resolved version, or None to abort the publish.
    """
    header("VERSION")
    empty = find_empty_changelog_sections(ROOT_CHANGELOG)
    if empty:
        error(
            "CHANGELOG.md has empty version section(s): "
            + ", ".join(f"[{v}]" for v in empty)
            + ". Delete the stub or fill in its notes, then re-run."
        )
        return None

    pkg_version = read_package_version()
    default = increment_version(pkg_version) if has_unreleased_section(ROOT_CHANGELOG) else pkg_version
    top = top_changelog_version(ROOT_CHANGELOG)
    # Never offer a default below a release the author already wrote by hand.
    if top and parse_version(top) > parse_version(default):
        default = top
    detail(f"  Current package.json version: {pkg_version}")
    if has_unreleased_section(ROOT_CHANGELOG):
        detail("  CHANGELOG has an [Unreleased] section (work pending).")

    version = prompt_version_until_valid(default)

    with timer.step("Version sync"):
        if version != pkg_version:
            set_package_version(version)
            success(f"Set package.json to {version}")
        try:
            if rename_unreleased_to_version(ROOT_CHANGELOG, version):
                success(f"Renamed [Unreleased] to [{version}] in CHANGELOG.md")
        except ValueError as exc:
            error(str(exc))
            return None

        # Reconcile: after the rename the top changelog version must equal the
        # package version, or the published notes won't match the .vsix.
        new_top = top_changelog_version(ROOT_CHANGELOG)
        if new_top != version:
            error(
                f"After version sync, CHANGELOG top is [{new_top}] but package.json is "
                f"{version}. Add a [{version}] section with release notes and re-run."
            )
            return None

        # Bump past a tag that already exists on the remote so the push can't
        # fail mid-release on a duplicate tag.
        while tag_exists_on_remote(version):
            bumped = increment_version(version)
            warn(f"Tag v{version} already exists on origin; bumping to {bumped}.")
            set_package_version(bumped)
            content = ROOT_CHANGELOG.read_text(encoding="utf-8")
            content = re.sub(
                rf"^##\s*\[{re.escape(version)}\]",
                f"## [{bumped}]",
                content,
                count=1,
                flags=re.MULTILINE,
            )
            ROOT_CHANGELOG.write_text(content, encoding="utf-8")
            success(f"Promoted top CHANGELOG section [{version}] -> [{bumped}]")
            version = bumped

    detail(f"  Publishing: {_c(version, Color.WHITE)}    Tag: v{version}")
    return version


# --------------------------------------------------------------------------- #
# Audit. Read-only pre-publish checks. Returns the count of blocking failures.
# --------------------------------------------------------------------------- #


def _used_nls_keys() -> set[str]:
    """All %key% manifest tokens referenced by package.json."""
    if not PACKAGE_JSON.exists():
        return set()
    return set(re.findall(r"%([A-Za-z0-9_.]+)%", PACKAGE_JSON.read_text(encoding="utf-8")))


def _defined_nls_keys() -> set[str]:
    if not PACKAGE_NLS.exists():
        return set()
    return set(json.loads(PACKAGE_NLS.read_text(encoding="utf-8")).keys())


def _used_l10n_keys() -> set[str]:
    """All l10n('key') runtime tokens referenced anywhere under src/."""
    keys: set[str] = set()
    for ts in SRC_DIR.rglob("*.ts"):
        for match in re.finditer(r"""l10n\(\s*['"]([A-Za-z0-9_.]+)['"]""", ts.read_text(encoding="utf-8")):
            keys.add(match.group(1))
    return keys


def _defined_l10n_keys() -> set[str]:
    if not RUNTIME_LOCALE.exists():
        return set()
    return set(json.loads(RUNTIME_LOCALE.read_text(encoding="utf-8")).keys())


def scan_ai_references() -> list[str]:
    """Return tracked files containing an assistant/vendor reference.

    The 'no AI on public surfaces' rule is a hard requirement: nothing shipped
    to GitHub or the Marketplace may name an AI tool. git grep searches only
    tracked files, so git-ignored working notes (CLAUDE.md, .claude/) are
    excluded automatically. The .vsix and binary images are excluded by
    pathspec to avoid binary-match noise.
    """
    result = run(
        [
            "git",
            "grep",
            "-iIl",
            "-E",
            AI_REFERENCE_RE.pattern,
            "--",
            ":(exclude)*.vsix",
            ":(exclude)*.png",
            ":(exclude)*.ico",
        ],
        REPO_ROOT,
        capture=True,
        check=False,
    )
    return [line for line in result.stdout.splitlines() if line.strip()]


def run_audit(mode: str) -> int:
    """Run read-only pre-publish checks. Returns the number of blocking failures.

    For non-full modes the version/changelog match is informational rather than
    blocking, so verification builds aren't forced to cut a release first.
    """
    header("AUDIT")
    failures = 0
    strict = mode == "full"

    # 1) Version / changelog agreement.
    version = read_package_version()
    top = top_changelog_version(ROOT_CHANGELOG)
    if has_unreleased_section(ROOT_CHANGELOG):
        if strict:
            info("CHANGELOG has [Unreleased]; a full publish will cut it to a version.")
        else:
            info("CHANGELOG has an [Unreleased] section.")
    if top is None:
        msg = "CHANGELOG.md has no '## [x.y.z]' heading."
        (error if strict else info)(msg)
        failures += int(strict)
    elif top != version and not has_unreleased_section(ROOT_CHANGELOG):
        msg = f"Version mismatch: package.json {version} != CHANGELOG top {top}."
        (error if strict else info)(msg)
        failures += int(strict)
    else:
        success(f"Version source of truth: package.json {version}")

    # 2) No empty changelog stubs (silent-skip guard).
    empty = find_empty_changelog_sections(ROOT_CHANGELOG)
    if empty:
        error("Empty CHANGELOG section(s): " + ", ".join(f"[{v}]" for v in empty))
        failures += 1
    else:
        success("No empty CHANGELOG sections.")

    # 3) Overview intro + pinned [log] link on the cut version (strict only;
    #    until [Unreleased] is cut the pinned tag can't be known).
    if strict and top and not has_unreleased_section(ROOT_CHANGELOG):
        problems = changelog_overview_problems(ROOT_CHANGELOG, top)
        if problems:
            for p in problems:
                error(p)
            failures += len(problems)
        else:
            success(f"[{top}] Overview intro and [log] link valid.")

    # 4) i18n manifest coverage: every %key% has a value in package.nls.json.
    missing_nls = sorted(_used_nls_keys() - _defined_nls_keys())
    if missing_nls:
        error(f"package.json uses {len(missing_nls)} %key% with no value in package.nls.json:")
        for k in missing_nls[:20]:
            detail(f"      %{k}%")
        failures += 1
    else:
        success("All package.json %keys% are defined in package.nls.json.")

    # 5) i18n runtime coverage: every l10n('key') has a value in locales/en.json.
    missing_l10n = sorted(_used_l10n_keys() - _defined_l10n_keys())
    if missing_l10n:
        error(f"Code uses {len(missing_l10n)} l10n key(s) with no value in locales/en.json:")
        for k in missing_l10n[:20]:
            detail(f"      {k}")
        failures += 1
    else:
        success("All l10n('key') calls are defined in locales/en.json.")

    # 6) No assistant/vendor references in tracked, shippable files (hard rule).
    flagged = scan_ai_references()
    if flagged:
        error("Disallowed assistant/vendor reference in tracked file(s):")
        for f in flagged:
            detail(f"      {f}")
        failures += 1
    else:
        success("No assistant/vendor references in tracked files.")

    print()
    if failures:
        error(f"Audit found {failures} blocking issue(s).")
    else:
        success("Audit clean.")
    return failures


# --------------------------------------------------------------------------- #
# Prerequisites and working tree.
# --------------------------------------------------------------------------- #


def check_prerequisites(mode: str) -> int:
    if not PACKAGE_JSON.exists():
        return fail(f"extension/package.json not found at {PACKAGE_JSON}", 1)
    required = ["npm", "npx"]
    if mode in ("full", "audit", "ci-fallback"):
        required += ["git"]
    if mode == "full":
        required += ["gh"]
    missing = [tool for tool in required if shutil.which(tool) is None]
    if missing:
        return fail(f"Required tools not found on PATH: {', '.join(missing)}", 1)
    return 0


def check_working_tree() -> None:
    """Report the working-tree state before the release commit.

    Run after version sync, so the version/changelog edits are expected to be
    committed into the release. This surfaces what will be committed rather than
    blocking — a full publish builds its own release commit.
    """
    result = run(["git", "status", "--porcelain"], REPO_ROOT, capture=True, check=False)
    if result.stdout.strip():
        info("Working tree changes that will go into the release commit:")
        for line in result.stdout.splitlines()[:20]:
            detail(f"      {line}")


# --------------------------------------------------------------------------- #
# Build and package.
# --------------------------------------------------------------------------- #


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
# Git tag, GitHub release.
# --------------------------------------------------------------------------- #


def git_commit_release(version: str) -> int:
    """Commit the version sync, then tag and push so the tag points at it."""
    header(f"GIT  (release v{version})")
    try:
        run(["git", "add", "-A"], REPO_ROOT)
        # Only commit when there is something staged; a re-run after a clean
        # commit should not fail on "nothing to commit".
        status = run(["git", "status", "--porcelain"], REPO_ROOT, capture=True, check=False)
        if status.stdout.strip():
            run(["git", "commit", "-m", f"chore: release v{version}"], REPO_ROOT)
        run(["git", "tag", "-a", f"v{version}", "-m", f"Release v{version}"], REPO_ROOT)
        run(["git", "push", "origin", "HEAD"], REPO_ROOT)
        run(["git", "push", "origin", f"v{version}"], REPO_ROOT)
    except subprocess.CalledProcessError:
        return fail("git commit/tag/push failed.", 7)
    return 0


def extract_changelog_section(changelog: Path, version: str) -> str | None:
    if not changelog.exists():
        return None
    pattern = re.compile(
        rf"^##\s*\[{re.escape(version)}\].*?$(.*?)(?=^##\s*\[|\Z)", re.MULTILINE | re.DOTALL
    )
    match = pattern.search(changelog.read_text(encoding="utf-8"))
    return match.group(1).strip() if match else None


def github_release(version: str) -> int:
    """Create a GitHub release with the .vsix attached and changelog notes."""
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
        success(f"Created GitHub release v{version}.")
    except subprocess.CalledProcessError:
        return fail("gh release create failed.", 8)
    finally:
        notes_file.unlink(missing_ok=True)
    return 0


# --------------------------------------------------------------------------- #
# Store propagation verification.
# --------------------------------------------------------------------------- #


def _extension_identity() -> tuple[str, str]:
    data = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    return data.get("publisher", ""), data.get("name", "")


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


# --------------------------------------------------------------------------- #
# CI fallback playbook (read-only).
# --------------------------------------------------------------------------- #


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


# --------------------------------------------------------------------------- #
# Mode orchestration.
# --------------------------------------------------------------------------- #

MODES = ("full", "package", "publish-existing", "dry-run", "audit", "ci-fallback")


def prompt_mode() -> str:
    header("PUBLISH OPTIONS")
    detail("  1) Full publish (audit -> version -> build -> package -> publish -> git + release -> verify)")
    detail("  2) Package only (build + .vsix, no publish; optional local install)")
    detail("  3) Publish existing .vsix (skip build/package) + verify")
    detail("  4) Dry run (audit + build + package, never publish)")
    detail("  5) Audit only (read-only checks; change nothing)")
    detail("  6) CI fallback playbook (manual release URLs and commands)")
    try:
        choice = input("  Choice [1]: ").strip() or "1"
    except (EOFError, KeyboardInterrupt):
        return "full"
    return {
        "1": "full",
        "2": "package",
        "3": "publish-existing",
        "4": "dry-run",
        "5": "audit",
        "6": "ci-fallback",
    }.get(choice, "full")


def main() -> int:
    global _QUIET
    parser = argparse.ArgumentParser(description="Publish the Saropa Workspace extension.")
    parser.add_argument("--mode", choices=MODES, help="Run non-interactively in the given mode.")
    parser.add_argument("--quiet", action="store_true", help="Only print warnings and errors.")
    parsed = parser.parse_args()
    _QUIET = parsed.quiet

    enable_ansi_support()
    show_logo()
    mode = parsed.mode or prompt_mode()

    code = check_prerequisites(mode)
    if code:
        return code

    detail(f"  Saropa Workspace extension - version {read_package_version()}, mode '{mode}'.")

    if mode == "ci-fallback":
        return ci_fallback()

    if mode == "audit":
        return 3 if run_audit(mode) else 0

    if mode == "publish-existing":
        timer = StepTimer()
        try:
            vsix = newest_vsix()
            if vsix is None:
                return fail("No existing .vsix to publish; run package first.", 6)
            success(f"Selected: {vsix.name}")
            version_match = re.search(rf"-({VERSION_RE})\.vsix$", vsix.name)
            with timer.step("Publish"):
                code = publish_marketplaces()
            if code:
                return code
            if version_match:
                verify_store_publication(version_match.group(1))
            return 0
        finally:
            timer.print_summary()

    # Build-and-maybe-publish modes (full, package, dry-run).
    timer = StepTimer()
    try:
        if run_audit(mode) and mode == "full":
            return fail("Audit failed; fix the issues above before a full publish.", 3)

        version: str | None = read_package_version()
        if mode == "full":
            version = resolve_version(timer)
            if version is None:
                return 10
            check_working_tree()

        with timer.step("Type check"):
            code = type_check()
        if code:
            return code
        with timer.step("Build"):
            code = build()
        if code:
            return code
        with timer.step("Package"):
            code = package_vsix(version)
        if code:
            return code

        if mode in ("package", "dry-run"):
            header("DONE")
            success("Package built. No publish performed for this mode.")
            if mode == "package":
                prompt_local_install()
            return 0

        # Full publish: stores -> git tag/release -> store verification.
        with timer.step("Publish"):
            code = publish_marketplaces()
        if code:
            return code
        with timer.step("Git + release"):
            code = git_commit_release(version) or github_release(version)
        if code:
            return code
        verify_store_publication(version)
        success_banner(version)
        return 0
    finally:
        timer.print_summary()


if __name__ == "__main__":
    sys.exit(main())
