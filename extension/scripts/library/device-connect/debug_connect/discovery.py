"""Target resolution: mDNS discovery, port-scan recovery, and USB discovery.

Android re-rolls the wireless-debug connect port on every restart, so a saved
port goes stale constantly. This module resolves the live target three ways —
the saved device (if its port is still open), mDNS auto-discovery, or a full TCP
port scan to recover the rerolled port — and also enumerates USB-attached
devices for the wired paths.
"""

import time
import socket
import platform
from concurrent.futures import ThreadPoolExecutor

from rich.prompt import Prompt, IntPrompt
from zeroconf import ServiceBrowser, Zeroconf, ServiceListener

from .core import (
    console,
    write_log,
    run_command,
    validate_ip_port,
    validate_ip_only,
    test_tcp_connectable,
    make_scan_progress,
    print_ok,
    print_err,
    print_info,
    _adb_shell,
)
import re


class ADBListener(ServiceListener):
    """Callback for Zeroconf mDNS network scanning."""
    def __init__(self):
        self.discovered_devices = []

    def add_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        info = zc.get_service_info(type_, name)
        if info and info.parsed_addresses():
            ip_address = info.parsed_addresses()[0]
            port = info.port
            target = f"{ip_address}:{port}"
            self.discovered_devices.append(target)


def scan_for_devices(service_type="_adb-tls-connect._tcp.local."):
    """
    Listens on the network to auto-discover Android 11+ debug ports.

    Uses the zeroconf library to continuously look for incoming network packets
    broadcasted by your phone. We safe-guarded the spinner here by changing it
    from 'radar' (which throws a KeyError) to 'earth' (which is natively supported).

    `service_type` selects WHICH advertisement to listen for. Android announces
    two distinct services on two distinct ports: '_adb-tls-connect._tcp.local.'
    (the persistent connect port, default) and '_adb-tls-pairing._tcp.local.'
    (a short-lived pairing port, advertised only while the device's pairing
    dialog is open). Pairing must scan for the latter.
    """
    # Instantiate the wrapper library that talks directly to the local network sockets
    zeroconf = Zeroconf()

    # Instantiate our custom listener instance that stores discovered device endpoints
    listener = ADBListener()

    # FIXED: Replaced 'radar' with 'earth' to avoid KeyError exceptions!
    # This renders a rotating globe icon while the socket listens for data packets.
    with console.status("[bold cyan]Scanning Wi-Fi for Android devices via mDNS...[/bold cyan]", spinner="earth"):

        # Open up a background worker thread that monitors the network socket for 4 seconds
        browser = ServiceBrowser(zeroconf, service_type, listener)

        # Give the network card exactly 4 seconds to catch and parse inbound device packets
        time.sleep(4)

        # Close the network listeners and cleanly unbind from system resources so the script doesn't leak memory
        zeroconf.close()

    # Return the clean array of string targets (e.g., ['192.168.1.50:43211']) back to the main flow
    return listener.discovered_devices


def host_is_up(host_ip):
    """One quick ping to distinguish 'device left the network' from 'port moved'.

    A refused TCP probe alone can't tell those apart: Android rerolls the
    wireless-debug port on every restart, so a refused port on a host that still
    answers ping means the port moved, not that the device is gone. Returns True
    when the host replies (TTL present in ping output on both Windows and POSIX).
    """
    param = "-n" if platform.system().lower() == "windows" else "-c"
    out = run_command(f"ping {param} 1 {host_ip}", show_output=False)
    return "ttl=" in out.lower()


def scan_for_open_ports(host_ip, timeout=0.4, workers=500):
    """Full TCP sweep of a host to recover Android's rerolled wireless-debug port.

    Android assigns a NEW random high port to wireless debugging every time it
    restarts, so the saved/mDNS-advertised port is refused constantly even while
    the phone sits on the same Wi-Fi. Scanning is the reliable recovery. Threaded
    so a full 1-65535 sweep finishes quickly; returns the sorted open-port list.

    A live progress bar advances once per probed port (consumed via the ordered
    `pool.map` generator from the main thread, so no shared-counter locking is
    needed) — a 65k-port sweep is otherwise an opaque multi-second pause.
    """
    open_ports = []

    def probe(port):
        # Return the port on success / None otherwise so the main thread can both
        # collect hits AND advance the bar as each result is yielded. Advancing
        # from inside the worker would need a lock; yielding back does not.
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        try:
            return port if sock.connect_ex((host_ip, port)) == 0 else None
        except OSError:
            return None
        finally:
            sock.close()

    total_ports = 65535
    with make_scan_progress() as progress:
        task = progress.add_task(f"Scanning {host_ip}", total=total_ports)
        with ThreadPoolExecutor(max_workers=workers) as pool:
            # pool.map yields results in submission order as workers finish; we
            # advance the bar per yielded result for a smooth, accurate sweep.
            for result in pool.map(probe, range(1, total_ports + 1)):
                if result is not None:
                    open_ports.append(result)
                progress.advance(task)

    return sorted(open_ports)


