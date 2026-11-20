// Auto-grouping, shared parts: the internal group and environment types the layers pass around, and the small
// helpers that make and read groups. autoGroup.ts and autoGroupName.ts build on this module.

import { Layout } from "./layout";
import { cleanName, isContainerOnly } from "./naming";
import type { GroupKind, OrgDoc, OrgOptions, OrgSource, SeqRange, TagMatch, Why } from "./orgTypes";
import type { TagDef } from "./tags";
import { FileTokens, logicalFolders } from "./tokens";

// Internal group while the tree is built.
// A group while the tree is built; `subs` are its sub-groups and `oversize` marks one no split could cut.
export interface G {
  id: string;
  kind: GroupKind;
  name: string;
  rawName: string;
  folder: string;
  docs: OrgDoc[];
  subs: G[];
  oversize: boolean;
  why: Why;
  range?: SeqRange;
  tagId?: string;
}

// What every layer reads for one project: the layout, the file tokens, the tag matches, the hubs and the name cleaner.
export interface Env {
  project: string;
  layout: Layout;
  tok: Map<string, FileTokens>;
  matches: Map<string, TagMatch[]>;
  tagById: Map<string, TagDef>;
  hubs: Set<string>;
  // Name cleaning under the project's naming settings.
  nameOf: (raw: string) => string;
}

// A folder in the tree of one project's documents; `n` counts the documents under it.
export interface Node {
  segs: string[];
  docs: OrgDoc[];
  kids: Map<string, Node>;
  n: number;
}

// Orders documents by key so every list is the same whatever order the documents arrive in.
export const byKey = (a: OrgDoc, b: OrgDoc): number => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
// The cleaned name, or the raw text when cleaning leaves nothing (a folder named v2).
// Builds the name cleaner for the naming settings (the project's, or the shipped ones).
export const cleanerOf = (n: OrgOptions["naming"] = {}): ((raw: string) => string) => (raw) => cleanName(raw, n.acronyms, n) || raw.trim();
// The folder of a document without the folders that only hold dates or states.
export const folderOf = (d: OrgDoc): string => logicalFolders(d.path).join("/");
// A key inside a context (a folder path), so the same stem in two folders gives two ids.
export const scoped = (ctx: string, k: string): string => (ctx ? `${ctx}/${k}` : k);

// A reason shown for a group or a document: a message key under releaseBoard.org.why and its values.
export function why(key: string, params: Record<string, string | number>, confidence: Why["confidence"] = "high", source: OrgSource = "inference"): Why {
  return { key: `releaseBoard.org.why.${key}`, params, source, confidence };
}

// Adds a value to the list under a key, making the list when the key is new.
export function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  (m.get(k) ?? m.set(k, []).get(k)!).push(v);
}

// The folder's own name, or its nearest parent when it is only a container (docs, notes).
export function folderLabel(folder: string): string {
  const segs = folder.split("/").filter(Boolean);
  return [...segs].reverse().find((s) => !isContainerOnly(s)) ?? segs[segs.length - 1] ?? "";
}

// A group of the given kind with a stable id built from the key, never from a member.
export function make(kind: GroupKind, env: Env, key: string, rawName: string, name: string, folder: string, docs: OrgDoc[], w: Why): G {
  return { id: `${env.project}:${kind}:${key}`, kind, name, rawName, folder, docs: [...docs].sort(byKey), subs: [], oversize: false, why: w };
}

// The documents of a group and of every group under it.
export function subtree(g: G): OrgDoc[] {
  return [...g.docs, ...g.subs.flatMap(subtree)];
}
