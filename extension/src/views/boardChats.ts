import * as vscode from "vscode";
import { ChatSummary, ProjectFolder, activeProjects } from "../board/activeNow";
import type { RenderState } from "../board/boardHtml";
import { readChats } from "../commands/chatExplorerApi";
import { l10n } from "../i18n/l10n";

// The board's look at the Chat Explorer chats: every 30 seconds while the tab shows, unless
// paused, and only while the setting is on. It keeps what the page needs and says when it changes.

const POLL_MS = 30 * 1000;
// The notice is drawn for this long; the page removes it itself after a few seconds.
const NOTICE_MS = 6 * 1000;
// Failures in a row before the pills are dropped; one bad look after a good one keeps them.
const FAILURES_TO_DROP = 2;

export function chatActivityOn(): boolean {
  return vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard").get<boolean>("chatActivity", true);
}

export type ReadChats = () => Promise<{ ok: true; chats: ChatSummary[] } | { ok: false }>;

export class ChatPoll {
  private active: string[] = [];
  // True once the last look worked, false once it failed; undefined before the first look or while off.
  private ok: boolean | undefined;
  private paused = false;
  private notice: string | undefined;
  private noticed = false;
  private failures = 0;
  private inFlight = false;
  private token = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly folders: () => ProjectFolder[],
    private readonly visible: () => boolean,
    private readonly changed: () => void,
    private readonly read: ReadChats = () => readChats()
  ) {}

  // Looks now and then every 30 seconds; calling it again only looks again.
  start(): void {
    this.timer ??= setInterval(() => this.tick(), POLL_MS);
    this.tick();
  }

  // One scheduled look: nothing while the tab is hidden; the pills go at once when the setting is off.
  private tick(): void {
    try {
      if (!chatActivityOn()) {
        this.token++;
        this.failures = 0;
        this.set(undefined, []);
        return;
      }
      if (this.visible()) {
        this.refresh().catch(() => undefined);
      }
    } catch {
      // A failing folders() or changed() must not escape from a timer.
    }
  }

  async refresh(): Promise<void> {
    if (this.inFlight) {
      return;
    }
    if (!chatActivityOn()) {
      this.set(undefined, []);
      return;
    }
    if (this.paused) {
      return;
    }
    const token = ++this.token;
    this.inFlight = true;
    let read: Awaited<ReturnType<ReadChats>>;
    try {
      read = await this.read();
    } finally {
      this.inFlight = false;
    }
    if (token !== this.token) {
      return;
    }
    if (read.ok) {
      this.failures = 0;
      this.set(true, activeProjects(read.chats, this.folders(), Date.now()));
    } else if (++this.failures >= FAILURES_TO_DROP || this.ok !== true) {
      this.set(false, []);
    }
  }

  private set(ok: boolean | undefined, active: string[]): void {
    let change = ok !== this.ok || active.join("\0") !== this.active.join("\0");
    this.ok = ok;
    this.active = active;
    if (ok === false && !this.noticed) {
      this.noticed = true;
      this.notice = l10n("releaseBoard.chats.unavailable");
      clearTimeout(this.noticeTimer);
      this.noticeTimer = setTimeout(() => (this.notice = undefined), NOTICE_MS);
      change = true;
    }
    if (change) {
      this.changed();
    }
  }

  // The pause and play pill was clicked. Pausing drops a look still in flight.
  toggle(): void {
    this.paused = !this.paused;
    this.token++;
    if (!this.paused) {
      this.tick();
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
    clearTimeout(this.noticeTimer);
  }
}
