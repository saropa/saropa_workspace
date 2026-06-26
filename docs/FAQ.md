# FAQ

## What is a shortcut?

A shortcut is a favorite file or script. **Single-click opens** it; **double-click
runs** it (within the configurable double-click window). You can also run a
shortcut from its inline play button or its context menu — the reliable run path
that does not depend on click timing.

## Project shortcuts vs global shortcuts — what is the difference?

- **Project shortcuts** are stored in `<folder>/.vscode/saropa-workspace.json`
  with paths relative to the folder. Commit that file and the shortcuts travel
  with the repository, shared with your team.
- **Global shortcuts** are stored in VS Code's `globalState` with absolute paths.
  They are personal to you and ride VS Code Settings Sync across your machines.

Pick project scope for "everyone working on this repo wants this", and global
scope for "this is my personal shortcut to a file anywhere on disk".

## Where is my data stored?

On your machine only. See [PRIVACY.md](PRIVACY.md) for the full breakdown. The
extension transmits nothing.

## Why does double-click sometimes not run a file?

Two reasons. First, double-click is a timing convenience layered on top of the
reliable run paths (inline play button, context-menu **Run**, the **Run
Shortcut…** palette) — VS Code tree views have no native double-click event, so
the timing window (`saropaWorkspace.doubleClickMs`) decides open vs run. Second, a
file with no run command (a plain document, image, or markdown with no
interpreter) is **opened** on double-click rather than sent to the shell, and the
extension tells you it has no run command. Set one with **Configure Run…**.

## What are auto-shortcuts?

Files matched by `saropaWorkspace.autoPins.patterns` are seeded automatically per
project (for example `pubspec.yaml`). You can remove an auto-shortcut — the
removal is remembered so it is not re-seeded — and restore all removed
auto-shortcuts on demand. Auto-shortcuts always sit at the top level and cannot be
grouped or given run parameters until you add them as shortcuts explicitly.

## What is the Project Files view?

A second, read-only view in the sidebar that lists interesting project files
(README, CHANGELOG, ROADMAP, package manifests) with each file's last-modified
time and declared version, so you can see whether the changelog is current and
what version the project is up to without opening anything. Configure it with
`saropaWorkspace.projectFiles.enabled` and `saropaWorkspace.projectFiles.files`.

## Can I run shortcuts on a schedule?

Yes. See [SCHEDULING.md](SCHEDULING.md).

## Can I import favorites from another extension?

Yes — Saropa Workspace detects and imports `.favorites.json` files (the kdcro101
"Favorites" format), and can scan immediate sibling projects for favorites and
import them as global shortcuts. The favorites import is offered once per workspace
when such a file is found, and is also available on demand.

## How do I bind a keyboard shortcut to a shortcut?

See [KEYBINDINGS.md](KEYBINDINGS.md).
