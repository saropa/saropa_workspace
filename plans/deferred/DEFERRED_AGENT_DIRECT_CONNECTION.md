# Deferred: direct agent connection to the Release Board

Status: deferred, not built (owner decision 36, 2026-10-30, in `plans/PLAN_RELEASE_BOARD_REDESIGN.md`, section 16).

## What it is

An MCP server or VS Code language-model tool that lets an AI agent read the Release Board itself (items, lights, groups, links) and submit changes itself, with no copy, paste or file hand-over by the owner.

## Why deferred

- The VS Code language-model tool API needs a newer engine than the extension's current `engines.vscode` of `^1.74.0`.
- An MCP route needs a long-running background server that the extension would have to start, secure and keep alive.
- The three channels that ship with the hand-off (a short referral command, the saved document file, a terminal command) already work with every agent, with no vendor dependency.

## Trigger to revisit

After handoff phase 3 (Bring back: patch schema, paste, folder watch, review list, apply) ships and has been used. Revisit then if owners still paste or move files by hand often enough to justify it.

## Design sketch (from plan section 16)

- Read: the same pure payload builder as the hand-off (scopes, filters, project-relative ids `project:path`, `rev` stamps), exposed as a read tool.
- Write: the agent submits a `saropa.releaseBoard.patch/1` document. Allowed operations only: `setStatus`, `setSeverity`, `addNeeds`, `removeNeeds`, `setGroup`. Nothing else is accepted.
- Review: a submitted patch goes into the same review list as a pasted one. Nothing changes until the owner applies it, with one Undo, and the history line reads "from AI proposal".
- The board never calls an AI and no light is computed by an AI; the agent is the caller, never the board.
- Privacy: the same filter as the hand-off (project-relative paths, no document bodies, secret patterns removed).

## Open questions

- MCP server or VS Code language-model tool, or both? Which engine version would the extension then require?
- Who starts and stops the server, and on which local port or channel? How is it kept local-only and authenticated?
- Does a submitted patch wait in the review list until the board panel is open, or show a notification?
- How are several agents or projects at once handled (ids, stale `rev` checks, one pending patch per hand-off)?
- Is read access enough for a first version, with writes still going through the file or paste route?
