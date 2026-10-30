import * as vscode from "vscode";
import type { ChatSummary } from "../board/activeNow";
import { withTimeout } from "../board/timeout";

// The in-process API of the Saropa Chat Explorer extension, read through one typed wrapper.
// The extension is optional and an outside contract: every step may be missing, change shape or
// fail, so a failure of any kind gives { ok: false } and never throws.

const EXTENSION_ID = "saropa.claude-chat-explorer";
// The API itself waits up to 60 s for its index; the board does not.
const CALL_TIMEOUT_MS = 10 * 1000;

export type ChatRead = { ok: true; chats: ChatSummary[] } | { ok: false };

// Finds the extension by id; replaced in tests.
type FindExtension = (id: string) => { activate(): PromiseLike<unknown> } | undefined;

interface ChatApi {
  listChats(): Promise<unknown>;
}

function isApi(v: unknown): v is ChatApi {
  const api = v as { apiVersion?: unknown; listChats?: unknown } | null | undefined;
  return typeof api === "object" && api !== null && typeof api.apiVersion === "number" && api.apiVersion >= 1 && typeof api.listChats === "function";
}

// One chat of the answer, or nothing when it lacks a folder or a time.
function summarize(raw: unknown): ChatSummary[] {
  const c = raw as { folder?: unknown; last?: unknown; state?: unknown; archived?: unknown } | null | undefined;
  if (typeof c !== "object" || c === null || typeof c.folder !== "string" || c.folder === "" || typeof c.last !== "number" || !Number.isFinite(c.last)) {
    return [];
  }
  return [{ folder: c.folder, last: c.last, state: typeof c.state === "string" ? c.state : undefined, archived: c.archived === true }];
}

// Every indexed chat, or { ok: false } when Chat Explorer is absent, too old, slow or failing.
export async function readChats(find: FindExtension = (id) => vscode.extensions.getExtension(id)): Promise<ChatRead> {
  try {
    const ext = find(EXTENSION_ID);
    const api: unknown = ext ? await withTimeout(Promise.resolve(ext.activate()), CALL_TIMEOUT_MS) : undefined;
    if (!isApi(api)) {
      return { ok: false };
    }
    const raw: unknown = await withTimeout(Promise.resolve(api.listChats()), CALL_TIMEOUT_MS);
    return Array.isArray(raw) ? { ok: true, chats: raw.flatMap(summarize) } : { ok: false };
  } catch {
    return { ok: false };
  }
}
