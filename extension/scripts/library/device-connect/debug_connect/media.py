"""Screen mirroring (scrcpy) and filtered logcat streaming.

scrcpy is auto-updated from GitHub, launched detached, and VERIFIED to have
actually started (a window-less zombie no longer reports false success). The
GitHub release check is throttled to once a day so repeated runs cannot exhaust
GitHub's unauthenticated API rate limit.
"""

import os
import io
import time
import json
import shutil
import zipfile
import platform
import subprocess
import urllib.error
import urllib.request

from rich.prompt import Prompt
from rich.progress import (
    Progress,
    BarColumn,
    TextColumn,
    DownloadColumn,
    TransferSpeedColumn,
    TimeRemainingColumn,
)

from .core import (
    console,
    write_log,
    run_command,
    log_dir,
    print_ok,
    print_warn,
    print_info,
    set_scrcpy_outcome,
)

# GitHub's unauthenticated REST limit is 60 requests/hour per IP. The old code
# hit the releases API on EVERY run, so several runs within an hour exhausted it
# and printed 'HTTP Error 403: rate limit exceeded'. A dev tool does not need a
# fresh scrcpy more than once a day, so we throttle the check to this interval.
_UPDATE_CHECK_INTERVAL_S = 24 * 3600

# After killing a stale scrcpy, the phone's single hardware video encoder
# (c2.mtk.avc.encoder) can stay claimed for a beat AFTER the PC process is gone —
# the device-side release lags the process-table drain. A fresh instance spawned
# inside that gap can't get frames and comes up window-less. Wait this long past
# the drain before (re)spawning so the encoder is genuinely free. This is the
# root cause of the "alive but never opened a window" reports.
_ENCODER_RELEASE_SETTLE_S = 2.0

# scrcpy v3+/v4 only creates its SDL window AFTER the first decoded frame lands.
# Over Wi-Fi (server push + negotiate + first frame) that can take several
# seconds; over USB it is near-instant, so a working mirror exits the poll early.
# Poll this long for a window before concluding the instance is a window-less
# zombie — too short a budget kills a mirror that was merely slow to draw.
_WINDOW_GRACE_S = 14.0


def _update_check_due(stamp_file):
    """True when the scrcpy GitHub update check is due (no stamp, or > a day old).

    Reading the stamp file's mtime keeps the throttle stateless beyond a single
    touch file next to the scrcpy install. Any read error errs toward checking
    (returns True) so a corrupt stamp never permanently blocks updates.
    """
    try:
        if not os.path.exists(stamp_file):
            return True
        return (time.time() - os.path.getmtime(stamp_file)) > _UPDATE_CHECK_INTERVAL_S
    except OSError:
        return True


def _touch_update_stamp(stamp_file):
    """Records 'checked just now' so the next run skips the API for a day.

    Called on EVERY terminal outcome of the check — success, already-current, AND
    rate-limit — so a 403 backs off for a full day instead of re-hitting the
    exhausted limit on every subsequent run.
    """
    try:
        with open(stamp_file, "w") as f:
            f.write(str(int(time.time())))
    except OSError:
        pass


def _purge_stale_scrcpy_install(scrcpy_dir):
    """Delete the previously-extracted scrcpy files before laying down a new build.

    scrcpy's release layout changes between versions (SDL2->SDL3, avcodec-61->62,
    etc.), and the extractor writes NEW files over the old ones by name without
    removing the ones the new release dropped. Left alone the folder accumulates
    dead DLLs from every prior version — harmless (the current exe imports its own
    by name) but confusing and unbounded. Purge here so each install is clean.

    Preserved: our own throttle/version stamps (dotfiles like .update_check /
    .version) and any user-created shortcuts (*.url / *.lnk) — these are not
    release artifacts and must survive the refresh.
    """
    try:
        for name in os.listdir(scrcpy_dir):
            lowered = name.lower()
            if name.startswith(".") or lowered.endswith((".url", ".lnk")):
                continue
            path = os.path.join(scrcpy_dir, name)
            if os.path.isdir(path):
                shutil.rmtree(path, ignore_errors=True)
            else:
                try:
                    os.remove(path)
                except OSError:
                    pass  # e.g. the DLL is loaded by a running scrcpy — skip it
    except OSError as e:
        # A purge failure is non-fatal — the extractor overwrites in place, so
        # worst case is the old stale-DLL behavior, not a broken install.
        write_log("SCRCPY", f"Pre-extract purge failed: {e}")


