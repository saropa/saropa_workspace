import * as vscode from "vscode";
import * as path from "path";
import { Pin, PinExecConfig, RunLocation } from "../model/pin";
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
  id:
    | "command"
    | "args"
    | "cwd"
    | "env"
    | "location"
    | "elevated"
    | "fileArg"
    | "extract"
    | "dependsOn"
    | "save";
}

// Seed the working copy's location from a stored pin WITHOUT consulting the
// workspace default (the hub shows the pin's own choice, where undefined means
// "follow the default setting"). Maps the deprecated useIntegratedTerminal flag
// for pins written before runLocation existed.
function seedLocation(exec: PinExecConfig | undefined): RunLocation | undefined {
  if (exec?.runLocation) {
    return exec.runLocation;
  }
  if (exec?.useIntegratedTerminal === true) {
    return "terminal";
  }
  if (exec?.useIntegratedTerminal === false) {
    return "background";
  }
  return undefined;
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
    runLocation: seedLocation(pin.exec),
    elevated: pin.exec?.elevated,
    includeFilePath: pin.exec?.includeFilePath,
    extractResult: pin.exec?.extractResult,
    dependsOn: pin.exec?.dependsOn,
  };

  const title = l10n("configure.title", { name });

  // Hub loop: show the field summary, dispatch to the chosen sub-editor, repeat.
  // Returns out of the function on Save (persist) or Esc (discard).
  for (;;) {
    const depName = work.dependsOn
      ? resolveDepName(store, work.dependsOn)
      : undefined;
    const choice = await showHub(work, title, depName);
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
      case "location":
        await editLocation(work, title);
        break;
      case "elevated":
        await editElevated(work, title);
        break;
      case "fileArg":
        await editFileArg(work, title);
        break;
      case "extract":
        await editExtract(work, title);
        break;
      case "dependsOn":
        await editDependsOn(work, title, store, pin);
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
    runLocation: work.runLocation,
    // Elevation only applies to an external window; drop it otherwise so a
    // stored config has no stray flag.
    elevated: work.runLocation === "external" && work.elevated === true ? true : undefined,
    // Writing runLocation supersedes the deprecated flag; clear it so a re-saved
    // pin carries the location in exactly one field (no two-source drift).
    useIntegratedTerminal: undefined,
    // true is the default assembly, so collapse it to undefined for parity; only
    // an explicit false (omit the file path) is meaningful to persist.
    includeFilePath: work.includeFilePath === false ? false : undefined,
    // Collapse an empty pattern to undefined (round-trip parity with hand-written
    // JSON that simply omits the field).
    extractResult:
      work.extractResult && work.extractResult.trim() !== ""
        ? work.extractResult
        : undefined,
    dependsOn: work.dependsOn || undefined,
  };
}

async function showHub(
  work: PinExecConfig,
  title: string,
  depName: string | undefined
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
      id: "location",
      label: l10n("configure.field.terminal"),
      description: locationLabel(work.runLocation),
    },
    // Elevation is only meaningful for an external window; show the toggle only
    // when that location is chosen so the hub does not offer a no-op field.
    ...(work.runLocation === "external"
      ? [
          {
            id: "elevated" as const,
            label: l10n("configure.field.elevated"),
            description: work.elevated
              ? l10n("configure.elevated.on")
              : l10n("configure.elevated.off"),
          },
        ]
      : []),
    {
      id: "fileArg",
      label: l10n("configure.field.fileArg"),
      description:
        work.includeFilePath === false
          ? l10n("configure.fileArg.off")
          : l10n("configure.fileArg.on"),
    },
    {
      id: "extract",
      label: l10n("configure.field.extract"),
      description: work.extractResult ?? l10n("configure.value.none"),
    },
    {
      id: "dependsOn",
      label: l10n("configure.field.dependsOn"),
      description: depName ?? l10n("configure.value.none"),
    },
    {
      id: "save",
      label: l10n("configure.save"),
      description: l10n("configure.saveHint"),
    },
  ];

  // ignoreFocusOut: dismissing the hub discards the whole working copy, so a
  // stray click outside the picker must NOT close it — only a deliberate Esc
  // does. Without this, one misclick loses every edit and the user starts over.
  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: l10n("configure.hubPlaceholder"),
    ignoreFocusOut: true,
  });
  return pick?.id;
}

function locationLabel(value: RunLocation | undefined): string {
  switch (value) {
    case "terminal":
      return l10n("configure.terminal.integrated");
    case "background":
      return l10n("configure.terminal.background");
    case "external":
      return l10n("configure.terminal.external");
    default:
      return l10n("configure.terminal.default");
  }
}

