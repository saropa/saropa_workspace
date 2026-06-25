import * as vscode from "vscode";
import { PinAction } from "../model/pin";
import { RecipeResult } from "./detectors";

// AI Context recipes (recipe book section I, 64-65). Surfaces active Claude/AI
// conversations as pins so the thread you were refactoring in is one click away
// instead of a hunt through a wall of identically styled chat tabs.
//
// Claude exposes no local API, so detection is a file scan of the folders where
// chat transcripts land — a local export folder, or an assistant extension's task
// store (.cline/tasks, etc.). The folders are user-configurable
// (saropaWorkspace.aiContext.claudeChatFolders); the scan is non-recursive (the
// folder root only, like every other detector) and capped to the freshest files so
// a busy chat store never floods the tree.

// Default scan roots when the user has not set their own. .claude and .cline/tasks
// are the common assistant stores; docs/chats is a conventional manual-export spot.
const DEFAULT_FOLDERS: readonly string[] = [".claude", ".cline/tasks", "docs/chats"];

// Only the N most recently modified transcripts are offered, across all configured
// folders combined. AI chats age out fast (a bug is fixed, the context is stale),
// so the freshest handful is what is worth a pin — older ones are noise.
const MAX_THREADS = 10;

// A chat label is the human title of a long conversation; cap it so one verbose
// title cannot stretch the tree row. Generous enough to stay readable.
const MAX_LABEL = 80;

const color = "charts.foreground";

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return undefined;
  }
}

function url(target: string): PinAction {
  return { kind: "url", url: target };
}

