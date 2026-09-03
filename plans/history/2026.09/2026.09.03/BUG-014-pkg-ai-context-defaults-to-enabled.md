# BUG-014: aiContext.enabled defaults to true — scans chat transcript directories without opt-in

**Status: Fixed**

<!-- Status values: Open → Investigating → Fix Ready → Closed -->

Created: 2026-09-02
Area: Packaging
File(s): `extension/package.json` (`contributes.configuration`, `saropaWorkspace.aiContext`)
Severity: Low
Extension version: 1.6.12

---

## Summary

The `saropaWorkspace.aiContext.enabled` setting defaults to `true`, with `claudeChatFolders` configured to scan `.claude`, `.cline/tasks`, `docs/chats`, and similar directories. This means the extension scans for chat transcripts and session data by default without explicit user opt-in. Scanning directories that may contain sensitive conversation transcripts, session history, and working notes is a privacy concern — this behavior should be opt-in, not opt-out.

---

## Attribution Evidence

The `aiContext` configuration is declared in `extension/package.json` under `contributes.configuration`. The default values are static manifest entries.

---

## Reproducer

1. Install the extension with default settings.
2. Open a workspace that contains `.claude/` or `.cline/tasks/` directories.
3. Observe: the extension scans these directories by default as part of its AI context feature, without the user having enabled this behavior.

**Frequency:** Always, on any workspace with matching directories.

---

## Expected vs Actual

| | Behavior |
|---|---|
| **Expected** | `aiContext.enabled` defaults to `false`. The user explicitly opts in to scanning chat transcript directories. |
| **Actual** | `aiContext.enabled` defaults to `true`. The extension scans chat transcript and session directories automatically. |

---

## State / Flow Context

```
package.json contributes.configuration
  └─ saropaWorkspace.aiContext.enabled
      └─ default: true   ← scans by default without opt-in

  └─ saropaWorkspace.aiContext.claudeChatFolders
      └─ default: [".claude", ".cline/tasks", "docs/chats", ...]
          └─ directories that may contain sensitive session data
```

---

## Root Cause

The feature was shipped with a default-on configuration for convenience. The privacy implications of scanning directories that contain conversation transcripts, session history, and other potentially sensitive content were not fully considered. A feature that accesses potentially sensitive data should require explicit opt-in.

---

## Suggested Fix

Change the default value of `saropaWorkspace.aiContext.enabled` from `true` to `false` in `package.json`.

Optionally, on first activation after the change, show an informational message to users who had the default active, explaining the change and how to re-enable it if desired.

---

## Changes Made

Changed `saropaWorkspace.aiContext.enabled` default from `true` to `false` in `extension/package.json` (`contributes.configuration`). No migration/notification message was added for existing users who had the default active — out of scope for a manifest default fix; flagging as optional follow-up per the suggested fix.

---

## Verification

- [x] `tsc -p ./ --noEmit` clean
- [x] `npm run build` (`node esbuild.js`) succeeds
- [ ] Manual smoke test: fresh install — confirm `aiContext.enabled` is `false` by default and chat directories are not scanned until the user enables the setting

---

## Commits

<!-- Add commit hashes as fixes land. -->

---

## Environment

- saropa_workspace version: 1.6.12
- VS Code version: any
- OS: any
- Pin scope (project / global): n/a
- Settings Sync enabled (yes / no): n/a

---

## Reflection

### Hardening items

- **Stale code-level default contradicts the manifest fix.** `extension/src/recipes/aiContextRecipes.ts:80` still reads `cfg.get<boolean>("aiContext.enabled", true)`. The `true` fallback only fires if VS Code's configuration read ever returns `undefined` for a registered setting, but it is a second, unsynced copy of the same default this bug just flipped in `package.json:2314` — a single-source-of-truth violation (`.claude/rules/global.md`). Should read `cfg.get<boolean>("aiContext.enabled", false)` so the fallback can never silently re-enable scanning if the manifest lookup ever misses.
- **Existing users who never touched the setting get a silent behavior change.** VS Code persists only explicit overrides; a user who left `aiContext.enabled` untouched inherited `true` under 1.6.12 and will silently start getting `false` after upgrade, with no notice. `Changes Made` explicitly deferred the informational-message follow-up from `Suggested Fix` — worth confirming that's tracked, since users relying on the (undocumented-as-opt-in) chat-folder recipes will see them vanish from the tree with no visible outcome (`.claude/rules/global.md` "No silent async" targets user actions, but a config-driven feature disappearance has the same UX cost).
- **No migration for users who explicitly set `aiContext.enabled: true` in `settings.json` before this fix** — those are unaffected (explicit override wins), but nothing distinguishes "explicit opt-in from before the privacy review" from "inherited the old insecure default" in the settings UI (`extension/src/views/settingsPanel.ts:115`). Both render identically as a plain boolean toggle with no annotation of the recent default change.
- **Manual smoke test still unchecked.** `Verification` leaves "fresh install — confirm `aiContext.enabled` is `false` by default" unticked. The unit tests (`extension/src/test/aiContextRecipes.test.ts:47-63`) cover the gate logic directly, but they set config explicitly and never exercise the manifest's own default value, so they would not have caught this bug or a regression of it.
- **`Commits` section is empty** — no commit hash recorded despite `Status: Fixed`, so the change can't be traced back from this file alone.

### Suggestions

- Add a unit test that reads the manifest's declared default for `saropaWorkspace.aiContext.enabled` from `package.json` (or asserts against the extracted constant) and fails if it is ever anything but `false`, so a future edit can't silently flip it back without a caller noticing — mirrors the "single source of truth" rule better than duplicating `false` as a second literal in `aiContextRecipes.ts`.
- Align the `cfg.get` fallback in `aiContextRecipes.ts:80` to `false` now, independent of the deferred first-activation notice, since it costs one character and removes the contradiction.
- Do the deferred first-activation notice as a small follow-up bug/task rather than letting it live only as a paragraph in `Suggested Fix` — Settings Sync means some users will get the new default mid-session with zero indication their AI-context recipes just disappeared.
