# Shared modules for the Saropa Workspace release toolchain (publish.py, audit.py).
#
# This package is the modular replacement for the former single-file publish.py.
# Entry points (scripts/publish.py, scripts/audit.py) add scripts/ to sys.path
# and import these as `modules._<name>`. Files are prefixed with an underscore to
# signal they are internal to the toolchain and not meant to be run directly.
