"""Connection pipeline, menu handlers, and the interactive menu.

Ties the other modules together: resolve a target (discovery) → `adb connect` →
optionally apply power saving (power) → run the post-connect suite (health +
media). Also hosts the wired USB paths and the top-level menu.
"""

import os
import time

from rich.panel import Panel
from rich.table import Table
from rich.prompt import Prompt, IntPrompt

from .core import (
    console,
    write_log,
    run_command,
    save_config,
    load_config,
    send_os_notification,
    validate_ip_port,
    require_adb,
    get_scrcpy_outcome,
)
from .discovery import (
    resolve_connect_target,
    scan_for_devices,
    resolve_usb_target,
    list_usb_devices,
    device_wifi_ip,
)
from .power import (
    apply_power_saving,
    apply_full_power,
    restore_power_saving,
    _power_state_active,
)
from .health import check_latency, show_device_health
from .media import (
    launch_scrcpy,
    start_logcat_stream,
    prompt_scrcpy,
    launch_filtered_logcat,
)


def check_flutter():
    with console.status("[bold yellow]Syncing ADB with Flutter daemon...[/bold yellow]", spinner="aesthetic"):
        time.sleep(3)

    with console.status("[bold yellow]Analyzing Flutter targets...[/bold yellow]", spinner="point"):
        flutter_out = run_command("flutter devices", show_output=False)

    # We ignore specific environment tags instead of generic names.
    ignored_tags = ["(desktop)", "(web)"]
    valid_devices = []

    # Loop through the raw terminal output line by line
    for line in flutter_out.split('\n'):
        # Check for both the proper unicode bullet point AND the mangled Windows encoding string
        if "•" in line or "â€¢" in line:

            # FIXED: We must explicitly define 'line_lower' by converting the current line
            # to lowercase. This prevents the NameError from crashing the list comprehension below!
            line_lower = line.lower()

            # Now we can safely iterate through our ignored tags array.
            # If none of the ignored tags exist inside our lowercase string, it's a mobile device!
            if not any(tag in line_lower for tag in [t.lower() for t in ignored_tags]):
                # Strip leading/trailing whitespaces and add to our verified collection
                valid_devices.append(line.strip())

    if valid_devices:
        console.print("\n✔ [bold green]Flutter recognizes your mobile device(s):[/bold green]")
        for d in valid_devices:
            console.print(f"  [cyan]{d}[/cyan]")

        # Flutter seeing the device only means 'flutter run' will work — it says
        # nothing about scrcpy. A prior 'Ready!' banner printed here unconditionally,
        # even on a run where scrcpy detected a headless zombie and gave up, so the
        # summary read as full success when mirroring had actually failed.
        if get_scrcpy_outcome() is False:
            console.print(
                "\n[bold yellow]⚠ Flutter is ready ('flutter run' will work), but screen "
                "mirroring did NOT start this run — see the scrcpy failure above.[/bold yellow]"
            )
        else:
            console.print("\n[bold green]=== Ready! Run 'flutter run' ===[/bold green]")
        write_log("ANALYSIS", "Mobile device recognized by Flutter.")
    else:
        console.print("\n✖ [bold red]Flutter does not see any mobile devices.[/bold red]")
        write_log("ANALYSIS", "No mobile targets found by Flutter.")
        console.print("\n[dim]Raw output from 'flutter devices' for debugging:[/dim]")
        console.print(f"[dim]{flutter_out}[/dim]")

    from .core import log_path
    console.print(f"\n[bold cyan]Full log saved to:[/bold cyan] {log_path}")


def check_adb_state(target_ip):
    devices_out = run_command("adb devices", show_output=False)
    for line in devices_out.split("\n"):
        if target_ip in line:
            if "unauthorized" in line:
                return "unauthorized"
            if "offline" in line:
                return "offline"
            if "device" in line:
                return "authorized"
    return "missing"


def establish_connection(ip_and_port):
    """Runs `adb connect` and returns the resulting adb state string.

    One of: 'authorized', 'unauthorized', 'offline', 'missing'.
    """
    with console.status(f"[bold cyan]Connecting to {ip_and_port}...[/bold cyan]", spinner="arc"):
        connect_output = run_command(f"adb connect {ip_and_port}", show_output=False)
        time.sleep(1.5)
    write_log("CONNECT", f"{ip_and_port}: {connect_output}")
    return check_adb_state(ip_and_port.split(":")[0])


