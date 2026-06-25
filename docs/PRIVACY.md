# Privacy

Saropa Workspace is local-first. Everything it records stays on your machine.

## No remote telemetry, no network

The extension makes **no network calls and sends no analytics or crash beacons**.
It does not phone home, and it does not require an account or a server to
function. Diagnostics stay in the local output channel.

It does keep some **local, on-device counters** to power features — a run history
for the Recent group, open-frequency counts for pin suggestions — but these live
in VS Code's own storage on your machine and are **never transmitted**. See "What
is stored, and where" below; you can disable each and clear the run history.

## What is stored, and where

All data lives on your machine:

- **Project pins** — in `<folder>/.vscode/saropa-workspace.json`, with paths
  relative to the folder. This file is part of your repository if you commit it,
  so it is shareable with your team. Nothing in it leaves your machine unless you
  publish the repository yourself.
- **Global pins** — in VS Code's extension `globalState`. This is synced across
  your own machines by VS Code Settings Sync (if you have it enabled), under your
  own account — never to Saropa.
- **Run history** — a small, bounded list of recently-run pins plus a lifetime
  run count per pin, kept in `globalState`, recording every run (manual and
  scheduled). It powers the **Recent** sidebar group and the "Run Pin…" palette's
  recents. On-device only, never transmitted. Turn collection off with
  `saropaWorkspace.telemetry.enabled`, or clear it with **Reset Run History**.
- **Open-frequency counts** — used by smart pin suggestions to offer to pin a
  file you open often. Counts are kept on this machine only, never transmitted,
  and each file is offered at most once. Turn the feature off with
  `saropaWorkspace.suggestions.enabled`.
- **Last-run status** — the success/failure and duration shown in the tree is
  kept in memory for the session only; it is not persisted and not transmitted.

## What the extension reads

To populate the views it reads files in your open workspace folders: the pins
file, and (for the **Project Files** view) a small set of well-known files such
as `README.md`, `CHANGELOG.md`, and package manifests, to show their
last-modified time and version. These reads are local; nothing read is sent
anywhere.

## Running scripts

Running a pin executes the command you configured, on your machine, in the
integrated terminal or a background output channel. The extension does not add,
inspect, or transmit anything about what you run.
