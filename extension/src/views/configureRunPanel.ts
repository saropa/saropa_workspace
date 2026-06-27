import * as vscode from "vscode";
import * as path from "path";
import { Shortcut, ShortcutExecConfig, RunLocation } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { seedLocation, normalize, ConcurrencyEdit } from "../commands/configureRun";
import { parseArgs, formatArgs } from "../commands/configureRunCommand";
import { planRun, resolveRunPrefix } from "../exec/runPlanning";
import { detectInterpreters } from "../exec/interpreterDetect";
import { renderConfigureRunHtml, shortcutName } from "./configureRunShell";
import { l10n } from "../i18n/l10n";

// The Configure Run webview form — a single screen that shows EVERY run parameter of one
// shortcut at once (command prefix, arguments, working directory, environment variables,
// where it runs, administrator privileges, file-arg toggle, output extraction, dependency,
// audio cues, run-on-save, overlapping runs, cross-process lock), with a live command
// preview. It is the default "Configure Run..."; the keyboard-only hub-and-spoke QuickPick
// stays reachable as "Configure Run (Quick)...". Both share the working-copy seed
// (seedLocation) and the persistence normalize() in commands/configureRun.ts, so a config
// saved from either path is byte-for-byte identical.
//
// The administrator toggle is the reason this form exists: in the QuickPick it only
// appeared AFTER the location was set to External, so a user looking to "run elevated"
// could not find it. Here it is always visible and merely disabled (with an inline hint)
// until the location is external — the option is discoverable instead of hidden.
//
// Local-only and safe (the native-first / webview rules): a strict CSP with a per-load
// nonce, no remote or bundled resource, themed entirely via --vscode-* variables. Save
// routes through the same store methods the tree and QuickPick use. A second open reuses
// the one panel, repointed at the new shortcut.

// The wire shape the client posts back. argsLine is the raw command-line string the host
// parses with the same parser the QuickPick uses; env is the assembled key/value map.
interface WireExec {
  command?: string;
  argsLine: string;
  cwd?: string;
  env: Record<string, string>;
  location?: RunLocation;
  elevated: boolean;
  includeFilePath: boolean;
  extractResult?: string;
  dependsOn?: string;
  sound: "default" | "on" | "off";
  runOnSave: boolean;
  allowConcurrent: boolean;
  lockName?: string;
}

export class ConfigureRunPanel {
  private static current: ConfigureRunPanel | undefined;
  private static readonly viewType = "saropaWorkspace.configureRun";

  private readonly disposables: vscode.Disposable[] = [];
  // The shortcut being edited; re-read from the store on save in case it changed.
  private shortcutId: string;

