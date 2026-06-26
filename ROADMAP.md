# Saropa Workspace — Roadmap

Saropa Workspace is a Visual Studio Code extension for **file and script shortcuts**:
pin any file as a favorite — a single click opens it, a double click runs it. Pins are
project-scoped (committed in `.vscode/saropa-workspace.json`) or global (carried across
machines by Settings Sync), and each can carry run parameters, schedules, and groups. It
is part of the **Saropa Suite**.

## Where the plan lives

The forward-looking plan is maintained as **one document per backlog item** under
[`plans/`](plans/), each written against the verified code state rather than a summary —
where the plan and the code diverge, the plan records what is actually implemented today.

- **[`plans/roadmap/`](plans/roadmap/)** — the phased backlog (import coverage, multi-root
  refinements, branch-aware sets, the dashboard webview, tests, suite integration, and the
  rest). Start at its [README index](plans/roadmap/README.md) for status and suggested order.
- **[`plans/wow/`](plans/wow/)** — the "WOW" feature backlog (port auto-unwedge, ephemeral
  pins, the git conflict center, focus tags, instant search, and more). See its
  [README index](plans/wow/README.md).

## Reference

Standing design context that informs every item above:

- **[`plans/guides/principles.md`](plans/guides/principles.md)** — the design constraints
  every change must satisfy (local-first, no remote telemetry, native-first UX,
  translation-ready, forward-compatible data, safe execution).
- **[`plans/guides/competitive-landscape.md`](plans/guides/competitive-landscape.md)** —
  the survey of rival extensions, the feature gaps that drive the backlog, the import
  formats, and the VS Code API constraints to design around.

## What has shipped

See the [changelog](CHANGELOG.md) for shipped features, release by release.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to set up the extension, build it, run the
tests, and pick up an item from the plans above.
