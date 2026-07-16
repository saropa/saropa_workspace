"""Device hardware health: battery / charging dashboard and network latency.

Reads `dumpsys battery` and derives the actual charge/discharge rate so the
'plugged in but draining' weak-cable case is diagnosed, not just level/temp.
Latency is measured as an average of a short ping burst so a single power-save
wake spike cannot trigger a false 'high latency' warning.
"""

import re
import sys
import platform

from rich.table import Table

from .core import (
    console,
    run_command,
    write_log,
    _adb_shell,
    _adb_shell_many,
    print_ok,
    print_warn,
    print_err,
    print_info,
)


def check_latency(ip_address, samples=10):
    """Pings the device several times and reports the AVERAGE connection quality.

    A SINGLE ping right after `adb connect` is unreliable: it routinely catches
    the Wi-Fi radio waking from power-save during the connection handshake and
    reports a one-off spike (observed: 116ms on a link whose true RTT is ~1ms).
    We send a short burst and judge the AVERAGE (plus worst-case and loss) so a
    transient first-packet spike can no longer trigger a false 'high latency'
    warning.
    """
    is_windows = platform.system().lower() == 'windows'
    with console.status(
        f"[bold cyan]Pinging device {samples}x to measure real latency...[/bold cyan]",
        spinner="dots",
    ):
        param = '-n' if is_windows else '-c'
        ping_output = run_command(f"ping {param} {samples} {ip_address}", show_output=False)

    # Parse EVERY per-reply time rather than the OS summary line — the summary
    # format varies by locale/OS, but 'time=NNms' / 'time<1ms' is stable on
    # both Windows and POSIX.
    if is_windows:
        times = [int(m) for m in re.findall(r"time[=<](\d+)\s*ms", ping_output)]
    else:
        times = [int(float(m)) for m in re.findall(r"time=([\d\.]+)\s*ms", ping_output)]

    if not times:
        console.print("[dim]Could not determine network latency (Ping dropped or blocked).[/dim]")
        write_log("LATENCY", f"No replies parsed from {ip_address}")
        return

    avg = round(sum(times) / len(times))
    worst = max(times)
    loss = max(0, samples - len(times))
    detail = f"avg {avg}ms, max {worst}ms, {loss}/{samples} lost"
    write_log("LATENCY", f"{ip_address}: {detail}")

    # Judge the AVERAGE, not one packet. Loss hurts hot-reload stability more
    # than raw latency, so any drops downgrade the verdict.
    if avg < 50 and loss == 0:
        console.print(f"✔ [bold green]Network Latency: {detail} (Excellent for Hot Reload)[/bold green]")
    elif avg < 100 and loss <= 1:
        console.print(f"⚠ [bold yellow]Network Latency: {detail} (Acceptable, may be slightly laggy)[/bold yellow]")
    else:
        console.print(f"✖ [bold red]Network Latency: {detail} (WARNING: high latency/loss — hot reload may disconnect)[/bold red]")


# BatteryManager.BATTERY_STATUS_* — the integer reported in `dumpsys battery`.
_BATTERY_STATUS = {1: "Unknown", 2: "Charging", 3: "Discharging", 4: "Not charging", 5: "Full"}


def _parse_battery(dump):
    """Pulls the battery fields we care about from `dumpsys battery` output.

    Field names vary across OEMs, so every lookup is best-effort and returns None
    when absent — callers render 'Unknown' or skip rather than crashing. Labels
    are matched exactly (with the trailing colon) so 'current now property' does
    not also catch 'current average property' or 'status property'.
    """
    def grab(label):
        needle = label + ":"
        for raw_line in dump.split('\n'):
            stripped = raw_line.strip()
            if stripped.startswith(needle):
                return stripped.split(":", 1)[1].strip()
        return None

    def as_int(label):
        value = grab(label)
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    temp_raw = as_int("temperature")
    return {
        "ac": grab("AC powered") == "true",
        "usb": grab("USB powered") == "true",
        "wireless": grab("Wireless powered") == "true",
        "dock": grab("Dock powered") == "true",
        "status": as_int("status"),
        "level": as_int("level"),
        "temp_c": (temp_raw / 10.0) if temp_raw is not None else None,
        "voltage_mv": as_int("voltage"),
        # Android convention: positive = current INTO the battery (charging),
        # negative = OUT of the battery (discharging). Confirmed on this device:
        # it read -403700uA while plugged in yet draining.
        "current_now_ua": as_int("current now property"),
        # OEM-specific direct watt reading (Motorola). Often absent.
        "charge_watt": as_int("charge watt"),
    }


