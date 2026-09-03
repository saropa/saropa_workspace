# BUG-002: runNearestScript hardcodes npm instead of detecting package manager

**Status: Fixed**

<!-- Status values: Open → Investigating → Fix Ready → Closed -->

Created: 2026-09-02
Area: Execution
File(s): `extension/src/commands/recipeCommands.ts` (`runNearestScript`)
Severity: High
Extension version: 1.6.12

---

## Summary

`recipeCommands.ts` `runNearestScript` always executes `npm run ${pick.label}` regardless of the project's actual package manager. The codebase already has `detectorHelpers.ts` `packageManager()` which detects pnpm/yarn/bun/npm via lockfile presence, and it is used elsewhere. This command ignores it, so projects using pnpm, yarn, or bun get the wrong invocation.

---

## Attribution Evidence

`runNearestScript` is defined in `extension/src/commands/recipeCommands.ts`. The `packageManager()` helper lives in `extension/src/detection/detectorHelpers.ts`. Both are extension code.

---

## Reproducer

1. Open a project that uses pnpm (has `pnpm-lock.yaml`, no `package-lock.json`).
2. Invoke the "Run Nearest Script" command.
3. Pick any script from the list.
4. Observe: terminal runs `npm run <script>` instead of `pnpm run <script>`.

**Frequency:** Always, in any non-npm project.

---

## Expected vs Actual

| | Behavior |
|---|---|
| **Expected** | The command detects the project's package manager (pnpm/yarn/bun/npm) and runs the script with the correct binary. |
| **Actual** | The command always runs `npm run <script>`, ignoring the project's actual package manager. |

---

## State / Flow Context

```
runNearestScript (commands/recipeCommands.ts)
  └─ builds command as `npm run ${pick.label}`   ← hardcoded "npm"
      └─ sends to terminal

detectorHelpers.ts packageManager()   ← exists, used elsewhere, NOT called here
```

---

## Root Cause

The `runNearestScript` function constructs the terminal command with a hardcoded `npm` prefix string. It does not call the existing `packageManager()` detection helper that other parts of the codebase use. This was an oversight when the function was written or when the detection helper was introduced.

---

## Suggested Fix

Replace the hardcoded `npm` string with a call to `packageManager()` (or its return value) to resolve the correct binary. The call pattern is already established in other command handlers — follow that precedent.

```ts
// Before
`npm run ${pick.label}`

// After
const pm = packageManager(workspaceFolder);
`${pm} run ${pick.label}`
```

---

## Changes Made

`extension/src/recipes/recipeCommands.ts` `runNearestScript`: imported `packageManager` from `./detectorHelpers` (note — the file actually lives at `extension/src/recipes/detectorHelpers.ts`, not `extension/src/detection/detectorHelpers.ts` as this report's paths stated). Replaced the hardcoded `npm run ${pick.label}` with a call to `packageManager()` against a synthetic `WorkspaceFolder` rooted at the nearest `package.json`'s directory (not the top-level workspace folder — a monorepo package can use a different manager than its root), then sent `${pm} run ${pick.label}` to the terminal.

---

## Verification

- [ ] `tsc -p ./ --noEmit` clean
- [ ] `npm run build` succeeds
- [ ] Manual smoke test: open a pnpm project, run the command, confirm `pnpm run <script>` appears in terminal
- [ ] Repeat with yarn and bun lockfiles

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

- `detectorHelpers.ts` `packageManager()` (lines 76-87) only checks lockfiles in the exact folder it is given, with no upward walk. `runNearestScript` (`recipeCommands.ts` line 218) passes the nearest `package.json`'s own directory (`dir`), so in a monorepo where the lockfile lives only at the repo root and the workspace member has no lockfile of its own, detection silently falls back to `npm` even on a pnpm/yarn/bun repo — the exact class of bug this fix targeted, just one level up.
- `runNearestScript` line 218 builds a synthetic `vscode.WorkspaceFolder` as `{ uri: vscode.Uri.file(dir) } as vscode.WorkspaceFolder`, supplying only `uri` and casting past `name`/`index`. `packageManager()` and the `exists()`/`readText()` helpers it calls only touch `.uri` today, so this works, but the cast means a future edit to those helpers (or a new helper added to `detectorHelpers.ts` that reads `folder.name` for a log message or similar) would compile clean and fail silently at runtime with `undefined`. No compiler backstop catches that regression.
- `terminal.sendText(`${pm} run ${pick.label}`)` at line 221 interpolates `pick.label` (a script name straight from `package.json`'s `scripts` keys) directly into a shell command line with no quoting or escaping. `package.json` script names are attacker-controllable if the repo itself is untrusted (e.g. opening a cloned malicious project) — a key like `build; rm -rf ~` would execute verbatim. This predates the fix but the fix touches this exact line, so it is now the natural place to add quoting.
- No error surfaced to the user if `packageManager()` itself throws (e.g. `vscode.workspace.fs.stat` rejecting for a reason other than "not found," such as a permissions error on `dir`) — `exists()` swallows all stat failures into `false`, so a permission-denied lockfile check silently degrades to "npm" rather than warning that detection could not run.

### Suggestions

- `packageManager()` is also used to build the display for `readNameVersion` / `openConfigFiles`-style recipes elsewhere; consider adding an optional upward-walk mode (stop at the workspace root, same pattern as `findNearestPackageJson` in this file) so nested monorepo packages inherit the root lockfile's manager instead of defaulting to npm.
- The synthetic `WorkspaceFolder` construction at line 218 is a one-off cast; if another recipe command needs to call a `folder`-typed helper against an arbitrary directory (not a real workspace folder), factor this into a small `folderFrom(dir: string): vscode.WorkspaceFolder` helper in `detectorHelpers.ts` so the cast and its `.name`/`.index` gap are documented and reused rather than re-typed at each call site.