async function editCommand(work: PinExecConfig, title: string): Promise<void> {
  const value = await vscode.window.showInputBox({
    title,
    prompt: l10n("configure.command.prompt"),
    placeHolder: l10n("configure.command.placeholder"),
    value: work.command ?? "",
    ignoreFocusOut: true,
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
    ignoreFocusOut: true,
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
    ignoreFocusOut: true,
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
      ignoreFocusOut: true,
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
      ignoreFocusOut: true,
    });
    if (!pick) {
      // Esc returns to the hub with the env edits made so far retained in `work`.
      return;
    }

    if (pick.id === "add") {
      const key = await vscode.window.showInputBox({
        title,
        prompt: l10n("configure.env.keyPrompt"),
        ignoreFocusOut: true,
        validateInput: (input) => validateEnvKey(input, keys),
      });
      if (key === undefined) {
        continue;
      }
      const value = await vscode.window.showInputBox({
        title,
        prompt: l10n("configure.env.valuePrompt", { key: key.trim() }),
        ignoreFocusOut: true,
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
      {
        title,
        placeHolder: l10n("configure.env.actionPlaceholder", { key }),
        ignoreFocusOut: true,
      }
    );
    if (!action) {
      continue;
    }
    if (action.id === "edit") {
      const value = await vscode.window.showInputBox({
        title,
        prompt: l10n("configure.env.valuePrompt", { key }),
        value: env[key],
        ignoreFocusOut: true,
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

async function editLocation(work: PinExecConfig, title: string): Promise<void> {
  interface LocationItem extends vscode.QuickPickItem {
    value: RunLocation | undefined;
  }
  const items: LocationItem[] = [
    { label: l10n("configure.terminal.default"), value: undefined },
    { label: l10n("configure.terminal.integrated"), value: "terminal" },
    { label: l10n("configure.terminal.background"), value: "background" },
    {
      label: l10n("configure.terminal.external"),
      detail: l10n("configure.terminal.externalDetail"),
      value: "external",
    },
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: l10n("configure.terminal.placeholder"),
    ignoreFocusOut: true,
  });
  if (!pick) {
    return;
  }
  work.runLocation = pick.value;
  // Choosing External immediately offers the admin toggle in the same sequence,
  // so enabling elevation is one flow rather than picking External, returning to
  // the hub, and hunting for a field that only appears once External is set. The
  // toggle stays on the hub too, so it remains adjustable later.
  if (pick.value === "external") {
    await editElevated(work, title);
  }
}

// Toggle administrator/elevated privileges for an external window. Reachable only
// when the location is "external" (the hub hides this field otherwise).
async function editElevated(work: PinExecConfig, title: string): Promise<void> {
  interface ElevatedItem extends vscode.QuickPickItem {
    value: boolean;
  }
  const items: ElevatedItem[] = [
    { label: l10n("configure.elevated.offChoice"), value: false },
    {
      label: l10n("configure.elevated.onChoice"),
      detail: l10n("configure.elevated.detail"),
      value: true,
    },
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: l10n("configure.elevated.placeholder"),
    ignoreFocusOut: true,
  });
  if (!pick) {
    return;
  }
  work.elevated = pick.value;
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
    ignoreFocusOut: true,
  });
  if (!pick) {
    return;
  }
  work.includeFilePath = pick.value;
}

// Set the output-extraction regex (WOW #16). The pattern is matched against a
// BACKGROUND run's output when it finishes; the first capture group (or the whole
// match) is copied to the clipboard. An empty entry clears it. Validated as a real
// regex inline so a typo never persists and silently never matches.
async function editExtract(work: PinExecConfig, title: string): Promise<void> {
  const value = await vscode.window.showInputBox({
    title,
    prompt: l10n("configure.extract.prompt"),
    placeHolder: l10n("configure.extract.placeholder"),
    value: work.extractResult ?? "",
    ignoreFocusOut: true,
    validateInput: (input) => {
      const trimmed = input.trim();
      if (trimmed === "") {
        return undefined; // empty clears the pattern
      }
      try {
        new RegExp(trimmed, "m");
        return undefined;
      } catch {
        return l10n("configure.extract.invalid");
      }
    },
  });
  if (value === undefined) {
    return;
  }
  work.extractResult = value.trim() === "" ? undefined : value.trim();
}

// Display name for a dependency pin id (the hub shows the prerequisite's name, not
// its opaque id). Falls back to a placeholder when the id no longer resolves.
function resolveDepName(store: PinStore, id: string): string {
  const dep = store.findPin(id);
  return dep
    ? dep.label ?? (dep.path.split("/").pop() ?? dep.path)
    : l10n("configure.dependsOn.unknown");
}

// Pick the pin that must succeed before this one runs (WOW #13), or clear the
// dependency. Lists the other pins across both scopes; recipe pins are excluded
// (they are detected shortcuts, not the user's own build steps), and the pin itself
// cannot depend on itself.
async function editDependsOn(
  work: PinExecConfig,
  title: string,
  store: PinStore,
  pin: Pin
): Promise<void> {
  interface DepItem extends vscode.QuickPickItem {
    id?: string;
  }
  const items: DepItem[] = [
    { id: undefined, label: l10n("configure.dependsOn.none") },
  ];
  for (const candidate of [...store.getProjectPins(), ...store.getGlobalPins()]) {
    if (candidate.id === pin.id || candidate.isRecipe) {
      continue;
    }
    items.push({
      id: candidate.id,
      label: candidate.label ?? (candidate.path.split("/").pop() ?? candidate.path),
      description:
        candidate.scope === "global"
          ? l10n("pin.group.global")
          : l10n("pin.group.project"),
    });
  }
  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: l10n("configure.dependsOn.placeholder"),
    ignoreFocusOut: true,
  });
  if (!pick) {
    return;
  }
  work.dependsOn = pick.id;
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