def _power_source(battery):
    """Human label for whatever charge source dumpsys reports (or on-battery)."""
    if battery["ac"]:
        return "AC Wall Adapter"
    if battery["usb"]:
        return "USB Cable"
    if battery["wireless"]:
        return "Wireless Charger"
    if battery["dock"]:
        return "Dock"
    return "Discharging (On Battery)"


def _net_power_w(battery):
    """Net battery power in watts = voltage x current_now.

    Positive = the battery is GAINING charge; negative = LOSING it. Derived from
    voltage x current so it works on any device that exposes current_now, not
    just OEMs that report a 'charge watt' field. Returns None if either input is
    missing.
    """
    if battery["voltage_mv"] is None or battery["current_now_ua"] is None:
        return None
    return (battery["voltage_mv"] / 1000.0) * (battery["current_now_ua"] / 1_000_000.0)


def _battery_advisories(battery, net_w):
    """Builds (severity, message) advisories from the parsed battery state.

    severity is 'error' (red), 'warn' (yellow), or 'ok' (green). This is where
    the 'plugged in but draining' / weak-charger diagnosis lives.
    """
    plugged = battery["ac"] or battery["usb"] or battery["wireless"] or battery["dock"]
    advisories = []

    # A full battery legitimately draws ~0W: once it hits 100% the charger stops
    # pushing current and net power settles near zero by design. Without this
    # guard the low-power branch below misreads that 0.0W as a weak charger /
    # worn cable and tells the user to swap a perfectly good setup.
    is_full = battery["status"] == 5 or (battery["level"] is not None and battery["level"] >= 100)
    if plugged and is_full:
        advisories.append((
            "ok",
            "Battery is full (100%) — the charger has stopped delivering current, "
            "so ~0W net is expected, not a sign of a weak charger or cable.",
        ))

    # The headline case: a charge source is connected but the battery is not
    # actually gaining (or is losing) charge. Three independent mechanisms cause
    # "plugged in but draining" during a screen-mirror dev session — diagnose by
    # the OTHER signals, because the cure differs:
    #   1. PC-port power deficit. A PC/laptop USB DATA port caps output at roughly
    #      4.5-7.5W. scrcpy's capture + H.264 encode + transmit alone burns ~5W,
    #      so there is almost nothing left to charge — even a premium 100W cable
    #      into a PC port barely charges. Cure: decouple data from power — keep
    #      the data link (USB or Wi-Fi) but route POWER to a real wall brick.
    #   2. Weak charger / worn or data-only cable. Carries adb+scrcpy fine but
    #      delivers little current. Cure: swap the cable/charger.
    #   3. Thermal throttle (handled by the temp branch below): above ~39-40C the
    #      OS throttles charge to protect the battery regardless of charger power.
    #      Cure: blank the phone panel — scrcpy's -S removes the display heat (see
    #      media.launch_scrcpy) so the fast-charge algorithm re-engages.
    # NOTE: low temperature here (e.g. 33C) plus draining means it is mechanism 1
    # or 2 (charger/cable/port), NOT heat — do not blame thermal when it is cool.
    # Skipped when full: a topped-off battery draws ~0W on purpose.
    if plugged and not is_full and net_w is not None:
        if net_w < 0:
            advisories.append((
                "error",
                f"Plugged in but the battery is DISCHARGING ({net_w:.1f}W net). "
                "The charger/cable cannot supply enough power. Swap to a known-good "
                "USB-C cable and a real wall charger (this phone takes up to 30W) — "
                "a data-only or worn cable still runs adb+scrcpy but barely charges.",
            ))
        elif net_w < 2.0:
            advisories.append((
                "warn",
                f"Charging at only {net_w:.1f}W — well below this phone's ~30W. "
                "Likely a weak charger or a worn/data-only cable. Swap the cable or "
                "use the proper wall charger.",
            ))

    # OEM watt reading reinforces the diagnosis when present and tiny — but only
    # when the battery is not full, since a topped-off battery legitimately
    # reports near-zero input.
    if plugged and not is_full and battery["charge_watt"] is not None and battery["charge_watt"] <= 2:
        advisories.append((
            "warn",
            f"Reported charger input is only {battery['charge_watt']}W (expect 10-30W "
            "on a healthy cable + charger).",
        ))

    # Status text contradicts the plug — surfaces OEM throttling/quirks.
    if plugged and battery["status"] == 3:
        advisories.append((
            "warn",
            "Charging status reads 'Discharging' despite a charger being connected.",
        ))

    # Heat throttles charging above ~40C, compounding slow charging.
    if battery["temp_c"] is not None and battery["temp_c"] >= 40.0:
        advisories.append((
            "warn",
            f"Battery is hot ({battery['temp_c']:.1f}C). Android throttles charging "
            "above ~40C — reduce load (close scrcpy / use USB) or let it cool.",
        ))

    if battery["level"] is not None and battery["level"] <= 20:
        advisories.append(("warn", f"Battery is low ({battery['level']}%)."))

    # All clear: connected and genuinely gaining charge.
    if plugged and net_w is not None and net_w >= 2.0 and not advisories:
        advisories.append(("ok", f"Charging healthily at +{net_w:.1f}W."))

    return advisories


