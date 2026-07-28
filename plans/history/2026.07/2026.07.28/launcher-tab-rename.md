# Launcher tab rename: "Saropa Launcher" → "Saropa Workspace"

The bottom-panel webview view tab was titled "Saropa Launcher", which diverged
from the extension's own display name ("Saropa Workspace"). The rename aligns the
panel tab with the extension identity.

## Changes

- `extension/package.nls.json` — `views.launcher.container.title` value changed
  from "Saropa Launcher" to "Saropa Workspace".
- `extension/src/i18n/locales/en.json` — `launcher.title` value changed from
  "Saropa Launcher" to "Saropa Workspace".
- `plans/guides/STYLEGUIDE.md` — screen-title reference table and prose updated
  to reflect the new title.

## Finish Report (2026-07-28)

**Scope:** VS Code extension (B) — two i18n catalog values, one style guide.

**Review:** No logic, safety, architecture, or performance issues. Pure string
rename with no downstream code-path changes.

**Tests:** Two test files (`launcherAssets.test.ts`, `launcherItems.test.ts`)
mention "Saropa Launcher" in file-header comments only. No assertions reference
the display title. No test breakage.

**Risk:** The sidebar view container (`views.container.title`) is already "Saropa
Workspace". Both surfaces now share the same tab label. If VS Code ever renders
both tabs simultaneously and the user needs to distinguish them, the identical
titles could cause confusion — but the sidebar uses a tree view (no tab), so this
does not arise in practice.
