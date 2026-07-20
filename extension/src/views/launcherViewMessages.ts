import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { shortcutKind } from "../model/shortcut";
import { FolderWatchStore } from "../model/folderWatch";
import { runShortcutCommand } from "../commands/shortcutExecution";
import { openShortcut } from "../commands/shortcutOpen";
import { l10n } from "../i18n/l10n";
import { ProjectFilesTreeProvider } from "./projectFilesProvider";
import { ScriptsTreeProvider } from "./scriptsTreeProvider";
import { runLibraryScript, buildScriptShortcut } from "../exec/scriptRunner";
import { SetParamsPanel } from "./setParamsPanel";

// The right-click menu only lists commands verified to accept a raw Shortcut via asShortcut
// (see buildMenu in launcherItemMenu). Re-resolving the id here and forwarding the shortcut
// as the command argument is therefore safe: the registered handler normalizes it exactly as
// a tree-item invocation would. The allowlist guards against a webview posting an arbitrary
// command id.
const MENU_COMMANDS: ReadonlySet<string> = new Set([
  "saropaWorkspace.openPin",
  "saropaWorkspace.runPin",
  "saropaWorkspace.runWith",
  "saropaWorkspace.configureRun",
  "saropaWorkspace.setPinParams",
  "saropaWorkspace.configureSchedule",
  "saropaWorkspace.configureTriggers",
  "saropaWorkspace.pausePin",
  "saropaWorkspace.unpausePin",
  "saropaWorkspace.customizeShortcut",
  "saropaWorkspace.setMetric",
  "saropaWorkspace.duplicateFile",
  "saropaWorkspace.renameFileOnDisk",
  "saropaWorkspace.copyFileTo",
  "saropaWorkspace.toggleMask",
  "saropaWorkspace.renamePin",
  "saropaWorkspace.unpin",
  "saropaWorkspace.promoteRecipe",
  "saropaWorkspace.scheduleRecipe",
]);

// The dependencies onMessage needs from the host class: the two stores it resolves ids
// against, the project-files provider for watch/file opens, and a callback to repaint the
// webview after a `ready` handshake (the class owns `post`'s access to the resolved view).
export interface LauncherMessageContext {
  readonly store: ShortcutStore;
  readonly watchStore: FolderWatchStore;
  readonly projectFiles: ProjectFilesTreeProvider;
  readonly scriptsProvider: ScriptsTreeProvider;
  readonly extensionPath: string;
  readonly post: () => Promise<void>;
}

// Resolve a webview message to an action on the addressed shortcut. The payload is
// untrusted, so the id is narrowed and re-resolved against the store rather than trusting a
// shortcut object from the webview.
export async function handleLauncherMessage(
  message: unknown,
  ctx: LauncherMessageContext
): Promise<void> {
  if (typeof message !== "object" || message === null) {
    return;
  }
  const msg = message as {
    type?: string;
    id?: string;
    command?: string;
    path?: string;
  };
  if (msg.type === "ready") {
    await ctx.post();
    return;
  }

  // The Watches and Project Files panes route their opens by their OWN validated
  // targets, not through the store: a watch id is not a shortcut id, and a surfaced
  // project file is often not a shortcut at all. Each id/path is re-validated against
  // the live source here so the untrusted webview can never drive an arbitrary watch
  // or open an arbitrary file path.
  if (msg.type === "openWatch" && typeof msg.id === "string") {
    if (ctx.watchStore.find(msg.id)) {
      // openWatch opens what changed and clears the watch's unseen counter; the
      // launcher's watch card carries that same counter, so it stays in sync.
      await vscode.commands.executeCommand("saropaWorkspace.openWatch", msg.id);
    }
    return;
  }
  if (msg.type === "openFile" && typeof msg.path === "string") {
    const files = await ctx.projectFiles.listSurfacedFiles();
    const target = files.find((f) => f.uri.fsPath === msg.path);
    if (target) {
      await vscode.commands.executeCommand("vscode.open", target.uri);
    }
    return;
  }
  // Copy a file-backed card's full on-disk path to the clipboard, resolved host-side by
  // the card's id so the webview never carries or is trusted with a path. A file shortcut/
  // recipe resolves through the store (its stored path may be folder-relative, so resolve
  // to the absolute fsPath); a surfaced project file's id is its absolute path, re-validated
  // against the live surfaced-files list. Either way the toast names the file.
  if (msg.type === "copyPath" && typeof msg.id === "string") {
    const shortcut = ctx.store.findShortcut(msg.id);
    if (shortcut) {
      // Only file shortcuts have a meaningful on-disk path; a shell/macro/routine does not.
      if (shortcutKind(shortcut) !== "file") {
        return;
      }
      const full = ctx.store.resolveUri(shortcut)?.fsPath ?? shortcut.path;
      await vscode.env.clipboard.writeText(full);
      void vscode.window.showInformationMessage(
        l10n("launcher.copiedPath", {
          name: shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path),
        })
      );
      return;
    }
    const files = await ctx.projectFiles.listSurfacedFiles();
    const target = files.find((f) => f.uri.fsPath === msg.id);
    if (target) {
      await vscode.env.clipboard.writeText(target.uri.fsPath);
      void vscode.window.showInformationMessage(
        l10n("launcher.copiedPath", {
          name: target.name.split("/").pop() ?? target.name,
        })
      );
    }
    return;
  }

  if (typeof msg.id !== "string") {
    return;
  }

  // Library script cards carry a `library:<id>` composite id that never exists
  // in the shortcut store. Intercept run messages for them and route through the
  // script runner, which synthesizes a Shortcut from the manifest entry.
  if (msg.id.startsWith("library:")) {
    const scriptId = msg.id.slice("library:".length);
    const script = ctx.scriptsProvider.findScript(scriptId);
    if (!script) {
      if (msg.type === "run") {
        void vscode.window.showErrorMessage(l10n("scripts.run.notFound"));
      }
      return;
    }
    if (msg.type === "run") {
      await runLibraryScript(script, ctx.extensionPath);
    } else if (msg.type === "command" && msg.command === "saropaWorkspace.setScriptParams") {
      SetParamsPanel.show(buildScriptShortcut(script, ctx.extensionPath));
    }
    return;
  }

  const shortcut = ctx.store.findShortcut(msg.id);
  if (!shortcut) {
    return;
  }
  if (msg.type === "open") {
    await openShortcut(ctx.store, shortcut);
  } else if (msg.type === "run") {
    await runShortcutCommand(ctx.store, shortcut);
  } else if (msg.type === "command" && typeof msg.command === "string") {
    // A right-click menu choice: run the same command the sidebar would, passing the
    // re-resolved shortcut as its argument. Gated by the allowlist so only the menu's
    // own commands can be driven from the webview.
    if (MENU_COMMANDS.has(msg.command)) {
      await vscode.commands.executeCommand(msg.command, shortcut);
    }
  }
}
