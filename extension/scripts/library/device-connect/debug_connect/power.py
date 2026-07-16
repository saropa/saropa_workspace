"""Device power saving — apply / restore toggle.

Captures the device's ORIGINAL settings before applying battery-saving values,
records them to a state file, and restores them exactly on the next run. Screen-
off / stay-awake are deliberately NOT done here — scrcpy's `-S -w` handles those
without fighting the mirror (see media.launch_scrcpy).
"""

import os
import json

from .core import console, write_log, POWER_STATE_FILE, _adb_shell_many

# Generic `settings` toggles applied by power saving: capture the original value,
# write the power value, and on restore put the original back (or delete the key
# if it had none). (namespace, key, power_value).
#
# NOTE: screen-off, stay-awake, and no-lock are deliberately NOT done here. They
# are handled by scrcpy's -S (panel off) + -w (--stay-awake) in the express paths,
# which keeps the device INTERACTIVE so it neither suspends nor engages the
# keyguard over Wi-Fi. Doing it via settings (stay_on_while_plugged_in, forced
# Doze, brightness) fought scrcpy and either blacked the mirror or triggered the
# fingerprint lock — see the history in launch_scrcpy / run_post_connect_suite.
_POWER_SETTINGS = [
    # Kill animation work — pure CPU/GPU saving, invisible on a dev device.
    ("global", "window_animation_scale", "0"),
    ("global", "transition_animation_scale", "0"),
    ("global", "animator_duration_scale", "0"),
]

# FULL POWER (the inverse of _POWER_SETTINGS): restore the three animation scales
# to 1. Zeroing them is what trips Flutter's MediaQuery.disableAnimations, which
# the app reads as OS reduce-motion and uses to flatten EVERY gated animation
# (depth parallax, micro-interactions, dialog motion, the lot). Setting them to 1
# clears that flag so animations run normally while debugging. Battery saver /
# Doze are cleared separately in apply_full_power. Screen panel-off + stay-awake
# are deliberately NOT touched — scrcpy's -S -w owns the physical screen; "full
# power" here means CPU/GPU/animation/battery-saver, not forcing the panel on.
_FULL_POWER_SETTINGS = [
    ("global", "window_animation_scale", "1"),
    ("global", "transition_animation_scale", "1"),
    ("global", "animator_duration_scale", "1"),
]

# Radios disabled via `svc` (not a settings write) but whose ON/OFF state we read
# from a settings flag so restore can re-enable only what was on.
# (flag_namespace, flag_key, disable_cmd, enable_cmd).
_POWER_RADIOS = [
    ("global", "bluetooth_on", "svc bluetooth disable", "svc bluetooth enable"),
    ("global", "mobile_data", "svc data disable", "svc data enable"),
]

# Motorola display/audio services that keep sensors awake. Force-stopped on
# apply; NOT restored — Android restarts them on demand, so there is nothing to
# put back.
_MOTO_BLOAT = [
    "com.motorola.motodisplay",
    "com.motorola.audiomonitor",
    "com.motorola.help",
]


def _settings_get_many(target, specs):
    """Reads many settings in ONE adb call. specs: [(namespace, key), ...].

    Returns {f'{namespace}/{key}': value|None}, mapping output lines back to specs
    by order (each `settings get` prints exactly one line — the value or 'null').
    """
    commands = [f"settings get {namespace} {key}" for namespace, key in specs]
    lines = _adb_shell_many(target, commands).split("\n")
    captured = {}
    for index, (namespace, key) in enumerate(specs):
        raw = lines[index].strip() if index < len(lines) else ""
        captured[f"{namespace}/{key}"] = raw if raw and raw.lower() != "null" else None
    return captured


def _read_power_state():
    """Loads the saved power-state JSON, or None when no state file exists."""
    if os.path.exists(POWER_STATE_FILE):
        try:
            with open(POWER_STATE_FILE, "r") as state_file:
                return json.load(state_file)
        except Exception:
            return None
    return None


