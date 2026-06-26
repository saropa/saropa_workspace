import * as vscode from "vscode";
import { Shortcut, ShortcutScope } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { SharedShortcut, toSharedShortcut } from "../import/shareLink";
import { l10n } from "../i18n/l10n";

// Export / import a shortcut SET to a shareable file (roadmap 2.1). The
// single-shortcut "Copy as Saropa Link" (shareLink.ts) carries one shortcut
// through a URL; this carries a whole scope's shortcuts AND their groups through a
// file, for converging a team on a common set of build/lint/run shortcuts without
// copy-pasting JSON.
//
// The file is versioned and self-describing. Import is idempotent (a shortcut
// already present in the target scope, by resolved path for a file shortcut or by
// label+action for an action shortcut, is skipped, not duplicated) and never
// silently overwrites: a shared set only ADDS, the conflicting entries are
// reported as skipped. Importing never runs a shortcut — a shared shell command
// stays a visible, deliberate choice.

// File markers. `format` guards against importing an unrelated JSON file; `version`
// lets a future incompatible shape be rejected rather than mis-parsed.
const FORMAT = "saropa-workspace-pins";
const VERSION = 1;

// A group carried in the export. `key` is the source groupId, used only as a join
// key between a shortcut and its group WITHIN this file (a fresh id is assigned on
// import). label/order/icon/color reproduce the group on the other side.
interface ExportedGroup {
  key: string;
  label: string;
  order: number;
  icon?: string;
  color?: string;
}

// A shortcut carried in the export: the same portable subset a share link uses,
// plus the key of its group (absent for a top-level shortcut).
interface ExportedShortcut extends SharedShortcut {
  groupKey?: string;
}

interface ExportedScope {
  groups: ExportedGroup[];
  pins: ExportedShortcut[];
}

interface ShortcutSetFile {
  format: typeof FORMAT;
  version: number;
  project?: ExportedScope;
  global?: ExportedScope;
}

// Which scopes a user chooses to export / import.
type ScopeChoice = "all" | "project" | "global";

// Build the exported view of one scope from its live shortcuts and groups. Recipe
// and auto shortcuts are excluded: they are detected/seeded, not user data, and
// re-detect themselves on the importing machine — exporting them would create
// stale, broken duplicates.
function exportScope(store: ShortcutStore, scope: ShortcutScope): ExportedScope {
  const shortcuts = (
    scope === "project" ? store.getProjectShortcuts() : store.getGlobalShortcuts()
  ).filter((p) => !p.isRecipe && !p.isAuto);
  const groups = store.getGroups(scope).map((g) => ({
    key: g.id,
    label: g.label,
    order: g.order,
    icon: g.icon,
    color: g.color,
  }));
  const exportedShortcuts: ExportedShortcut[] = shortcuts.map((p) => ({
    ...toSharedShortcut(p),
    groupKey: p.groupId,
  }));
  return { groups, pins: exportedShortcuts };
}

// "Export Shortcuts to File": pick the scope(s), choose a destination, write the
// set.
export async function exportShortcutSet(store: ShortcutStore): Promise<void> {
  const scope = await pickScope("export");
  if (!scope) {
    return;
  }

  const file: ShortcutSetFile = { format: FORMAT, version: VERSION };
  if (scope === "all" || scope === "project") {
    file.project = exportScope(store, "project");
  }
  if (scope === "all" || scope === "global") {
    file.global = exportScope(store, "global");
  }

  const count =
    (file.project?.pins.length ?? 0) + (file.global?.pins.length ?? 0);
  if (count === 0) {
    vscode.window.showInformationMessage(l10n("export.empty"));
    return;
  }

  const target = await vscode.window.showSaveDialog({
    title: l10n("export.saveTitle"),
    saveLabel: l10n("export.saveLabel"),
    filters: { "Saropa shortcut set": ["json"] },
    defaultUri: defaultExportUri(),
  });
  if (!target) {
    return;
  }
  const json = JSON.stringify(file, null, 2) + "\n";
  await vscode.workspace.fs.writeFile(target, Buffer.from(json, "utf8"));
  vscode.window.showInformationMessage(
    l10n("export.done", { count, file: target.path.split("/").pop() ?? target.fsPath })
  );
}

// A sensible default save location/name: the first workspace folder, named after
// it, so a team file reads as "<project>-shortcuts.json" rather than "Untitled".
function defaultExportUri(): vscode.Uri | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return undefined;
  }
  const name = folder.name.replace(/[^A-Za-z0-9._-]+/g, "-");
  return vscode.Uri.joinPath(folder.uri, `${name}-shortcuts.json`);
}

