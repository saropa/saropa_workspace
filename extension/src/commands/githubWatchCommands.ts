// "Watch a GitHub repo for new issues/PRs": the add-flow for a WatchKind "repo"
// watch, mirroring folderWatchAddCommands.ts's addFolderWatch/addFileWatch. Prompts
// for an "owner/repo" slug, triggers the GitHub sign-in prompt if needed (this is
// the one interactive auth call — background polling never prompts), and stores the
// watch. The engine seeds the baseline on its next scan, so adding a repo watch
// never floods the user with every issue/PR the repo already has open.
import * as vscode from "vscode";
import { FolderWatch, FolderWatchStore, watchKind } from "../model/folderWatch";
import {
  isValidRepoSlug,
  parseRepoSlug,
  fetchOpenRepoItems,
  detectRepoFromGit,
} from "../github/githubClient";
import { l10n } from "../i18n/l10n";
import { newId, creationScopes, notifyWatchChange } from "./folderWatchCommands";

export async function addGitHubRepoWatch(store: FolderWatchStore): Promise<void> {
  // Prefill from the active workspace folder's `origin` remote, if it resolves to a
  // GitHub repo — watching the project you're already in becomes a single confirm
  // instead of a copy-paste round trip to the browser. Silently falls through to an
  // empty box for every other case (no folder, not git, non-GitHub remote).
  const activeFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const detected = activeFolder ? await detectRepoFromGit(activeFolder) : undefined;
  const slug = await vscode.window.showInputBox({
    title: l10n("github.addRepoTitle"),
    prompt: l10n("github.addRepoPrompt"),
    placeHolder: "owner/repo",
    value: detected ? `${detected.owner}/${detected.repo}` : undefined,
    // Trim before validating so trailing whitespace (common when pasting from a
    // URL bar) does not block submission — matches the trim applied post-submit.
    validateInput: (value) =>
      isValidRepoSlug(value.trim()) ? undefined : l10n("github.invalidSlug"),
  });
  if (!slug) {
    return;
  }
  const trimmed = slug.trim();

  // GitHub owner/repo slugs are case-insensitive — normalize so "Facebook/react"
  // and "facebook/REACT" are recognized as the same target.
  const lower = trimmed.toLowerCase();
  const existing = store
    .list()
    .find((w) => watchKind(w) === "repo" && w.target.toLowerCase() === lower);
  if (existing) {
    notifyWatchChange(l10n("github.alreadyWatched", { repo: trimmed }));
    return;
  }

  const parsed = parseRepoSlug(trimmed);
  if (!parsed) {
    return;
  }

  // Optional narrowing: leave either box empty to alert on every open issue/PR (the
  // pre-filter default). Asked up front, before the auth/existence check, so a
  // cancel here (Escape) abandons the whole add-flow the same way an empty slug
  // does, rather than adding an unfiltered watch first and requiring a separate
  // edit step.
  const labelsInput = await vscode.window.showInputBox({
    title: l10n("github.addRepoTitle"),
    prompt: l10n("github.filterLabelsPrompt"),
    placeHolder: l10n("github.filterLabelsPlaceholder"),
  });
  if (labelsInput === undefined) {
    return;
  }
  const filterLabels = labelsInput
    .split(",")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const authorInput = await vscode.window.showInputBox({
    title: l10n("github.addRepoTitle"),
    prompt: l10n("github.filterAuthorPrompt"),
    placeHolder: l10n("github.filterAuthorPlaceholder"),
  });
  if (authorInput === undefined) {
    return;
  }
  const filterAuthor = authorInput.trim();

  // Interactive: this is the one place a repo-watch scan is allowed to prompt for
  // GitHub sign-in. Also doubles as an existence check — a typo'd repo fails here
  // with a clear message instead of silently never reporting anything.
  try {
    await fetchOpenRepoItems(parsed, true);
  } catch (err) {
    void vscode.window.showWarningMessage(
      l10n("github.addRepoFailed", {
        repo: trimmed,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return;
  }

  const watch: FolderWatch = {
    id: newId(),
    target: trimmed,
    kind: "repo",
    isFile: false,
    mode: "new",
    enabled: true,
    alertScopes: creationScopes(),
    filterLabels: filterLabels.length > 0 ? filterLabels : undefined,
    filterAuthor: filterAuthor.length > 0 ? filterAuthor : undefined,
  };
  await store.add(watch);
  notifyWatchChange(l10n("github.repoAdded", { repo: trimmed }));
}

// Change an existing repo watch's target slug in place, instead of remove +
// re-add (which would also lose the watch's label/scopes/filters). Re-validates
// and re-fetches the new slug exactly like the add-flow (existence check, doubles
// as an auth check for a private repo), then clears the baseline/unseen state
// because the old target's cached "issue:123" keys belong to a different repo — a
// stale baseline would either miss every item in the new repo as "already seen"
// or, worse, never seed and report nothing until a lucky diff.
export async function editGitHubRepoWatch(
  store: FolderWatchStore,
  watch: FolderWatch
): Promise<void> {
  const slug = await vscode.window.showInputBox({
    title: l10n("github.editRepoTitle"),
    prompt: l10n("github.addRepoPrompt"),
    value: watch.target,
    validateInput: (value) =>
      isValidRepoSlug(value.trim()) ? undefined : l10n("github.invalidSlug"),
  });
  if (!slug) {
    return;
  }
  const trimmed = slug.trim();
  if (trimmed.toLowerCase() === watch.target.toLowerCase()) {
    return;
  }

  const lower = trimmed.toLowerCase();
  const existing = store
    .list()
    .find(
      (w) => w.id !== watch.id && watchKind(w) === "repo" && w.target.toLowerCase() === lower
    );
  if (existing) {
    notifyWatchChange(l10n("github.alreadyWatched", { repo: trimmed }));
    return;
  }

  const parsed = parseRepoSlug(trimmed);
  if (!parsed) {
    return;
  }
  try {
    await fetchOpenRepoItems(parsed, true);
  } catch (err) {
    void vscode.window.showWarningMessage(
      l10n("github.addRepoFailed", {
        repo: trimmed,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return;
  }

  await store.update(watch.id, { target: trimmed });
  await store.clearBaseline(watch.id);
  await store.clearUnseen(watch.id);
  notifyWatchChange(l10n("github.repoRetargeted", { repo: trimmed }));
}
