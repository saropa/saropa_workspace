import * as vscode from "vscode";
import * as cp from "child_process";

// Tracks background child processes started for pins so the tree can show a pin
// as running and offer a Stop action (roadmap 2.3). Integrated-terminal runs are
// intentionally NOT tracked here: the terminal owns their lifecycle, and killing
// them out from under the terminal would be the regression the roadmap warns
// against. One process per pin id; a relaunch replaces the prior handle.
class ProcessRegistry implements vscode.Disposable {
  private readonly running = new Map<string, cp.ChildProcess>();
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
        this._onDidChange.fire();
      }
    };
    child.on("close", clear);
    child.on("error", clear);
  }

  isRunning(pinId: string): boolean {
    return this.running.has(pinId);
  }

  // Terminate a tracked process and its child tree where the platform supports
  // it. Returns false if nothing was running for that pin. The child's close
  // handler does the map removal + change event.
  stop(pinId: string): boolean {
    const child = this.running.get(pinId);
    if (!child || child.pid === undefined) {
      return false;
    }
    killTree(child);
    return true;
  }

  dispose(): void {
    for (const child of this.running.values()) {
      killTree(child);
    }
    this.running.clear();
  }
}

function killTree(child: cp.ChildProcess): void {
  if (child.pid === undefined) {
    return;
  }
  if (process.platform === "win32") {
    // Under shell:true, spawn launches cmd.exe which then launches the real
    // interpreter; child.kill() would only reap cmd.exe and orphan the script.
    // taskkill /T /F terminates the whole tree.
    cp.spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  } else {
    child.kill("SIGTERM");
  }
}

// Module-level singleton: both the runner (which registers) and the commands /
// tree (which read and stop) share one instance without threading it through.
export const processRegistry = new ProcessRegistry();
