// Fake webview panel for the vscode test stub: records html and posted messages so a
// panel test can assert on them. Split out of vscode.ts.

// vscode.Webview stand-in (the panel's `.webview` sub-object): html setter,
// postMessage (recorded so a test can assert what the host sent the client),
// and onDidReceiveMessage (the test drives this directly via __receiveFromClient
// to simulate the client script posting a message back).
export interface FakeWebview {
  html: string;
  /** The content-security-policy source token a page allows its own resources from. */
  readonly cspSource: string;
  /** Maps a local resource to the address the page loads it from (the stub keeps the same address). */
  asWebviewUri<T>(local: T): T;
  readonly postedMessages: unknown[];
  postMessage(message: unknown): Promise<boolean>;
  onDidReceiveMessage(handler: (message: unknown) => void): { dispose(): void };
  __receiveFromClient(message: unknown): void;
}

// vscode.WebviewPanel stand-in for the Set Params / Configure Run panel tests.
// reveal is a no-op; dispose fires the registered onDidDispose listener,
// matching the real panel's host->message->dispose lifecycle.
export interface FakeWebviewPanel {
  readonly viewType: string;
  title: string;
  visible: boolean;
  readonly webview: FakeWebview;
  onDidDispose(handler: () => void): { dispose(): void };
  onDidChangeViewState(handler: (e: unknown) => void): { dispose(): void };
  reveal(column?: number): void;
  dispose(): void;
  readonly disposed: boolean;
}

/** Creates a fake webview panel and records it so a test can read it back. */
export function fakeWebviewPanel(viewType: string, title: string): FakeWebviewPanel {
  let receiveHandler: ((message: unknown) => void) | undefined;
  let disposeHandler: (() => void) | undefined;
  let disposed = false;
  const postedMessages: unknown[] = [];
  const webview: FakeWebview = {
    html: "",
    cspSource: "vscode-webview://fake",
    asWebviewUri: <T>(local: T): T => local,
    postedMessages,
    async postMessage(message: unknown): Promise<boolean> {
      postedMessages.push(message);
      return true;
    },
    onDidReceiveMessage(handler: (message: unknown) => void): { dispose(): void } {
      receiveHandler = handler;
      return { dispose: (): void => {} };
    },
    __receiveFromClient(message: unknown): void {
      receiveHandler?.(message);
    },
  };
  return {
    viewType,
    title,
    visible: true,
    webview,
    onDidDispose(handler: () => void): { dispose(): void } {
      disposeHandler = handler;
      return { dispose: (): void => {} };
    },
    onDidChangeViewState(): { dispose(): void } {
      return { dispose: (): void => {} };
    },
    reveal(): void {},
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      disposeHandler?.();
    },
    get disposed(): boolean {
      return disposed;
    },
  };
}

// The panels created since the last reset, in creation order — a test reads the
// most recent one back (createWebviewPanel's real return type carries no such
// list; this is a test-only convenience) via __lastWebviewPanel().
export const createdPanels: FakeWebviewPanel[] = [];
/** Test hook: the most recently created fake panel, or undefined. */
export function __lastWebviewPanel(): FakeWebviewPanel | undefined {
  return createdPanels[createdPanels.length - 1];
}
/** Test hook: disposes and forgets every fake panel. */
export function __resetWebviewPanels(): void {
  for (const p of createdPanels) {
    p.dispose();
  }
  createdPanels.length = 0;
}
