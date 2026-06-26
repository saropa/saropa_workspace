import * as vscode from "vscode";
import { Shortcut } from "../model/shortcut";
import { runOutputs, CapturedRun } from "../exec/runOutputs";
import { l10n } from "../i18n/l10n";

// "Diff Last Two Runs" (roadmap WOW #20). After re-running a failing background task,
// it is hard to tell from a wall of log output whether the error is the SAME one or a
// NEW one. This opens VS Code's native side-by-side diff of the previous run's output
// against the latest, so the changed lines stand out. Read-only: it only reads the
// captured output the runner kept.

// Read-only virtual document backing the two sides of the diff. A virtual scheme
// keeps the captured output out of any real file and out of the editor's dirty
// state. Content is keyed by uri (shortcut id + which run), refreshed each invocation.
class RunOutputProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = "saropa-runoutput";

  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  private readonly contents = new Map<string, string>();

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? "";
  }

  // Publish one side's text under a stable per-shortcut/side uri and return that uri.
  // Re-diffing the same shortcut reuses the uri and repaints via onDidChange.
  set(pinId: string, side: "previous" | "latest", text: string): vscode.Uri {
    const uri = vscode.Uri.from({
      scheme: RunOutputProvider.scheme,
      path: `/${pinId}/${side}.log`,
    });
    this.contents.set(uri.toString(), text);
    this._onDidChange.fire(uri);
    return uri;
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

const provider = new RunOutputProvider();

// Register the virtual-document provider backing run-output diffs. Pushed to
// subscriptions so it and its emitter are disposed on deactivation.
export function registerRunOutputDiff(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      RunOutputProvider.scheme,
      provider
    ),
    provider
  );
}

// Open a diff of a shortcut's last two background-run outputs. When fewer than two runs
// have been captured (the shortcut was never run in the background, or only once this
// session), there is nothing to compare, so it says so and does nothing.
export async function diffLastRuns(shortcut: Shortcut): Promise<void> {
  const name = shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
  const pair = runOutputs.lastTwo(shortcut.id);
  if (!pair) {
    vscode.window.showInformationMessage(l10n("diffRuns.needTwo", { name }));
    return;
  }
  const [previous, latest] = pair;
  const left = provider.set(shortcut.id, "previous", runText(previous));
  const right = provider.set(shortcut.id, "latest", runText(latest));
  await vscode.commands.executeCommand(
    "vscode.diff",
    left,
    right,
    l10n("diffRuns.title", { name })
  );
}

// Prefix the captured output with a one-line header (when it ended, exit code) so
// each side of the diff is self-identifying, then the raw output.
function runText(run: CapturedRun): string {
  const when = new Date(run.endedAt).toLocaleString();
  const code = run.exitCode === null ? "?" : String(run.exitCode);
  const header = l10n("diffRuns.header", { when, code });
  return `${header}\n\n${run.output}`;
}