def run_post_connect_suite(ip_and_port, auto=False, with_logcat=False):
    """Everything after a successful connect: notify, latency, health, mirror, logs.

    auto=True (express): scrcpy launches without asking. with_logcat then decides
    the logging behavior:
      - with_logcat=False (battery-friendly default): no logcat stream; print a
        one-line hint showing how to tail logs manually without blocking.
      - with_logcat=True: stream logcat directly (no prompt). This keeps the
        device pushing logs over Wi-Fi continuously — a small extra drain, which
        is exactly why no-logging is the default express path.
    auto=False (interactive): scrcpy and logcat are each offered via y/N prompts.
    """
    # A USB transport's "serial" is the hardware serial (no colon), not an
    # IP:PORT. Latency-pinging it is meaningless (there is no network endpoint),
    # and it must NOT be saved as last_ip_port — the express resolver expects an
    # IP:PORT there, so a serial would poison that path.
    is_usb = not validate_ip_port(ip_and_port)

    if is_usb:
        console.print(f"✔ Connected over USB to {ip_and_port}!", style="bold green")
        send_os_notification("Flutter USB Connected", f"Ready to debug on {ip_and_port}")
    else:
        ip_only = ip_and_port.split(":")[0]
        console.print(f"✔ Successfully connected and authorized to {ip_and_port}!", style="bold green")
        save_config("last_ip_port", ip_and_port)
        send_os_notification("Flutter Wi-Fi Connected", f"Ready to debug on {ip_and_port}")
        check_latency(ip_only)

    show_device_health(ip_and_port)

    if auto:
        # Turn the phone panel off (-S) for the real power saving, AND keep the
        # device awake with -w so it neither suspends nor locks over Wi-Fi (see
        # launch_scrcpy). -w keeps the device interactive, so the keyguard never
        # engages — no fingerprint prompt despite the dark screen.
        launch_scrcpy(ip_and_port, keep_screen_on=False, stay_awake=True)
        if with_logcat:
            start_logcat_stream(ip_and_port)
        else:
            console.print(
                f"[dim]To watch logs: adb -s {ip_and_port} logcat -v color Flutter:V Dart:V *:S[/dim]"
            )
    else:
        prompt_scrcpy(ip_and_port)
        launch_filtered_logcat(ip_and_port)


def connect_and_setup(config, auto, with_logcat=False, full_power=False):
    """Shared connect pipeline: resolve target -> adb connect -> [full power] -> suite.

    Express (auto=True) auto-detects the transport: if a USB cable is actually
    attached it uses the wired device — immune to the two Wireless-Debugging
    failure modes (the connect port re-rolls every restart, and the link flaps in
    Doze, which drops the VM-service debug session AND re-fires the Drift Advisor
    "detected on port 8642" toast on every recovery). With NO cable plugged in it
    falls straight through to the existing wireless resolve+connect UNCHANGED, so
    a wireless-only run behaves exactly as before. Interactive paths (auto=False)
    chose wireless from the menu explicitly and are never redirected to USB.
    """
    # Express transport auto-detect: prefer a plugged-in cable over wireless, but
    # ONLY when one is genuinely present — `list_usb_devices()` is empty on a
    # wireless-only run, so this whole block is a no-op and the wireless path runs.
    # Wired skips `adb connect` (adbd already listens on the cable) and has no
    # IP:PORT to probe, so it hands the serial straight to the post-connect suite.
    if auto and list_usb_devices():
        serial = resolve_usb_target()
        if serial:
            console.print(
                f"✔ [bold green]USB cable detected — using wired device {serial}.[/bold green] "
                "[dim](Most reliable: no wireless port re-roll, no Doze flap. "
                "Unplug the cable to use Wi-Fi.)[/dim]"
            )
            write_log("USB", f"Express auto-selected wired transport {serial}")
            # Full power BEFORE the suite, same ordering as the wireless branch
            # below, so animation scales are restored before scrcpy mirrors.
            if full_power:
                apply_full_power(serial)
            run_post_connect_suite(serial, auto=True, with_logcat=with_logcat)
            return

    ip_and_port = resolve_connect_target(config, auto=auto)
    if not ip_and_port:
        if auto:
            console.print("[yellow]No device resolved — nothing to connect to.[/yellow]")
        return

    state = establish_connection(ip_and_port)
    if state == "authorized":
        # Apply FULL POWER BEFORE the post-connect suite so animation scales are
        # back to 1 (clearing Flutter's reduce-motion gate) and battery saver/Doze
        # are off by the time scrcpy launches. Screen-off + stay-awake still come
        # from scrcpy's -S -w, not from here — full power never forces the panel on.
        if full_power:
            apply_full_power(ip_and_port)
        run_post_connect_suite(ip_and_port, auto=auto, with_logcat=with_logcat)
    elif state == "unauthorized":
        console.print("✖ [bold red]Device connected but UNAUTHORIZED.[/bold red]")
        console.print("You must [bold]Pair[/bold] the device first (menu option 2).")
        run_command(f"adb disconnect {ip_and_port}", show_output=False)
    else:
        console.print(f"✖ [bold red]Connection failed or device offline (state: {state}).[/bold red]")


