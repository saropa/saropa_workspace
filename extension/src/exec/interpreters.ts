// Pure catalog of interpreter CANDIDATES to probe for a file type. No IO and no host
// API: this names what COULD run a given extension (the display label, the prefix to
// store, and the bare binary to look for on PATH). The detection layer
// (interpreterDetect.ts) decides which candidates actually exist on this machine, and
// the UI adds the always-available pseudo-choices (the configured default, "Run
// directly", "Browse…"). Kept pure so the per-extension catalog and its ordering are
// unit-testable without touching the filesystem.

export interface InterpreterCandidate {
  // Display name for the chip / QuickPick row, e.g. "python", "py launcher".
  readonly label: string;
  // The value stored as ShortcutExecConfig.command when chosen, e.g. "python",
  // "py -3", "pwsh -File". May carry fixed args; the run assembly leaves the prefix
  // verbatim, so a multi-token prefix runs as written.
  readonly command: string;
  // The bare executable to locate on PATH (honoring PATHEXT on Windows). Carried
  // separately from `command` so a prefix with args ("py -3") still probes the right
  // binary ("py"). Defaults to the command's first whitespace token.
  readonly probeBinary?: string;
}

// One candidate, with the probe binary defaulted from the command's first token.
function candidate(label: string, command: string, probeBinary?: string): InterpreterCandidate {
  return { label, command, probeBinary: probeBinary ?? commandBinary(command) };
}

// The first whitespace-delimited token of a command prefix — the binary a PATH lookup
// should resolve. "pwsh -File" -> "pwsh"; "py -3" -> "py"; "python" -> "python".
export function commandBinary(command: string): string {
  return command.trim().split(/\s+/, 1)[0] ?? "";
}

// Reused candidates so a runtime shared across extensions (node for .js/.mjs/.cjs) is
// defined once.
const NODE = candidate("node", "node");
const BASH = candidate("bash", "bash");

// Ordered interpreter catalog, keyed by lowercase extension (including the dot). Order
// is the display order; the most conventional choice for the platform-neutral case
// leads. Windows-specific resolution (the `py` launcher, versioned installs found off
// PATH) is layered on by the detection module — this catalog stays platform-neutral.
const CATALOG: Readonly<Record<string, readonly InterpreterCandidate[]>> = {
  ".py": [
    // `py` (the Windows Python launcher) leads on the catalog because it picks the
    // right installed Python without a hardcoded version; `python` / `python3` cover
    // PATH installs and every Unix host.
    candidate("py launcher", "py"),
    candidate("python", "python"),
    candidate("python3", "python3"),
  ],
  ".pyw": [candidate("pythonw", "pythonw"), candidate("py launcher", "py")],
  ".js": [NODE],
  ".mjs": [NODE],
  ".cjs": [NODE],
  ".ts": [candidate("tsx", "tsx"), candidate("ts-node", "ts-node"), candidate("deno run", "deno run", "deno")],
  ".ps1": [candidate("pwsh", "pwsh -File", "pwsh"), candidate("Windows PowerShell", "powershell -File", "powershell")],
  ".sh": [BASH, candidate("sh", "sh")],
  ".bash": [BASH],
  ".rb": [candidate("ruby", "ruby")],
  ".pl": [candidate("perl", "perl")],
  ".php": [candidate("php", "php")],
  ".lua": [candidate("lua", "lua")],
  ".r": [candidate("Rscript", "Rscript")],
};

// The interpreter candidates for a file extension, in display order, or an empty list
// for a type with no known interpreter (a plain document). The caller lowercases the
// extension; an unknown extension yields [] so the UI falls back to its pseudo-choices.
export function candidatesForExt(ext: string): readonly InterpreterCandidate[] {
  return CATALOG[ext] ?? [];
}
