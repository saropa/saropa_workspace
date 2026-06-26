# README sync — v1.1.0 (Unreleased) features

The root `README.md` predated the bulk of the v1.1.0 work and documented only
the 1.0.x feature set, so the public product page omitted the major capabilities
already recorded in the `[Unreleased]` section of `CHANGELOG.md`. This task
brought the README's user-facing documentation into line with the shipped
changelog, adding the new feature areas and extending the command and settings
references.

## Finish Report (2026-06-26)

### Scope

Documentation only (`README.md`). No extension code, manifest, tests, or i18n
catalogs were touched. No changelog entry was added because the README is the
document being synced to the existing `[Unreleased]` changelog entries, not a new
behavior.

### What changed

Source of truth for every addition was the `[Unreleased]` section of
`CHANGELOG.md`. The README's existing structure and voice were preserved; content
was added, not reorganized.

**Extended existing sections:**

- **Schedule** — documented days-of-week, every-N-minutes/hours/days, full cron
  expressions with the friendly builder, run-on-workspace-open, and the new
  **Schedule & Workflow Planner** (Day ruler, draggable Week calendar, Workflow
  node graph).
- **Run scripts** — remembered last parameters and **Run with Last Parameters**,
  extract-a-value-from-output, the one-click fix button on a failed run, and the
  port-in-use kill-and-retry toast.
- **Recipes** — added the format / clean / upgrade recipes, open
  README/CHANGELOG/LICENSE/contributing links, and open-commit-history.
- **Project Files** — noted the live item count on the view title.

**New `## Features` subsections** (each in the README's existing bold-lead-in
style): live status badges + metrics + Saropa Dashboard; inspect-before-you-run
(Simulate / Peek / Diff / missing-file relocate); tag, filter, and focus;
branch-linked pins; pause, lock, and expire; single-instance runs with a
cross-process lock; workspace power tools (scratchpad, editor layout, .env
switch, boot sequence, shell-history pins, JSON edit, export/import); more pin
kinds and actions (line pin, tail -f, remote/external, template, Saropa link,
file-manager actions, drop-to-run, comments/separators); audio cues; Active AI
threads.

**Reference tables:**

- **Commands** — added roughly 25 rows covering Configure Triggers, the planner,
  pause/unpause, lock file, tag/filter, branch link, line pin, log follow, peek/
  simulate/diff, pin expiry, routines, hygiene scan, external/template/link, the
  file-manager actions, pin-set management, export/import/edit-JSON, focus,
  scratchpad/layout/.env, boot sequence, shell-history, the dashboard/monitor/
  Code-Health commands, run analytics, and restore-suggestions.
- **Settings** — added `sound.enabled` (default off), `previewMode.enabled`
  (default off), `hygiene.*`, and `processMonitor.heartbeat.enabled` (default
  off). Defaults were verified against the changelog's stated behavior.

### Verification

Doc accuracy was checked against `CHANGELOG.md`: setting defaults (sound,
preview mode, heartbeat all off by default), the run-when-idle 3-minute default,
the Alt+P peek binding, and command names. Markdown links use repo-relative paths
consistent with the surrounding document. No public-surface AI references were
introduced.
