import * as vscode from "vscode";
import * as cp from "child_process";

// Tracks background child processes started for pins so the tree can show a pin
// as running and offer a Stop action (roadmap 2.3). Integrated-terminal runs are
// intentionally NOT tracked here: the terminal owns their lifecycle, and killing
// them out from under the terminal would be the regression the roadmap warns
// against. One process per pin id; a relaunch replaces the prior handle.
// Graceful stop sends SIGTERM (posix) / taskkill without /F (win) so the process
// can clean up; if it has not exited after this long, the stop auto-escalates to
// a forced kill so a wedged process cannot leave the pin stuck "stopping" forever.
const ESCALATE_AFTER_MS = 4000;

class ProcessRegistry implements vscode.Disposable {
  private readonly running = new Map<string, cp.ChildProcess>();
  // Pins whose process has been asked to stop but has not exited yet, so the tree
  // can show a "stopping…" state until the close handler clears it.
  private readonly stopping = new Set<string>();
  // Pending auto-escalation timers, cleared when the process exits in time.
  private readonly escalateTimers = new Map<string, NodeJS.Timeout>();
  private readonly _onDidChange = new vscode.EventEmitter<void>();

  // Fires when a process starts or ends, so the tree can repaint running state.
  readonly onDidChange = this._onDidChange.event;

  register(pinId: string, child: cp.ChildProcess): void {
    this.running.set(pinId, child);
    this._onDidChange.fire();

    // Clear on exit — but only if this exact child is still the registered one,
    // so a newer run that replaced it is not wrongly removed.
    const clear = (): void => {
      if (this.running.get(pinId) === child) {
        this.running.delete(pinId);
        this.stopping.delete(pinId);
        const timer = this.escalateTimers.get(pinId);
        if (timer) {
          clearTimeout(timer);
          this.escalateTimers.delete(pinId);
        }
        this._onDidChange.fire();
      }
    };
    child.on("close", clear);
    child.on("error", clear);
  }

  isRunning(pinId: string): boolean {
    return this.running.has(pinId);
  }

  isStopping(pinId: string): boolean {
    return this.stopping.has(pinId);
  }

  // Ask a tracked process to stop gracefully, mark it "stopping", and arm an
  // auto-escalation to a forced kill if it does not exit in time. Returns false
  // if nothing was running. The child's close handler clears the state.
  stop(pinId: string): boolean {
    const child = this.running.get(pinId);
    if (!child || child.pid === undefined) {
      return false;
    }
    this.stopping.add(pinId);
    this._onDidChange.fire();
    killTree(child, false);

    if (!this.escalateTimers.has(pinId)) {
      const timer = setTimeout(() => {
        this.escalateTimers.delete(pinId);
        // Still running after the grace period: force it.
        if (this.running.get(pinId) === child) {
          killTree(child, true);
        }
      }, ESCALATE_AFTER_MS);
      this.escalateTimers.set(pinId, timer);
    }
    return true;
  }

  // Force-kill immediately (the manual escape hatch when a graceful Stop did not
  // take). Returns false if nothing was running.
  forceKill(pinId: string): boolean {
    const child = this.running.get(pinId);
    if (!child || child.pid === undefined) {
      return false;
    }
    this.stopping.add(pinId);
    this._onDidChange.fire();
    killTree(child, true);
    return true;
  }

  dispose(): void {
    for (const timer of this.escalateTimers.values()) {
      clearTimeout(timer);
    }
    this.escalateTimers.clear();
    for (const child of this.running.values()) {
      killTree(child, true);
    }
    this.running.clear();
    this.stopping.clear();
  }
}

// Terminate a process (and its child tree where supported). force=false is a
// graceful request (SIGTERM / taskkill /T); force=true is non-negotiable
// (SIGKILL / taskkill /T /F).
function killTree(child: cp.ChildProcess, force: boolean): void {
  if (child.pid === undefined) {
    return;
  }
  if (process.platform === "win32") {
    // Under shell:true, spawn launches cmd.exe which then launches the real
    // interpreter; child.kill() would only reap cmd.exe and orphan the script.
    // taskkill /T terminates the whole tree; /F forces it.
    const args = ["/pid", String(child.pid), "/T"];
    if (force) {
      args.push("/F");
    }
    cp.spawn("taskkill", args);
  } else {
    child.kill(force ? "SIGKILL" : "SIGTERM");
  }
}

// Module-level singleton: both the runner (which registers) and the commands /
// tree (which read and stop) share one instance without threading it through.
export const processRegistry = new ProcessRegistry();
