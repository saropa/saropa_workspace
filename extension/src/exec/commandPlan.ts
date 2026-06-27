// Pure command-assembly core for runner.ts. No VS Code, no filesystem: the IO
// (reading the interpreter-defaults setting, reading a script's shebang, resolving
// the workspace folder) stays in runner.ts, which feeds the resolved values in
// here. Keeping the decision logic pure makes the interpreter fallback and the
// shell assembly unit-testable without the extension host (roadmap 4.1).

// The interpreter prefix for a file. Precedence, in one place:
//   1. A non-blank explicit per-shortcut command always wins.
//   2. A blank explicit command ("") means "run the file directly":
//        - on Unix it stays blank — the OS honors the file's `#!` shebang + exec bit;
//        - on Windows it must STILL resolve to a real interpreter (the shell has no
//          shebang honoring; a bare script path is handed to its file association and
//          opens instead of executing), so it falls through to the resolution in 3.
//   3. No explicit command -> the configured default for the extension; else the
//      file's own `#!` interpreter; else "" (run directly).
// Splitting (2) by platform is why this takes `platform`: a pinned `.py` carrying a
// blank "Run directly (shebang)" command would otherwise run as a bare path on
// Windows and never reach Python.
export function resolveInterpreter(opts: {
  // shortcut.exec?.command — undefined means the user set no explicit prefix.
  explicitCommand: string | undefined;
  // Lowercased file extension including the dot, e.g. ".py".
  ext: string;
  // The saropaWorkspace.interpreterDefaults map (extension -> prefix). Set a value
  // to an absolute interpreter path here to pin a specific runtime (e.g. ".py" ->
  // "D:/Tools/Python/Python314/python.exe").
  defaults: Record<string, string>;
  // Interpreter parsed from the file's `#!` line, or undefined when it has none.
  shebang: string | undefined;
  // Host platform (process.platform). Only win32 is special-cased; injectable so the
  // Unix vs Windows branch of the blank-command rule is testable without the host.
  platform: NodeJS.Platform;
}): string {
  const blankExplicit = opts.explicitCommand === "";

  // A non-blank explicit command always wins.
  if (opts.explicitCommand !== undefined && !blankExplicit) {
    return opts.explicitCommand;
  }

  // Unix honors a blank "run directly" via the shebang + exec bit; Windows cannot,
  // so a blank prefix there resolves like an unset command below.
  if (blankExplicit && opts.platform !== "win32") {
    return "";
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

// Parse the interpreter out of a `#!` shebang LINE (the raw first line of a file), or
// undefined when it is not a shebang / names nothing. Honors the Unix `env` convention:
// `#!/usr/bin/env python3 [args]` yields `python3 [args]` (the env wrapper is dropped,
// since the shell already resolves the binary on PATH); any other shebang yields its
// literal interpreter path + args. Pure (takes the line, reads no file) so the runner's
// shebang resolution and the run-target detector share ONE parser instead of two copies.
export function parseShebangLine(firstLine: string): string | undefined {
  if (!firstLine.startsWith("#!")) {
    return undefined;
  }
  const rest = firstLine.slice(2).trim();
  if (!rest) {
    return undefined;
  }
  const parts = rest.split(/\s+/);
  // basename so an absolute `/usr/bin/env` (or a bare `env`) is recognized either way.
  if (basename(parts[0]) === "env" && parts.length > 1) {
    return parts.slice(1).join(" ");
  }
  return rest;
}

// Minimal POSIX basename for parseShebangLine: the segment after the last '/'. A shebang
// path is always POSIX-style ('/'), so this needs no platform path module.
function basename(p: string): string {
  const slash = p.lastIndexOf("/");
  return slash === -1 ? p : p.slice(slash + 1);
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
