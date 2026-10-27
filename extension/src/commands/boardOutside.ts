import * as vscode from "vscode";
import { mapLimit } from "../board/pool";
import { Outside, OutsideGroup, OutsideItem, chatCount, cleanGroup, cleanItems, emptyOutside, parseReviewRequests, MAX_GROUPS } from "../board/outside";
import { l10n } from "../i18n/l10n";

// Optional links from the Release Board to the world outside the document scan. Each one
// turns on only when its source is there, fails quietly, and never changes a light.

const CHAT_EXTENSION = "saropa.claude-chat-explorer";
const CHAT_LIMIT = 60;
const PROVIDER_MS = 5000;

interface ChatApi {
  apiVersion?: number;
  chatsForFile?: (file: string) => Promise<unknown>;
}

// A group another extension contributes to the board (the public API of this extension).
export interface BoardGroupProvider {
  id: string;
  label: string;
  items(): OutsideItem[] | Promise<OutsideItem[]>;
}

const providers = new Map<string, BoardGroupProvider>();
const changed = new vscode.EventEmitter<void>();
export const onDidChangeProviders = changed.event;

export function addBoardGroup(provider: BoardGroupProvider): vscode.Disposable {
  providers.set(provider.id, provider);
  changed.fire();
  return new vscode.Disposable(() => {
    if (providers.get(provider.id) === provider) {
      providers.delete(provider.id);
      changed.fire();
    }
  });
}

async function chatApi(): Promise<ChatApi | undefined> {
  const ext = vscode.extensions.getExtension(CHAT_EXTENSION);
  if (!ext) {
    return undefined;
  }
  try {
    const api = (ext.isActive ? ext.exports : await ext.activate()) as ChatApi | undefined;
    return api?.apiVersion === 1 && typeof api.chatsForFile === "function" ? api : undefined;
  } catch {
    return undefined;
  }
}

// Sessions per open document, asked of Chat Explorer four at a time. `files` maps the
// board key "project/path" to the absolute path.
async function loadChats(files: Array<[string, string]>): Promise<Record<string, number>> {
  const api = await chatApi();
  const out: Record<string, number> = {};
  if (!api?.chatsForFile) {
    return out;
  }
  const ask = api.chatsForFile.bind(api);
  await mapLimit(files.slice(0, CHAT_LIMIT), 4, async ([key, file]) => {
    try {
      const n = chatCount(await ask(file));
      if (n !== undefined) {
        out[key] = n;
      }
    } catch {
      // Chat Explorer failing is no reason to disturb the board.
    }
  });
  return out;
}

async function loadReviewRequests(): Promise<OutsideGroup | undefined> {
  if (!vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard").get<boolean>("reviewRequests", false)) {
    return undefined;
  }
  try {
    // Silent: the board never opens a sign-in prompt by itself.
    const session = await vscode.authentication.getSession("github", ["repo"], { silent: true });
    if (!session) {
      return undefined;
    }
    const res = await fetch("https://api.github.com/search/issues?q=" + encodeURIComponent("is:pr is:open archived:false review-requested:@me") + "&per_page=20", {
      headers: { Authorization: `Bearer ${session.accessToken}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return undefined;
    }
    const items = parseReviewRequests(await res.json());
    return items.length > 0 ? { id: "github-review", label: l10n("releaseBoard.panel.reviewRequests"), items } : undefined;
  } catch {
    return undefined;
  }
}

async function loadProviders(): Promise<OutsideGroup[]> {
  const out: OutsideGroup[] = [];
  for (const p of [...providers.values()].slice(0, MAX_GROUPS)) {
    try {
      const items = await Promise.race([Promise.resolve(p.items()), new Promise<never>((_, no) => setTimeout(() => no(new Error("timeout")), PROVIDER_MS))]);
      const g = cleanGroup(p.id, p.label, cleanItems(items));
      if (g) {
        out.push({ ...g, id: "ext:" + g.id });
      }
    } catch {
      // A broken provider is skipped.
    }
  }
  return out;
}

// Everything outside the scan for the open documents, fetched in parallel.
export async function loadOutside(files: Array<[string, string]>): Promise<Outside> {
  const [chats, review, groups] = await Promise.all([loadChats(files), loadReviewRequests(), loadProviders()]);
  const out = emptyOutside();
  out.chats = chats;
  out.groups = [...(review ? [review] : []), ...groups].slice(0, MAX_GROUPS);
  return out;
}
