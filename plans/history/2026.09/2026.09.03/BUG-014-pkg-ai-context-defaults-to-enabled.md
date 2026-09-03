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
