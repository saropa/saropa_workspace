import * as vscode from "vscode";
import { Pin } from "../model/pin";
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

// Prompt the user once per unique token. Returns a raw->value map, or undefined
// if the user canceled any prompt — the caller must then abort the run with
// nothing executed (acceptance 7.1: a cancel leaves no partial run).
export async function resolveInteractiveTokens(
  pin: Pin
): Promise<Map<string, string> | undefined> {
  const tokens = collectInteractiveTokens(pin);
  const values = new Map<string, string>();
  for (const token of tokens) {
    let value: string | undefined;
    if (token.kind === "prompt") {
      value = await vscode.window.showInputBox({
        prompt: token.arg || l10n("prompt.inputFallback"),
        // Keep the box open if focus shifts; a run prompt is easy to lose.
        ignoreFocusOut: true,
      });
    } else {
      const options = token.arg
        .split(",")
        .map((o) => o.trim())
        .filter((o) => o.length > 0);
      value = await vscode.window.showQuickPick(options, {
        placeHolder: l10n("prompt.pickPlaceholder"),
        ignoreFocusOut: true,
      });
    }
    // Escape / dismiss yields undefined; treat as a cancel of the whole run.
    if (value === undefined) {
      return undefined;
    }
    values.set(token.raw, value);
  }
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
