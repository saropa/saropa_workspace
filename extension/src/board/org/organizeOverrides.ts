// The Tags editor, overrides: typed access to the per-group and per-document entries of the rules file (a group's
// name, emoji and colour, a document placed in a group by hand, a tag removed from one document).

import { isObject, parseForEdit } from "../ruleAssign";
import { isAllowedColour } from "./appearance";
import { EditOutcome, ID, LIMITS, editOrganize, isStr } from "./organizeEditCore";
import type { GroupOverride, OrganizeConfig } from "./overrides";

const GROUP_ID = /^[^\s:]{1,100}:[a-z]+:\S{0,190}$/;
const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

export function groupIdOk(id: unknown): id is string {
  return isStr(id, LIMITS.groupId) && GROUP_ID.test(id) && id !== "__proto__";
}

// A name, emoji or colour a person set on a group. Undefined when a value is unusable.
export function cleanGroupOverride(o: unknown): GroupOverride | undefined {
  if (!isObject(o)) {
    return undefined;
  }
  const out: GroupOverride = {};
  if (o.name !== undefined) {
    if (!isStr(o.name, LIMITS.groupName) || o.name.trim() === "") {
      return undefined;
    }
    out.name = o.name.trim();
  }
  if (o.emoji !== undefined) {
    if (!isStr(o.emoji, LIMITS.emoji)) {
      return undefined;
    }
    out.emoji = o.emoji;
  }
  if (o.colour !== undefined) {
    // The engine honours the eight names only (autoGroup.ts), so a hex is refused here.
    if (!isStr(o.colour, 7) || !isAllowedColour(o.colour)) {
      return undefined;
    }
    out.colour = o.colour;
  }
  return out;
}

export function groupOverrides(text: string | undefined): Record<string, GroupOverride> {
  const p = parseForEdit(text);
  const g = p.ok && isObject(p.doc.organize) && isObject(p.doc.organize.groups) ? p.doc.organize.groups : {};
  const out: Record<string, GroupOverride> = {};
  for (const id of Object.keys(g)) {
    const o = groupIdOk(id) ? cleanGroupOverride(g[id]) : undefined;
    if (o && Object.keys(o).length) {
      out[id] = o;
    }
  }
  return out;
}

// Sets the override of one group; `undefined`, or an override with no value, removes it.
export function setGroupOverride(text: string | undefined, groupId: string, override: GroupOverride | undefined): EditOutcome {
  const clean = override === undefined ? {} : cleanGroupOverride(override);
  if (!groupIdOk(groupId) || clean === undefined) {
    return { ok: false, reason: "shape" };
  }
  return editOrganize(text, (org) => {
    if (org.groups !== undefined && !isObject(org.groups)) {
      return false;
    }
    const groups: Record<string, unknown> = isObject(org.groups) ? org.groups : {};
    if (Object.keys(clean).length) {
      groups[groupId] = clean;
    } else if (hasOwn(groups, groupId)) {
      delete groups[groupId];
    }
    if (Object.keys(groups).length) {
      org.groups = groups;
    } else {
      delete org.groups;
    }
    return true;
  });
}

type Pin = { project: string; path: string };
export const pinOk = (a: Pin): boolean => isStr(a.project, 100) && a.project !== "" && isStr(a.path, 500) && a.path !== "";

// Places one document in a group by hand (`group` undefined: back to automatic). One entry per document.
export function setAssign(text: string | undefined, doc: Pin, group: string | undefined): EditOutcome {
  if (!pinOk(doc) || (group !== undefined && !groupIdOk(group))) {
    return { ok: false, reason: "shape" };
  }
  return editOrganize(text, (org) => {
    if (org.assign !== undefined && !Array.isArray(org.assign)) {
      return false;
    }
    const list = ((org.assign as OrganizeConfig["assign"]) ?? []).filter((a) => isObject(a) && !(a.project === doc.project && a.path === doc.path));
    if (group !== undefined) {
      list.push({ project: doc.project, path: doc.path, group });
    }
    if (list.length > LIMITS.assigns) {
      return false;
    }
    if (list.length) {
      org.assign = list;
    } else {
      delete org.assign;
    }
    return true;
  });
}

// Removes (or restores) one tag on one document.
export function setUntag(text: string | undefined, doc: Pin, tag: string, removed: boolean): EditOutcome {
  if (!pinOk(doc) || !isStr(tag, LIMITS.id) || !ID.test(tag)) {
    return { ok: false, reason: "shape" };
  }
  return editOrganize(text, (org) => {
    if (org.untag !== undefined && !Array.isArray(org.untag)) {
      return false;
    }
    const list = ((org.untag as OrganizeConfig["untag"]) ?? []).filter((a) => isObject(a) && !(a.project === doc.project && a.path === doc.path && a.tag === tag));
    if (removed) {
      list.push({ project: doc.project, path: doc.path, tag });
    }
    if (list.length > LIMITS.assigns) {
      return false;
    }
    if (list.length) {
      org.untag = list;
    } else {
      delete org.untag;
    }
    return true;
  });
}
