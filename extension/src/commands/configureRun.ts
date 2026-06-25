import * as vscode from "vscode";
import * as path from "path";
import { Pin, PinExecConfig } from "../model/pin";
import { PinStore } from "../model/pinStore";
import { l10n } from "../i18n/l10n";

// Roadmap 2.1 — Run-parameters editor.
//
// A hub-and-spoke QuickPick flow to edit a pin's PinExecConfig (command prefix,
// arguments, working directory, environment variables, terminal-vs-background
// toggle) without hand-editing JSON.
//
// Edits accumulate in a working copy; nothing is persisted until the user
// explicitly chooses Save at the hub. Dismissing (Esc) the hub discards the
// working copy, so a canceled edit never reaches disk (acceptance: canceling
// any step aborts with no partial write). Dismissing a sub-step returns to the
// hub with that field unchanged.

// A QuickPickItem tagged with the hub action it represents.
interface HubItem extends vscode.QuickPickItem {
  id: "command" | "args" | "cwd" | "env" | "terminal" | "fileArg" | "save";
}

export async function configureRun(store: PinStore, pin: Pin): Promise<void> {
  // Auto-pins are recomputed each refresh and never stored in pins[], so there
  // is nowhere to persist run config; surface that rather than silently failing.
  if (pin.isAuto) {
    vscode.window.showWarningMessage(l10n("configure.autoUnsupported"));
    return;
  }

  const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);

  // Working copy: a deep-enough clone so canceling discards every edit. args and
  // env are copied by value; the rest are primitives.
  const work: PinExecConfig = {
    command: pin.exec?.command,
    args: pin.exec?.args ? [...pin.exec.args] : undefined,
    cwd: pin.exec?.cwd,
    env: pin.exec?.env ? { ...pin.exec.env } : undefined,
    useIntegratedTerminal: pin.exec?.useIntegratedTerminal,
    includeFilePath: pin.exec?.includeFilePath,
  };

  const title = l10n("configure.title", { name });

  // Hub loop: show the field summary, dispatch to the chosen sub-editor, repeat.
  // Returns out of the function on Save (persist) or Esc (discard).
  for (;;) {
    const choice = await showHub(work, title);
    if (!choice) {
      // Esc at the hub: discard the working copy and write nothing (canceling
      // leaves the persisted config untouched).
      return;
    }
    if (choice === "save") {
      break;
    }
    switch (choice) {
      case "command":
        await editCommand(work, title);
        break;
      case "args":
        await editArgs(work, title);
        break;
      case "cwd":
        await editCwd(work, title, store, pin);
        break;
      case "env":
        await editEnv(work, title);
        break;
      case "terminal":
        await editTerminal(work, title);
        break;
      case "fileArg":
        await editFileArg(work, title);
        break;
    }
  }

  await store.updatePinExec(pin, normalize(work));
  vscode.window.showInformationMessage(l10n("configure.saved", { name }));
}

// Collapse empty collections to undefined so a saved config is identical to the
// equivalent hand-written JSON (round-trip parity). command is left as-is: ""
// (run directly, overriding the interpreter default) is a distinct, meaningful
// value from undefined (use the default).
function normalize(work: PinExecConfig): PinExecConfig {
  return {
    command: work.command,
    args: work.args && work.args.length > 0 ? work.args : undefined,
    cwd: work.cwd,
    env: work.env && Object.keys(work.env).length > 0 ? work.env : undefined,
    useIntegratedTerminal: work.useIntegratedTerminal,
    // true is the default assembly, so collapse it to undefined for parity; only
    // an explicit false (omit the file path) is meaningful to persist.
    includeFilePath: work.includeFilePath === false ? false : undefined,
  };
}

