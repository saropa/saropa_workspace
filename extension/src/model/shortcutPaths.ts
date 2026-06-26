import * as vscode from "vscode";

// Global-shortcut path round-trip helpers. A global shortcut stores either a plain
// absolute fsPath (the common local-file case) or, for a file on a non-local
// filesystem (Remote-SSH, WSL, dev container, or a virtual provider), the full URI
// string. Split out from the store so the file/non-file BRANCH logic is unit-testable
// against a minimal Uri stub without loading the whole store graph (roadmap 4.1).

// Resolve a global shortcut's stored target back to a URI. The two stored forms are
// told apart by a scheme separator: a real URI always carries "<scheme>://", while a
// local path never does — a Windows drive path "C:\…" has a single colon but no
// "://", so it is never mistaken for a URI. Files stored by older versions are
// always plain fsPaths (no "://"), so this stays backward compatible.
export function parseGlobalPath(stored: string): vscode.Uri {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(stored)
    ? vscode.Uri.parse(stored)
    : vscode.Uri.file(stored);
}

// The string a global shortcut should store for a given URI: a plain absolute fsPath
// for a local file (so it reads naturally and dedupes against older shortcuts), or the
// full URI string for any other scheme so the scheme survives the round-trip. The
// inverse of parseGlobalPath.
export function globalStoredPath(uri: vscode.Uri): string {
  return uri.scheme === "file" ? uri.fsPath : uri.toString();
}
