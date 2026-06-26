import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";

// The `.env` context switcher (WOW #10): swap the active `.env` between the
// `.env.<name>` profiles a project keeps (`.env.staging`, `.env.prod`, ...), instead
// of renaming files by hand. The active file is always `.env`; each profile is the
// source of truth for one environment, copied over `.env` when selected.

// Suffixes that look like `.env.<name>` but are NOT switchable profiles: templates
// shipped for reference, and our own backup file. Excluded so the switcher only
// offers real environments.
const NON_PROFILE_SUFFIXES = new Set([
  "example",
  "sample",
  "template",
  "dist",
  "bak",
  "backup",
]);
const ACTIVE_ENV = ".env";
// Single rolling backup of the active `.env` taken right before a switch overwrites
// a hand-edited file, so manual edits are recoverable.
const BACKUP_ENV = ".env.bak";

interface EnvProfile {
  // The environment name ("staging" from ".env.staging").
  name: string;
  fileName: string;
  uri: vscode.Uri;
}

interface FolderProfiles {
  folder: vscode.WorkspaceFolder;
  profiles: EnvProfile[];
}

// Read a file as utf8 text, or undefined when it does not exist. Used both to load a
// profile and to read the current `.env` for the match/backup checks.
async function readTextOrUndefined(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return undefined;
  }
}

// Discover the `.env.<name>` profiles directly under a folder. The bare `.env` is the
// active file, not a profile; templates and the backup are filtered out.
async function discoverProfiles(
  folder: vscode.WorkspaceFolder
): Promise<EnvProfile[]> {
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(folder.uri);
  } catch {
    return [];
  }
  const profiles: EnvProfile[] = [];
  for (const [name, type] of entries) {
    if (type !== vscode.FileType.File) {
      continue;
    }
    const match = /^\.env\.([A-Za-z0-9_-]+)$/.exec(name);
    if (!match) {
      continue;
    }
    if (NON_PROFILE_SUFFIXES.has(match[1].toLowerCase())) {
      continue;
    }
    profiles.push({
      name: match[1],
      fileName: name,
      uri: vscode.Uri.joinPath(folder.uri, name),
    });
  }
  return profiles.sort((a, b) => a.name.localeCompare(b.name));
}

// Which profile, if any, the current `.env` content matches exactly. Returns
// undefined when `.env` is absent OR carries content that matches no profile (the
// hand-edited case the backup path protects).
async function activeProfileName(
  activeContent: string | undefined,
  profiles: EnvProfile[]
): Promise<string | undefined> {
  if (activeContent === undefined) {
    return undefined;
  }
  for (const profile of profiles) {
    const content = await readTextOrUndefined(profile.uri);
    if (content !== undefined && content === activeContent) {
      return profile.name;
    }
  }
  return undefined;
}

// The outcome of choosing a folder: a folder with its profiles, "none" when no
// folder has any profile, or "canceled" when the user dismissed the multi-folder
// pick. The three cases drive distinct responses (proceed / inform / silent no-op).
type FolderChoice = FolderProfiles | "none" | "canceled";

// Pick the workspace folder to operate on: the only one with profiles, or a chosen
// one when several qualify.
async function pickFolder(): Promise<FolderChoice> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const withProfiles: FolderProfiles[] = [];
  for (const folder of folders) {
    const profiles = await discoverProfiles(folder);
    if (profiles.length > 0) {
      withProfiles.push({ folder, profiles });
    }
  }
  if (withProfiles.length === 0) {
    return "none";
  }
  if (withProfiles.length === 1) {
    return withProfiles[0];
  }
  const picked = await vscode.window.showQuickPick(
    withProfiles.map((entry) => ({
      label: entry.folder.name,
      description: l10n("env.profileCount", { count: entry.profiles.length }),
      entry,
    })),
    { placeHolder: l10n("env.folderPlaceholder") }
  );
  return picked ? picked.entry : "canceled";
}

// Swap the active `.env` to a chosen profile. Never destroys a hand-edited `.env`:
// when the current `.env` matches no profile, it is backed up to `.env.bak` after a
// modal confirm before being overwritten. Switching between recognized profiles
// needs no backup (the previous environment still lives in its own `.env.<name>`).
export async function switchEnvProfile(): Promise<void> {
  if ((vscode.workspace.workspaceFolders ?? []).length === 0) {
    vscode.window.showWarningMessage(l10n("env.noWorkspace"));
    return;
  }
  const chosen = await pickFolder();
  if (chosen === "none") {
    vscode.window.showInformationMessage(l10n("env.noProfiles"));
    return;
  }
  if (chosen === "canceled") {
    return;
  }
  const { folder, profiles } = chosen;
  const activeUri = vscode.Uri.joinPath(folder.uri, ACTIVE_ENV);
  const activeContent = await readTextOrUndefined(activeUri);
  const currentName = await activeProfileName(activeContent, profiles);

  const items = profiles.map((profile) => ({
    label: profile.name,
    description: profile.name === currentName ? l10n("env.activeTag") : "",
    iconPath: new vscode.ThemeIcon(
      profile.name === currentName ? "pass-filled" : "circle-outline"
    ),
    profile,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: l10n("env.placeholder"),
  });
  if (!picked) {
    return;
  }
  const profile = picked.profile;
  if (profile.name === currentName) {
    vscode.window.showInformationMessage(
      l10n("env.alreadyActive", { name: profile.name })
    );
    return;
  }
  const newContent = await readTextOrUndefined(profile.uri);
  if (newContent === undefined) {
    // The profile vanished between discovery and selection (deleted/renamed).
    vscode.window.showWarningMessage(
      l10n("env.profileGone", { name: profile.fileName })
    );
    return;
  }
  // A `.env` that matches no profile carries manual edits. Confirm + back it up to
  // `.env.bak` before overwriting, so a hand-edited active file is never lost.
  if (activeContent !== undefined && currentName === undefined) {
    const backUp = l10n("env.backupAction");
    const choice = await vscode.window.showWarningMessage(
      l10n("env.unsavedConfirm", { name: profile.name }),
      { modal: true },
      backUp
    );
    if (choice !== backUp) {
      return;
    }
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(folder.uri, BACKUP_ENV),
      Buffer.from(activeContent, "utf8")
    );
  }
  await vscode.workspace.fs.writeFile(
    activeUri,
    Buffer.from(newContent, "utf8")
  );
  // Tell the user the follow-through: a running dev server still holds the old env
  // until it is restarted (Saropa cannot restart an arbitrary external server).
  vscode.window.showInformationMessage(
    l10n("env.switched", { name: profile.name })
  );
}