def _resolve_scrcpy_exe():
    """Locate the scrcpy executable, cross-platform.

    Returns ``(exe_path_or_None, managed_dir_or_None)``:
      * scrcpy already on PATH -> (that path, None). Used as-is and never
        auto-updated here — the user's package manager owns that copy.
      * Windows, not on PATH -> (<dir>/scrcpy.exe, <dir>), where <dir> is
        ``$SCRCPY_HOME`` or ``%LOCALAPPDATA%/scrcpy``: a per-user copy this script
        auto-downloads from GitHub and keeps current.
      * any other OS, not on PATH -> (None, None). There is no bundled installer;
        the caller tells the user to install scrcpy from their package manager.

    Replaces a former hardcoded Windows path that only existed on one machine, so
    mirroring now works on any host that has scrcpy installed or is on Windows.
    """
    on_path = shutil.which("scrcpy")
    if on_path:
        return on_path, None
    if platform.system() == "Windows":
        base = os.environ.get("SCRCPY_HOME") or os.path.join(
            os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "scrcpy"
        )
        return os.path.join(base, "scrcpy.exe"), base
    return None, None


def update_scrcpy(scrcpy_dir, version_file):
    """Best-effort update of the managed scrcpy install to the latest GitHub release.

    ``scrcpy_dir`` is the caller-resolved managed location (see
    _resolve_scrcpy_exe) — never a hardcoded path. A copy of scrcpy found on PATH
    is not routed here; only a per-user managed copy this script owns is updated.
    Any network/extract failure is non-fatal — we keep whatever build is on disk
    and let the caller launch it. The GitHub release API call is throttled to
    once per day (see _update_check_due) so repeated runs never trip GitHub's
    unauthenticated rate limit; a 403 is treated as 'skip quietly', not an error.
    """
    stamp_file = os.path.join(scrcpy_dir, ".update_check")

    # Throttle: skip the network entirely if we checked within the last day.
    if os.path.exists(scrcpy_dir) and not _update_check_due(stamp_file):
        print_info("scrcpy update check skipped (checked within the last day).")
        return

    # PHASE 1 — query the release API (fast; a spinner is enough). Any failure
    # here is non-fatal: keep the installed build and return.
    try:
        with console.status("[dim]Checking GitHub for latest scrcpy release...[/dim]", spinner="dots"):
            api_url = "https://api.github.com/repos/Genymobile/scrcpy/releases/latest"
            # Pretend to be a standard browser to avoid basic API blocks.
            req = urllib.request.Request(api_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req) as response:
                data = json.loads(response.read().decode())
        latest_version = data['tag_name']
        # We reached the API — record the check so the daily throttle applies
        # even if we end up already-current or the download fails below.
        _touch_update_stamp(stamp_file)
    except urllib.error.HTTPError as http_err:
        # 403 here is almost always GitHub's hourly rate limit, not a real
        # failure. Back off for a day and keep the installed build — a rate limit
        # is not a reason to alarm the user on every run.
        _touch_update_stamp(stamp_file)
        if http_err.code == 403:
            print_info("scrcpy update check skipped (GitHub rate limit) — using the installed build.")
        else:
            print_info(f"scrcpy update check failed (HTTP {http_err.code}); using the installed build.")
        return
    except Exception as e:
        print_info(f"scrcpy update check skipped ({e}); using the installed build.")
        return

    current_version = ""
    if os.path.exists(version_file):
        with open(version_file, "r") as f:
            current_version = f.read().strip()

    # Already current — nothing to download.
    if current_version == latest_version:
        print_ok(f"scrcpy is up to date ({current_version}).")
        return

    download_url = next(
        (asset['browser_download_url'] for asset in data['assets']
         if "win64" in asset['name'] and asset['name'].endswith(".zip")),
        None,
    )
    if not download_url:
        print_warn("Could not locate the win64 scrcpy download link on GitHub.")
        return

    # PHASE 2 — download with a real progress bar (this is the slow part, often
    # 30-50 MB). Chunked read so the bar advances by bytes; extract in memory,
    # stripping the zip's root folder so files land directly in scrcpy_dir. A
    # download/extract failure is non-fatal — keep whatever build is on disk.
    console.print(f"[bold yellow]New scrcpy version found ({latest_version}). Downloading...[/bold yellow]")
    try:
        with urllib.request.urlopen(download_url) as zip_resp:
            total = int(zip_resp.headers.get("Content-Length", 0)) or None
            buffer = io.BytesIO()
            with Progress(
                TextColumn("[cyan]Downloading scrcpy"),
                BarColumn(),
                DownloadColumn(),
                TransferSpeedColumn(),
                TimeRemainingColumn(),
                console=console,
                transient=True,
            ) as progress:
                task = progress.add_task("download", total=total)
                while True:
                    chunk = zip_resp.read(64 * 1024)
                    if not chunk:
                        break
                    buffer.write(chunk)
                    progress.advance(task, len(chunk))

        # Download succeeded — safe to clear the old install now (a failed
        # download above would have skipped this and kept the working build).
        os.makedirs(scrcpy_dir, exist_ok=True)
        _purge_stale_scrcpy_install(scrcpy_dir)

        with zipfile.ZipFile(buffer) as z:
            root_folder = z.namelist()[0].split('/')[0] + '/'
            for member in z.namelist():
                if member == root_folder:
                    continue
                target_path = os.path.join(scrcpy_dir, member.replace(root_folder, ""))
                if member.endswith('/'):
                    os.makedirs(target_path, exist_ok=True)
                    continue
                with z.open(member) as source, open(target_path, "wb") as target:
                    shutil.copyfileobj(source, target)

        with open(version_file, "w") as f:
            f.write(latest_version)
        print_ok(f"scrcpy successfully updated to {latest_version}!")
    except Exception as e:
        print_warn(f"scrcpy download/extract failed ({e}); using the installed build.")