def handle_android_11_plus(config):
    """Interactive Android 11+ connect (discovery + manual entry, asks per step)."""
    console.print("\n[bold cyan]--- Android 11+ (Native Wireless Debugging) ---[/bold cyan]")
    connect_and_setup(config, auto=False)


def run_express(config, with_logcat=False, full_power=False):
    """Zero-prompt 'just run everything' path.

    Resolves the saved/discovered device, connects, optionally forces full power,
    then sets up notify + latency + health + screen mirror — no input needed on a
    known device. Falls back to prompts only when it cannot find one.

    with_logcat=False (default) skips the live log stream to minimize drain;
    full_power=True (menu option 0) restores animation scales + clears battery
    saver before mirroring, so on-device animations run during debugging.
    """
    mode = "with live logging" if with_logcat else "no logging"
    if full_power:
        mode += " + full power"
    console.print(f"\n[bold cyan]--- Express: connect + mirror + status ({mode}) ---[/bold cyan]")
    connect_and_setup(config, auto=True, with_logcat=with_logcat, full_power=full_power)


def handle_pairing(config):
    """First-time pairing for Android 11+ wireless debugging.

    Pairing and connecting are two SEPARATE steps on two SEPARATE ports: the
    pairing port is short-lived (only live while the device's 'Pair device with
    pairing code' dialog is open) and is consumed once. After a successful pair,
    the persistent CONNECT port is a different number, so we hand straight off to
    the normal connect flow (which auto-discovers / scans for that live port).
    """
    console.print("\n[bold cyan]--- Pair New Device (Android 11+ Wireless Debugging) ---[/bold cyan]")
    console.print(
        "[dim]On the device: Settings → Developer options → Wireless debugging →\n"
        "  'Pair device with pairing code'. It shows an IP:PORT and a 6-digit code.[/dim]"
    )

    # 1. Auto-discover the pairing service — a different mDNS type AND port from
    #    connect. Only advertised while the pairing dialog is open on the device.
    discovered = scan_for_devices(service_type="_adb-tls-pairing._tcp.local.")
    pair_target = ""

    if discovered:
        console.print(f"✔ [bold green]Found a device in pairing mode:[/bold green] {discovered[0]}")
        if Prompt.ask("Pair with this device?", choices=["y", "n"], default="y") == "y":
            pair_target = discovered[0]

    # 2. Manual fallback — the PAIRING IP:PORT (shown under the pairing code),
    #    not the connect port.
    if not pair_target:
        while True:
            pair_target = Prompt.ask(
                "\n[bold magenta]Enter the PAIRING IP:PORT[/bold magenta] "
                "(shown under the pairing code) or press Enter to skip"
            ).strip()
            if not pair_target:
                return
            if validate_ip_port(pair_target):
                break
            console.print("✖ [bold red]Invalid format.[/bold red] Needs IP and Port separated by colon.")

    # 3. The 6-digit code shown on the device.
    code = Prompt.ask("[bold magenta]Enter the 6-digit pairing code[/bold magenta]").strip()
    if not code:
        console.print("[dim]No code entered — pairing aborted.[/dim]")
        return

    # 4. Pair NON-interactively: passing the code as a CLI arg avoids adb's own
    #    interactive "Enter pairing code:" prompt, which would block this script
    #    waiting on a child process we can't feed input to cleanly.
    with console.status(f"[bold cyan]Pairing with {pair_target}...[/bold cyan]", spinner="arc"):
        pair_output = run_command(f"adb pair {pair_target} {code}", show_output=False)

    # adb prints "Successfully paired to <ip:port> [guid=...]" on success.
    if "successfully paired" in pair_output.lower():
        console.print(f"✔ [bold green]Successfully paired with {pair_target}![/bold green]")
        write_log("PAIR", f"Paired {pair_target}")
        console.print(
            "[dim]Paired. The CONNECT port differs from the pairing port — "
            "continuing to connect...[/dim]"
        )
        # Hand off to the connect flow for the (different) live connect port.
        handle_android_11_plus(config)
    else:
        console.print(f"✖ [bold red]Pairing failed:[/bold red] {pair_output}")
        write_log("PAIR", f"Pairing failed {pair_target}: {pair_output}")