# =============================================================================
# ANIMATION-SCALE AUDIT
# =============================================================================
# The three Settings.Global animation scales. A value of 0 ("Animation off")
# makes the OS report accessibilityFeatures.disableAnimations = true to apps.
# Two independent consequences then hit a Flutter app:
#   1. MediaQuery.disableAnimations becomes true (app-level reduce-motion gates).
#   2. EVERY AnimationController instant-completes — forward()/animateTo() jump
#      straight to the end value in a single frame instead of ticking over their
#      duration. So page transitions, the screen hero / depth entrance, and
#      expand/collapse render with ZERO visible motion, even though the widget
#      code is correct.
# Developers routinely set these to 0 (or .5x) to speed up the UI and then can't
# tell why "animations don't work" on the device — this audit makes the cause
# obvious. animator_duration_scale is the one that drives AnimationController.
_ANIMATION_SCALE_KEYS = {
    "Animator duration scale": "animator_duration_scale",
    "Transition animation scale": "transition_animation_scale",
    "Window animation scale": "window_animation_scale",
}


def _read_animation_scale(target_ip_port, settings_key):
    """Reads one Settings.Global animation scale as a float, or None if unreadable.

    `settings get` prints the literal string "null" when the row was never
    written. On Android an unset scale defaults to 1.0 (animations ON), so "null"
    is treated as 1.0 — NOT as missing or off.
    """
    raw = _adb_shell(target_ip_port, f"settings get global {settings_key}")
    if raw is None:
        return None
    raw = raw.strip().lower()
    if raw in ("", "null"):
        return 1.0  # unset == platform default == on
    try:
        return float(raw)
    except ValueError:
        return None


