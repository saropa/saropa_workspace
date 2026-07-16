"""Flutter Device Debug Assistant — package modules.

Each concern lives in its own module. The entry point stays a thin launcher: it
runs the
dependency bootstrapper (rich / plyer / zeroconf) BEFORE importing anything
here, because every submodule imports those third-party packages at module
load. Import order therefore matters — never import this package before
`ensure_dependencies()` has run.

Modules:
    core       paths, logging, config, run_command, adb-shell + validation utils
    health     battery / charging dashboard + network latency
    power      device power-saving apply / restore toggle
    media      scrcpy screen mirroring + filtered logcat streaming
    discovery  mDNS scan, port-scan recovery, USB discovery, target resolution
    connect    connection pipeline, menu handlers, and the interactive menu
"""