async function showHub(
  work: PinExecConfig,
  title: string
): Promise<HubItem["id"] | undefined> {
  const items: HubItem[] = [
    {
      id: "command",
      label: l10n("configure.field.command"),
      description: work.command ?? l10n("configure.value.commandDefault"),
    },
    {
      id: "args",
      label: l10n("configure.field.args"),
      description:
        work.args && work.args.length > 0
          ? formatArgs(work.args)
          : l10n("configure.value.none"),
    },
    {
      id: "cwd",
      label: l10n("configure.field.cwd"),
      description: work.cwd ?? l10n("configure.value.cwdDefault"),
    },
    {
      id: "env",
      label: l10n("configure.field.env"),
      description: l10n("configure.value.envCount", {
        count: work.env ? Object.keys(work.env).length : 0,
      }),
    },
    {
      id: "terminal",
      label: l10n("configure.field.terminal"),
      description: terminalLabel(work.useIntegratedTerminal),
    },
    {
      id: "fileArg",
      label: l10n("configure.field.fileArg"),
      description:
        work.includeFilePath === false
          ? l10n("configure.fileArg.off")
          : l10n("configure.fileArg.on"),
    },
    {
      id: "save",
      label: l10n("configure.save"),
      description: l10n("configure.saveHint"),
    },
  ];

  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: l10n("configure.hubPlaceholder"),
  });
  return pick?.id;
}

function terminalLabel(value: boolean | undefined): string {
  if (value === true) {
    return l10n("configure.terminal.integrated");
  }
  if (value === false) {
    return l10n("configure.terminal.background");
  }
  return l10n("configure.terminal.default");
}

async function editCommand(work: PinExecConfig, title: string): Promise<void> {
  const value = await vscode.window.showInputBox({
    title,
    prompt: l10n("configure.command.prompt"),
    placeHolder: l10n("configure.command.placeholder"),
    value: work.command ?? "",
  });
  if (value === undefined) {
    // Esc on the sub-step: leave the field unchanged.
    return;
  }
  // An empty entry means "use the interpreter default for this file type".
  work.command = value.trim() === "" ? undefined : value;
}

async function editArgs(work: PinExecConfig, title: string): Promise<void> {
  const value = await vscode.window.showInputBox({
    title,
    prompt: l10n("configure.args.prompt"),
    placeHolder: l10n("configure.args.placeholder"),
    value: work.args ? formatArgs(work.args) : "",
  });
  if (value === undefined) {
    return;
  }
  const parsed = parseArgs(value);
  work.args = parsed.length > 0 ? parsed : undefined;
}

async function editCwd(
  work: PinExecConfig,
  title: string,
  store: PinStore,
  pin: Pin
): Promise<void> {
  const uri = store.resolveUri(pin);
  const owningFolder = uri
    ? vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath
    : undefined;
  const fileDir = uri ? path.dirname(uri.fsPath) : undefined;

  interface CwdItem extends vscode.QuickPickItem {
    id: "default" | "workspace" | "fileDir" | "custom";
    value?: string;
  }
  const items: CwdItem[] = [
    {
      id: "default",
      label: l10n("configure.cwd.default"),
      description: owningFolder ?? l10n("configure.value.cwdDefault"),
    },
  ];
  if (owningFolder) {
    items.push({
      id: "workspace",
      label: l10n("configure.cwd.workspace"),
      description: owningFolder,
      value: owningFolder,
    });
  }
  if (fileDir && fileDir !== owningFolder) {
    items.push({
      id: "fileDir",
      label: l10n("configure.cwd.fileDir"),
      description: fileDir,
      value: fileDir,
    });
  }
  items.push({ id: "custom", label: l10n("configure.cwd.custom") });

  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: l10n("configure.cwd.placeholder"),
  });
  if (!pick) {
    return;
  }
  if (pick.id === "default") {
    work.cwd = undefined;
    return;
  }
  if (pick.id === "custom") {
    const entered = await vscode.window.showInputBox({
      title,
      prompt: l10n("configure.cwd.customPrompt"),
      value: work.cwd ?? "",
      // Validate existence inline so an invalid path never persists.
      validateInput: async (input) => {
        if (input.trim() === "") {
          return l10n("configure.cwd.empty");
        }
        return (await directoryExists(input.trim()))
          ? undefined
          : l10n("configure.cwd.notFound");
      },
    });
    if (entered === undefined) {
      return;
    }
    work.cwd = entered.trim();
    return;
  }
  work.cwd = pick.value;
}

async function directoryExists(fsPath: string): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(fsPath));
    return (stat.type & vscode.FileType.Directory) !== 0;
  } catch {
    return false;
  }
}

