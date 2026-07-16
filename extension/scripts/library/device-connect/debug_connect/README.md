# Debug Connect — Flutter on-device debugging assistant

Connects a physical Android device to Flutter for on-device debugging over
**Wi-Fi** or **USB**, mirrors the screen with [scrcpy](https://github.com/Genymobile/scrcpy),
and reports battery / charging / connectivity health. Device-agnostic; validated
against a Motorola edge (MediaTek) but written for any Android device.

## Run it

```bash
python device-connect            # interactive menu
python device-connect -h         # help / option reference
```

The entry point is a thin **launcher** (`__main__.py` beside this package): it
checks for the third-party dependencies (`rich`, `plyer`, `zeroconf`) and, when any
are missing, asks before installing them via pip — declining aborts the run. It
then imports this package and runs its menu.

## Menu

| Key | Action | What it does |
|----|--------|--------------|
| 0 | Express | Zero-prompt: resolve the saved/discovered device, apply power saving, connect, mirror. **No logging** (default). |
| 1 | Express + logging | Same as 0 but also streams filtered Flutter/Dart logcat. |
| 2 | Pair new device | First-time Android 11+ pairing (pairing code). |
| 3 | Connect Android 11+ | Interactive mDNS discovery + manual entry. |
| 4 | Connection status | `adb devices` + `flutter devices` sync check. |
| 5 | Power saving | Apply / restore toggle (disables BT, mobile data, animations, Moto bloat; keeps Wi-Fi + location). |
| 6 | Device health | Battery, charging rate, temperature dashboard only. |
| 7 | **Wired USB** | Debug straight over a cable — no port, no pairing, immune to the wireless-debug toggle. |
| 8 | **Wireless via USB** | `adb tcpip 5555` over a cable once → connect to the fixed port wirelessly. |

## "Wireless debugging keeps turning off / no port is ever assigned"

This is the standard behavior of Android 11+ **Wireless Debugging** on
Motorola / MediaTek devices:

- The IP:Port only exists while Wi-Fi is associated and the radio is awake;
  Motorola's battery management drops Wi-Fi in Doze, tearing down the debug
  daemon.
- The TLS connect port **re-rolls on every restart** (the tool's mDNS + full
  port-scan recovery chases that, but it is treating a symptom).

The durable fix is to stop using Wireless Debugging:

- **Option 7 (Wired USB)** — a cable has no port and no pairing; adbd is always
  listening.
- **Option 8 (Wireless via USB)** — `adb tcpip 5555` puts adbd on the legacy
  **fixed** port 5555, which does not re-roll and needs no pairing. Needs a cable
  once to arm it; survives sleep/reconnect until the next phone **reboot**.

Phone-side settings that help: Developer options → *Disable adb authorization
timeout* and *Stay awake*; remove battery optimization for the dev session; keep
the phone on the charger (Doze never fully engages while charging).

## Module map

| Module | Responsibility |
|--------|----------------|
| `core` | Shared singletons: `console`, daily log, config, `run_command`, adb-shell helpers, validation, UX print helpers, `require_adb`, progress factory. |
| `health` | Battery / charging dashboard (`dumpsys battery`) + network latency. |
| `power` | Power-saving apply / restore with original-value capture. |
| `media` | scrcpy launch (verified, throttled auto-update with download progress) + filtered logcat. |
| `discovery` | mDNS scan, full-range port-scan recovery (progress bar), USB discovery, target resolution. |
| `connect` | Connection pipeline, the eight menu handlers, and the interactive menu. |

### Import-order constraint

`core` / `health` / `power` / `media` / `discovery` / `connect` all import
`rich` / `plyer` / `zeroconf` at module load. The launcher therefore **must**
run `ensure_dependencies()` before importing this package — only the launcher's
own top imports are restricted to the standard library.

## State files (in the project root)

| File | Purpose |
|------|---------|
| `wifi_debug_config.json` | Remembers the last connected `IP:PORT` for the zero-prompt express path. |
| `wifi_power_state.json` | Power-saving restore snapshot (original setting values + `active` flag). Present ⇒ next option-5 run restores. |
| `reports/<date>/<ts>_debug_connect.log` | Per-run execution log. |

(The `wifi_*` filenames are retained from the tool's Wi-Fi-only era so existing
saved state is not orphaned.)