def handle_wired_usb(config):
    """Menu path: debug over a USB cable — no Wi-Fi, no port, no pairing.

    The most reliable transport, immune to the wireless-debugging toggle turning
    itself off and to Android re-rolling the debug port. Resolves the USB device
    and runs the normal post-connect suite (health + scrcpy + log hint) against
    its serial; latency/ping is skipped automatically (a serial has no IP).
    """
    console.print("\n[bold cyan]--- Wired USB Debugging (most reliable) ---[/bold cyan]")
    target = resolve_usb_target()
    if not target:
        return

    console.print(f"✔ [bold green]Using USB device {target}.[/bold green]")
    write_log("USB", f"Wired session on {target}")
    run_post_connect_suite(target, auto=True)


def handle_wireless_via_usb(config):
    """Menu path: arm wireless debugging on the FIXED legacy port 5555 over USB.

    Bypasses Android 11+ Wireless Debugging entirely: `adb tcpip 5555` restarts
    adbd in plain TCP mode on the legacy fixed port, which does NOT re-roll on
    reconnect and needs no pairing — the durable answer to 'a port is never
    assigned'. A cable is needed ONCE to issue the command; port 5555 then
    survives sleep and reconnects until the phone REBOOTS (re-run this after a
    reboot). The phone must be on the same Wi-Fi for the follow-on connect.
    """
    console.print("\n[bold cyan]--- Wireless via USB (fixed port 5555) ---[/bold cyan]")
    console.print(
        "[dim]Needs a USB cable once to arm it; the fixed port 5555 then survives "
        "sleep/reconnect (resets only on a phone reboot — re-run this after a "
        "reboot).[/dim]"
    )
    serial = resolve_usb_target()
    if not serial:
        return

    ip_address = device_wifi_ip(serial)
    if not ip_address:
        console.print(
            "✖ [bold red]Could not read the phone's Wi-Fi IP over USB.[/bold red] "
            "Connect the phone to the same Wi-Fi network and retry."
        )
        write_log("TCPIP", f"No wlan0 IP for {serial}")
        return

    # Restart adbd in TCP mode on the fixed port. This drops the USB transport
    # and re-exposes the same daemon over the network on 5555.
    with console.status(f"[bold cyan]Arming TCP/IP mode on {serial}...[/bold cyan]", spinner="arc"):
        tcpip_out = run_command(f"adb -s {serial} tcpip 5555", show_output=False)
        time.sleep(1.5)
    write_log("TCPIP", f"{serial} -> {ip_address}:5555: {tcpip_out}")

    target = f"{ip_address}:5555"
    console.print(f"[dim]adbd restarted in TCP mode — connecting to {target}[/dim]")
    console.print("[bold yellow]You can unplug the USB cable now.[/bold yellow]")

    state = establish_connection(target)
    if state == "authorized":
        save_config("last_ip_port", target)
        run_post_connect_suite(target, auto=True)
    else:
        console.print(
            f"✖ [bold red]Wireless connect to {target} failed (state: {state}).[/bold red] "
            "Keep the cable in and retry, or check the phone is on this Wi-Fi."
        )