  static show(context: vscode.ExtensionContext, store: ShortcutStore, shortcut: Shortcut): void {
    // Auto-shortcuts are recomputed each refresh and never stored, so run config cannot
    // persist on them — same guard as the QuickPick editor.
    if (shortcut.isAuto) {
      vscode.window.showWarningMessage(l10n("configure.autoUnsupported"));
      return;
    }
    const column = vscode.window.activeTextEditor?.viewColumn;
    if (ConfigureRunPanel.current) {
      ConfigureRunPanel.current.repoint(shortcut);
      ConfigureRunPanel.current.panel.reveal(column);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      ConfigureRunPanel.viewType,
      l10n("configureRun.title", { name: shortcutName(shortcut) }),
      column ?? vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    ConfigureRunPanel.current = new ConfigureRunPanel(panel, store, shortcut);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly store: ShortcutStore,
    shortcut: Shortcut
  ) {
    this.shortcutId = shortcut.id;
    this.panel.webview.html = renderConfigureRunHtml(this.store, shortcut);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: unknown) => void this.onMessage(message),
      null,
      this.disposables
    );
  }

  // Reuse the open panel for a different shortcut: repoint, rebuild the form, retitle.
  private repoint(shortcut: Shortcut): void {
    this.shortcutId = shortcut.id;
    this.panel.title = l10n("configureRun.title", { name: shortcutName(shortcut) });
    this.panel.webview.html = renderConfigureRunHtml(this.store, shortcut);
  }

  // ---- message protocol -------------------------------------------------

  private async onMessage(message: unknown): Promise<void> {
    if (typeof message !== "object" || message === null) {
      return;
    }
    const msg = message as { type?: string; work?: WireExec };
    switch (msg.type) {
      case "ready":
        await this.postInit();
        return;
      case "change":
        if (msg.work) {
          await this.postPreview(msg.work);
        }
        return;
      case "save":
        if (msg.work) {
          await this.save(msg.work);
        }
        return;
      case "browse":
        await this.onBrowse();
        return;
      case "cancel":
        this.panel.dispose();
        return;
    }
  }

  // The shortcut's stored config as the wire shape the client seeds the form from.
  private initialWork(shortcut: Shortcut): WireExec {
    const exec = shortcut.exec;
    return {
      command: exec?.command,
      argsLine: exec?.args ? formatArgs(exec.args) : "",
      cwd: exec?.cwd,
      env: exec?.env ? { ...exec.env } : {},
      location: seedLocation(exec),
      elevated: exec?.elevated === true,
      includeFilePath: exec?.includeFilePath !== false,
      extractResult: exec?.extractResult,
      dependsOn: exec?.dependsOn,
      sound: exec?.sound ?? "default",
      runOnSave: exec?.runOnSave === true,
      allowConcurrent: shortcut.allowConcurrent === true,
      lockName: shortcut.lockName,
    };
  }

  private async postInit(): Promise<void> {
    const shortcut = this.store.findShortcut(this.shortcutId);
    if (!shortcut) {
      return;
    }
    await this.panel.webview.postMessage({
      type: "init",
      work: this.initialWork(shortcut),
    });
    await this.postInterpreters(shortcut);
  }

  // Detect the interpreters installed for this file's type and post them so the command
  // card can render one-click chips plus a "what blank resolves to" hint — the no-typing,
  // no-JSON way to choose a runtime. Carries the host-localized labels for the pseudo-
  // choices (run directly / browse / the default hint), since the client holds no
  // display strings. A non-file shortcut (a recipe action, a moved target) has no file
  // type to detect, so the chips stay empty and the card is just the text box.
  private async postInterpreters(shortcut: Shortcut): Promise<void> {
    const uri = this.store.resolveUri(shortcut);
    if (!uri) {
      return;
    }
    const ext = path.extname(uri.fsPath).toLowerCase();
    const detected = await detectInterpreters(ext);
    // The prefix a blank command resolves to: the file-type default, else the shebang.
    const defaultPrefix = resolveRunPrefix(
      { ...shortcut, exec: { ...shortcut.exec, command: undefined } },
      uri.fsPath
    );
    await this.panel.webview.postMessage({
      type: "interpreters",
      detected: detected.map((d) => ({ label: d.label, command: d.command, detail: d.path })),
      labels: {
        // The chip that clears the per-pin prefix back to the file-type default. The
        // command box cannot carry "run directly" (it collapses empty to "use default"),
        // so that explicit choice lives only in the "Run with…" QuickPick — here, empty
        // means default.
        useDefault: l10n("configureRun.interp.useDefault"),
        browse: l10n("configureRun.interp.browse"),
        // Shown under the command box while it is blank, so "empty" is never a mystery.
        defaultHint: defaultPrefix
          ? l10n("configureRun.interp.defaultHint", { interpreter: defaultPrefix })
          : l10n("configureRun.interp.defaultHintNone"),
      },
    });
  }

  // Pick an interpreter executable from disk and hand its path back to the command box.
  // A path with spaces is quoted so it stays a single prefix token in the assembly.
  private async onBrowse(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: l10n("runWith.browse.openLabel"),
      title: l10n("runWith.browse.title"),
    });
    if (!picked || picked.length === 0) {
      return;
    }
    const exe = picked[0].fsPath;
    await this.panel.webview.postMessage({
      type: "browsed",
      command: /\s/.test(exe) ? `"${exe}"` : exe,
    });
  }

  // Turn the wire shape back into a ShortcutExecConfig working copy (the same one the
  // QuickPick threads through normalize). Concurrency lives top-level on the Shortcut,
  // so it is returned separately.
  private toWork(wire: WireExec): { exec: ShortcutExecConfig; conc: ConcurrencyEdit } {
    const parsedArgs = parseArgs(wire.argsLine);
    const exec: ShortcutExecConfig = {
      command: wire.command,
      args: parsedArgs.length > 0 ? parsedArgs : undefined,
      cwd: wire.cwd,
      env: Object.keys(wire.env).length > 0 ? wire.env : undefined,
      runLocation: wire.location,
      elevated: wire.elevated,
      includeFilePath: wire.includeFilePath,
      extractResult: wire.extractResult,
      dependsOn: wire.dependsOn,
      sound: wire.sound === "default" ? undefined : wire.sound,
      runOnSave: wire.runOnSave,
    };
    const conc: ConcurrencyEdit = {
      allowConcurrent: wire.allowConcurrent,
      lockName: wire.lockName,
    };
    return { exec, conc };
  }

  // Compute the live command preview from the form using the real planRun assembly, so
  // the footer can never disagree with what an actual run will do. A typed extract regex
  // is validated here (echoed as extractValid) so a malformed pattern blocks save.
  private async postPreview(wire: WireExec): Promise<void> {
    const shortcut = this.store.findShortcut(this.shortcutId);
    if (!shortcut) {
      return;
    }
    const { exec } = this.toWork(wire);
    await this.panel.webview.postMessage({
      type: "preview",
      commandLine: this.previewCommand(shortcut, normalize(exec)),
      extractValid: isValidExtract(wire.extractResult),
    });
  }

  // Assemble the command line the working copy would run, via planRun (one source of
  // truth with a real run and the dry-run audit). When the file type has no run command
  // the planner yields an empty line, which reads as "this opens the file" — surfaced as
  // a localized note. When the file cannot be resolved (a moved/removed target) there is
  // nothing to assemble, so the same note is shown.
  private previewCommand(shortcut: Shortcut, exec: ShortcutExecConfig): string {
    const uri = this.store.resolveUri(shortcut);
    if (!uri) {
      return l10n("configureRun.footer.none");
    }
    const plan = planRun({ ...shortcut, exec }, uri);
    if (plan.commandLine.trim() === "") {
      return l10n("configureRun.footer.none");
    }
    const elevated =
      plan.location === "external" && plan.elevated
        ? l10n("configureRun.footer.elevatedSuffix")
        : "";
    return plan.commandLine + elevated;
  }

  // Persist the form: reconstruct the config, normalize (round-trip parity with the
  // QuickPick and hand-written JSON), write through the same store methods, and report a
  // toast that names the shortcut.
  private async save(wire: WireExec): Promise<void> {
    const shortcut = this.store.findShortcut(this.shortcutId);
    if (!shortcut) {
      vscode.window.showWarningMessage(l10n("configure.autoUnsupported"));
      this.panel.dispose();
      return;
    }
    const { exec, conc } = this.toWork(wire);
    await this.store.updateShortcutExec(shortcut, normalize(exec));
    await this.store.setShortcutConcurrency(shortcut, conc.allowConcurrent, conc.lockName);
    vscode.window.showInformationMessage(
      l10n("configure.saved", { name: shortcutName(shortcut) })
    );
    this.panel.dispose();
  }

  private dispose(): void {
    ConfigureRunPanel.current = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

// Whether a typed extract pattern is a valid regex. An empty/absent pattern is valid (it
// clears the field); a non-empty one must compile, mirroring the QuickPick's inline
// validation so a malformed pattern never persists and silently never matches.
function isValidExtract(pattern: string | undefined): boolean {
  if (!pattern || pattern.trim() === "") {
    return true;
  }
  try {
    new RegExp(pattern.trim(), "m");
    return true;
  } catch {
    return false;
  }
}