def recover_target_via_scan(host_ip, auto=False):
    """When a probe is refused but the host is up, scan for the live debug port.

    Returns a new IP:PORT to connect to, or None if the host is off-network, no
    open ports are found, or the user declines. This is the recovery path for the
    rotating-port problem — instead of dead-ending on a stale port, we find the
    port the device actually moved to.

    auto=True (express path): skip the "Scan?" confirm AND the multi-port picker.
    Android's wireless-debug connect port is the rerolled high port, so in a
    zero-input run we scan unconditionally and take the highest open port. This is
    what turns a stale saved port into a successful express connect with no manual
    IP:PORT entry — the exact failure that previously forced a hand-typed port
    (saved 37993 was dead, the live port had rerolled to 43299).
    """
    if not host_is_up(host_ip):
        print_info(f"Host {host_ip} did not answer ping — device likely off-network.")
        return None

    # Interactive paths confirm before a full-range scan; the express path scans
    # unconditionally (no prompt) so it stays zero-input.
    if not auto:
        prompt = (
            f"Host [cyan]{host_ip}[/cyan] is up but the port was refused "
            f"(Android rerolls the debug port). Scan for the live port?"
        )
        if Prompt.ask(prompt, choices=["y", "n"], default="y") != "y":
            return None

    # scan_for_open_ports renders its OWN progress bar (a determinate sweep), so
    # it is NOT wrapped in a console.status spinner — two live rich displays at
    # once corrupt the terminal.
    open_ports = scan_for_open_ports(host_ip)
    write_log("SCAN", f"{host_ip} open ports: {open_ports}")

    if not open_ports:
        print_err(
            f"No open ports on {host_ip}. "
            "Enable wireless debugging on the device, then retry."
        )
        return None

    # A single open port is almost always the debug port — use it directly.
    # With several open, the highest is the most likely random debug port: the
    # express path takes it without a picker; interactive paths offer it as the
    # default while letting the user pick another.
    if len(open_ports) == 1:
        chosen = open_ports[0]
    elif auto:
        chosen = open_ports[-1]
    else:
        console.print(
            f"Open ports on {host_ip}: "
            f"[cyan]{', '.join(str(p) for p in open_ports)}[/cyan]"
        )
        chosen = IntPrompt.ask(
            "Which port is the wireless-debug port?", default=open_ports[-1]
        )

    print_ok(f"Using {host_ip}:{chosen}")
    return f"{host_ip}:{chosen}"


