# Plan: HubGrid — a watched-repos dashboard panel

Status: implemented (changelog entry under 2.8.0). Built differently from the first draft in four places, recorded under "Built differently" at the end.

## Why this replaces the original draft

The original draft specified a standalone web app: GitHub App webhooks into a
Go/Rust edge service, a Redis stream, a Socket.io cluster, Next.js SSR, React +
Zustand, and `@tanstack/react-virtual`. None of that fits this codebase — this
is a VS Code extension, not a hosted web service, and it already has a working
GitHub repo-watch feature (poll-based, `globalState`-backed) plus eleven existing
webview panels built on a shared, dependency-free pattern (static HTML shell +
inlined CSS/JS + `postMessage`). This plan reuses that pattern instead of
introducing a server, a build step, or a UI framework.

What survives from the original draft, adapted to a webview: the dense
single-row-per-item layout, filtering by repo/status, keyboard
navigation, a rate-limit notice, and copy-link actions. Dropped entirely:
webhooks/Redis/WebSockets (the extension polls REST on a timer already), the
Next.js URL-routing/deep-link scheme (webview panels have no URL bar), and
React/Zustand/virtualization (unnecessary at the scale of a handful of watched
repos).

## Feature recap: what already exists

- **Model**: `FolderWatch` (`kind: "repo"`, `target` = `"owner/repo"`) in
  `extension/src/model/folderWatch.ts`; `GitHubWatchItem` /`RepoSlug` in
  `extension/src/github/githubTypes.ts`.
