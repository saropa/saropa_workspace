// Stand-ins for the editor shell: the input box, the active color theme and the installed
// extensions with their manifests. Re-exported by vscode.ts so "vscode" still resolves to one module.

import { EventEmitter } from "./vscodeTypes";

// vscode.ColorThemeKind: the real numeric values.
export const ColorThemeKind = { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 } as const;

let themeKind: number = ColorThemeKind.Dark;
/** Test hook: sets the kind `window.activeColorTheme` reports. */
export function __setColorThemeKind(kind: number): void {
  themeKind = kind;
}

/** A title-bar button of an input box. */
export interface FakeInputButton {
  readonly iconPath?: unknown;
  readonly tooltip?: string;
}

/** A persistent input box: the properties the extension sets, plus change, button, accept and hide events. */
export interface FakeInputBox {
  title: string | undefined;
  prompt: string | undefined;
  placeholder: string | undefined;
  value: string;
  buttons: readonly FakeInputButton[];
  shown: boolean;
  disposed: boolean;
  onDidChangeValue: EventEmitter<string>["event"];
  onDidTriggerButton: EventEmitter<FakeInputButton>["event"];
  onDidAccept: EventEmitter<void>["event"];
  onDidHide: EventEmitter<void>["event"];
  show(): void;
  hide(): void;
  dispose(): void;
  /** Test driver: sets the text as a user typing would, firing the change event. */
  type(text: string): void;
  /** Test driver: presses the button at `index` of the current buttons. */
  press(index: number): void;
  /** Test driver: presses Enter. */
  accept(): void;
}

const inputBoxes: FakeInputBox[] = [];

/** Test hook: every input box created since the last reset, in creation order. */
export function __inputBoxes(): readonly FakeInputBox[] {
  return inputBoxes;
}

function createInputBox(): FakeInputBox {
  const changed = new EventEmitter<string>();
  const pressed = new EventEmitter<FakeInputButton>();
  const accepted = new EventEmitter<void>();
  const hidden = new EventEmitter<void>();
  const box: FakeInputBox = {
    title: undefined,
    prompt: undefined,
    placeholder: undefined,
    value: "",
    buttons: [],
    shown: false,
    disposed: false,
    onDidChangeValue: changed.event,
    onDidTriggerButton: pressed.event,
    onDidAccept: accepted.event,
    onDidHide: hidden.event,
    show(): void {
      box.shown = true;
    },
    hide(): void {
      box.shown = false;
      hidden.fire();
    },
    dispose(): void {
      box.disposed = true;
    },
    type(text: string): void {
      box.value = text;
      changed.fire(text);
    },
    press(index: number): void {
      pressed.fire(box.buttons[index]);
    },
    accept(): void {
      accepted.fire();
    },
  };
  inputBoxes.push(box);
  return box;
}

/** An integrated terminal handle: what it was created with, what was typed into it, how it was shown. */
export interface FakeTerminal {
  readonly options: { name?: string; cwd?: string; env?: Record<string, string> };
  readonly sentTexts: string[];
  readonly shownWith: boolean[];
  disposed: boolean;
  show(preserveFocus?: boolean): void;
  sendText(text: string, addNewLine?: boolean): void;
  dispose(): void;
}

const terminals: FakeTerminal[] = [];

/** Test hook: every terminal created since the last reset, in creation order. */
export function __terminals(): readonly FakeTerminal[] {
  return terminals;
}

function createTerminal(options: FakeTerminal["options"]): FakeTerminal {
  const terminal: FakeTerminal = {
    options,
    sentTexts: [],
    shownWith: [],
    disposed: false,
    show(preserveFocus?: boolean): void {
      terminal.shownWith.push(preserveFocus === true);
    },
    sendText(text: string): void {
      terminal.sentTexts.push(text);
    },
    dispose(): void {
      terminal.disposed = true;
    },
  };
  terminals.push(terminal);
  return terminal;
}

// Installed extensions: id -> manifest. getExtension reports presence and the manifest.
let installed = new Map<string, unknown>();

/** Test hook: sets which extension ids are installed; the optional manifest is their packageJSON. */
export function __setInstalledExtensions(ids: string[], manifest?: unknown): void {
  installed = new Map(ids.map((id) => [id, manifest]));
}

/** Test hook: marks every extension as not installed (called by the config reset). */
export function __clearInstalledExtensions(): void {
  installed = new Map();
}

/** vscode.extensions stand-in: reports installed ids with their manifest. */
export const extensions = {
  getExtension(id: string): { id: string; packageJSON: unknown } | undefined {
    return installed.has(id) ? { id, packageJSON: installed.get(id) } : undefined;
  },
};

/** Test hook: forgets the input boxes, terminals, resets the theme to dark and removes all extensions. */
export function __resetShell(): void {
  inputBoxes.length = 0;
  terminals.length = 0;
  themeKind = ColorThemeKind.Dark;
  __clearInstalledExtensions();
}

/** The extra members of `vscode.window`. */
export const shellWindow = {
  createInputBox,
  createTerminal,
  activeColorTheme: {
    get kind(): number {
      return themeKind;
    },
  },
};
