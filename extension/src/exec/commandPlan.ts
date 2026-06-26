// Pure command-assembly core for runner.ts. No VS Code, no filesystem: the IO
// (reading the interpreter-defaults setting, reading a script's shebang, resolving
// the workspace folder) stays in runner.ts, which feeds the resolved values in
// here. Keeping the decision logic pure makes the interpreter fallback and the
// shell assembly unit-testable without the extension host (roadmap 4.1).

// The interpreter prefix for a file: an explicit per-shortcut command wins (including
// an explicit empty string, which means "run the file directly" — e.g. a shebang
// script); else the configured default for the file extension; else the file's
// own `#!` interpreter; else "" (run directly). A single ordered fallback so the
// precedence lives in one place.
export function resolveInterpreter(opts: {
  // shortcut.exec?.command — undefined means the user set no explicit prefix.
  explicitCommand: string | undefined;
  // Lowercased file extension including the dot, e.g. ".py".
  ext: string;
  // The saropaWorkspace.interpreterDefaults map (extension -> prefix).
  defaults: Record<string, string>;
  // Interpreter parsed from the file's `#!` line, or undefined when it has none.
  shebang: string | undefined;
}): string {
  if (opts.explicitCommand !== undefined) {
    return opts.explicitCommand;
  }
  const byExtension = opts.defaults[opts.ext];
  if (byExtension !== undefined) {
    return byExtension;
  }
  return opts.shebang ?? "";
}

// Whether a shortcut can be executed at all (there is some interpreter path). True for
// an explicit command, an extension with a configured default, or a file carrying
// a shebang. False for an ordinary document (.txt, .md, image) with no
// interpreter, where "run" has no meaning and the caller should open it instead.
export function isRunnablePlan(opts: {
  explicitCommand: string | undefined;
  ext: string;
  defaults: Record<string, string>;
  hasShebang: boolean;
}): boolean {
  if (opts.explicitCommand !== undefined) {
    return true;
  }
  if (opts.defaults[opts.ext] !== undefined) {
    return true;
  }
  return opts.hasShebang;
}

// Quote a path/arg for the shell. Simple double-quote wrapping covers the common
// case (paths with spaces) without a full shell-escaping dependency; an embedded
// double quote is backslash-escaped so the wrapping is not broken.
export function quoteArg(value: string): string {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

// Assemble `<prefix> "<file>" <args...>`. A blank prefix runs the file directly;
// includeFile === false omits the file entirely (an npm-script / Make-target run
// config names its work in args and runs against cwd, not a file path). Empty
// parts are dropped so a blank prefix or no-file run never leaves a stray space.
export function assembleCommandLine(opts: {
  prefix: string;
  fsPath: string;
  args: string[];
  includeFile: boolean;
}): string {
  return [
    opts.prefix,
    ...(opts.includeFile ? [quoteArg(opts.fsPath)] : []),
    ...opts.args.map(quoteArg),
  ]
    .filter((part) => part.length > 0)
    .join(" ");
}
