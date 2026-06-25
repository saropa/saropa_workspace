import * as vscode from "vscode";
import { Pin } from "../model/pin";
import { promptMemory } from "./promptMemory";
import { l10n } from "../i18n/l10n";

// Interactive run-parameter tokens (roadmap 7.1). Unlike the static $name tokens
// (tokens.ts), these are resolved at run time from the user, so they need async
// VS Code UI and cannot live in the pure substitution path:
//   ${prompt:Label}     opens an input box, the label is the prompt text
//   ${pick:dev,stage}   opens a QuickPick over the comma-separated options
// One parameterized pin then covers many variants (a branch, an environment, a
// target) instead of a near-duplicate pin per value.
//
// Unattended callers (the scheduler) must NOT reach the prompt — they check
// hasInteractiveTokens and skip, since there is no user to answer a dialog.

// Matches a single interactive token. Only "prompt" and "pick" are recognized;
// any other ${...} (e.g. a shell ${HOME}) is left untouched for the shell.
const INTERACTIVE_RE = /\$\{(prompt|pick):([^}]*)\}/g;

interface InteractiveToken {
  // The full "${prompt:Label}" text; used verbatim as the dedup key and the
  // substitution target so the same token reused across command/args/cwd is
  // asked for exactly once.
  raw: string;
  kind: "prompt" | "pick";
  // Label text (prompt) or the comma-separated option list (pick).
  arg: string;
}

// Every string a run is assembled from: the command prefix, each argument, and a
// custom working directory.
function runStrings(pin: Pin): string[] {
  const out: string[] = [];
  if (pin.exec?.command) {
    out.push(pin.exec.command);
  }
  if (pin.exec?.args) {
    out.push(...pin.exec.args);
  }
  if (pin.exec?.cwd) {
    out.push(pin.exec.cwd);
  }
  return out;
}

// Whether running this pin would require interactive input. The scheduler uses
// this to skip unattended fires that cannot be answered.
export function hasInteractiveTokens(pin: Pin): boolean {
  return runStrings(pin).some((s) => {
    // .test on a /g regex advances lastIndex; reset so each string starts clean.
    INTERACTIVE_RE.lastIndex = 0;
    return INTERACTIVE_RE.test(s);
  });
}

// Unique interactive tokens across all run strings, in first-seen order.
function collectInteractiveTokens(pin: Pin): InteractiveToken[] {
  const seen = new Map<string, InteractiveToken>();
  for (const s of runStrings(pin)) {
    INTERACTIVE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = INTERACTIVE_RE.exec(s)) !== null) {
      const raw = match[0];
      if (!seen.has(raw)) {
        seen.set(raw, {
          raw,
          kind: match[1] as "prompt" | "pick",
          arg: match[2],
        });
      }
    }
  }
  return [...seen.values()];
}

// Ask the user for one token's value, pre-filled with the value entered last time
// (roadmap WOW #7). For a prompt, the last value seeds the input box; for a pick,
// the last value is moved to the front of the options so it is the highlighted
// default. Returns undefined on Escape / dismiss.
async function promptForToken(
  token: InteractiveToken,
  lastValue: string | undefined
): Promise<string | undefined> {
  if (token.kind === "prompt") {
    return vscode.window.showInputBox({
      prompt: token.arg || l10n("prompt.inputFallback"),
      // Default to the previous answer so the common "same as last time" case is a
      // single Enter, while still editable.
      value: lastValue ?? "",
      // Keep the box open if focus shifts; a run prompt is easy to lose.
      ignoreFocusOut: true,
    });
  }
  let options = token.arg
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  // showQuickPick highlights the first item, so surfacing the last choice first
  // makes it the default without changing the available set.
  if (lastValue && options.includes(lastValue)) {
    options = [lastValue, ...options.filter((o) => o !== lastValue)];
  }
  return vscode.window.showQuickPick(options, {
    placeHolder: l10n("prompt.pickPlaceholder"),
    ignoreFocusOut: true,
  });
}

// Prompt the user once per unique token, defaulting each to the value entered last
// time. Returns a raw->value map, or undefined if the user canceled any prompt — the
// caller must then abort the run with nothing executed (acceptance 7.1: a cancel
// leaves no partial run). Successful answers are remembered for next time.
export async function resolveInteractiveTokens(
  pin: Pin
): Promise<Map<string, string> | undefined> {
  const tokens = collectInteractiveTokens(pin);
  const values = new Map<string, string>();
  for (const token of tokens) {
    const value = await promptForToken(
      token,
      promptMemory.getValue(pin.id, token.raw)
    );
    // Escape / dismiss yields undefined; treat as a cancel of the whole run.
    if (value === undefined) {
      return undefined;
    }
    values.set(token.raw, value);
  }
  await promptMemory.remember(pin.id, values);
  return values;
}

// Resolve interactive tokens WITHOUT prompting where a previous choice is
// remembered; prompt only for tokens never answered for this pin. Backs "Run with
// Last Parameters", the bypass for a parameterized pin you run the same way every
// time. Returns undefined if a still-needed prompt is canceled; newly entered values
// are remembered so the next bypass skips them too.
export async function resolveRememberedTokens(
  pin: Pin
): Promise<Map<string, string> | undefined> {
  const tokens = collectInteractiveTokens(pin);
  const values = new Map<string, string>();
  const newlyEntered = new Map<string, string>();
  for (const token of tokens) {
    const last = promptMemory.getValue(pin.id, token.raw);
    if (last !== undefined) {
      values.set(token.raw, last);
      continue;
    }
    // No memory yet for this token: ask once so a first bypass still works, then
    // remember it for subsequent bypasses.
    const value = await promptForToken(token, undefined);
    if (value === undefined) {
      return undefined;
    }
    values.set(token.raw, value);
    newlyEntered.set(token.raw, value);
  }
  await promptMemory.remember(pin.id, newlyEntered);
  return values;
}

// Shallow-clone the pin with every interactive token replaced by its resolved
// value in the command, args, and cwd. The stored pin is untouched — the
// substitution applies to this run only.
export function cloneWithResolvedTokens(
  pin: Pin,
  values: Map<string, string>
): Pin {
  if (!pin.exec) {
    return pin;
  }
  const apply = (s: string): string => {
    let out = s;
    for (const [raw, value] of values) {
      out = out.split(raw).join(value);
    }
    return out;
  };
  return {
    ...pin,
    exec: {
      ...pin.exec,
      command:
        pin.exec.command !== undefined ? apply(pin.exec.command) : undefined,
      args: pin.exec.args?.map(apply),
      cwd: pin.exec.cwd !== undefined ? apply(pin.exec.cwd) : undefined,
    },
  };
}
