// Toast text and actions for the folder/file/repo watches: list formatting, the
// new-vs-changed wording and the open action. Split out of folderWatchEngine.
import * as vscode from "vscode";
import * as path from "path";
import { FolderWatch, FolderWatchDelta } from "../model/folderWatch";
import { l10n } from "../i18n/l10n";
import { GitHubWatchItem, newestRepoItem } from "../github/githubTypes";

// How many filenames a toast lists before collapsing the rest into "+N more", so a
// burst of new files names the first few (UX: name the item) without an unbounded
// wall of text.
const MAX_LISTED = 5;

// List up to MAX_LISTED item titles as "#N title", then "+N more", mirroring
// formatFiles for the repo-watch toast.
function formatItems(items: GitHubWatchItem[]): string {
  const shown = items.slice(0, MAX_LISTED).map((i) => `#${i.number} ${i.title}`);
  const extra = items.length - shown.length;
  return extra > 0
    ? l10n("folderWatch.fileListMore", { files: shown.join(", "), more: extra })
    : shown.join(", ");
}

// List up to MAX_LISTED filenames, then "+N more", so the toast names files
// without an unbounded list. Basename only — the folder is already named.
function formatFiles(files: string[]): string {
  const shown = files
    .slice(0, MAX_LISTED)
    .map((f) => f.split("/").pop() ?? f);
  const extra = files.length - shown.length;
  return extra > 0
    ? l10n("folderWatch.fileListMore", { files: shown.join(", "), more: extra })
    : shown.join(", ");
}

export async function toastFolderDelta(
  watch: FolderWatch,
  delta: FolderWatchDelta,
  isStartup: boolean,
  label: string
): Promise<void> {
  // Ordered new-then-changed so the listed filenames line up with the split
  // counts the message states.
  const files = [...delta.added, ...delta.changed];
  const summary = formatFiles(files);
  const hasAdded = delta.added.length > 0;
  const hasChanged = delta.changed.length > 0;
  // Name new vs changed precisely rather than collapsing both into one
  // ambiguous "new or changed" verb: a batch that is purely edits must read as
  // "changed" (not "new"), and a mixed batch states each count so the reader
  // knows which files arrived vs which were edited. The startup variants add
  // the "while you were away" framing for closed-window arrivals.
  let message: string;
  if (hasAdded && hasChanged) {
    message = l10n(
      isStartup ? "folderWatch.mixedFilesStartup" : "folderWatch.mixedFiles",
      {
        added: delta.added.length,
        changed: delta.changed.length,
        label,
        files: summary,
      }
    );
  } else if (hasChanged) {
    message = l10n(
      isStartup
        ? "folderWatch.changedFilesStartup"
        : "folderWatch.changedFiles",
      { count: delta.changed.length, label, files: summary }
    );
  } else {
    message = l10n(
      isStartup ? "folderWatch.newFilesStartup" : "folderWatch.newFiles",
      { count: delta.added.length, label, files: summary }
    );
  }

  const open = l10n("folderWatch.open");
  const choice = await vscode.window.showInformationMessage(message, open);
  if (choice !== open) {
    return;
  }
  // Open the first changed/new file (folder watch) or the target itself (file
  // watch), so the action lands the user on the thing the toast named.
  const first = files[0];
  const toOpen = watch.isFile
    ? vscode.Uri.file(watch.target)
    : vscode.Uri.file(path.join(watch.target, first));
  try {
    await vscode.window.showTextDocument(toOpen, { preview: true });
  } catch {
    // A binary or unopenable file: reveal it in the Explorer instead of failing.
    await vscode.commands.executeCommand("revealInExplorer", toOpen);
  }
}

// Toast for a repo watch: names the new issues/PRs by title (not just a count,
// matching the folder-watch toast's "name the item" convention) and opens the
// newest one on GitHub. delta.added holds the composite keys ("issue:123");
// delta.changed is always empty for a repo watch (mode is fixed to "new").
export async function toastRepoItems(
  delta: FolderWatchDelta,
  items: GitHubWatchItem[],
  label: string
): Promise<void> {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const newItems = delta.added
    .map((key) => byKey.get(key))
    .filter((i): i is GitHubWatchItem => i !== undefined);
  if (newItems.length === 0) {
    return;
  }
  const issueCount = newItems.filter((i) => i.kind === "issue").length;
  const prCount = newItems.filter((i) => i.kind === "pr").length;
  const summary = formatItems(newItems);

  let message: string;
  if (issueCount > 0 && prCount > 0) {
    message = l10n("github.newMixed", {
      issues: issueCount,
      prs: prCount,
      label,
      items: summary,
    });
  } else if (prCount > 0) {
    message = l10n("github.newPrs", { count: prCount, label, items: summary });
  } else {
    message = l10n("github.newIssues", { count: issueCount, label, items: summary });
  }

  const open = l10n("folderWatch.open");
  const choice = await vscode.window.showInformationMessage(message, open);
  if (choice !== open) {
    return;
  }
  const target = newestRepoItem(newItems);
  if (target) {
    await vscode.env.openExternal(vscode.Uri.parse(target.htmlUrl));
  }
}
