# Open VSX token made per-extension in the release script

The release toolchain read the Open VSX Personal Access Token from the generic
`OVSX_PAT` environment variable — the same single slot the `ovsx` CLI reads. With
roughly thirty Saropa extensions, each holding its own Open VSX token, one shared
`OVSX_PAT` slot cannot hold them all; whichever value was last written would be
used to publish every extension. The token is now stored per-extension and mapped
into `OVSX_PAT` only at publish time.

## Finish Report (2026-06-26)

### Defect

`scripts/modules/_publish.py` resolved the Open VSX token directly from
`OVSX_PAT`. That variable is global to the machine and is the exact name the
`ovsx publish` CLI consumes, so storing a durable per-extension secret there is
impossible without collision across the suite's extensions.

### Change

- The durable secret now lives in a project-specific User environment variable,
  `OVSX_PAT_SAROPA_WORKSPACE`.
- `publish_marketplaces()` in `scripts/modules/_publish.py` reads
  `OVSX_PAT_SAROPA_WORKSPACE` and copies it into `OVSX_PAT` immediately before the
  Open VSX publish — both on the already-set path (env var present) and on the
  interactive-prompt path (the prompt writes the project-specific var, whose
  returned value is then mapped into `OVSX_PAT`). The generic slot is populated
  only for the duration of the publish, so per-extension tokens never collide.
- The interactive prompt, the failure warning, the launcher docstring in
  `scripts/publish.py`, and the publishing skill doc were updated to name the
  project-specific variable.
- The manual release playbook in `scripts/modules/_ci.py` now emits the
  `$env:OVSX_PAT = $env:OVSX_PAT_SAROPA_WORKSPACE` mapping line before the raw
  `npx ovsx publish` step, since the raw CLI still reads the generic slot.

### Verification

- `python -m py_compile` passed on `_publish.py`, `publish.py`, and `_ci.py`.
- The VS Code Marketplace path (`VSCE_PAT`) is unchanged.

### Notes

The token value itself is held only in the Windows User environment (registry
HKCU), referenced by variable name in code; it is not written to any tracked
file. The VS Code Marketplace token (`VSCE_PAT`) remains a separate, unset
variable.
