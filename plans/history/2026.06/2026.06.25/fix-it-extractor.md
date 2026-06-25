# Offer the fix a failed run suggested

When a tool fails and prints a fix command in its output ("Run `npm install lodash`
to fix"), the user had to select, copy, and paste it. This detects a suggested fix in
a failed background run's output and adds a one-click "Run: …" button to the failure
toast.

## Finish Report (2026-06-25)

### Scope
VS Code extension (TypeScript). No Flutter/Dart code.

### What changed
- **`exec/runner.ts`**: on a failed background run, `detectFixCommand(output)` scans the
  captured output against a small ordered set of conservative patterns and returns the
  first suggested command:
  1. a quoted command following a run/try/fix verb (the most reliable signal),
  2. a bare `npm`/`pnpm install …`,
  3. `yarn add …`,
  4. `pip`/`pip3 install …`.
  `notifyCompletion` gained an optional `fix` argument; when present, the failure
  toast shows a **Run: <command>** action ahead of **Show Output**, and choosing it
  runs the exact command in the shared integrated terminal (`runInTerminal`) in the
  run's cwd. Detection runs only on failure; the toast is otherwise unchanged.

### Why a toast action, not a "Quick Fix pin"
The pitch suggested a transient pin sliding into the sidebar. A toast-with-action
delivers the same one-click outcome without adding a transient pin kind to the tree
model and render path — far smaller blast radius for the same user benefit. If a
persistent surface is wanted later, it is a separate follow-up.

### Why conservative
A missed suggestion just means no button (the user still has the full output via Show
Output). A *wrong* command offered for one click is worse, so the patterns favor
precision: the command is always shown in full in the button text, so the user runs it
knowingly, and it runs in the visible integrated terminal (interactive — an install
may prompt), never silently in the background.

### Verification
`npx tsc --noEmit` exit 0; `node esbuild.js` exit 0; en.json parse-validated. No test
harness in the extension; verified by type-check, build, and inspection. `detectFixCommand`
is pure and unit-testable should a harness be added.

### Localization
`run.runFix` added to `en.json`. No MT pipeline in this repo.
