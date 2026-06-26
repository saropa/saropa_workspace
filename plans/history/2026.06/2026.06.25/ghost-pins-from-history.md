# Suggest pins from frequently-typed shell commands

Developers retype long shell one-liners (docker exec, psql dumps, ssh tunnels) but
rarely save them as pins. This adds an on-demand scan of local shell history that
surfaces the complex commands typed several times and offers to save the chosen ones
as shell pins.

## Finish Report (2026-06-25)

### Scope
VS Code extension (TypeScript). No Flutter/Dart code.

### What changed
- **`PinStore.addShellPin(label, shellCommand, scope, useIntegratedTerminal)`**
  (pinStore.ts): a focused creator for a shell-action pin, joining the existing
  `addPin` / `addLinePin` / `importPin` family. Never runs the pin — it only stores
  it. A shell pin carries no file path, so it does not dedupe by path.
- **`commands/ghostPins.ts`** (new): `suggestFromHistory(store)` reads the available
  shell-history files (PowerShell PSReadLine `ConsoleHost_history.txt`, `~/.bash_history`,
  `~/.zsh_history`) with `fs.promises.readFile`, normalizes each line (stripping the
  zsh extended-history `: epoch:elapsed;` prefix), counts how often each
  "worth-suggesting" command appears (has arguments, ≥12 chars, leading command not a
  trivial nav builtin), keeps those typed ≥3 times, and offers the top 20 in a
  multi-select QuickPick showing each command's frequency. Selected commands are saved
  as global shell pins (a frequently-typed command is a personal, machine-wide habit,
  and a shell pin has no path tying it to a folder); the label is the command,
  truncated for the tree row while the pin keeps the full command.
- **Command `saropaWorkspace.suggestFromHistory`** ("Suggest Pins from Shell
  History..."): registered in `registerPinCommands`; surfaced in the Pins view title
  `···` overflow (the `0_new` group, sparkle icon) and the command palette.

### Privacy
The scan is read-only and entirely local: it reads the user's own history files, never
writes them, and transmits nothing. Invoking the command is the consent; nothing is
pinned or run until the user selects.

### Design note (on-demand, not a passive watcher)
The pitch described a "Ghost Pin" that appears automatically with a sparkle when a
command crosses a frequency threshold. A passive tail of history files plus an
auto-injected tree group is both more invasive (continuous background file reads) and a
larger surface in the heavily-shared tree provider. The same value — learn from what
the developer actually types, one action to save it — is delivered as an explicit,
read-only scan the user triggers, which also makes the privacy contract obvious.

### Verification
`npx tsc -p ./ --noEmit` exit 0; `node esbuild.js` exit 0; all three manifests
parse-validated. No test harness in the extension; verified by type-check, build, and
inspection.

### Localization
`ghost.*` runtime strings in `en.json`; `command.suggestFromHistory.title` in
`package.nls.json`. No MT pipeline in this repo.
