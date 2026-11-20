import { AssignRefusal, isObject, parseForEdit, serialize } from "./ruleText";

// Hiding one document from the board: its project-relative path is added to the rules file's
// `hiddenDocs` table, keyed by project id. Pure: the host reads and writes the file; this module
// only turns text into text.

export type HideResult = { ok: true; text: string } | { ok: false; reason: AssignRefusal };

// The paths are exact, never globs: a path holding a wildcard character cannot be mistaken for a
// pattern, and the same relative path in another project stays on that project's board.
export function hideDoc(text: string | undefined, a: { project: string; path: string }): HideResult {
  const parsed = parseForEdit(text);
  if (!parsed.ok) {
    return parsed;
  }
  const doc = parsed.doc;
  if (doc.hiddenDocs === undefined) {
    doc.hiddenDocs = {};
  }
  // A `hiddenDocs` of the wrong shape is the owner's data: refuse rather than overwrite it.
  if (!isObject(doc.hiddenDocs)) {
    return { ok: false, reason: "shape" };
  }
  const list = doc.hiddenDocs[a.project] ?? [];
  if (!Array.isArray(list)) {
    return { ok: false, reason: "shape" };
  }
  // Already listed: nothing to write, so the caller never reports a hide that changed nothing.
  if (list.includes(a.path)) {
    return { ok: false, reason: "same" };
  }
  doc.hiddenDocs[a.project] = [...list, a.path];
  return { ok: true, text: serialize(parsed) };
}

// True when the document of `project` at `path` is hidden by the table read from the rules file.
// The table comes from user JSON, so anything that is not a list of strings hides nothing.
export function isHidden(table: unknown, project: string, path: string): boolean {
  if (!isObject(table)) {
    return false;
  }
  const list = table[project];
  return Array.isArray(list) && list.includes(path);
}
