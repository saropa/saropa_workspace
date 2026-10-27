import * as vscode from "vscode";
import { DetailLevel, OpenChatMode, asDetail, asOpenChat } from "../board/handToChat";
import { HandAgent, agentCommands, agentName, asAgent, pickCommand, toastTopic } from "../board/handAgent";
import { chatApi } from "./boardOutside";
import { l10n } from "../i18n/l10n";

// Release Board, Hand to chat: copies a prepared prompt to the clipboard and says so in a
// message. Local only: no network, nothing is sent. The owner may pick a chat tool; its
// command is run after copying (by a button, or at once with autoOpen) and is never given
// the prompt: the clipboard is the way the text travels. When Chat Explorer is installed
// and the owner turned the offer on, a message offers to open the chats that touched the
// document.

// Chat Explorer's own command that opens its panel on the chats for a file.
const SHOW_FILE_CHATS = "saropaChatExplorer.fileSessions.show";
const ASK_MS = 3000;

// The Hand to chat settings, already checked.
export interface HandSettings {
  enabled: boolean;
  detail: DetailLevel;
  openChat: OpenChatMode;
  agent: HandAgent;
  customCommand: string;
  autoOpen: boolean;
}

// Reads the Hand to chat settings; a bad value falls back to its default.
export function readHandSettings(): HandSettings {
  const c = vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard.handToChat");
  return {
    enabled: c.get<boolean>("enabled", true),
    detail: asDetail(c.get<string>("detail", "standard")),
    openChat: asOpenChat(c.get<string>("openChat", "never")),
    agent: asAgent(c.get<string>("agent", "none")),
    customCommand: String(c.get<string>("customCommand", "") ?? ""),
    autoOpen: c.get<boolean>("autoOpen", false) === true,
  };
}

// Runs a call with a time limit; the timer is cleared whether the call wins or not.
async function within<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, no) => (timer = setTimeout(() => no(new Error("timeout")), ASK_MS)))]);
  } finally {
    clearTimeout(timer);
  }
}

// True when Chat Explorer answers within a moment and knows chats for the file. Both its
// start-up and its answer are bounded.
async function hasChats(file: string): Promise<boolean> {
  try {
    const api = await within(chatApi());
    if (!api?.chatsForFile) {
      return false;
    }
    const reply = (await within(api.chatsForFile(file))) as { total?: unknown };
    return typeof reply?.total === "number" && reply.total > 0;
  } catch {
    return false;
  }
}

// Runs the first command of the chosen agent that VS Code knows. False when none exists or
// the command fails. No argument is passed.
export async function openAgent(agent: HandAgent, customCommand: string): Promise<boolean> {
  try {
    const known = new Set(await vscode.commands.getCommands(true));
    const candidates = agentCommands(agent, customCommand);
    // A command of an extension that has not started yet is missing from the list; try the first id anyway.
    const id = pickCommand(candidates, known) ?? candidates[0];
    if (!id) {
      return false;
    }
    await vscode.commands.executeCommand(id);
    return true;
  } catch {
    return false;
  }
}

// What the toast calls the chosen agent.
function agentLabel(agent: HandAgent): string {
  return agentName(agent) || l10n("releaseBoard.handToChat.agentCustom");
}

// Copies the prompt, then says so. `doc` is the document the prompt is about, when there is one.
// `knownChats` is the chat count the board already holds for it; when given, Chat Explorer is not asked again.
// `quiet` copies without any message: the caller shows its own.
// `topic` is what the prompt is about; the message names it.
export async function copyHandPrompt(text: string, doc: vscode.Uri | undefined, openChat: OpenChatMode, knownChats?: number, quiet = false, topic?: string): Promise<void> {
  await vscode.env.clipboard.writeText(text);
  if (quiet) {
    return;
  }
  const { agent, customCommand, autoOpen } = readHandSettings();
  const what = topic ? toastTopic(topic) : "";
  const copied = what ? l10n("releaseBoard.handToChat.copiedTopic", { topic: what }) : l10n("releaseBoard.handToChat.copied");
  let agentButton = agent !== "none" ? l10n("releaseBoard.handToChat.openAgent", { agent: agentLabel(agent) }) : "";
  if (agentButton && autoOpen) {
    if (await openAgent(agent, customCommand)) {
      agentButton = "";
    } else {
      void vscode.window.showInformationMessage(l10n("releaseBoard.handToChat.agentMissing", { agent: agentLabel(agent) }));
    }
  }
  const offerChats = openChat === "offer" && doc !== undefined && (knownChats !== undefined ? knownChats > 0 : await hasChats(doc.fsPath));
  const chatsButton = offerChats ? l10n("releaseBoard.handToChat.openChats") : "";
  const buttons = [agentButton, chatsButton].filter(Boolean);
  const message = offerChats ? `${copied} ${l10n("releaseBoard.handToChat.chatsTouched")}` : copied;
  // Not awaited: the board never waits on the owner's answer.
  void vscode.window.showInformationMessage(message, ...buttons).then(async (pick) => {
    if (pick === undefined) {
      return;
    }
    if (pick === chatsButton) {
      void vscode.commands.executeCommand(SHOW_FILE_CHATS, doc);
    } else if (pick === agentButton && !(await openAgent(agent, customCommand))) {
      void vscode.window.showInformationMessage(l10n("releaseBoard.handToChat.agentMissing", { agent: agentLabel(agent) }));
    }
  });
}
