// "Watch a GitHub repo for new issues/PRs": the add-flow for a WatchKind "repo"
// watch, mirroring folderWatchAddCommands.ts's addFolderWatch/addFileWatch. Prompts
// for an "owner/repo" slug, triggers the GitHub sign-in prompt if needed (this is
// the one interactive auth call — background polling never prompts), and stores the
// watch. The engine seeds the baseline on its next scan, so adding a repo watch
// never floods the user with every issue/PR the repo already has open.
import * as vscode from "vscode";
import { FolderWatch, FolderWatchStore, watchKind } from "../model/folderWatch";
import { isValidRepoSlug, parseRepoSlug, fetchOpenRepoItems } from "../github/githubClient";
import { getGitRemote } from "../recipes/gitMeta";
import { RepoSlug } from "../github/githubTypes";
import { l10n } from "../i18n/l10n";
import { newId, creationScopes, notifyWatchChange } from "./folderWatchCommands";

// GitHub owner/repo slugs are case-insensitive — "Facebook/react" and
// "facebook/REACT" are the same target. Shared by the add- and edit-flows so the
// two can never define "already watching this" differently; `excludeId` lets the
// edit-flow check every OTHER repo watch without flagging the one being edited
// against its own (about-to-change) target.
function findDuplicateRepoWatch(
  store: FolderWatchStore,
  slug: string,
  excludeId?: string
): FolderWatch | undefined {
  const lower = slug.toLowerCase();
  return store
    .list()
    .find(
      (w) => w.id !== excludeId && watchKind(w) === "repo" && w.target.toLowerCase() === lower
    );
}

// Confirms a slug resolves to a real, reachable repo before it's stored — doubles
// as the one interactive GitHub sign-in prompt (see file header), so a typo'd or
// private-and-inaccessible repo fails here with a clear message instead of a watch
// that silently never reports anything. Shared by add and edit since both need the
// exact same check before committing a target.
async function verifyRepoReachable(parsed: RepoSlug, trimmedSlug: string): Promise<boolean> {
  try {
    await fetchOpenRepoItems(parsed, true);
    return true;
  } catch (err) {
    void vscode.window.showWarningMessage(
      l10n("github.addRepoFailed", {
        repo: trimmedSlug,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return false;
  }
}

// Best-effort "owner/repo" for the active workspace folder's `origin` remote, used
// to prefill the add-repo-watch input box so watching the project you're already in
// is a single confirm instead of a copy-paste round trip to the browser. Reuses the
// URL-recipes' git reader (reads .git/config directly, no `git` process) rather
// than a second hand-rolled remote parser. Returns undefined for every ordinary
// "not applicable" case (no folder, not git, no origin, a non-GitHub remote).
async function detectActiveRepo(): Promise<RepoSlug | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return undefined;
  }
  const remote = await getGitRemote(folder);
  return remote?.host === "github" ? { owner: remote.owner, repo: remote.repo } : undefined;
}

export async function addGitHubRepoWatch(store: FolderWatchStore): Promise<void> {
  const detected = await detectActiveRepo();
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

  if (findDuplicateRepoWatch(store, trimmed)) {
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

  if (!(await verifyRepoReachable(parsed, trimmed))) {
    return;
  }

  const scopes = creationScopes();
  const watch: FolderWatch = {
    id: newId(),
    target: trimmed,
    kind: "repo",
    isFile: false,
    mode: "new",
    enabled: true,
    alertScopes: scopes,
    // A folder watch always alerts in its own containing project regardless of
    // alertScopes (watchAlertsIn's rule 2) — but a repo slug has no "containing
    // project", so that automatic fallback does not apply to it (see
    // watchAlertsIn). Adding one with no folder open therefore leaves it with no
    // home at all: alertScopes is undefined AND there is no owning project to fall
    // back to, so it would never alert anywhere until someone finds it in Manage
    // Watches and opts a project in by hand. Defaulting to global in exactly that
    // one case (no folder open at creation) gives it a home instead of a silent
    // dead end; a folder is open, it still gets the normal project-scoped default.
    global: scopes === undefined ? true : undefined,
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

  if (findDuplicateRepoWatch(store, trimmed, watch.id)) {
    notifyWatchChange(l10n("github.alreadyWatched", { repo: trimmed }));
    return;
  }

  const parsed = parseRepoSlug(trimmed);
  if (!parsed) {
    return;
  }
  if (!(await verifyRepoReachable(parsed, trimmed))) {
    return;
  }

  await store.update(watch.id, { target: trimmed });
  await store.clearBaseline(watch.id);
  await store.clearUnseen(watch.id);
  notifyWatchChange(l10n("github.repoRetargeted", { repo: trimmed }));
}
