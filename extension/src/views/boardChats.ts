import * as vscode from "vscode";
import { ProjectFolder, activeProjects } from "../board/activeNow";
import type { RenderState } from "../board/boardHtml";
import { readChats } from "../commands/chatExplorerApi";
import { l10n } from "../i18n/l10n";

// The board's look at the Chat Explorer chats: every 30 seconds while the tab shows, unless
// paused, and only while the setting is on. It keeps what the page needs and says when it changes.

const POLL_MS = 30 * 1000;
// The notice is drawn for this long; the page removes it itself after a few seconds.
const NOTICE_MS = 6 * 1000;

export function chatActivityOn(): boolean {
  return vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard").get<boolean>("chatActivity", true);
}

export class ChatPoll {
  private active: string[] = [];
  // True once the last look worked, false once it failed; undefined before the first look or while off.
  private ok: boolean | undefined;
  private paused = false;
  private notice: string | undefined;
  private noticed = false;
  private token = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly folders: () => ProjectFolder[],
    private readonly visible: () => boolean,
    private readonly changed: () => void
  ) {}

  // Looks now and then every 30 seconds; calling it again only looks again.
  start(): void {
    this.timer ??= setInterval(() => this.visible() && void this.refresh(), POLL_MS);
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const token = ++this.token;
    if (!chatActivityOn()) {
      this.set(undefined, []);
      return;
    }
    if (this.paused) {
      return;
    }
    const read = await readChats();
    if (token !== this.token) {
      return;
    }
    this.set(read.ok, read.ok ? activeProjects(read.chats, this.folders(), Date.now()) : []);
  }

  private set(ok: boolean | undefined, active: string[]): void {
    let change = ok !== this.ok || active.join("\0") !== this.active.join("\0");
    this.ok = ok;
    this.active = active;
    if (ok === false && !this.noticed) {
      this.noticed = true;
      this.notice = l10n("releaseBoard.chats.unavailable");
      setTimeout(() => (this.notice = undefined), NOTICE_MS);
      change = true;
    }
    if (change) {
      this.changed();
    }
  }

  // The pause and play pill was clicked.
  toggle(): void {
    this.paused = !this.paused;
    if (!this.paused) {
      void this.refresh();
    }
    this.changed();
  }

  // What the page draws: the active projects and the pill state while the integration works.
  view(): Pick<RenderState, "chat" | "notice"> {
    return { ...(this.ok ? { chat: { active: this.active, paused: this.paused } } : {}), ...(this.notice ? { notice: this.notice } : {}) };
  }

  dispose(): void {
    this.token++;
    clearInterval(this.timer);
  }
}
