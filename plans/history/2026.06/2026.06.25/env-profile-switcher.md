# Switch the active .env between project profiles

Moving between local, staging, and prod meant renaming `.env.staging` to `.env` by
hand (or editing variables and changing them back). This adds a `.env` profile
switcher: pick from the `.env.<name>` files a project keeps and it copies the chosen
one over `.env`, backing up a hand-edited active file first.

## Finish Report (2026-06-25)

### Scope
VS Code extension (TypeScript). No Flutter/Dart code.

### What changed
- **`commands/envProfiles.ts`** (new): `switchEnvProfile()`
  - Discovers profiles per workspace folder: every `.env.<name>` directly under the
    folder, excluding templates (`example` / `sample` / `template` / `dist`) and the
    backup (`bak` / `backup`); the bare `.env` is the active file, not a profile.
  - Picks the folder (the only one with profiles, or a chosen one when several
    qualify), reads the current `.env`, and determines which profile it matches (if
    any) so the QuickPick can mark the active environment.
  - On selection, copies the profile's content over `.env`. Safety: when the current
    `.env` matches NO profile (hand edits), a modal confirm offers to back it up to
    `.env.bak` before overwriting; switching between recognized profiles needs no
    backup because each environment still lives in its own `.env.<name>`.
  - Reports the switch and reminds the user to restart their dev server (the running
    server still holds the old environment — Saropa cannot restart an arbitrary
    external process).
- **Command `saropaWorkspace.switchEnvProfile`** ("Switch .env Profile..."):
  registered in `registerPinCommands` (no pin/store argument); surfaced in the Pins
  view title `···` overflow (the `0_new` group) and the command palette.

### Design note (no auto-restart, no radio-button tree group)
The pitch described a radio-button pin group and automatic dev-server restart.
Restarting an arbitrary external dev server is outside what an extension can do
reliably, so the follow-through is a clear "restart to apply" message instead. The
switch is delivered as a command (with the active profile marked in the picker) rather
than a new always-present tree group, keeping it out of the heavily-shared tree
provider; the core value — one action to swap environments, without manual file
renames and without losing hand edits — is fully delivered.

### Verification
`npx tsc -p ./ --noEmit` exit 0; `node esbuild.js` exit 0; all three manifests
parse-validated. No test harness in the extension; verified by type-check, build, and
inspection. File writes go through `vscode.workspace.fs` (remote/virtual-FS safe).

### Localization
`env.*` runtime strings in `en.json`; `command.switchEnvProfile.title` in
`package.nls.json`. No MT pipeline in this repo.
