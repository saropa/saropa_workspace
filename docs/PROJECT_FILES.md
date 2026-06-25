# Project Files view

A second, read-only view in the Saropa Workspace sidebar that shows the
project's interesting files at a glance — so you can see whether the changelog is
current and what version the project is up to without opening anything.

## What it shows

For each configured file that exists in a workspace folder, the view shows a row
with:

- the **file name** (with its themed file-type icon),
- **when it was last modified** — relative for recent edits ("just now",
  "5m ago", "3h ago", "3d ago"), then an absolute date beyond a week, and
- the **declared version**, where the file type carries one.

Single-click a row to open the file. The version, when present, leads the row so
"what version is this up to?" is answered first; the freshness follows it. The
tooltip shows the full path, the version, and the absolute last-modified time.

## Default file list

Each file is shown only when it actually exists:

```
README.md
CHANGELOG.md
ROADMAP.md
CONTRIBUTING.md
SECURITY.md
LICENSE
LICENSE.md
package.json
pubspec.yaml
Cargo.toml
pyproject.toml
go.mod
```

Change the list with `saropaWorkspace.projectFiles.files` (root-relative file
names). Hide the view entirely with `saropaWorkspace.projectFiles.enabled`.

## Where the version comes from

| File | Version source |
| ---- | -------------- |
| `package.json` | the `"version"` field |
| `pubspec.yaml` | the top-level `version:` line |
| `Cargo.toml` | the `version = "…"` line |
| `pyproject.toml` | the `version = "…"` line |
| `CHANGELOG.md` | the newest release heading (the `[Unreleased]` placeholder is skipped) |

Any other surfaced file shows its last-modified time only.

## How "last modified" is determined

The time is the file's modification time on disk (mtime), so it reflects your
**live edits** as soon as you save — which is exactly what answers "is the
changelog updated?". It is not the git commit time. The view refreshes when a
file is saved, when workspace folders change, and from the refresh button in the
view's title bar.

## Notes

- The scan is stat-based and reads file content only for the small set of
  version-bearing files above — there is no project-wide crawl.
- With more than one workspace folder open, files are grouped under their owning
  folder so the same name in two folders stays distinguishable.
- The view is local-only and transmits nothing; see [PRIVACY.md](PRIVACY.md).
