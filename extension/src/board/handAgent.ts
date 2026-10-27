// Hand to chat: which chat tool the owner uses. Pure: it maps a setting value to the
// VS Code command ids that open that tool. The host (commands/boardHandToChat.ts) asks
// VS Code which of them exist and runs the first one. The prompt itself always travels by
// the clipboard; no command here is given any text.

export const HAND_AGENTS = ["none", "claudeCode", "copilotChat", "cursor", "custom"] as const;
// The chat tool Hand to chat can open after copying.
export type HandAgent = (typeof HAND_AGENTS)[number];

// Command ids tried in order; the first one VS Code knows is run. Add an id here to support
// another build of a tool.
const AGENT_COMMANDS: Record<Exclude<HandAgent, "none" | "custom">, readonly string[]> = {
  claudeCode: ["claude-vscode.focus", "claude-vscode.sidebar.open"],
  copilotChat: ["workbench.action.chat.open", "workbench.panel.chat.view.copilot.focus"],
  // The Cursor ids are the least certain; the custom choice covers a build that differs.
  cursor: ["aichat.newchataction", "composer.newAgentChat"],
};

const NAMES: Record<Exclude<HandAgent, "none" | "custom">, string> = {
  claudeCode: "Claude Code",
  copilotChat: "Copilot Chat",
  cursor: "Cursor chat",
};

// Plain setting value to an agent; anything unknown means none.
export function asAgent(v: unknown): HandAgent {
  return typeof v === "string" && (HAND_AGENTS as readonly string[]).includes(v) ? (v as HandAgent) : "none";
}

// The command ids to try for an agent, in order. `custom` is the owner's own command id.
export function agentCommands(agent: HandAgent, custom: string): string[] {
  if (agent === "none") {
    return [];
  }
  if (agent === "custom") {
    const id = custom.trim();
    return id ? [id] : [];
  }
  return [...AGENT_COMMANDS[agent]];
}

// The name shown on the toast and its button; empty for none and custom (the host words those).
export function agentName(agent: HandAgent): string {
  return agent === "none" || agent === "custom" ? "" : NAMES[agent];
}

// The first candidate VS Code knows, or undefined.
export function pickCommand(candidates: readonly string[], known: ReadonlySet<string>): string | undefined {
  return candidates.find((c) => known.has(c));
}

// One line of a document title or headline for a toast: whitespace folded, cut at `max`.
export function toastTopic(text: string, max = 80): string {
  // Brackets and parentheses are dropped so a title cannot render as a link in the message.
  const one = text.replace(/[[\]()]/g, "").replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}
