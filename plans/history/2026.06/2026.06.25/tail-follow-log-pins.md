# Follow a log file live (tail -f) from a file pin

Clicking a log file pin opened it statically; watching a running process's output
meant closing and reopening the tab or switching to a terminal. This adds a per-pin
"follow" toggle that opens the file at its end and keeps it scrolled to the newest
lines as the file grows on disk, mimicking `tail -f` inside the editor.

## Finish Report (2026-06-25)

### Scope
VS Code extension (TypeScript). No Flutter/Dart code.

### What changed
- **`Pin.tailFollow?: boolean`** (model/pin.ts): an optional per-pin flag. When set,
  opening the file pin follows it like `tail -f`. Persists as an ordinary pin field
  (round-trips through the project file / global state like any other).
- **`PinStore.setPinTail(pin, follow)`**: persists the flag via the existing
  `mutatePin` path; clears the field entirely when off so an unfollowed pin carries
  no stale flag.
- **`commands/pinCommands.ts`**:
  - `openPin` now starts a follow session when `pin.tailFollow` is set (it supersedes
    a line jump, since following means "show me the newest lines", not "land on line
    N").
  - In-memory follow manager: a `Set<string>` of followed document URIs, a single
    shared `onDidChangeTextDocument` listener that re-reveals the end of every visible
    editor showing a followed doc whenever it grows, and an `onDidCloseTextDocument`
    listener that drops the entry so a closed tab leaves nothing behind. Both
    listeners are registered once (`registerTailFollow`) and pushed to
    `context.subscriptions`, so they dispose on deactivate and never leak.
  - `toggleTail` command flips the flag, guards non-file pins with a message, offers
    to open the file immediately on enable, and drops any live follow at once on
    disable.
- **New command `saropaWorkspace.toggleTail`** ("Toggle Log Follow (tail -f)") on the
  Pins context menu for file pins (`pin` / `pinAuto` / `pinScheduled`); hidden from the
  command palette (it needs a pin argument).

### Design note
The follow is in-memory and lives for one tab's lifetime; it is re-armed from
`pin.tailFollow` each time the pin is opened. VS Code already reloads an unmodified
document when the underlying file changes on disk, so the change listener fires on
every append without a custom file watcher. The pitch's "split pane" detail is left to
the user (a follow works in any pane, and all split editors of the same doc track the
tail); the core — auto-scroll on append — is what shipped.

### Verification
`npx tsc -p ./ --noEmit` exit 0; `node esbuild.js` exit 0; all three manifests
parse-validated. No test harness in the extension; verified by type-check, build, and
inspection.

### Localization
`tail.enabled` / `tail.disabled` / `tail.openNow` / `tail.fileOnly` in `en.json`;
`command.toggleTail.title` in `package.nls.json`. No MT pipeline in this repo.