def _power_state_active():
    state = _read_power_state()
    return bool(state and state.get("active"))


def _clear_power_state():
    """Removes the state file once everything captured in it has been restored."""
    try:
        if os.path.exists(POWER_STATE_FILE):
            os.remove(POWER_STATE_FILE)
    except Exception as remove_error:
        console.print(f"[red]Could not clear power state file: {remove_error}[/red]")


def apply_power_saving(target):
    """Captures current device power settings, then applies battery-saving values.

    Restores any PRIOR application first (see below) so the values we capture are
    the user's true originals — not the already-dimmed/disabled values from a
    previous run. Without that, a second apply would record brightness=10 as the
    'original' and the real value would be lost forever.
    """
    if _power_state_active():
        restore_power_saving(target, announce=False)

    # Capture EVERY original value in one adb call (settings + radio ON flags).
    # Location is intentionally absent — the app needs it during debugging, so
    # power saving must not disable it.
    get_specs = [(namespace, key) for namespace, key, _ in _POWER_SETTINGS]
    get_specs += [(namespace, key) for namespace, key, _, _ in _POWER_RADIOS]
    saved = _settings_get_many(target, get_specs)

    # Apply every change in one adb call: settings writes, radio disables (Wi-Fi
    # untouched), and the Moto display/audio force-stops (auto-restart).
    #
    # Deliberately NOT spoofing `dumpsys battery unplug` for battery saver, and
    # NOT forcing Doze: both suspend the device / display pipeline a few seconds
    # after the panel goes dark, which blanks the scrcpy mirror and drops the
    # session. Panel-off + stay-awake come from scrcpy's -S -w instead.
    commands = [f"settings put {namespace} {key} {value}" for namespace, key, value in _POWER_SETTINGS]
    commands += [disable_cmd for _, _, disable_cmd, _ in _POWER_RADIOS]
    commands += [f"am force-stop {package}" for package in _MOTO_BLOAT]
    _adb_shell_many(target, commands)

    try:
        with open(POWER_STATE_FILE, "w") as state_file:
            json.dump({"active": True, "target": target, "saved": saved}, state_file, indent=4)
    except Exception as write_error:
        console.print(f"[red]Power saving applied but state file could not be written: {write_error}[/red]")
        console.print("[red]Restore will not be possible automatically.[/red]")
        write_log("POWER", f"State write failed for {target}: {write_error}")
        return

    write_log("POWER", f"Applied power saving on {target}")
    console.print("✔ [bold green]Power saving applied.[/bold green] Run menu option 5 to restore.")
    console.print("[dim]   Disabled: Bluetooth, mobile data; animations off; Moto bloat stopped. Wi-Fi + location left ON.[/dim]")
    console.print("[dim]   Phone screen off + device kept awake/unlocked is handled by scrcpy's -S -w (no fingerprint, no suspend).[/dim]")


