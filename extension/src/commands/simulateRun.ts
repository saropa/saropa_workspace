import * as vscode from "vscode";
import { Shortcut, shortcutKind } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { planRun, expandRecipeTokens } from "../exec/runner";
import {
  hasInteractiveTokens,
  resolveInteractiveTokens,
  cloneWithResolvedTokens,
} from "../exec/promptTokens";
import { l10n } from "../i18n/l10n";

// "Simulate Run" (Dry Run / Audit Mode, roadmap WOW #11). A shared or complex shortcut
// — a multi-step macro, a run config full of $tokens and ${prompt:...} — is risky
// to double-click when you cannot see what it will actually execute. This builds
// the EXACT command line, working directory, run location, and environment that a
// real run would use (by reusing planRun, the same pure assembly the runner and
// scheduler use) and renders it as a read-only Markdown preview. Nothing is
// executed: every code path here is read-only, so auditing a routine can never
// trigger it.
//
// Interactive ${prompt:...} / ${pick:...} tokens are answered virtually — the user
// fills them in so the simulated command reflects their choices — exactly as a real
// run would prompt, but with no side effect afterward.

// Read-only virtual document backing the preview. A virtual scheme (not an untitled
// buffer) keeps the audit clean: there is no dirty editor to dismiss, and the
// content cannot be accidentally edited or saved. Content is keyed by uri so
// re-simulating the same shortcut refreshes its existing preview rather than piling up
// tabs.
class SimulationPreviewProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = "saropa-simulate";

  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  // uri.toString() -> markdown body. Holds only the most recent simulation per shortcut.
  private readonly contents = new Map<string, string>();

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? "";
  }

  // Render the report. The uri path ends in ".md" so the built-in Markdown preview
  // treats the virtual document as Markdown; the shortcut id keys the uri so the same
  // shortcut reuses one preview (fire onDidChange to repaint it with fresh content).
  async show(shortcut: Shortcut, title: string, content: string): Promise<void> {
    const safe = title.replace(/[\\/:*?"<>|]/g, "_");
    const uri = vscode.Uri.from({
      scheme: SimulationPreviewProvider.scheme,
      path: `/${shortcut.id}/${safe}.md`,
    });
    this.contents.set(uri.toString(), content);
    this._onDidChange.fire(uri);
    // markdown.showPreview accepts the uri directly, opening only the rendered
    // preview (no source editor) — the "clean Markdown preview" the audit wants.
    await vscode.commands.executeCommand("markdown.showPreview", uri);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

const preview = new SimulationPreviewProvider();

// Register the virtual-document provider that backs simulate previews. Pushed to
// subscriptions so the provider and its emitter are disposed on deactivation.
export function registerSimulationPreview(
  context: vscode.ExtensionContext
): void {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      SimulationPreviewProvider.scheme,
      preview
    ),
    preview
  );
}

// Entry point for the "Simulate Run" command. Decides between the file-shortcut path
// (assemble a command via planRun) and the non-file recipe path (describe the
// action), then renders the report. Returns without rendering when the shortcut's file
// is unresolved/missing (named in a toast) or an interactive prompt is canceled.
export async function simulateRun(store: ShortcutStore, shortcut: Shortcut): Promise<void> {
  const name = shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);

  if (shortcutKind(shortcut) !== "file") {
    await preview.show(shortcut, l10n("simulate.title", { name }), buildActionReport(shortcut, name));
    return;
  }

  const uri = store.resolveUri(shortcut);
  if (!uri) {
    vscode.window.showWarningMessage(l10n("pin.missingFile", { path: shortcut.path }));
    return;
  }

  // Answer ${prompt:...} / ${pick:...} virtually so the simulated command shows the
  // values the user picked, matching what a real run would assemble. A cancel
  // aborts the simulation with nothing rendered (mirrors the real-run cancel).
  let effectiveShortcut = shortcut;
  const resolvedPrompts: Array<{ token: string; value: string }> = [];
  if (hasInteractiveTokens(shortcut)) {
    const values = await resolveInteractiveTokens(shortcut);
    if (values === undefined) {
      vscode.window.showInformationMessage(l10n("simulate.canceled", { name }));
      return;
    }
    for (const [token, value] of values) {
      resolvedPrompts.push({ token, value });
    }
    effectiveShortcut = cloneWithResolvedTokens(shortcut, values);
  }

  const report = buildFileReport(effectiveShortcut, uri, name, resolvedPrompts);
  await preview.show(shortcut, l10n("simulate.title", { name }), report);
}

