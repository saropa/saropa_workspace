# Plan: HubGrid — a watched-repos dashboard panel

## Why this replaces the original draft

The original draft specified a standalone web app: GitHub App webhooks into a
Go/Rust edge service, a Redis stream, a Socket.io cluster, Next.js SSR, React +
Zustand, and `@tanstack/react-virtual`. None of that fits this codebase — this
is a VS Code extension, not a hosted web service, and it already has a working
GitHub repo-watch feature (poll-based, `globalState`-backed) plus nine existing
webview panels built on a shared, dependency-free pattern (static HTML shell +
inlined CSS/JS + `postMessage`). This plan reuses that pattern instead of
introducing a server, a build step, or a UI framework.

What survives from the original draft, adapted to a webview: the dense
single-row-per-item layout (`SmartRow`), filtering by repo/status, keyboard
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
4. Client renders one `SmartRow`-style table row per item — status icon
   (issue vs. PR, draft), repo tag, `#number`, title (CSS `truncate`),
   labels, relative "updated" time — styled entirely with `--vscode-*`
   tokens, matching the editor theme automatically (no hardcoded palette).
5. Filter bar: buttons for "All" / each watched repo, driven client-side
   against the already-loaded item list — no re-fetch.
6. Keyboard: `j`/`k`/arrows move a focused-row index (a CSS `outline`, not a
   real DOM `tabindex` sweep — the item count here is realistically dozens,
   not thousands, so no virtualization is needed); `Enter` opens the row.
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

1. `hubGridShell.ts` + `hubGridAssets.ts`: static shell, CSP+nonce, inlined
   CSS (SmartRow layout, filter bar, banner) and client script (render,
   filter, keyboard nav, message posting).
2. `hubGridPanel.ts`: singleton panel class, gathers data from
   `FolderWatchStore` + `FolderWatchEngine`, message handlers for
   `open`/`copy`/`refresh`, repaints on `store.onDidChange` /
   `onDidChangeCounts`.
3. Command registration: `saropaWorkspace.showHubGrid` in
   `folderWatchCommands.ts` (or a new `hubGridCommands.ts` if that file is
   getting large), wired in `wiringWatchers.ts`.
4. `package.json`: command entry + `view/title` menu contribution on
   `saropaWorkspace.watches`, `package.nls.json` title key.
5. `src/i18n/locales/en.json`: new keys for panel title, filter labels,
   empty state, rate-limit banner text.
6. Update root `CHANGELOG.md` `## [Unreleased]` once shipped.

No changes needed to `folderWatch.ts`, `githubClient.ts`, `githubTypes.ts`,
or the engine's polling/diff logic — this is a new read surface over data
that already exists.
