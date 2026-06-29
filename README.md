<!-- # Saropa Workspace -->

<div align="center">

[![Saropa Workspace](https://raw.githubusercontent.com/saropa/saropa_workspace/main/images/banner.png)](https://marketplace.visualstudio.com/items?itemName=saropa.saropa-workspace)

</div>

# Saropa Workspace

**Pin files as shortcuts, run scripts with a double-click, and automate repository workflows.**
<br>
Developed by [Saropa](https://saropa.com) to make Flutter & Dart development faster.

<br>
<div align="center">

[![VS Marketplace](https://img.shields.io/badge/marketplace-saropa--workspace-blue?style=flat-square&logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=saropa.saropa-workspace) [![publisher](https://img.shields.io/badge/publisher-saropa-435489?style=flat-square&logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/publishers/saropa) [![GitHub stars](https://img.shields.io/github/stars/saropa/saropa_workspace?style=flat-square&logo=github)](https://github.com/saropa/saropa_workspace) [![GitHub forks](https://img.shields.io/github/forks/saropa/saropa_workspace?style=flat-square&logo=github)](https://github.com/saropa/saropa_workspace) [![GitHub issues](https://img.shields.io/github/issues/saropa/saropa_workspace?style=flat-square&logo=github)](https://github.com/saropa/saropa_workspace/issues) [![GitHub last commit](https://img.shields.io/github/last-commit/saropa/saropa_workspace?style=flat-square&logo=github)](https://github.com/saropa/saropa_workspace/commits)

[![VS Code](https://img.shields.io/badge/VS%20Code-1.74%2B-007ACC.svg?style=flat-square&logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com/) [![License: MIT](https://img.shields.io/badge/license-MIT-purple.svg?style=flat-square)](https://opensource.org/licenses/MIT)

</div>
<br>

> 💬 **Have feedback on Saropa Workspace?** Please share it by [opening an issue](https://github.com/saropa/saropa_workspace/issues/new) on GitHub!

---

Saropa Workspace maps your recurring shell scripts and critical platform configurations into a master sidebar menu. On initialization, it parses your manifests and `.git/config` to auto-generate **Recipes**. These are zero-config, one-click macros for tasks like formatting, linting, and tracking Git branch PRs. The true utility is the background automation engine. You can map scripts to specific file globs to execute headless tasks instantly on save. You can chain multiple commands into execution graphs or fire them off cron schedules while the editor is open. The environment state saves directly to a plain `.json` file inside `.vscode/`. Commit it, and your whole team inherits a fully automated project workspace without manual onboarding.
---

## Screenshot

<div align="center">

![Saropa Workspace sidebar and launcher](https://raw.githubusercontent.com/saropa/saropa_workspace/main/images/screenshot.png)

</div>

---

## Features

### 📌 Add & Open
* **Single-Click Access:** Pin any file via the editor title menu or Explorer right-click menu to open it instantly without hunting through directories.
* **Scoped Shortcuts:** Organize configurations into **Project Shortcuts** (shared repo-level) or **Global Shortcuts** (tied to your user profile).
* **Activity Badge:** Unused or newly added shortcuts carry a leading dot (●) and trigger a temporary badge count on the sidebar icon.
* **Launcher Board:** Access your tools via a dedicated bottom panel tab with searchable text filters, collapsible sections, and responsive column layouts.

### ▶️ Script Execution
* **Double-Click Runs:** Double-click a saved shortcut to trigger scripts inside the integrated terminal or a background channel.
* **Custom Environments:** Define runtime prefixes (`python`, `node`, `bash`), append CLI arguments, set working directories, and inject environment variables.
* **Dynamic Tokens:** Parameterize commands with interactive placeholder tokens like `${prompt:Label}` or `${pick:a,b,c}` that cache your last chosen response.
* **Process Handling:** Bypasses tree-view event limits with inline play buttons, displays last-run exit status flags, and offers quick force-kill commands.

### ⏰ Scheduling & Workflows
* **Automation Triggers:** Run saved scripts at designated times, repeating intervals, open events, or native cron expressions.
* **Visual Planner:** Wire shortcuts into graph chains or calendar sequences that respond to project hooks like git commits, pushes, or file saves.
* **In-Process Engine:** Runs lightweight tasks locally without external system configuration; a status-bar tracker keeps queued scripts visible.

### 🧩 Discovered Recipes
* **Auto-Detection:** Scans your codebase manifests and `.git/config` to stand up dynamic macros without manual entry.
* **Ecosystem Shortcuts:** Generates instant controls for package installs, formatting, lint diagnostics, repository PR paths, and local docker deployment.
* **Hygiene Tools:** Includes built-in sweeps like a `Workspace bloat scan` to clear directory conflicts and layout freezes.
* **Editable Promotion:** Keep scripts hidden, toggle entire recipe domains off, or choose `Promote to Shortcut` to customize a macro permanently.

---

## Technical Capabilities
* **Workspace Management:** Group configurations with drag-and-drop support, customize codicons/colors, or swap between isolated tool sets.
* **Smart Onboarding:** Infers runner profiles automatically for new `package.json` or `Makefile` entries, and suggests shortcuts for heavily pinned files.
* **Ecosystem Diagnostics:** Tracks modification histories via the `Project Files` pane, calculates code health indexes, and exposes background execution logs.

---

## Project vs Global Scopes

| Scope | Storage Location | Sharing Method |
| ----- | ---------------- | -------------- |
| **Project** | `.vscode/saropa-workspace.json` | Commit to git — the entire team shares the same build shortcuts. |
| **Global** | VS Code User Profile | Synced across your development environments via Settings Sync. |

---

## Execution Fallbacks

VS Code trees lack native double-click handling, so the extension monitors click gaps via `saropaWorkspace.doubleClickMs` (default **400 ms**). If click intervals feel erratic on your hardware, use the explicit **inline play button** or the right-click **Run** menu for deterministic execution.

---

## Settings Reference (`saropaWorkspace.*`)

| Setting | Default | Purpose |
| ------- | ------- | ----------- |
| `autoPins.patterns` | `["pubspec.yaml", ...]` | Sets target files to automatically pin on new workspaces. |
| `doubleClickMs` | `400` | Window in milliseconds to capture run commands vs open events. |
| `defaultUseIntegratedTerminal` | `true` | Routes output to the integrated terminal instead of background logs. |
| `recipes.enabled` | `true` | Enables auto-parsing of manifests to stand up default macros. |
| `aiContext.enabled` | `true` | Displays active markdown chat files in a dedicated sidebar group. |

```json
{
  "saropaWorkspace.interpreterDefaults": {
    ".py": "python",
    ".js": "node",
    ".ts": "ts-node",
    ".sh": "bash"
  }
}
```

---

## Command Reference

| Command | Action |
| ------- | ------ |
| **Configure Run…** | Single form for prefixes, parameters, env flags, file watches, and execution locations. |
| **Configure Schedule…** | Interface for interval frequencies, times, and raw cron expressions. |
| **Run Shortcut with Overrides…** | Launches an execution block with temporary, one-off runtime arguments. |
| **Import Favorites…** | Scrapes external manager extensions and sibling folders to pull shortcuts. |

---

## Part of the Saropa Suite

| Extension | Core Purpose |
| --------- | ------------ |
| **Saropa Workspace** | Automated script runners, workspace pinning, and cron workflows. |
| **Saropa Lints** | Static security and behavior analysis profiles for Flutter & Dart. |
| **Saropa Log Capture** | Persistent, indexed application log streams inside the editor. |
| **Saropa Drift Advisor** | SQLite runtime tracking and profiling mechanics. |

---

## Contact & License

* **Support:** [dev@saropa.com](mailto:dev@saropa.com)
* **License:** [MIT](https://github.com/saropa/saropa_workspace/blob/main/LICENSE) — open usage.

[GitHub][github_link] | [Issues][issues_link] | [Saropa Suite][suite_link]

[github_link]: https://github.com/saropa/saropa_workspace
[issues_link]: https://github.com/saropa/saropa_workspace/issues
[suite_link]: https://marketplace.visualstudio.com/items?itemName=saropa.saropa-suite
[saropa_link]: https://saropa.com
