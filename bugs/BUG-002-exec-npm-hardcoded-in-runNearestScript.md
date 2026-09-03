# BUG-002: runNearestScript hardcodes npm instead of detecting package manager

**Status: Open**

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

<!-- Fill in when a fix is written. -->

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
