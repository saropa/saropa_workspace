import * as vscode from "vscode";

// VS Code tree views have no native double-click event: selecting an item fires
// its `command` once. This discriminator times successive activations of the SAME
// shortcut id — a second activation within the configured window counts as a
// double-click (run); otherwise it is a single click (open).
//
// The single-click action is deferred by the window length so a fast second click
// can cancel it. This adds a small open latency equal to doubleClickMs, which is
// the unavoidable cost of emulating double-click on a single-fire control.
export class DoubleClickDispatcher {
  private lastId: string | undefined;
  private lastTime = 0;
  private pendingSingle: NodeJS.Timeout | undefined;

  constructor(
    private readonly onSingle: (id: string) => void,
    private readonly onDouble: (id: string) => void
  ) {}

  private windowMs(): number {
    return vscode.workspace
      .getConfiguration("saropaWorkspace")
      .get<number>("doubleClickMs", 400);
  }

  activate(id: string): void {
    const now = Date.now();
    const window = this.windowMs();

    const isSecondClick =
      this.lastId === id && now - this.lastTime <= window && this.pendingSingle;

    if (isSecondClick) {
      // Cancel the deferred open and run instead.
      if (this.pendingSingle) {
        clearTimeout(this.pendingSingle);
        this.pendingSingle = undefined;
      }
      this.lastId = undefined;
      this.lastTime = 0;
      this.onDouble(id);
      return;
    }

    // First click: remember it and defer the open so a second click can cancel.
    this.lastId = id;
    this.lastTime = now;
    if (this.pendingSingle) {
      clearTimeout(this.pendingSingle);
    }
    this.pendingSingle = setTimeout(() => {
      this.pendingSingle = undefined;
      this.lastId = undefined;
      this.onSingle(id);
    }, window);
  }

  dispose(): void {
    if (this.pendingSingle) {
      clearTimeout(this.pendingSingle);
    }
  }
}