def _scrcpy_process_count():
    """Windows-only count of live scrcpy.exe processes.

    Used to confirm a kill actually drained before we relaunch. Returns 0 on
    non-Windows or on any query error — the caller only uses this to decide
    whether to keep waiting, so erring toward 0 just ends the wait early rather
    than blocking the launch.
    """
    if platform.system().lower() != "windows":
        return 0
    try:
        out = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq scrcpy.exe", "/NH"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        # tasklist prints "INFO: No tasks..." (no image name) when none match.
        return out.stdout.lower().count("scrcpy.exe")
    except Exception:
        return 0


def _kill_all_scrcpy(reason):
    """Kill every scrcpy.exe / scrcpy process AND wait for them to actually exit.

    The phone has a single hardware video encoder (c2.mtk.avc.encoder); while any
    scrcpy still holds it, a freshly spawned instance can't get frames and stays
    window-less. The old cleanup fired one taskkill and slept a flat 0.7s — but
    /F termination plus the device-side encoder release lag past that, so a
    relaunch could still collide with a not-yet-dead instance and stack. Poll
    until the process table is clear (or a short timeout) so the encoder is
    genuinely free before the caller spawns the next mirror.
    """
    on_windows = platform.system().lower() == "windows"
    try:
        if on_windows:
            subprocess.run(
                ["taskkill", "/F", "/IM", "scrcpy.exe"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
        else:
            subprocess.run(
                ["pkill", "-f", "scrcpy"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
    except Exception as e:
        # A failed cleanup is non-fatal; worst case the collision recurs and the
        # post-launch window check below reports it. Don't block the launch.
        write_log("SCRCPY", f"Cleanup taskkill failed ({reason}): {e}")
        return

    # Wait (up to ~3s) for the table to drain so the encoder is released before
    # relaunch. Non-Windows skips the poll (count is always 0 there).
    drained = False
    for _ in range(15):
        if _scrcpy_process_count() == 0:
            drained = True
            break
        time.sleep(0.2)

    if drained:
        write_log("SCRCPY", f"Cleared pre-existing scrcpy before launch ({reason})")
    else:
        write_log("SCRCPY", f"scrcpy still draining after kill ({reason})")


def _process_has_visible_window(pid):
    """Windows-only: True if `pid` owns at least one visible top-level window.

    scrcpy v3+ creates its SDL window only AFTER the first decoded frame
    arrives. An instance that lost the device's single encoder to a stacked
    sibling stays alive with no window — the process-alive poll alone reports
    that zombie as 'launched'. Walking the top-level windows for one owned by
    this pid distinguishes a real mirror from a headless zombie.

    Returns True on non-Windows (no Win32 window model — fall back to the
    alive-only semantics the caller had before) and True on any probe error, so
    the check can never turn a genuinely working mirror into a reported failure.
    """
    if platform.system().lower() != "windows":
        return True
    try:
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        found = []

        # EnumWindows callback: BOOL CALLBACK(HWND hwnd, LPARAM lParam).
        enum_proc_type = ctypes.WINFUNCTYPE(
            wintypes.BOOL, wintypes.HWND, wintypes.LPARAM
        )

        def _on_window(hwnd, _lparam):
            if not user32.IsWindowVisible(hwnd):
                return True  # keep enumerating
            owner_pid = wintypes.DWORD(0)
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner_pid))
            if owner_pid.value == pid:
                found.append(hwnd)
                return False  # stop — answer found
            return True

        user32.EnumWindows(enum_proc_type(_on_window), 0)
        return bool(found)
    except Exception:
        # If the Win32 probe itself fails, don't penalize a working mirror.
        return True


def _spawn_scrcpy_and_verify(args):
    """Spawn scrcpy detached, then classify how it started.

    Returns a (status, info, detail) tuple, one of:
      ("window",   pid,  "")        alive WITH a visible window — a real mirror.
      ("exited",   code, err_text)  died on startup; err_text is its captured stderr.
      ("headless", pid,  "")        alive but no window after the grace budget
                                    (window-less zombie — caller decides retry/kill).
      ("error",    None, message)   the spawn itself raised.

    stderr goes to a temp log (NOT DEVNULL) so a startup death reports its real
    cause instead of a false 'launched'. We poll the WHOLE grace budget rather
    than sleeping a flat interval and checking once: a working mirror returns the
    instant its window appears (fast on USB), while a genuine failure still gets
    the full window (slow first frame on Wi-Fi) before we call it headless.
    """
    err_log_path = os.path.join(log_dir, "scrcpy_launch.err")

    creation_flags = 0
    if platform.system().lower() == "windows":
        # Windows-only flags — referenced only on Windows (absent on POSIX). Detach
        # into its OWN process group so scrcpy outlives this script and does not
        # fight the logcat stream for the terminal.
        creation_flags = (
            subprocess.DETACHED_PROCESS
            | subprocess.CREATE_NEW_PROCESS_GROUP
        )

    try:
        # Keep our handle so we can close it after the poll; scrcpy inherits its
        # own copy and keeps writing to the file after we let go.
        err_log = open(err_log_path, "w", encoding="utf-8", errors="replace")
        proc = subprocess.Popen(
            args,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=err_log,
            creationflags=creation_flags,
            close_fds=True,
        )
    except Exception as e:
        write_log("SCRCPY", f"Launch exception: {e}")
        return ("error", None, str(e))

    # Poll for either the window (success) or an early exit (failure) across the
    # whole grace budget.
    deadline = time.time() + _WINDOW_GRACE_S
    while time.time() < deadline:
        exited = proc.poll()
        if exited is not None:
            err_log.close()
            try:
                with open(err_log_path, "r", encoding="utf-8", errors="replace") as f:
                    err_text = f.read().strip()
            except Exception:
                err_text = ""
            write_log("SCRCPY", f"Exited code {exited}: {err_text}")
            return ("exited", exited, err_text)
        if _process_has_visible_window(proc.pid):
            err_log.close()
            return ("window", proc.pid, "")
        time.sleep(0.5)

    # Still alive, still no window after the full budget: a window-less zombie.
    err_log.close()
    return ("headless", proc.pid, "")


def launch_scrcpy(target_ip_port, keep_screen_on=False, stay_awake=False):
    """Launches scrcpy detached and VERIFIES it actually started.

    The old launch sent stderr to DEVNULL and printed 'launched!' the instant
    Popen returned — so a scrcpy that died on startup (server-push race, codec
    init failure) was reported as success while no window ever appeared. We now
    redirect stderr to a temp log, wait briefly, poll the process, and claim
    success only if it is still alive. If it exited, we surface the captured
    error instead of a false positive.

    keep_screen_on=False (default): pass scrcpy's '-S' (--turn-screen-off) so the
    PHONE display is blanked while mirroring. The device keeps driving its panel
    even when mirrored, so leaving it lit makes it run hot (observed climbing
    32->38C on AC power) — blanking it keeps the device cool. The PC mirror
    WINDOW still renders normally; only the phone's own screen goes dark. This is
    safe now that the launch is verified above: a dark phone no longer hides a
    failed launch the way it did when '-S' was paired with the old false-success
    reporting.
    """
    # Locate scrcpy cross-platform. A copy on PATH (macOS/Linux via a package
    # manager, or Windows via choco/scoop) is used as-is; otherwise Windows falls
    # back to a per-user managed copy this script keeps current. Replaces a former
    # hardcoded D:\tools\scrcpy that only existed on one machine.
    scrcpy_exe, managed_dir = _resolve_scrcpy_exe()
    if managed_dir is not None:
        # Only a managed (auto-downloaded) install is updated here; a PATH copy is
        # left to the user's package manager.
        update_scrcpy(managed_dir, os.path.join(managed_dir, ".version"))

    if scrcpy_exe is None or not os.path.exists(scrcpy_exe):
        if platform.system() == "Windows":
            detail = f"scrcpy not found (looked on PATH and in {managed_dir})."
        else:
            detail = (
                "scrcpy not found on PATH — install it "
                "(e.g. 'brew install scrcpy' or 'apt install scrcpy') and re-run."
            )
        console.print(f"✖ [bold red]{detail}[/bold red]")
        write_log("SCRCPY", detail)
        set_scrcpy_outcome(False)
        return

    # Kill any scrcpy left over from a prior run BEFORE spawning a new one, WAIT
    # for the process table to drain (inside _kill_all_scrcpy), THEN — if there
    # actually was a stale instance — wait a further beat for the DEVICE-SIDE
    # encoder release, which lags the PC process exit. A fresh scrcpy spawned
    # inside that gap can't get frames, and scrcpy v3+/v4 only creates its window
    # AFTER the first decoded frame arrives — so it stays alive with no window.
    # One mirror is all a dev session needs, so clear the field first, confirm it
    # cleared, and let the encoder settle before respawning.
    had_stale = _scrcpy_process_count() > 0
    _kill_all_scrcpy("pre-launch")
    if had_stale:
        console.print("[dim]   Cleared previous scrcpy instance(s); letting the device encoder settle...[/dim]")
        time.sleep(_ENCODER_RELEASE_SETTLE_S)

    # Pass an argv list (no shell) so the path-with-spaces needs no quoting.
    #
    # Power/thermal: scrcpy's continuous screen capture + H.264 encode + Wi-Fi
    # transmit is the heaviest controllable load on the device — it ran the
    # phone up to 38C and drained the battery even with the panel blanked,
    # because '-S' only kills the backlight, not the encode/radio work. Cap that
    # work to cut the draw while keeping the mirror usable for dev:
    #
    # Why this matters for charging: a phone mirroring over a PC USB DATA port is
    # often draining even while "plugged in" — the port caps at ~4.5-7.5W and the
    # encode/transmit work alone burns ~5W, so nothing is left to charge (a 100W
    # cable into a PC port does not help). The fix is to DECOUPLE data from power:
    # mirror over Wi-Fi (or accept slow USB charging) and route POWER to a real
    # wall brick. Blanking the panel with -S also drops the battery below the
    # ~39-40C charge-throttle threshold so fast charging can re-engage. The
    # weak-cable / PC-port / thermal diagnosis the user actually sees lives in
    # health._battery_advisories.
    #   --no-audio        drop the continuous audio capture/encode/transmit stream
    #   --max-fps=30      halve+ the encode rate vs the panel's native 60-144Hz
    #   --video-bit-rate=4M  less to encode and push over Wi-Fi (default is 8M)
    #   --no-power-on     don't wake the device when scrcpy attaches
    args = [
        scrcpy_exe,
        "-s", target_ip_port,
        "--no-mouse-hover",
        "--no-audio",
        "--max-fps=30",
        "--video-bit-rate=4M",
        "--no-power-on",
    ]
    if not keep_screen_on:
        args.append("-S")
    if stay_awake:
        # --stay-awake (-w): keep the device awake while plugged in even with the
        # screen off (-S). Over Wi-Fi there is no USB tether, so without this the
        # device suspends a few seconds after -S blanks the panel — black mirror,
        # dropped session. It ALSO keeps the device 'interactive', so the keyguard
        # never engages: -S no longer triggers a lock-screen / fingerprint prompt.
        # scrcpy restores the original stay-awake state when it exits.
        args.append("-w")

    console.print("[dim]Spawning scrcpy as a detached background process...[/dim]")

    # Spawn + verify, with ONE controlled auto-retry. A window-less result almost
    # always means the fresh instance raced the device-side encoder release, which
    # a short settle fixes — so on the first headless outcome we kill it, wait the
    # full settle, and respawn ONCE. This REPLACES the old "kill it and tell the
    # user to re-run", which is what produced a pile of flashing mirror windows as
    # the user re-ran the whole script by hand. Two attempts is the cap: if the
    # second is still window-less, it's a genuine device-side encoder problem a
    # re-run won't clear on its own.
    for attempt in (1, 2):
        status, info, detail = _spawn_scrcpy_and_verify(args)

        if status == "window":
            console.print("✔ [bold green]Screen mirroring launched.[/bold green]")
            if not keep_screen_on:
                console.print("[dim]   Phone screen intentionally blanked (-S) to keep the device cool; the mirror window still shows.[/dim]")
            console.print("[dim]   If you don't see the window, it's behind this terminal or on another monitor.[/dim]")
            write_log("SCRCPY", f"Launched (pid {info}) for {target_ip_port} on attempt {attempt}")
            set_scrcpy_outcome(True)
            return

        if status == "exited":
            # Died on startup — report scrcpy's own captured stderr, not a guess.
            console.print(f"✖ [bold red]scrcpy exited immediately (code {info}).[/bold red]")
            if detail:
                console.print(f"[dim]{detail}[/dim]")
            write_log("SCRCPY", f"Exited code {info} for {target_ip_port}: {detail}")
            set_scrcpy_outcome(False)
            return

        if status == "error":
            console.print(f"✖ [bold red]Failed to launch scrcpy. Error: {detail}[/bold red]")
            set_scrcpy_outcome(False)
            return

        # status == "headless": alive but no window. Kill it so it can't keep
        # holding the encoder, then (first attempt only) settle and retry once.
        _kill_all_scrcpy(f"headless-attempt-{attempt}")
        write_log(
            "SCRCPY",
            f"Headless (no window) for {target_ip_port} on attempt {attempt}; killed pid {info}",
        )
        if attempt == 1:
            console.print("[dim]   scrcpy came up window-less (device encoder still busy) — retrying once...[/dim]")
            time.sleep(_ENCODER_RELEASE_SETTLE_S)

    # Both attempts came up window-less: a genuine device-side encoder problem.
    console.print(
        "✖ [bold red]scrcpy started but never opened a window "
        "(the device's video encoder is unavailable).[/bold red]"
    )
    console.print(
        "[dim]   Toggle the phone's Wi-Fi/USB debugging off and on, or replug the "
        "cable, to reset the encoder — then re-run.[/dim]"
    )
    write_log("SCRCPY", f"Headless after retry for {target_ip_port}; gave up")
    set_scrcpy_outcome(False)


def prompt_scrcpy(target_ip_port):
    """Interactive path: asks before launching screen mirroring."""
    choice = Prompt.ask("\n[bold yellow]Launch scrcpy for screen mirroring?[/bold yellow] (y/N)", default="n").lower()
    if choice == 'y':
        launch_scrcpy(target_ip_port)


def start_logcat_stream(target_ip_port):
    """Streams filtered Flutter/Dart logcat to THIS terminal (blocking, no prompt).

    Blocks the script entirely — Python hands the terminal to adb until the
    developer hits Ctrl+C. Split out from the interactive prompt so the express
    'logging on' path can stream directly without a y/N. NOTE: while attached,
    the device pushes log lines over Wi-Fi continuously, which keeps the radio
    active and adds a small battery drain — that is why the default express path
    leaves it off.
    """
    console.print("\n[bold cyan]--- Spawning Live Flutter Logcat ---[/bold cyan]")

    # Clear the device buffer first so we start from a clean slate ('-c' flushes
    # the old system logs from previous hours).
    run_command(f"adb -s {target_ip_port} logcat -c", show_output=False)

    # Filter spec: verbose Flutter engine + Dart VM (print()), silence the rest.
    # '-v color' lets adb tag errors/warnings with native terminal colors.
    filter_spec = "Flutter:V Dart:V *:S"
    command = f"adb -s {target_ip_port} logcat -v color {filter_spec}"

    # Explicit instructions so a quiet stream doesn't read as a frozen terminal.
    console.print("\n[bold green]✔ Logcat is now streaming to this terminal.[/bold green]")
    console.print("[bold white]Note: If the screen stays blank below, your Flutter app[/bold white]")
    console.print("[bold white]   is not sending any logs yet. Run 'flutter run' or interact[/bold white]")
    console.print("[bold white]   with your app to populate this view.[/bold white]")
    console.print("[dim]--------------------------------------------------------- (Press Ctrl+C to stop)[/dim]\n")

    try:
        # Synchronous/blocking — adb streams directly to this window. No
        # CREATE_NO_WINDOW here: this stream is MEANT to inherit the terminal.
        subprocess.run(command, shell=True)
    except KeyboardInterrupt:
        # Catch Ctrl+C cleanly so it drops back into the main flow.
        console.print("\n[yellow]Logcat stream closed safely. Returning to menu...[/yellow]")


def launch_filtered_logcat(target_ip_port):
    """Interactive path: asks before streaming logcat."""
    choice = Prompt.ask("\n[bold yellow]Spawn live filtered Logcat stream?[/bold yellow] (y/N)", default="n").lower()
    if choice == 'y':
        start_logcat_stream(target_ip_port)
