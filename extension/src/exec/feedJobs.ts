import * as vscode from "vscode";

// What the scheduled catch-up is doing for each feeding recipe, by shortcut id. The scheduler
// writes it; the Release Board reads it to say "checking now" or why a job did not start.
// In memory only: it describes this session.

// queued: waiting its turn. running: started. failed: did not start (`reason` says why).
export type FeedJobState = "queued" | "running" | "failed";

export interface FeedJob {
  state: FeedJobState;
  reason?: string;
}

class FeedJobs {
  private readonly jobs = new Map<string, FeedJob>();
  private readonly changed = new vscode.EventEmitter<string>();
  // Fires with the shortcut id after every change, so the board can refresh that row.
  readonly onDidChange = this.changed.event;

  set(id: string, job: FeedJob): void {
    this.jobs.set(id, job);
    this.changed.fire(id);
  }

  clear(id: string): void {
    if (this.jobs.delete(id)) {
      this.changed.fire(id);
    }
  }

  get(id: string): FeedJob | undefined {
    return this.jobs.get(id);
  }

  // Forgets every job without firing, for tests.
  reset(): void {
    this.jobs.clear();
  }
}

export const feedJobs = new FeedJobs();