def resolve_connect_target(config, auto=False):
    """Figures out the CONNECT IP:PORT, reachability-probing as it goes.

    Resolution order:
      1. (auto only) the SAVED last connection, used immediately if its port is
         still open — this is what makes the express path zero-prompt.
      2. mDNS auto-discovery of a broadcasting device.
      3. Manual IP:PORT entry (the fallback when 1 and 2 find nothing).
    On a refused port whose host still pings, scan for Android's rerolled
    wireless-debug port instead of dead-ending. Returns IP:PORT or None.

    There is intentionally NO post-probe "Connect?" confirm — selecting the
    discovered device or typing the IP:PORT is already the intent to connect.
    """
    saved = config.get("last_ip_port", "")
    saved_host = saved.split(":")[0] if saved and validate_ip_port(saved) else ""

    # Express: PREFER the fixed wireless-debug port 5555 over the ephemeral
    # re-rolling port whenever the device is armed for it. Menu option 8 runs
    # `adb tcpip 5555`, which makes adbd listen on the static legacy port; that
    # port never re-rolls and survives sleep/reconnect, so it is strictly more
    # stable than the saved high port Android reassigns on every restart. Probe
    # it FIRST on the host we already know (no hardcoded IP — the host comes from
    # the saved connection). Skipped when the saved port already IS 5555 (the
    # happy path below reuses it) or no host is known yet. When 5555 is not open
    # (device never armed), this falls straight through to normal resolution, so
    # a plain Wi-Fi run is unchanged.
    if auto and saved_host and not saved.endswith(":5555"):
        fixed = f"{saved_host}:5555"
        with console.status(f"[bold cyan]Checking fixed port {fixed}...[/bold cyan]", spinner="arc"):
            reachable, detail = test_tcp_connectable(fixed)
        if reachable:
            console.print(
                f"✔ [bold green]Fixed wireless-debug port reachable at {fixed}[/bold green] "
                f"({detail}) — preferring it over the re-rolling port."
            )
            write_log("PROBE", f"Reachable (fixed 5555) {fixed}: {detail}")
            return fixed
        console.print(
            f"[dim]Fixed port {fixed} not open (device not armed for 5555 via menu option 8) "
            f"— continuing with normal resolution.[/dim]"
        )

    # Express happy path: reuse the last device if its port is still open.
    if auto and saved and validate_ip_port(saved):
        with console.status(f"[bold cyan]Checking saved device {saved}...[/bold cyan]", spinner="arc"):
            reachable, detail = test_tcp_connectable(saved)
        if reachable:
            console.print(f"✔ [bold green]Saved device {saved} is reachable[/bold green] ({detail}).")
            write_log("PROBE", f"Reachable (saved) {saved}: {detail}")
            return saved
        console.print(f"[dim]Saved device {saved} not reachable ({detail}) — discovering...[/dim]")

    # mDNS discovery. In auto mode we take the first hit without asking.
    discovered = scan_for_devices()
    ip_and_port = ""
    if discovered:
        console.print(f"✔ [bold green]Auto-discovered device on network:[/bold green] {discovered[0]}")
        if auto or Prompt.ask("Connect to this device?", choices=["y", "n"], default="y") == "y":
            ip_and_port = discovered[0]

    # Express auto-recovery: a known saved host, no reachable saved port, and no
    # mDNS hit means Android rerolled the wireless-debug port (mDNS can even keep
    # advertising the dead port — observed 37993 still announced after the live
    # port moved to 43299). Scan the saved host for the live port automatically
    # rather than dropping to a manual prompt, so the express path stays
    # zero-input instead of forcing a hand-typed IP:PORT.
    if not ip_and_port and auto and saved and validate_ip_port(saved):
        recovered = recover_target_via_scan(saved.split(":")[0], auto=True)
        if recovered:
            ip_and_port = recovered

    # Manual entry fallback. Accepts three shapes so the user re-enters only the
    # part that changed:
    #   - IP:PORT   -> used directly
    #   - IP only   -> scan that host for the live (rerolled) debug port
    #   - PORT only -> attached to the last-known IP (saved host)
    # Android rerolls only the PORT when wireless debugging restarts while the IP
    # stays put on a fixed-lease network, so "port only" is the usual re-entry;
    # "IP only" covers a moved device whose new port still has to be discovered.
    if not ip_and_port:
        saved_host = saved.split(":")[0] if saved and validate_ip_port(saved) else ""
        while True:
            entry = Prompt.ask(
                "\n[bold magenta]Enter IP:PORT, IP only, or PORT only[/bold magenta] "
                "(e.g., 192.168.1.151:39099, 192.168.1.151, or 39099) or press Enter to skip",
                default=saved,
            ).strip()
            if not entry:
                return None

            # Full endpoint — use exactly as typed.
            if validate_ip_port(entry):
                ip_and_port = entry
                break

            # IP only — discover the live debug port on that host via a scan and
            # return it directly (the scan already confirmed the port is open).
            if validate_ip_only(entry):
                recovered = recover_target_via_scan(entry)
                if recovered:
                    return recovered
                console.print(
                    f"[dim]No debug port found on {entry}. Enter IP:PORT directly, "
                    f"or enable wireless debugging on the device and retry.[/dim]"
                )
                continue

            # PORT only — attach the last-known IP. Reject out-of-range so a typo
            # never gets combined into a nonsense endpoint.
            if entry.isdigit():
                port_num = int(entry)
                if not 1 <= port_num <= 65535:
                    console.print("✖ [bold red]Port out of range (1-65535).[/bold red]")
                    continue
                if not saved_host:
                    console.print(
                        "✖ [bold red]No saved IP to attach the port to.[/bold red] "
                        "Enter the full IP:PORT this time."
                    )
                    continue
                ip_and_port = f"{saved_host}:{entry}"
                console.print(f"[dim]Using last-known IP → {ip_and_port}[/dim]")
                break

            console.print(
                "✖ [bold red]Invalid format.[/bold red] "
                "Use IP:PORT, an IP address, or a port number."
            )

    # Probe reachability BEFORE adb connect — a dead/firewalled endpoint makes
    # 'adb connect' hang on its own long internal timeout.
    with console.status(f"[bold cyan]Testing if {ip_and_port} is reachable...[/bold cyan]", spinner="arc"):
        reachable, detail = test_tcp_connectable(ip_and_port)

    if reachable:
        console.print(f"✔ [bold green]{ip_and_port} is reachable[/bold green] ({detail}).")
        write_log("PROBE", f"Reachable {ip_and_port}: {detail}")
        return ip_and_port

    console.print(f"✖ [bold red]{ip_and_port} is not reachable:[/bold red] {detail}")
    write_log("PROBE", f"Unreachable {ip_and_port}: {detail}")
    # Refused port + live host = Android rerolled the debug port; scan to recover
    # (express mode scans without a prompt — see recover_target_via_scan auto=).
    return recover_target_via_scan(ip_and_port.split(":")[0], auto=auto)


