# BUG-006: Config directory watcher not updated when saropaWorkspace.configDir changes at runtime

**Status: Open**

<!-- Status values: Open → Investigating → Fix Ready → Closed -->

Created: 2026-09-02
Area: Packaging
File(s): `extension/src/wiringWatchers.ts`
Severity: Medium
Extension version: 1.6.12

---

## Summary

`wiringWatchers.ts` sets up a `FileSystemWatcher` once at activation for `KNOWN_CONFIG_DIRS` plus the current `configDirName()`. If the user changes the `saropaWorkspace.configDir` setting at runtime to a directory name not in `KNOWN_CONFIG_DIRS`, no new watcher is registered for that directory. Hand edits to config files in the new location will not trigger a live refresh until the extension is reloaded.

---

## Attribution Evidence

The watcher setup is in `extension/src/wiringWatchers.ts`. The `KNOWN_CONFIG_DIRS` constant and `configDirName()` helper are extension code. The `saropaWorkspace.configDir` setting is declared in `extension/package.json`.

---

## Reproducer

1. Set `saropaWorkspace.configDir` to a custom directory name not in `KNOWN_CONFIG_DIRS` (e.g. `.myconfig`).
2. Do NOT reload the window — just change the setting.
3. Create or edit a config file in `.myconfig/` in the workspace.
4. Observe: the extension does not pick up the change. The tree view and internal state remain stale.
5. Reload the window — now the watcher covers `.myconfig/` and changes are detected.

**Frequency:** Always, when changing `configDir` to a novel directory name at runtime without reloading.

---

## Expected vs Actual

| | Behavior |
|---|---|
| **Expected** | Changing `saropaWorkspace.configDir` at runtime registers a new watcher for the new directory, so config file changes are detected immediately. |
| **Actual** | The watcher is only set up at activation time. A runtime change to a novel directory name leaves it unwatched until the next reload. |

---

## State / Flow Context

```
activate (extension.ts)
  └─ wiringWatchers.ts: setupWatchers()
      └─ creates FileSystemWatcher for KNOWN_CONFIG_DIRS + configDirName()
          ← runs once, never updated

onDidChangeConfiguration (saropaWorkspace.configDir changes)
  └─ various handlers update internal state
      └─ but wiringWatchers.ts does NOT re-register the watcher
```

---

## Root Cause

The file system watcher is created once during activation with a static glob pattern derived from the known config directories at that point in time. There is no `onDidChangeConfiguration` handler that disposes the old watcher and creates a new one when `configDir` changes. The `KNOWN_CONFIG_DIRS` list covers common names (`.vscode`, `.saropa`, etc.) but cannot anticipate every custom value.

---

## Suggested Fix

Listen for `onDidChangeConfiguration` events for the `saropaWorkspace.configDir` key. When it changes:

1. Dispose the existing config directory watcher.
2. Create a new `FileSystemWatcher` that includes the new `configDirName()` value alongside `KNOWN_CONFIG_DIRS`.
3. Push the new watcher to `context.subscriptions`.

Alternatively, use a broader glob pattern that watches all directories and filters in the event handler — though this may be less efficient.

---

## Changes Made

<!-- Fill in when a fix is written. -->

---

## Verification

- [ ] `tsc -p ./ --noEmit` clean
- [ ] `npm run build` succeeds
- [ ] Manual smoke test: change `configDir` at runtime to a custom name, edit a file there, confirm the extension picks up the change without a reload

---

## Commits

<!-- Add commit hashes as fixes land. -->

---

## Environment

- saropa_workspace version: 1.6.12
- VS Code version: any
- OS: any
- Pin scope (project / global): project
- Settings Sync enabled (yes / no): n/a
