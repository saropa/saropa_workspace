# Security Policy

## Supported Versions

We support the latest published version of Saropa Workspace on the
[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=saropa.saropa-workspace).
Please always use the latest version to ensure you have any security patches.

| Version | Supported          |
|---------|--------------------|
| 0.1.x   | :white_check_mark: |
| < 0.1.0 | :x:                |

## Scope

Saropa Workspace is a Visual Studio Code extension that runs locally inside
your editor. It manages "pins" (shortcuts to files and scripts) and can run
the scripts you pin.

What it does:

- Stores project pins in a workspace file (`.vscode/saropa-workspace.json`)
  and global/user pins in the extension's `globalState` (synced via VS Code
  Settings Sync when you enable that).
- Executes scripts **you choose to pin**, using the command prefix, args,
  working directory, and environment variables you configure per pin. These
  run through the integrated terminal or a background output channel on your
  own machine, with your own permissions.

What it does **not** do:

- It sends and phones home nothing — no remote telemetry, no analytics, no
  network calls. The only data it keeps (a local run history and pin-suggestion
  counts) lives in VS Code's storage on your machine and is never transmitted.
- It does not require network access or external services for its own
  operation.
- It does not run anything you did not explicitly pin and trigger.

Because the extension runs scripts on your behalf, treat a pinned script the
same way you would treat any local executable: only pin files you trust, and
review the run parameters (command prefix, args, cwd, env) before running a
pin you did not create yourself — for example, one imported from a shared
`.favorites.json`.

## Reporting a Vulnerability

If you discover a security vulnerability in Saropa Workspace, please report
it responsibly.

**For security issues:** Email [security@saropa.com](mailto:security@saropa.com)

**For general bugs:** Open an issue at
[github.com/saropa/saropa_workspace/issues](https://github.com/saropa/saropa_workspace/issues)

You should expect a response within 48 hours. Please provide:

- A description of the vulnerability
- Steps to reproduce the issue
- Potential impact assessment

We appreciate responsible disclosure and will acknowledge contributors
in our release notes (unless you prefer to remain anonymous).
