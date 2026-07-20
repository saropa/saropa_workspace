import * as vscode from "vscode";

// Remembers the last value entered for each interactive run-parameter token
// (${prompt:...} / ${pick:...}) per shortcut, so the next run defaults to the
// previous choice instead of asking from scratch every time (roadmap WOW #7). A
// shortcut that picks between dev/staging/prod then defaults to whatever was chosen
// last, and a "Run with Last Parameters" command can skip the dialogs entirely.
//
// STORED IN workspaceState, NOT globalState: a remembered value can be anything the
// user typed (including something sensitive), and the choice is inherently
// workspace-contextual — the branch/environment/target that fits THIS project. Using
// workspaceState keeps it on-device and per-workspace, and avoids syncing typed
// input to the cloud the way globalState (Settings Sync) would.

const KEY = "saropaWorkspace.promptMemory";

// shortcut id -> (token raw text e.g. "${pick:dev,stage}") -> last entered value.
type MemoryData = Record<string, Record<string, string>>;

class PromptMemory {
  // Set by activate(); until then every method is an inert no-op, so importing the
  // singleton at module load (in promptTokens) is safe before activation.
  private context: vscode.ExtensionContext | undefined;

  init(context: vscode.ExtensionContext): void {
    this.context = context;
  }

  // The last value entered for a token on this shortcut, or undefined if never
  // answered.
  getValue(pinId: string, tokenRaw: string): string | undefined {
    return this.read()[pinId]?.[tokenRaw];
  }

  // Whether any remembered value exists for the shortcut (used to decide if a bypass
  // run can skip prompts at all).
  has(pinId: string): boolean {
    const forShortcut = this.read()[pinId];
    return forShortcut !== undefined && Object.keys(forShortcut).length > 0;
  }

  // Merge freshly entered token values into the shortcut's memory and persist. Only
  // the tokens just answered are written, so a partial run does not erase other
  // tokens' remembered values.
  async remember(pinId: string, values: Map<string, string>): Promise<void> {
    if (!this.context || values.size === 0) {
      return;
    }
    const data = this.read();
    const forShortcut = { ...(data[pinId] ?? {}) };
    for (const [raw, value] of values) {
      forShortcut[raw] = value;
    }
    data[pinId] = forShortcut;
    await this.write(data);
  }

  // Drop a shortcut's remembered values (called when a shortcut is removed, so stale
  // entries do not accumulate). No-op when the shortcut has no memory.
  async forget(pinId: string): Promise<void> {
    if (!this.context) {
      return;
    }
    const data = this.read();
    if (data[pinId] === undefined) {
      return;
    }
    delete data[pinId];
    await this.write(data);
  }

  // Drop a single token's remembered value, leaving the shortcut's other tokens
  // untouched. Backs the Set Params editor's "Reset to unanswered" action — so
  // the NEXT run prompts fresh for just that token instead of silently reusing a
  // fixed value the user wants to reconsider. No-op when the token has no memory.
  async forgetToken(pinId: string, tokenRaw: string): Promise<void> {
    if (!this.context) {
      return;
    }
    const data = this.read();
    const forShortcut = data[pinId];
    if (forShortcut === undefined || !(tokenRaw in forShortcut)) {
      return;
    }
    const next = { ...forShortcut };
    delete next[tokenRaw];
    if (Object.keys(next).length === 0) {
      delete data[pinId];
    } else {
      data[pinId] = next;
    }
    await this.write(data);
  }

  private read(): MemoryData {
    const data = this.context?.workspaceState.get<MemoryData>(KEY);
    return data && typeof data === "object" ? data : {};
  }

  private async write(data: MemoryData): Promise<void> {
    await this.context?.workspaceState.update(KEY, data);
  }
}

// Module-level singleton: promptTokens reads/writes it during interactive resolution.
export const promptMemory = new PromptMemory();
