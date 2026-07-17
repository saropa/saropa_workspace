import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { candidatesForExt, commandBinary } from "./interpreters";

// IO layer over the pure interpreter catalog: probe the host for the interpreters that
// can actually run a given file type, so the UI offers real, installed choices instead
// of a free-text box. Two sources are merged and de-duplicated by resolved executable
// path:
//   1. catalog binaries found on PATH (honoring PATHEXT on Windows);
//   2. versioned Python installs found OFF PATH (the common Windows case where the
//      Microsoft Store / a per-user install never put python.exe on PATH) — this is the
//      reason the feature exists: a pinned `.py` should reach a real Python without the
//      user hunting down `…\PythonNNN\python.exe`.
// Results are cached per extension for the session — interpreters do not appear and
// disappear within a window, and the scan touches the filesystem, so caching keeps the
// QuickPick / the Configure Run panel instant after the first open.

export interface DetectedInterpreter {
  // Display label for the chip / QuickPick row.
  readonly label: string;
  // The value to store as ShortcutExecConfig.command (a bare name like "python", a
  // prefix like "pwsh -File", or an absolute path — quoted when it contains spaces so
  // the run assembly leaves it intact).
  readonly command: string;
  // The resolved absolute executable path, shown as the row detail and used to
  // de-duplicate two catalog names that resolve to the same binary.
  readonly path: string;
}

const cache = new Map<string, DetectedInterpreter[]>();

// The detected interpreters for a file extension, in catalog order then by install
// scan, de-duplicated by executable path. Empty for a type with no known interpreter.
export async function detectInterpreters(ext: string): Promise<DetectedInterpreter[]> {
  const key = ext.toLowerCase();
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }
  const out: DetectedInterpreter[] = [];
  const seen = new Set<string>();

  const remember = (label: string, command: string, exe: string): void => {
    const dedupeKey = exe.toLowerCase();
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    out.push({ label, command, path: exe });
  };

  // 1. Catalog binaries that resolve on PATH.
  for (const cand of candidatesForExt(key)) {
    const exe = findOnPath(commandBinary(cand.command));
    if (exe) {
      remember(cand.label, cand.command, exe);
    }
  }

  // 2. Versioned Python installs that PATH did not surface. The stored command is the
  // absolute python.exe path (quoted if it has spaces), so the pin runs that exact
  // interpreter regardless of what `python` resolves to on PATH.
  if (key === ".py" || key === ".pyw") {
    for (const exe of scanPythonInstalls()) {
      remember(pythonInstallLabel(exe), quoteIfSpaced(exe), exe);
    }
  }

  cache.set(key, out);
  return out;
}

// Drop the session cache. The interpreter set is stable within a window, so this is only
// for tests / a future explicit "rescan" command — not called on the hot path.
export function clearInterpreterCache(): void {
  cache.clear();
}

// Locate an executable on PATH the way the shell would. On Windows each PATH directory
// is tried with every PATHEXT suffix (so "py" resolves "py.exe"); elsewhere the bare
// name is tested. Returns the first hit's absolute path, or undefined when not found.
// Exported so callers outside this module (e.g. a script's `requires` pre-flight) can
// reuse the same PATH + PATHEXT resolution instead of reimplementing it.
export function findOnPath(binary: string): string | undefined {
  if (!binary) {
    return undefined;
  }
  const rawPath = process.env.PATH ?? process.env.Path ?? "";
  const dirs = rawPath.split(path.delimiter).filter((d) => d.length > 0);
  const onWindows = process.platform === "win32";
  // An empty suffix lets an already-suffixed name (or a Unix binary) match directly.
  const exts = onWindows
    ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)]
    : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = path.join(dir, binary + ext);
      if (isFile(full)) {
        return full;
      }
    }
  }
  return undefined;
}

// Windows install roots that hold versioned Python folders (e.g. "Python314"), each
// containing python.exe. These are the locations a per-user / all-users / tool-managed
// Python lands without ever being added to PATH. Only scanned on win32 — Unix Pythons
// come through PATH (step 1) and a blind directory walk elsewhere would be noise.
function pythonInstallRoots(): string[] {
  if (process.platform !== "win32") {
    return [];
  }
  const roots: string[] = [];
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    roots.push(path.join(localAppData, "Programs", "Python"));
  }
  const programFiles = process.env.ProgramFiles;
  if (programFiles) {
    roots.push(path.join(programFiles, "Python"));
  }
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  if (programFilesX86) {
    roots.push(path.join(programFilesX86, "Python"));
  }
  // pyenv-win keeps each version under versions/<x.y.z>/python.exe.
  roots.push(path.join(os.homedir(), ".pyenv", "pyenv-win", "versions"));
  // Bare-drive and common tool roots where a "PythonNNN" folder sits directly inside.
  roots.push("C:\\", "C:\\Python", "D:\\Tools\\Python", "D:\\Python");
  return roots;
}

// Find python.exe inside each install root's immediate child directories. A python.exe
// directly in the root (some all-users installs) is also taken. Each readdir is guarded
// so a missing or unreadable root is skipped silently rather than failing the scan.
function scanPythonInstalls(): string[] {
  const found: string[] = [];
  for (const root of pythonInstallRoots()) {
    const direct = path.join(root, "python.exe");
    if (isFile(direct)) {
      found.push(direct);
    }
    let children: string[];
    try {
      children = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const child of children) {
      // Only version-named folders ("Python314", "3.12.1") are interpreter homes;
      // skipping the rest keeps the scan cheap and avoids false positives.
      if (!/^(python|\d)/i.test(child)) {
        continue;
      }
      const exe = path.join(root, child, "python.exe");
      if (isFile(exe)) {
        found.push(exe);
      }
    }
  }
  return found;
}

// A readable label for a scanned Python: the version-bearing folder name, e.g.
// "D:\\Tools\\Python\\Python314\\python.exe" -> "Python (Python314)". The full path is
// carried separately as the row detail, so the label stays short.
function pythonInstallLabel(exe: string): string {
  const folder = path.basename(path.dirname(exe));
  return `Python (${folder})`;
}

// Quote an absolute interpreter path that contains spaces so it survives as a single
// prefix token in the assembled command line (the assembler leaves the prefix verbatim).
function quoteIfSpaced(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

// Whether a path exists and is a regular file. The single guarded stat both probes use.
function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