def check_animation_scales(target_ip_port, *, offer_fix=True):
    """Audits the OS animation duration scales and warns when any is turned OFF.

    A scale of 0 disables animations at the OS level: AnimationControllers
    complete instantly, so in-app motion (page transitions, the hero / depth
    entrance, expand/collapse) shows no movement. This is the most common reason
    "animations don't work" on a dev device despite correct app code. When a
    scale is off, [offer_fix] is set, AND this is an interactive terminal, offers
    to restore all three to 1.0.
    """
    scales = {
        label: _read_animation_scale(target_ip_port, key)
        for label, key in _ANIMATION_SCALE_KEYS.items()
    }

    table = Table(title="Animation Scales (OS)", style="cyan")
    table.add_column("Scale", style="magenta", justify="left")
    table.add_column("Value", style="green", justify="right")
    for label, value in scales.items():
        if value is None:
            shown = "Unknown"
        elif value == 0:
            shown = "OFF (0)"
        else:
            shown = f"{value:g}x"
        table.add_row(label, shown)
    console.print("")
    console.print(table)

    write_log(
        "ANIM",
        f"{target_ip_port}: "
        + ", ".join(f"{_ANIMATION_SCALE_KEYS[label]}={scales[label]}" for label in scales),
    )

    known = [value for value in scales.values() if value is not None]
    if not known:
        print_warn("Could not read animation scales (device offline or settings blocked).")
        return

    disabled = [label for label, value in scales.items() if value == 0]
    if not disabled:
        print_ok(
            "Animations are ON — page transitions, the hero / depth entrance, and "
            "expand/collapse will animate normally."
        )
        return

    # At least one scale is off → animations are disabled at the OS level.
    print_err(
        "Animations are DISABLED at the OS level (" + ", ".join(disabled) + " = 0). "
        "Every AnimationController completes instantly, so in-app motion — page "
        "transitions, the screen hero / depth entrance, expand/collapse — shows NO "
        "movement, even when the app code is correct."
    )
    print_info(
        "Fix on the device: Developer options → set Window / Transition / Animator "
        "duration scale all to 1x (animator_duration_scale is the one that drives "
        "AnimationController). Or run:"
    )
    for key in _ANIMATION_SCALE_KEYS.values():
        print_info(f"  adb -s {target_ip_port} shell settings put global {key} 1.0")

    # Only prompt at a real terminal — express / piped runs must not block here.
    if offer_fix and sys.stdin is not None and sys.stdin.isatty():
        answer = (
            console.input("[bold cyan]Restore all animation scales to 1.0 now? [y/N]: [/bold cyan]")
            .strip()
            .lower()
        )
        if answer == "y":
            _adb_shell_many(
                target_ip_port,
                [f"settings put global {key} 1.0" for key in _ANIMATION_SCALE_KEYS.values()],
            )
            print_ok(
                "Set Window / Transition / Animator duration scale to 1.0. "
                "Relaunch the app to see animations."
            )
            write_log("ANIM", f"{target_ip_port}: restored all animation scales to 1.0")


def show_device_health(target_ip_port):
    """Renders battery + charging health from `dumpsys battery` and warns on issues.

    Beyond level/temp/source, this surfaces the actual charge/discharge rate
    (derived from voltage x current) and prints recommendations when the device
    is plugged in but not charging effectively — the weak-cable/charger case that
    drains the battery even on AC.
    """
    with console.status("[bold cyan]Fetching device hardware health...[/bold cyan]", spinner="bouncingBar"):
        battery_out = run_command(f"adb -s {target_ip_port} shell dumpsys battery", show_output=False)

    battery = _parse_battery(battery_out)
    net_w = _net_power_w(battery)

    level = f"{battery['level']}%" if battery["level"] is not None else "Unknown"
    temp = f"{battery['temp_c']:.1f}°C" if battery["temp_c"] is not None else "Unknown"
    voltage = f"{battery['voltage_mv'] / 1000.0:.2f}V" if battery["voltage_mv"] is not None else "Unknown"
    status = _BATTERY_STATUS.get(battery["status"], "Unknown")

    if net_w is None:
        net_str = "Unknown"
    elif net_w >= 0:
        net_str = f"+{net_w:.1f}W (charging)"
    else:
        net_str = f"{net_w:.1f}W (discharging)"

    table = Table(title="Device Health Dashboard", style="cyan")
    table.add_column("Metric", style="magenta", justify="left")
    table.add_column("Status", style="green", justify="right")
    table.add_row("Battery Level", level)
    table.add_row("Temperature", temp)
    table.add_row("Voltage", voltage)
    table.add_row("Power Source", _power_source(battery))
    table.add_row("Charging Status", status)
    table.add_row("Net Power", net_str)
    if battery["charge_watt"] is not None:
        table.add_row("Charger Input", f"{battery['charge_watt']}W")

    console.print("")
    console.print(table)
    write_log(
        "HEALTH",
        f"{target_ip_port}: level={level} temp={temp} src={_power_source(battery)} "
        f"status={status} net={net_str}",
    )

    # Recommendations / warnings below the table.
    advisories = _battery_advisories(battery, net_w)
    style_by_severity = {
        "error": ("✖", "bold red"),
        "warn": ("⚠", "bold yellow"),
        "ok": ("✔", "bold green"),
    }
    for severity, message in advisories:
        icon, style = style_by_severity[severity]
        console.print(f"{icon} [{style}]{message}[/{style}]")

    # Animation-scale audit: surfaces the "animations off at the OS level" case
    # that makes every in-app AnimationController (page/hero/depth/expand) render
    # with zero motion — a frequent dev-device gotcha unrelated to battery.
    check_animation_scales(target_ip_port)
