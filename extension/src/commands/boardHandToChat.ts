import * as vscode from "vscode";
import { DetailLevel, OpenChatMode, asDetail, asOpenChat } from "../board/handToChat";
import { chatApi } from "./boardOutside";
import { l10n } from "../i18n/l10n";

// Release Board, Hand to chat: copies a prepared prompt to the clipboard. Local only: no
// network, nothing is sent. When Chat Explorer is installed and the owner turned the offer
// on, a message offers to open the chats that touched the document.

// Chat Explorer's own command that opens its panel on the chats for a file.
const SHOW_FILE_CHATS = "saropaChatExplorer.fileSessions.show";
const ASK_MS = 3000;

export interface HandSettings {
  enabled: boolean;
  detail: DetailLevel;
  openChat: OpenChatMode;
}

export function readHandSettings(): HandSettings {
  const c = vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard.handToChat");
  return { enabled: c.get<boolean>("enabled", true), detail: asDetail(c.get<string>("detail", "standard")), openChat: asOpenChat(c.get<string>("openChat", "never")) };
}

// True when Chat Explorer answers within a moment and knows chats for the file.
async function hasChats(file: string): Promise<boolean> {
  const api = await chatApi();
  if (!api?.chatsForFile) {
    return false;
  }
  try {
    const reply = (await Promise.race([api.chatsForFile(file), new Promise<never>((_, no) => setTimeout(() => no(new Error("timeout")), ASK_MS))])) as { total?: unknown };
    return typeof reply?.total === "number" && reply.total > 0;
  } catch {
    return false;
  }
}

// Copies the prompt. `doc` is the document the prompt is about, when there is one.
export async function copyHandPrompt(text: string, doc: vscode.Uri | undefined, openChat: OpenChatMode): Promise<void> {
  await vscode.env.clipboard.writeText(text);
  if (openChat !== "offer" || !doc || !(await hasChats(doc.fsPath))) {
    void vscode.window.showInformationMessage(l10n("releaseBoard.handToChat.copied"));
    return;
  }
  // Not awaited: the board never waits on the owner's answer.
  const open = l10n("releaseBoard.handToChat.openChats");
  void vscode.window.showInformationMessage(l10n("releaseBoard.handToChat.copiedOffer"), open).then((pick) => {
    if (pick === open) {
      void vscode.commands.executeCommand(SHOW_FILE_CHATS, doc);
    }
  });
}