def handle_power_saving(config):
    """Menu path: connect to the device, then TOGGLE power saving.

    First run applies (and captures originals); the next run restores. The toggle
    decision is driven entirely by whether a state file is active, so 'apply' and
    'restore' are the same menu choice — exactly the run/re-run behavior wanted.
    """
    console.print("\n[bold cyan]--- Device Power Saving (apply / restore toggle) ---[/bold cyan]")
    target = resolve_connect_target(config, auto=True)
    if not target:
        console.print("[yellow]No device resolved — cannot change power settings.[/yellow]")
        return

    state = establish_connection(target)
    if state != "authorized":
        console.print(f"✖ [bold red]Device not authorized (state: {state}); cannot change power settings.[/bold red]")
        return

    save_config("last_ip_port", target)
    if _power_state_active():
        restore_power_saving(target)
    else:
        apply_power_saving(target)


def handle_device_health(config):
    """Menu path: connect to the device and ONLY report its hardware health.

    A deliberately minimal path — no scrcpy mirror, no logcat, no power-saving
    toggle, no Flutter daemon sync. Resolve the saved/discovered device, connect,
    print the battery/charging/power dashboard, and stop. This is the quick
    'is the phone OK / charging / how warm' check without spinning up a full
    debug session.
    """
    console.print("\n[bold cyan]--- Device Health Check (battery / charging / power) ---[/bold cyan]")
    target = resolve_connect_target(config, auto=True)
    if not target:
        console.print("[yellow]No device resolved — cannot read device health.[/yellow]")
        return

    state = establish_connection(target)
    if state != "authorized":
        console.print(f"✖ [bold red]Device not authorized (state: {state}); cannot read device health.[/bold red]")
        return

    save_config("last_ip_port", target)
    # Confirm connectivity quality alongside the hardware health so a single
    # check answers both "is it reachable" and "is it OK".
    check_latency(target.split(":")[0])
    show_device_health(target)


# Menu rows: (key, slug, title, hint, accent-style). `key` is the interactive
# IntPrompt digit — it CAN shift if the menu is reordered/renumbered. `slug` is
# the stable identifier for the --action CLI flag: it is never derived from
# `key` or list position, so renumbering the menu (e.g. inserting a new option)
# never breaks a saved 'debug_connect.py --action express' command line.
_MENU_ROWS = [
    ("0", "express", "Express", "auto-config + full power, NO logging — USB if cabled, else Wi-Fi (default)", "bold green"),
    ("1", "express-log", "Express + logging", "auto-config, live logcat stream — USB if cabled, else Wi-Fi", "green"),
    ("2", "pair", "Pair new device", "Android 11+ pairing code (first time)", "cyan"),
    ("3", "connect", "Connect Android 11+", "interactive mDNS discovery", "cyan"),
    ("4", "status", "Connection status", "check adb + Flutter sync", "cyan"),
    ("5", "power", "Power saving", "apply / restore toggle", "magenta"),
    ("6", "health", "Device health", "battery, charging, temperature", "magenta"),
    ("7", "usb", "Wired USB", "connect over a cable — most reliable, no port/pairing", "bold yellow"),
    ("8", "usb-wireless", "Wireless via USB", "arm fixed port 5555 over a cable, then go wireless", "yellow"),
]

# Stable slug -> menu key mapping, exported for the CLI launcher (debug_connect.py)
# so 'python debug_connect.py --action <slug>' resolves through the slug, never a
# raw digit that could point at a different option after the menu changes.
MENU_ACTIONS = {slug: key for key, slug, _, _, _ in _MENU_ROWS}


def _render_menu():
    """Renders the action menu as a bordered, grouped table (keys + hints).

    Replaces the former flat list of print() lines: the table aligns the keys,
    color-codes each transport group, and frames the choices so the menu reads as
    one scannable block instead of nine loose lines. The `5` row's label reflects
    whether the next run will APPLY or RESTORE power saving.
    """
    table = Table.grid(padding=(0, 2))
    table.add_column(justify="right", no_wrap=True)
    table.add_column(no_wrap=True)
    table.add_column(style="dim")
    for key, _slug, title, hint, accent in _MENU_ROWS:
        # The power-saving row's hint flips with the current state file.
        if key == "5":
            hint = "RESTORE originals" if _power_state_active() else "APPLY (disable non-essentials)"
        table.add_row(f"[{accent}]{key}[/{accent}]", f"[{accent}]{title}[/{accent}]", hint)
    console.print(Panel(table, title="[bold]Select Action[/bold]", border_style="cyan", expand=False))