- **Client**: `fetchOpenRepoItems()` in `extension/src/github/githubClient.ts`
  (VS Code's built-in GitHub auth provider).
- **Engine**: `FolderWatchEngine` (`extension/src/exec/folderWatchEngine.ts`)
  polls every `saropaWorkspace.github.pollIntervalMinutes` (default 5), diffs
  against a stored baseline, toasts new issues/PRs, and keeps an in-memory
  `repoItemsCache: Map<watchId, GitHubWatchItem[]>` exposed via
  `getCachedRepoItems(watchId)`.
- **Persistence**: `FolderWatchStore` — `globalState` keys for the watch list,
  per-watch baselines, and per-watch unseen-item keys.
- **Current UI**: `WatchesTreeProvider` — a flat sidebar tree, one row per
  watch, click opens the newest unseen item externally.

There is no dashboard/table view of watched-repo activity today — only the
tree row plus toast notifications. HubGrid adds that view.

## Architecture

One new webview panel, following the `dashboardPanel.ts` /
`dashboardShell.ts` / `dashboardAssets.ts` split already used by the other
nine panels — no new dependencies, no bundler changes.

```
extension/src/views/
  hubGridPanel.ts    lifecycle: singleton panel, message dispatch, refresh
  hubGridShell.ts     static HTML shell, CSP + per-load nonce
  hubGridAssets.ts    inlined CSS + client-side script (vanilla JS)
```

### Data flow

1. Command `saropaWorkspace.showHubGrid` (title-bar button on the Watches
   view, next to the existing watch/manage buttons) opens or reveals the
   panel.
2. Host reads all `kind: "repo"` watches from `FolderWatchStore`, and for
   each: `engine.getCachedRepoItems(watch.id)` + `store.unseenKeys(watch.id)`.
   No new network calls — this reuses the engine's existing poll cache.
3. Host posts one `load` message: flattened item list (each item carries its
   owning repo slug), the unseen-key set, and per-repo rate-limit state if
   the engine recorded a 403 on last poll.
4. Client renders one dense table row per item — status icon
   (issue vs. PR, draft), repo tag, `#number`, title (CSS `truncate`),
   labels, relative "updated" time — styled entirely with `--vscode-*`
   tokens, matching the editor theme automatically (no hardcoded palette).
5. Filter bar: buttons for "All" / each watched repo, driven client-side
   against the already-loaded item list — no re-fetch.
6. Keyboard: `j`/`k`/arrows move a focused-row index (a CSS `outline`, not a
   real DOM `tabindex` sweep — the item count here is realistically dozens,
   not thousands, so no virtualization is needed); `Enter` opens the row.
   The table uses a semantic `<table>` with `role="grid"`, rows carry
   `role="row"`, and the active row is marked with `aria-activedescendant`.
   Filter buttons carry `aria-pressed`; filter changes announce the visible
   count via an `aria-live="polite"` region.
7. Row click or `Enter` -> `postMessage({ type: "open", htmlUrl, watchId,
   itemKey })` -> host calls `vscode.env.openExternal` and clears that item's
   unseen flag via `store.clearUnseen()` (mirrors `openRepoWatch()`'s
   existing behavior).
8. Copy button -> `postMessage({ type: "copy", text })` -> host calls
   `vscode.env.clipboard.writeText` (there is no in-webview clipboard API
   guarantee in VS Code, so this always round-trips through the host).
9. Refresh button -> `postMessage({ type: "refresh" })` -> host triggers
   `engine.reconcileWatchers()` for repo watches, then re-posts `load` once
   the poll completes.
10. Rate limiting: if the engine's last scan recorded a GitHub 403, the panel
    shows a dismissible banner naming the affected repo and the reset time
    (the engine already computes this for its toast/warning path — reuse it,
    don't re-derive).
11. Empty state: when no `kind: "repo"` watches exist, or all watch caches are
    empty (first load before the first poll completes), the panel shows a
    centered empty-state message with a link/button to add a watch — same
    pattern as the board panel's empty state.

### Data model additions

None required. `GitHubWatchItem` already has everything a row needs
(`kind`, `number`, `title`, `htmlUrl`, `author`, `updatedAt`, `labels`,
`draft`). The panel is a read-only projection of existing state — the only
new persisted value is none; open/unseen state continues to live in
`FolderWatchStore` exactly as it does for the tree view today.

### i18n

All panel strings go through `l10n()` + `src/i18n/locales/en.json`, same as
every other webview (see `dashboardShell.ts` for the pattern of injecting a
localized `STRINGS` object into the client script).

## Explicitly out of scope

- Any server component, webhook ingestion, or push delivery. Polling on the
  existing timer is the only data path.
- URL-based deep linking / shareable filtered views — a VS Code webview has
  no addressable URL to share; "share" here means "copy issue/PR link,"
  which the existing action bar already covers.
- A UI framework or virtualized list library. Plain DOM row rendering is
  sufficient at this scale and keeps the panel dependency-free like its
  siblings.
- Multi-window/multi-client state sync — `FolderWatchStore` already handles
  this via `globalState` and the existing `onDidChange` events; the panel
  just needs to repaint on those, same as the tree view does.

## Work items

1. `hubGridShell.ts` + `hubGridAssets.ts` + `hubGridPanel.ts`: static shell,
   CSP+nonce, inlined CSS (dense single-row layout, filter bar, banner),
   client script (render, filter, keyboard nav, message posting), and
   singleton panel class. These three files share a message contract and
   ship as one build step. The panel class gathers data from
   `FolderWatchStore` + `FolderWatchEngine`, handles `open`/`copy`/`refresh`
   messages, and repaints on `store.onDidChange` / `onDidChangeCounts`.
   Repaint is debounced — multiple rapid `onDidChange` fires (e.g. the
   engine reconciling several watches in one cycle) collapse into a single
   `load` post, not one per watch.
2. Command registration: `saropaWorkspace.showHubGrid` in
   `folderWatchCommands.ts`, wired in `wiringWatchers.ts`.
3. `package.json`: command entry + `view/title` menu contribution on
   `saropaWorkspace.watches`, `package.nls.json` title key.
4. `src/i18n/locales/en.json`: new keys for panel title, filter labels,
   empty state, rate-limit banner text.
5. Tests: unit tests for the host-side data-gathering logic — flattening
   items across watches, merging unseen keys, debounce behavior. Pure
   functions, no VS Code host dependency, run under `node --test`.
6. Update root `CHANGELOG.md` `## [Unreleased]` once shipped.

No changes needed to `folderWatch.ts`, `githubClient.ts`, `githubTypes.ts`,
or the engine's polling/diff logic — this is a new read surface over data
that already exists.

## Built differently from the first draft

- Messages carry ids only. `open` and `copy` send `{ watchId, itemKey }`; the host resolves the URL from the engine cache. The page never supplies a URL or clipboard text, so a tampered message cannot open an arbitrary address.
- Opening one row marks only that item seen. `FolderWatchStore.markSeen(id, key)` was added because `clearUnseen(id)` clears the whole watch, which would mark siblings the user never looked at.
- The engine did not record rate-limit state (only an output-channel line). It now records each repo watch's last scan error (`getRepoScanError`), fires `onDidScanRepo` after every repo scan, and exposes `refreshRepoWatches()` (the Refresh button). The banner reads the scan error; a leading 403 or 429 selects the rate-limit wording. `reconcileWatchers` stayed private.
- Registration is in `folderWatchCommands.ts`, which `activation/wiringWatchers.ts` already calls, so no wiring file changed. Data shaping lives in `views/hubGridData.ts` (no vscode import, unit tested).
