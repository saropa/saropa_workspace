import { manualGroupOf, tidyGroupName } from "./groups";
import { SeverityResult, docGlob, isObject, parseForEdit, serialize } from "./ruleAssign";

// Moving one document into a group, or out of every group, in the text of the user's rules file.
// A group is an entry of "groups" with globs of "project/path" (read first by groups.ts); taking a
// document out of a group the board found itself is an entry of "ungrouped". Pure: the host reads
// and writes the file.

// The longest group name the board accepts.
export const MAX_GROUP_NAME = 60;

// A group name as typed, tidied: spaces trimmed and collapsed. Undefined when empty, too long or
// holding a control character.
export function cleanGroupName(raw: string): string | undefined {
  const name = tidyGroupName(raw);
  return name === "" || name.length > MAX_GROUP_NAME || /[\u0000-\u001f\u007f]/.test(name) ? undefined : name;
}

// The groups listed by hand in a rules file's parsed content, by name.
export function manualGroupNames(cfg: { groups?: unknown }): string[] {
  const names = (Array.isArray(cfg.groups) ? cfg.groups : []).map((g) => (isObject(g) && typeof g.name === "string" ? cleanGroupName(g.name) : undefined)).filter((n): n is string => n !== undefined);
  return [...new Set(names)];
}

// Puts one document into the group `group` (made when the file has none of that name), or, with
// `group` undefined, takes it out of every group it was listed in and keeps it out of the groups
// the board finds. The glob is the exact "project/path", never a wildcard. Same refusals as a
// rule; taking out what is already out is refused as "none" and nothing is written.
export function setDocGroup(text: string | undefined, a: { project: string; path: string; group: string | undefined }): SeverityResult {
  const glob = docGlob(a.project + "/" + a.path);
  if (glob === undefined) {
    return { ok: false, reason: "glob" };
  }
  const name = a.group === undefined ? undefined : cleanGroupName(a.group);
  if (a.group !== undefined && name === undefined) {
    return { ok: false, reason: "name" };
  }
  const parsed = parseForEdit(text);
  if (!parsed.ok) {
    return parsed;
  }
  const doc = parsed.doc;
  if ((doc.groups !== undefined && !Array.isArray(doc.groups)) || (doc.ungrouped !== undefined && !Array.isArray(doc.ungrouped))) {
    return { ok: false, reason: "shape" };
  }
  type Entry = { name?: unknown; match?: unknown[] };
  const groups = (Array.isArray(doc.groups) ? doc.groups : []) as Entry[];
  let out = (Array.isArray(doc.ungrouped) ? doc.ungrouped : []) as unknown[];
  if (groups.some((g) => !isObject(g) || (g.match !== undefined && !Array.isArray(g.match)))) {
    return { ok: false, reason: "shape" };
  }
  let changed = false;
  const nameOf = (g: Entry): string => (typeof g.name === "string" ? tidyGroupName(g.name) : "");
  // The first group of the chosen name takes the document; a duplicate of the name is left alone.
  const target = name === undefined ? undefined : groups.find((g) => nameOf(g) === name);
  // Out of every other group that lists the document by its exact glob.
  for (const g of groups) {
    const kept = (g.match ?? []).filter((m) => m !== glob);
    if (g !== target && kept.length !== (g.match ?? []).length) {
      g.match = kept;
      changed = true;
    }
  }
  const resolves = (): string | undefined =>
    manualGroupOf(
      groups.filter((g) => typeof g.name === "string").map((g) => ({ name: g.name as string, match: (g.match ?? []).filter((m): m is string => typeof m === "string") })),
      out.filter((m): m is string => typeof m === "string"),
      a.project,
      a.path
    );
  if (name === undefined) {
    if (!out.includes(glob)) {
      out = [...out, glob];
      changed = true;
    }
  } else {
    if (out.includes(glob)) {
      out = out.filter((m) => m !== glob);
      changed = true;
    }
    // Already in the group (listed, or claimed by one of its patterns): nothing to add.
    if (resolves() !== name) {
      if (target) {
        target.match = [...(target.match ?? []), glob];
      } else {
        groups.push({ name, match: [glob] });
      }
      changed = true;
      // A pattern of an earlier group, or of "ungrouped", still wins: refuse, never claim a move that did nothing.
      if (resolves() !== name) {
        return { ok: false, reason: "claimed" };
      }
    }
  }
  if (!changed) {
    return { ok: false, reason: name === undefined ? "none" : "same" };
  }
  // A group left with no document stays: the user named it.
  for (const [key, list] of [["groups", groups], ["ungrouped", out]] as const) {
    if (list.length > 0) {
      doc[key] = list;
    } else {
      delete doc[key];
    }
  }
  return { ok: true, text: serialize(parsed) };
}
