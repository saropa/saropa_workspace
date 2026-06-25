import * as vscode from "vscode";
import * as path from "path";
import { Pin, pinKind } from "../model/pin";
import { PinStore } from "../model/pinStore";
import { l10n } from "../i18n/l10n";

// "Copy-Paste Template Pins" (roadmap WOW #27). Duplicate a file pin's target into a
// new file, renaming the file's base identifier in every case style at once — so
// `base_controller.ts` (containing `BaseController`, `base_controller`,
// `BASE_CONTROLLER`) becomes `user_account.ts` with `UserAccount`, `user_account`,
// `USER_ACCOUNT` — then open the copy. The source file and the pin are untouched.

type CaseStyle = "snake" | "kebab" | "camel" | "pascal" | "upper";
// All styles transformed in one pass. The five render to distinct strings, so a
// plain split/join per style cannot cross-replace, and order does not matter.
const ALL_STYLES: readonly CaseStyle[] = ["pascal", "camel", "upper", "snake", "kebab"];

// Split an identifier into lowercase words, breaking on camelCase humps and the
// separators _ - and space. "BaseController" -> ["base","controller"];
// "user_account" -> ["user","account"].
function splitWords(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-\s]+/g, " ")
    .trim()
    .toLowerCase()
    .split(" ")
    .filter((w) => w.length > 0);
}

function renderCase(words: string[], style: CaseStyle): string {
  const cap = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);
  switch (style) {
    case "snake":
      return words.join("_");
    case "kebab":
      return words.join("-");
    case "upper":
      return words.map((w) => w.toUpperCase()).join("_");
    case "pascal":
      return words.map(cap).join("");
    case "camel":
      return words.map((w, i) => (i === 0 ? w : cap(w))).join("");
  }
}

// Detect the case style of the original file's base name, so the copy is named the
// same way (a snake_case source yields a snake_case file). An all-caps base is
// treated as snake (lowercased on render) rather than UPPER, since file names are
// rarely SCREAMING_CASE.
function detectFileNameStyle(base: string): CaseStyle {
  if (base.includes("_")) {
    return "snake";
  }
  if (base.includes("-")) {
    return "kebab";
  }
  if (/^[A-Z]/.test(base)) {
    return "pascal";
  }
  return "camel";
}

// Replace every case-variant of the source words with the matching variant of the
// target words throughout the text.
function replaceAllCases(
  text: string,
  source: string[],
  target: string[]
): string {
  let out = text;
  for (const style of ALL_STYLES) {
    const from = renderCase(source, style);
    if (from.length > 0) {
      out = out.split(from).join(renderCase(target, style));
    }
  }
  return out;
}

export async function useAsTemplate(store: PinStore, pin: Pin): Promise<void> {
  if (pinKind(pin) !== "file") {
    vscode.window.showWarningMessage(l10n("template.notFile"));
    return;
  }
  const uri = store.resolveUri(pin);
  if (!uri) {
    vscode.window.showWarningMessage(l10n("pin.missingFile", { path: pin.path }));
    return;
  }
  const ext = path.extname(uri.fsPath);
  const sourceBase = path.basename(uri.fsPath, ext);
  const sourceWords = splitWords(sourceBase);

  const input = await vscode.window.showInputBox({
    prompt: l10n("template.prompt", { source: sourceBase }),
    placeHolder: l10n("template.placeholder"),
    validateInput: (v) =>
      v.trim().length === 0 ? l10n("template.empty") : undefined,
  });
  if (input === undefined) {
    return;
  }
  const targetWords = splitWords(input);
  if (targetWords.length === 0) {
    return;
  }

  const newBase = renderCase(targetWords, detectFileNameStyle(sourceBase));
  const newName = newBase + ext;
  const dir = vscode.Uri.joinPath(uri, "..");
  const targetUri = vscode.Uri.joinPath(dir, newName);

  // Never overwrite: a clobbered file is unrecoverable from here. Stat-then-abort.
  try {
    await vscode.workspace.fs.stat(targetUri);
    vscode.window.showWarningMessage(l10n("template.exists", { name: newName }));
    return;
  } catch {
    // Does not exist — the expected path for a fresh copy.
  }

  // Read as UTF-8 text and rewrite identifiers. A template is by definition a source
  // file; a binary would not carry meaningful identifiers to rename.
  const bytes = await vscode.workspace.fs.readFile(uri);
  const transformed = replaceAllCases(
    Buffer.from(bytes).toString("utf8"),
    sourceWords,
    targetWords
  );
  await vscode.workspace.fs.writeFile(
    targetUri,
    Buffer.from(transformed, "utf8")
  );
  await vscode.window.showTextDocument(targetUri, { preview: false });
  vscode.window.showInformationMessage(
    l10n("template.created", { name: newName, source: sourceBase + ext })
  );
}
