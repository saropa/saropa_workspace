# Privacy

Saropa Workspace is local-first and collects nothing.

## No telemetry, no network

The extension has **no analytics, no usage counters, no crash beacons, and no
network calls**. It does not phone home, and it does not require an account or a
server to function. Diagnostics stay in the local output channel.

## What is stored, and where

All data lives on your machine:

- **Project pins** — in `<folder>/.vscode/saropa-workspace.json`, with paths
  relative to the folder. This file is part of your repository if you commit it,
  so it is shareable with your team. Nothing in it leaves your machine unless you
  publish the repository yourself.
- **Global pins** — in VS Code's extension `globalState`. This is synced across
  your own machines by VS Code Settings Sync (if you have it enabled), under your
  own account — never to Saropa.
- **Recently-run list** — a small, bounded list kept in `globalState` so the
  "Run Pin…" palette can show recents first. On-device only.
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