def apply_full_power(target):
    """Captures current animation scales, then forces FULL POWER for debugging.

    The inverse of apply_power_saving: writes the three animation scales to 1 (so
    Flutter's MediaQuery.disableAnimations clears and gated animations run), and
    clears battery saver + forced Doze. Radios are left untouched (full power has
    nothing to disable) and the screen is left to scrcpy's -S -w — "except for the
    screen being on" is intentional, this never forces the physical panel on.

    Reuses the SAME state file + generic restore_power_saving path, so menu option
    5 reverses whichever of the two modes was last applied. Restores any prior
    application first so the captured originals are the user's true values, not the
    already-modified ones from a previous run.
    """
    if _power_state_active():
        restore_power_saving(target, announce=False)

    # Capture the originals of exactly the keys we are about to change, so restore
    # puts them back (or deletes them if they had no prior value).
    get_specs = [(namespace, key) for namespace, key, _ in _FULL_POWER_SETTINGS]
    saved = _settings_get_many(target, get_specs)

    # One adb call: animation scales to full, then clear battery saver + Doze. No
    # radio toggles, no screen/stay-awake writes (scrcpy -S -w owns the panel).
    commands = [f"settings put {namespace} {key} {value}" for namespace, key, value in _FULL_POWER_SETTINGS]
    commands += [
        "settings put global low_power 0",
        "dumpsys deviceidle unforce",
        # Fully DISABLE Doze for this power cycle — NOT force it. Doze suspends the
        # background network stack when the device is stationary / screen-off, which
        # silently drops the wireless-adb TCP socket and makes Android re-roll the
        # debug port: the root cause of "the debugger keeps disconnecting" and the
        # repeating Drift Advisor "detected on port 8642" toast on Wi-Fi debugging.
        # This is the ANTI-Doze command — the OPPOSITE of the forced-Doze the file
        # header warns blanks scrcpy — so it keeps the radio alive and never
        # suspends the mirror. It auto-reverts on reboot; restore re-enables it.
        "dumpsys deviceidle disable",
        "dumpsys battery reset",
    ]
    _adb_shell_many(target, commands)

    try:
        with open(POWER_STATE_FILE, "w") as state_file:
            json.dump(
                {"active": True, "target": target, "mode": "full_power", "saved": saved},
                state_file,
                indent=4,
            )
    except Exception as write_error:
        console.print(f"[red]Full power applied but state file could not be written: {write_error}[/red]")
        console.print("[red]Restore will not be possible automatically.[/red]")
        write_log("POWER", f"State write failed for {target}: {write_error}")
        return

    write_log("POWER", f"Applied full power on {target}")
    console.print("✔ [bold green]Full power applied.[/bold green] Run menu option 5 to restore originals.")
    console.print("[dim]   Animations ON (scales=1); battery saver off; Doze DISABLED (keeps Wi-Fi adb alive). Radios + screen untouched.[/dim]")
    console.print("[dim]   Phone screen off + device kept awake/unlocked is still handled by scrcpy's -S -w.[/dim]")


def _restore_command(path, original):
    """Returns the ONE device-shell command that restores a captured setting.

    Radios re-enable unless captured explicitly off ('0') — an unreadable original
    errs toward turning connectivity back ON, never leaving Bluetooth/data
    silently disabled. Returns None when nothing is needed (radio already off).
    """
    radio_enable = {f"{ns}/{key}": enable for ns, key, _, enable in _POWER_RADIOS}
    if path in radio_enable:
        return radio_enable[path] if original != "0" else None

    namespace, key = path.split("/", 1)
    if original is None:
        return f"settings delete {namespace} {key}"
    return f"settings put {namespace} {key} {original}"


def restore_power_saving(target, announce=True):
    """Reverses everything apply_power_saving recorded, then clears the state file."""
    state = _read_power_state()
    if not state or not state.get("active"):
        if announce:
            console.print("[dim]No power-saving state to restore — device unchanged.[/dim]")
        return

    commands = []
    for path, original in state.get("saved", {}).items():
        command = _restore_command(path, original)
        if command:
            commands.append(command)

    # Defensive cleanup: clear framework toggles an EARLIER version of this tool
    # may have set (battery saver via unplug spoof, forced Doze). Harmless no-ops
    # if they were never applied. Radios + captured settings are restored above.
    commands += [
        "settings put global low_power 0",
        "dumpsys deviceidle unforce",
        # Re-enable Doze that apply_full_power disabled, returning the device to
        # normal background power management. Harmless no-op when Doze was never
        # disabled (e.g. restoring after a battery-saving apply).
        "dumpsys deviceidle enable",
        "dumpsys battery reset",
    ]
    # One adb call for the whole restore — no per-command console-window flashes.
    _adb_shell_many(target, commands)

    _clear_power_state()
    write_log("POWER", f"Restored power settings on {target}")
    if announce:
        console.print("✔ [bold green]Device power settings restored to their originals.[/bold green]")