// Markdown for a file shortcut: the exact command planRun would launch, plus its cwd,
// location, environment, any answered prompts, and any unrecognized $placeholders.
function buildFileReport(
  shortcut: Shortcut,
  uri: vscode.Uri,
  name: string,
  resolvedPrompts: Array<{ token: string; value: string }>
): string {
  const plan = planRun(shortcut, uri);
  const lines: string[] = [
    `# ${l10n("simulate.title", { name })}`,
    "",
    `> ${l10n("simulate.intro")}`,
    "",
  ];

  // A shortcut with no interpreter and no explicit command has an empty command line:
  // a real double-click would OPEN the file, not run it. Say so plainly instead of
  // showing an empty code fence that reads as "runs nothing".
  if (plan.commandLine.trim().length === 0) {
    lines.push(`_${l10n("simulate.notRunnable", { name })}_`, "");
  } else {
    lines.push(
      `## ${l10n("simulate.commandHeading")}`,
      "",
      "```sh",
      plan.commandLine,
      "```",
      ""
    );
  }

  lines.push(
    `## ${l10n("simulate.cwdHeading")}`,
    "",
    "```",
    plan.cwd,
    "```",
    "",
    `## ${l10n("simulate.locationHeading")}`,
    "",
    locationLabel(plan.location, plan.elevated),
    ""
  );

  lines.push(...envSection(plan.env));

  if (resolvedPrompts.length > 0) {
    lines.push(`## ${l10n("simulate.promptsHeading")}`, "");
    for (const { token, value } of resolvedPrompts) {
      lines.push(`- \`${token}\` → \`${value}\``);
    }
    lines.push("");
  }

  if (plan.unknownTokens.length > 0) {
    lines.push(
      `## ${l10n("simulate.unknownHeading")}`,
      "",
      `_${l10n("simulate.unknownNote")}_`,
      ""
    );
    for (const token of plan.unknownTokens) {
      lines.push(`- \`$${token}\``);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// Render the merged-over environment as a bullet list, or "(none)" when the shortcut
// adds no variables (the run inherits the ambient environment unchanged).
function envSection(env: Record<string, string> | undefined): string[] {
  const out = [`## ${l10n("simulate.envHeading")}`, ""];
  const entries = env ? Object.entries(env) : [];
  if (entries.length === 0) {
    out.push(`_${l10n("simulate.none")}_`, "");
    return out;
  }
  for (const [key, value] of entries) {
    out.push(`- \`${key}=${value}\``);
  }
  out.push("");
  return out;
}

// Map a run location (+ elevation) to its human label, reusing the same wording the
// Configure Run picker shows so the audit names the destination consistently.
function locationLabel(location: string, elevated: boolean): string {
  switch (location) {
    case "terminal":
      return l10n("simulate.location.terminal");
    case "background":
      return l10n("simulate.location.background");
    case "external":
      return elevated
        ? l10n("simulate.location.externalElevated")
        : l10n("simulate.location.external");
    default:
      return location;
  }
}

// Markdown for a non-file recipe shortcut (url / shell / command / macro): what running
// it would do, with $workspaceRoot/$date tokens resolved the same way a real run
// resolves them so the audit shows concrete paths, not raw tokens.
function buildActionReport(shortcut: Shortcut, name: string): string {
  const action = shortcut.action;
  const lines: string[] = [
    `# ${l10n("simulate.title", { name })}`,
    "",
    `> ${l10n("simulate.intro")}`,
    "",
  ];
  if (!action) {
    lines.push(`_${shortcut.path}_`, "");
    return lines.join("\n");
  }

  switch (action.kind) {
    case "url":
      lines.push(l10n("simulate.action.url"), "", `<${action.url ?? ""}>`, "");
      break;
    case "shell":
      lines.push(
        l10n("simulate.action.shell"),
        "",
        "```sh",
        expandRecipeTokens(action.shellCommand ?? ""),
        "```",
        "",
        `## ${l10n("simulate.cwdHeading")}`,
        "",
        "```",
        expandRecipeTokens(action.cwd ?? ""),
        "```",
        ""
      );
      break;
    case "command":
      lines.push(
        l10n("simulate.action.command", { id: action.commandId ?? "" }),
        ""
      );
      if (action.commandArgs && action.commandArgs.length > 0) {
        lines.push("```json", JSON.stringify(action.commandArgs, null, 2), "```", "");
      }
      break;
    case "macro":
      lines.push(`## ${l10n("simulate.action.macro")}`, "");
      (action.steps ?? []).forEach((step, index) => {
        const label = step.label ?? step.kind;
        const detail =
          step.kind === "open"
            ? expandRecipeTokens(step.path ?? "")
            : step.kind === "shell"
              ? expandRecipeTokens(step.shellCommand ?? "")
              : step.kind === "url"
                ? step.url ?? ""
                : step.commandId ?? "";
        lines.push(`${index + 1}. **${label}** — \`${detail}\``);
      });
      lines.push("");
      break;
  }
  return lines.join("\n");
}