// "Import Shortcuts from File": read and validate a set file, then add its
// shortcuts (and recreate their groups) into the chosen scope(s), skipping
// anything already present. Reports how many were added vs skipped.
export async function importShortcutSet(store: ShortcutStore): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    title: l10n("import.set.openTitle"),
    openLabel: l10n("import.set.openLabel"),
    filters: { "Saropa shortcut set": ["json"] },
  });
  if (!picked || picked.length === 0) {
    return;
  }

  const file = await readSetFile(picked[0]);
  if (!file) {
    vscode.window.showWarningMessage(l10n("import.set.invalid"));
    return;
  }

  const scope = await pickScope("import");
  if (!scope) {
    return;
  }

  let added = 0;
  let skipped = 0;
  if ((scope === "all" || scope === "project") && file.project) {
    const r = await importScope(store, "project", file.project);
    added += r.added;
    skipped += r.skipped;
  }
  if ((scope === "all" || scope === "global") && file.global) {
    const r = await importScope(store, "global", file.global);
    added += r.added;
    skipped += r.skipped;
  }

  if (added === 0 && skipped === 0) {
    vscode.window.showInformationMessage(l10n("import.set.nothing"));
    return;
  }
  vscode.window.showInformationMessage(
    skipped > 0
      ? l10n("import.set.doneWithSkips", { added, skipped })
      : l10n("import.set.done", { added })
  );
}

// Import one scope: recreate each group (reusing an existing same-label group so a
// re-import does not pile up duplicate folders), then add each non-duplicate
// shortcut into its mapped group. Returns the added/skipped tally.
async function importScope(
  store: ShortcutStore,
  scope: ShortcutScope,
  data: ExportedScope
): Promise<{ added: number; skipped: number }> {
  const groupIdByKey = await resolveGroups(store, scope, data.groups);
  const existing = scope === "project" ? store.getProjectShortcuts() : store.getGlobalShortcuts();

  let added = 0;
  let skipped = 0;
  for (const shortcut of data.pins) {
    if (isDuplicate(existing, shortcut)) {
      skipped++;
      continue;
    }
    const groupId = shortcut.groupKey ? groupIdByKey.get(shortcut.groupKey) : undefined;
    if (await store.importShortcut(shortcut, scope, groupId)) {
      added++;
    } else {
      // importPin only fails for a project import with no workspace folder open.
      skipped++;
    }
  }
  return { added, skipped };
}

// Map each exported group key to a real group id in the target scope, reusing an
// existing group with the same label (case-sensitive) so re-importing the same set
// does not create a second "Build" folder, and creating the group otherwise.
async function resolveGroups(
  store: ShortcutStore,
  scope: ShortcutScope,
  groups: ExportedGroup[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const existing = store.getGroups(scope);
  // Sort by the source order so created groups keep their relative arrangement.
  for (const g of [...groups].sort((a, b) => a.order - b.order)) {
    const match = existing.find((e) => e.label === g.label);
    if (match) {
      map.set(g.key, match.id);
      continue;
    }
    const newId = await store.createGroup(scope, g.label);
    if (newId) {
      map.set(g.key, newId);
    }
  }
  return map;
}

// Whether a shortcut from the file is already present in the target scope. File
// shortcuts match on path (the same resolved-path idempotency the favorites import
// uses); action shortcuts (no path) match on label + action kind, so re-importing
// a shared macro/shell set does not duplicate it. Comment / separator annotations
// are never treated as duplicates: they are positional dividers, so two identical
// separators (or repeated comment text) are intentional and must each survive the
// round-trip.
function isDuplicate(existing: Shortcut[], shortcut: ExportedShortcut): boolean {
  const kind = shortcut.action?.kind;
  if (kind === "comment" || kind === "separator") {
    return false;
  }
  if (shortcut.path) {
    return existing.some((p) => p.path === shortcut.path);
  }
  if (shortcut.action) {
    return existing.some(
      (p) => p.action?.kind === shortcut.action?.kind && (p.label ?? "") === (shortcut.label ?? "")
    );
  }
  return false;
}

// Read and validate a set file. Returns undefined for an unreadable file, invalid
// JSON, the wrong format marker, or an unsupported version — never throws.
async function readSetFile(uri: vscode.Uri): Promise<ShortcutSetFile | undefined> {
  let bytes: Uint8Array;
  try {
    bytes = await vscode.workspace.fs.readFile(uri);
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }
  const file = parsed as Partial<ShortcutSetFile>;
  if (file.format !== FORMAT || file.version !== VERSION) {
    return undefined;
  }
  // Defensive: coerce missing scopes to absent, and missing arrays to empty, so a
  // hand-edited file with one scope still imports.
  return {
    format: FORMAT,
    version: VERSION,
    project: normalizeScope(file.project),
    global: normalizeScope(file.global),
  };
}

function normalizeScope(scope: unknown): ExportedScope | undefined {
  if (!scope || typeof scope !== "object") {
    return undefined;
  }
  const s = scope as Partial<ExportedScope>;
  return {
    groups: Array.isArray(s.groups) ? s.groups : [],
    pins: Array.isArray(s.pins) ? s.pins : [],
  };
}

// Prompt for which scope(s) to export or import. The wording differs per action so
// the picker reads naturally in both flows.
async function pickScope(action: "export" | "import"): Promise<ScopeChoice | undefined> {
  interface ScopeItem extends vscode.QuickPickItem {
    value: ScopeChoice;
  }
  const items: ScopeItem[] = [
    { value: "all", label: l10n("pinSet.scope.all") },
    { value: "project", label: l10n("pinSet.scope.project") },
    { value: "global", label: l10n("pinSet.scope.global") },
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title: action === "export" ? l10n("export.saveTitle") : l10n("import.set.openTitle"),
    placeHolder: l10n("pinSet.scope.placeholder"),
    ignoreFocusOut: true,
  });
  return pick?.value;
}