def main(action=None):
    """Runs the menu once. `action`, when given, is a resolved menu KEY
    ('0'-'8') — the CLI launcher resolves the stable --action slug (see
    MENU_ACTIONS) to a key before calling this. Skips the interactive
    IntPrompt for non-interactive invocation. An invalid key falls back to
    the interactive prompt so a typo doesn't silently no-op the run.
    """
    write_log("START", "Initializing Flutter Device Debug Assistant")
    console.print(
        Panel.fit(
            "[bold cyan]Flutter Device Debug Assistant[/bold cyan]\n"
            "[dim]Wi-Fi · Wired USB · fixed-port bridge — for Flutter on-device debugging[/dim]",
            border_style="cyan",
        )
    )

    # Pre-flight: every menu action shells out to adb. Fail fast with one clear
    # message instead of a cascade of empty outputs three steps later.
    if not require_adb():
        return

    config = load_config()

    # adb has a built-in mDNS AUTO-connect that connects to every
    # _adb-tls-connect service it discovers — separate from this script's own
    # zeroconf discovery + explicit `adb connect`. Left on, it registers the
    # device under its mDNS service NAME (plus a duplicate "(N)" entry each time
    # the service re-advertises after a reconnect) IN ADDITION to the explicit
    # IP:PORT transport this script creates, so the same phone appears three+
    # times in Flutter's device picker. Disabling it leaves the IP:PORT this
    # script connects as the ONLY transport — one clean entry. The persistent adb
    # daemon inherits this env at spawn, so it MUST be set before start-server.
    os.environ["ADB_MDNS_AUTO_CONNECT"] = "0"

    with console.status("[dim]Resetting ADB server to clear ghost connections...[/dim]", spinner="dots2"):
        run_command("adb kill-server", show_output=False)
        run_command("adb start-server", show_output=False)

    # Grouped, bordered menu (see _render_menu). Option 0 (Express) forces FULL
    # POWER — animation scales back to 1 so the app's reduce-motion gate clears and
    # animations run on-device. The option-5 power-saving row's label reflects
    # whether the next run will apply or restore (it reverses whichever mode is
    # active). Screen-off + stay-awake come from scrcpy's -S -w, not these settings.
    console.print()
    _render_menu()

    valid_keys = [key for key, _slug, _title, _hint, _accent in _MENU_ROWS]
    if action is not None and action in valid_keys:
        choice = int(action)
        console.print(f"\n[dim]Auto-selected via command line: {choice}[/dim]")
    else:
        if action is not None:
            console.print(f"[bold yellow]Ignoring invalid action '{action}' — falling back to the prompt.[/bold yellow]")
        # Express (no logging) is the default: press Enter and it connects +
        # mirrors + verifies the saved/discovered device with no further input.
        # Option 1 is the same auto-config but also streams logcat (which keeps
        # the device radio active — a small extra battery drain, hence off by
        # default).
        choice = IntPrompt.ask(
            "\nEnter choice",
            choices=valid_keys,
            default=0,
        )

    if choice == 0:
        run_express(config, with_logcat=False, full_power=True)
    elif choice == 1:
        run_express(config, with_logcat=True)
    elif choice == 2:
        handle_pairing(config)
    elif choice == 3:
        handle_android_11_plus(config)
    elif choice == 5:
        handle_power_saving(config)
    elif choice == 6:
        handle_device_health(config)
    elif choice == 7:
        handle_wired_usb(config)
    elif choice == 8:
        handle_wireless_via_usb(config)

    # Options 5 and 6 are one-shot device actions (power toggle / health read) —
    # no Flutter device sync to report afterward, so skip the 3s daemon-sync +
    # `flutter devices` for both.
    if choice not in (5, 6):
        check_flutter()