async function editEnv(work: PinExecConfig, title: string): Promise<void> {
  // Sub-hub: list each KEY = value, an Add action, and per-entry edit/remove.
  // Looping here lets the user manage several variables before returning.
  for (;;) {
    const env = work.env ?? {};
    const keys = Object.keys(env);

    interface EnvItem extends vscode.QuickPickItem {
      id: string; // "add" or "var:<key>"
    }
    const items: EnvItem[] = [
      { id: "add", label: l10n("configure.env.add") },
    ];
    for (const key of keys) {
      items.push({
        id: `var:${key}`,
        label: `$(symbol-variable) ${key}`,
        description: env[key],
      });
    }

    const pick = await vscode.window.showQuickPick(items, {
      title,
      placeHolder: l10n("configure.env.placeholder"),
    });
    if (!pick) {
      // Esc returns to the hub with the env edits made so far retained in `work`.
      return;
    }

    if (pick.id === "add") {
      const key = await vscode.window.showInputBox({
        title,
        prompt: l10n("configure.env.keyPrompt"),
        validateInput: (input) => validateEnvKey(input, keys),
      });
      if (key === undefined) {
        continue;
      }
      const value = await vscode.window.showInputBox({
        title,
        prompt: l10n("configure.env.valuePrompt", { key: key.trim() }),
      });
      if (value === undefined) {
        continue;
      }
      work.env = { ...env, [key.trim()]: value };
      continue;
    }

    // Existing entry: edit its value or remove it.
    const key = pick.id.slice("var:".length);
    interface EnvActionItem extends vscode.QuickPickItem {
      id: "edit" | "delete";
    }
    const action = await vscode.window.showQuickPick<EnvActionItem>(
      [
        { id: "edit", label: l10n("configure.env.edit") },
        { id: "delete", label: l10n("configure.env.delete") },
      ],
      { title, placeHolder: l10n("configure.env.actionPlaceholder", { key }) }
    );
    if (!action) {
      continue;
    }
    if (action.id === "edit") {
      const value = await vscode.window.showInputBox({
        title,
        prompt: l10n("configure.env.valuePrompt", { key }),
        value: env[key],
      });
      if (value === undefined) {
        continue;
      }
      work.env = { ...env, [key]: value };
    } else {
      const { [key]: _removed, ...rest } = env;
      work.env = rest;
    }
  }
}

function validateEnvKey(input: string, existing: string[]): string | undefined {
  const trimmed = input.trim();
  if (trimmed === "") {
    return l10n("configure.env.keyEmpty");
  }
  if (trimmed.includes("=")) {
    return l10n("configure.env.keyEquals");
  }
  if (existing.includes(trimmed)) {
    return l10n("configure.env.keyDuplicate", { key: trimmed });
  }
  return undefined;
}

async function editTerminal(work: PinExecConfig, title: string): Promise<void> {
  interface TermItem extends vscode.QuickPickItem {
    value: boolean | undefined;
  }
  const items: TermItem[] = [
    { label: l10n("configure.terminal.default"), value: undefined },
    { label: l10n("configure.terminal.integrated"), value: true },
    { label: l10n("configure.terminal.background"), value: false },
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: l10n("configure.terminal.placeholder"),
  });
  if (!pick) {
    return;
  }
  work.useIntegratedTerminal = pick.value;
}

// Toggle whether the file path is inserted into the command. Off suits run
// targets that name their work in args (an npm script, a Make target) where the
// file is the package.json / Makefile in cwd, not an argument.
async function editFileArg(work: PinExecConfig, title: string): Promise<void> {
  interface FileArgItem extends vscode.QuickPickItem {
    value: boolean;
  }
  const items: FileArgItem[] = [
    { label: l10n("configure.fileArg.on"), value: true },
    { label: l10n("configure.fileArg.off"), value: false },
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: l10n("configure.fileArg.placeholder"),
  });
  if (!pick) {
    return;
  }
  work.includeFilePath = pick.value;
}

// Split a command-line string into args, honoring double-quoted spans so an
// argument with spaces survives the round trip through the input box. Exported so
// the run-with-overrides palette parses an edited argument line the same way.
export function parseArgs(line: string): string[] {
  const out: string[] = [];
  const token = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(line)) !== null) {
    out.push(match[1] !== undefined ? match[1] : match[2]);
  }
  return out;
}

// Inverse of parseArgs: quote any arg containing whitespace so the displayed and
// re-parsed forms agree. Exported alongside parseArgs for the overrides palette.
export function formatArgs(args: string[]): string {
  return args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
}