# =============================================================================
# WIRED (USB) TRANSPORT DISCOVERY
# =============================================================================
# USB is the most reliable transport: it is immune to the two failure modes that
# plague Android 11+ Wireless Debugging on Motorola — the toggle silently turning
# itself off (Wi-Fi dropped in Doze / settings screen backgrounded) and the debug
# port re-rolling on every restart so no stable port is ever assigned. A cable
# has no port and no pairing; adbd is always listening on it.
def list_usb_devices():
    """Returns the serials of AUTHORIZED USB-attached devices (not Wi-Fi transports).

    `adb devices` lists every transport on one line each as '<serial>\\t<state>'.
    A Wi-Fi transport's serial is the IP:PORT we connected as; a USB device's
    serial is its hardware serial (no colon, e.g. ZY22XXXXXX). We treat any line
    in state 'device' whose serial is NOT an IP:PORT as a USB attachment. Lines
    in 'unauthorized'/'offline' are skipped — the caller can't debug those yet.
    """
    out = run_command("adb devices", show_output=False)
    usb = []
    # Skip the "List of devices attached" header line.
    for line in out.split("\n")[1:]:
        parts = line.split()
        if len(parts) >= 2 and parts[1] == "device" and not validate_ip_port(parts[0]):
            usb.append(parts[0])
    return usb


def _pick_usb(serials):
    """Lets the user pick among several attached USB devices. Returns a serial."""
    console.print("[bold]Multiple USB devices attached:[/bold]")
    for index, serial in enumerate(serials, start=1):
        console.print(f"  {index}. [cyan]{serial}[/cyan]")
    pick = IntPrompt.ask(
        "Which device?",
        choices=[str(i) for i in range(1, len(serials) + 1)],
        default=1,
    )
    return serials[pick - 1]


def resolve_usb_target():
    """Finds the single USB device to act on, or None with a guidance message.

    Centralizes the 'no device / one device / pick from many' logic both wired
    paths need, plus the standard 'why isn't my phone showing up' hint (charge-
    only cable mode and the on-device authorization prompt are the usual causes).
    """
    usb = list_usb_devices()
    if not usb:
        console.print(
            "✖ [bold red]No authorized USB device found.[/bold red]\n"
            "[dim]Plug the phone in with a DATA cable, set USB mode to "
            "'File transfer / Android Auto' (not 'Charge only'), and accept the "
            "'Allow USB debugging?' prompt on the phone, then retry.[/dim]"
        )
        return None
    return usb[0] if len(usb) == 1 else _pick_usb(usb)


def device_wifi_ip(serial):
    """Reads the phone's wlan0 IPv4 over USB, for the tcpip wireless handoff.

    Tries `ip -f inet addr show wlan0` first (the address the phone holds on
    Wi-Fi), falling back to the `src` address in `ip route` for OEMs whose
    `addr show` output differs. Returns the dotted-quad string or None.
    """
    out = _adb_shell(serial, "ip -f inet addr show wlan0")
    match = re.search(r"inet (\d{1,3}(?:\.\d{1,3}){3})", out)
    if match:
        return match.group(1)
    out = _adb_shell(serial, "ip route")
    match = re.search(r"src (\d{1,3}(?:\.\d{1,3}){3})", out)
    return match.group(1) if match else None
