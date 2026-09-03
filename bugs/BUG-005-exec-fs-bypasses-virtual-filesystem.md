# BUG-005: Raw fs calls bypass vscode.workspace.fs — breaks remote environments

**Status: Open**

<!-- Status values: Open → Investigating → Fix Ready → Closed -->

Created: 2026-09-02
Area: Execution
File(s): `extension/src/exec/fileOps.ts` (`toggleFileLock`), `extension/src/views/dailyReport.ts` (`writeSuiteDailyReportFile`)
Severity: Medium
Extension version: 1.6.12

---

## Summary

Two modules use Node's raw `fs.promises` API (stat, chmod, mkdir, writeFile) on `uri.fsPath` instead of the `vscode.workspace.fs` API. This works on local filesystems but breaks under VS Code Remote (SSH, WSL, Containers) and Live Share, where the workspace filesystem is virtual and `fsPath` does not resolve to a local path the Node process can access.

---

## Attribution Evidence

- `fileOps.ts` `toggleFileLock`: uses `fs.promises.stat` and `fs.promises.chmod` on `uri.fsPath`.
- `dailyReport.ts` `writeSuiteDailyReportFile`: uses `fs/promises` `mkdir` and `writeFile` against `path.join(root, ...)` where `root` comes from `workspaceFolders[0].uri.fsPath`.

Both files are in `extension/src/`.

---

## Reproducer

1. Connect to a Remote SSH or WSL workspace in VS Code.
2. Trigger `toggleFileLock` on a file (or trigger the daily report write).
3. Observe: the operation fails because Node's `fs` cannot resolve the remote path.

**Frequency:** Always, in any remote or virtual filesystem context.

---

## Expected vs Actual

| | Behavior |
|---|---|
| **Expected** | File operations use `vscode.workspace.fs` which transparently handles local, remote, and virtual filesystems. |
| **Actual** | Raw `fs.promises` calls operate on `uri.fsPath`, which is meaningless in remote contexts — the file is on the remote host, but `fs` tries to access it locally. |

---

## State / Flow Context

```
toggleFileLock (exec/fileOps.ts)
  └─ fs.promises.stat(uri.fsPath)    ← raw Node fs, not vscode.workspace.fs
  └─ fs.promises.chmod(uri.fsPath)   ← same

writeSuiteDailyReportFile (views/dailyReport.ts)
  └─ fs.promises.mkdir(path.join(root, ...))   ← root = workspaceFolders[0].uri.fsPath
  └─ fs.promises.writeFile(...)                ← same
```

---

## Root Cause

These two modules were written using Node's native `fs` API for convenience. The `vscode.workspace.fs` API was not used, skipping the abstraction layer that handles remote and virtual filesystems. In a local-only context this works fine, but it is not portable.

Note: `chmod` (used by `toggleFileLock` for file lock toggling) has no direct equivalent in `vscode.workspace.fs`. This operation may need to be disabled or handled differently in remote contexts.

---

## Suggested Fix

**`dailyReport.ts`**: Replace `fs.promises.mkdir` and `fs.promises.writeFile` with `vscode.workspace.fs.createDirectory` and `vscode.workspace.fs.writeFile`, operating on `Uri` objects instead of string paths.

**`fileOps.ts`**: For `toggleFileLock`, `vscode.workspace.fs` does not expose chmod. Options:
1. Guard the operation: check if the workspace is local (`uri.scheme === 'file'`) before calling `fs.promises.chmod`; show an informational message in remote contexts explaining the limitation.
2. If remote lock toggling is important, explore a terminal-based `chmod` command sent to the remote host.

---

## Changes Made

<!-- Fill in when a fix is written. -->

---

## Verification

- [ ] `tsc -p ./ --noEmit` clean
- [ ] `npm run build` succeeds
- [ ] Manual smoke test: daily report writes correctly in a local workspace
- [ ] If possible, test in a Remote SSH or WSL context

---

## Commits

<!-- Add commit hashes as fixes land. -->

---

## Environment

- saropa_workspace version: 1.6.12
- VS Code version: any
- OS: any (specifically relevant for Remote SSH, WSL, Containers, Live Share)
- Pin scope (project / global): n/a
- Settings Sync enabled (yes / no): n/a