// A stable, filesystem-path-derived id, so sticky removal and de-duplication
// survive reloads (the path does not change between scans). Non-alphanumerics
// collapse to underscores; the folder prefix is part of relPath, so two files of
// the same name in different scan folders never collide.
function recipeIdFor(relPath: string): string {
  return `ai.chat.${relPath.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
}

// The file's base name without its extension, the fallback label when no in-file
// title is found.
function baseName(relPath: string): string {
  const file = relPath.split("/").pop() ?? relPath;
  return file.replace(/\.(md|json)$/i, "");
}

function clampLabel(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_LABEL ? `${trimmed.slice(0, MAX_LABEL - 1)}…` : trimmed;
}

interface Candidate {
  uri: vscode.Uri;
  // Workspace-folder-relative path (e.g. ".claude/refactor.md"), used as the file
  // pin target and as the basis for the stable recipe id.
  relPath: string;
  mtime: number;
}

export async function detectAiContextRecipes(
  folder: vscode.WorkspaceFolder
): Promise<RecipeResult[]> {
  const cfg = vscode.workspace.getConfiguration("saropaWorkspace");
  if (!cfg.get<boolean>("aiContext.enabled", true)) {
    return [];
  }
  const folders = cfg.get<string[]>(
    "aiContext.claudeChatFolders",
    DEFAULT_FOLDERS as string[]
  );

  // Gather every .md / .json transcript across the configured folders (top level
  // only), then keep the globally freshest MAX_THREADS — so the cap spans the whole
  // chat store, not each folder independently.
  const { candidates, anyFolderPresent } = await collectCandidates(folder, folders);
  candidates.sort((a, b) => b.mtime - a.mtime);
  const freshest = candidates.slice(0, MAX_THREADS);

  const out: RecipeResult[] = [];

  // Recipe 65 — "Start a new Claude chat". A standing shortcut to claude.ai/new,
  // offered only when this workspace actually uses a configured chat folder (the
  // folder exists). That gate keeps the Active AI Threads group out of projects that
  // do not work with AI chats, while giving projects that do a discoverable entry
  // even before any transcript has been scanned.
  if (anyFolderPresent) {
    out.push({
      recipeId: "ai.new",
      label: "Start a new Claude chat",
      description:
        "Opens a fresh conversation at https://claude.ai/new in your browser (or the Claude desktop app, if it is registered to handle the link). Offered because this workspace has a configured AI chat folder.",
      icon: "add",
      color,
      group: "ai",
      action: url("https://claude.ai/new"),
    });
  }

  for (const candidate of freshest) {
    const recipe = await parseThread(candidate);
    // A file with no recognizable chat content (no title/H1, no id/URL) is skipped
    // rather than pinned, so a stray config JSON or notes file in a scan folder does
    // not masquerade as a conversation.
    if (recipe) {
      out.push(recipe);
    }
  }
  return out;
}

async function collectCandidates(
  folder: vscode.WorkspaceFolder,
  folders: string[]
): Promise<{ candidates: Candidate[]; anyFolderPresent: boolean }> {
  const candidates: Candidate[] = [];
  let anyFolderPresent = false;
  for (const rel of folders) {
    const dirUri = vscode.Uri.joinPath(folder.uri, ...rel.split("/"));
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dirUri);
    } catch {
      // Folder absent in this workspace — the common case; skip it silently.
      continue;
    }
    anyFolderPresent = true;
    for (const [name, type] of entries) {
      // Top-level transcript files only: never descend into subfolders (the
      // detector-wide "no recursive crawl" rule) and ignore non-transcript types.
      if (type !== vscode.FileType.File || !/\.(md|json)$/i.test(name)) {
        continue;
      }
      const uri = vscode.Uri.joinPath(dirUri, name);
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        candidates.push({ uri, relPath: `${rel}/${name}`, mtime: stat.mtime });
      } catch {
        // Raced deletion between listing and stat — drop it.
        continue;
      }
    }
  }
  return { candidates, anyFolderPresent };
}

// Turn one transcript into a recipe, or undefined when it has no chat-like content.
// JSON transcripts carry a structured title/id; Markdown transcripts carry an H1
// title and (optionally) a claude.ai URL in frontmatter or a footer.
async function parseThread(candidate: Candidate): Promise<RecipeResult | undefined> {
  const text = await readText(candidate.uri);
  if (text === undefined) {
    return undefined;
  }

  const parsed = /\.json$/i.test(candidate.relPath)
    ? parseJsonThread(text)
    : parseMarkdownThread(text);
  if (!parsed) {
    return undefined;
  }

  const label = clampLabel(parsed.title ?? baseName(candidate.relPath));
  // A deep link to the web/desktop chat when we have one; otherwise the local
  // transcript file (recipe 64's two action shapes). The file pin reuses the
  // standard file-open path, so it honors preview/peek like any other file pin.
  const action = parsed.chatUrl ? url(parsed.chatUrl) : undefined;
  const where = parsed.chatUrl
    ? `opens the conversation at ${parsed.chatUrl}`
    : "opens the local transcript file";

  return {
    recipeId: recipeIdFor(candidate.relPath),
    label,
    description: `Pinned AI conversation "${label}", detected from ${candidate.relPath}. Single-click ${where}. Only the most recently modified chats are offered; remove one to keep it from re-appearing.`,
    icon: "sparkle",
    color,
    group: "ai",
    action,
    filePath: action ? undefined : candidate.relPath,
  };
}

interface ParsedThread {
  title?: string;
  chatUrl?: string;
}

// A structured chat log. Requires a string title — its presence is what separates a
// real transcript from an unrelated JSON (config, lockfile) sitting in a scan
// folder. The chat id (id or uuid) becomes a claude.ai deep link.
function parseJsonThread(text: string): ParsedThread | undefined {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const title = typeof obj.title === "string" ? obj.title : undefined;
  if (!title) {
    return undefined;
  }
  const id =
    typeof obj.id === "string"
      ? obj.id
      : typeof obj.uuid === "string"
        ? obj.uuid
        : undefined;
  return { title, chatUrl: id ? `https://claude.ai/chat/${id}` : undefined };
}

// A Markdown transcript. The first H1 is the title; a claude.ai URL anywhere
// (frontmatter or footer) is the deep link. With neither an H1 nor a URL there is
// nothing chat-shaped to pin, so the file is skipped.
function parseMarkdownThread(text: string): ParsedThread | undefined {
  const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim();
  const raw = /https?:\/\/claude\.ai\/\S+/i.exec(text)?.[0];
  // \S+ greedily swallows wrapping delimiters when the URL sits in a Markdown link
  // or angle brackets (<...>, (...), "..."); strip the common trailers so the opened
  // deep link is the bare URL, not one with a stray ">" or ")" appended.
  const chatUrl = raw?.replace(/[)>\]"'.,;]+$/, "");
  if (!title && !chatUrl) {
    return undefined;
  }
  return { title, chatUrl };
}
