// Shared shapes of the auto-organization engine. Pure data: no vscode, no clock, no randomness.

import type { GroupInput } from "../groups";

export type OrgColour = "teal" | "sky" | "indigo" | "orchid" | "olive" | "ochre" | "slate" | "pine";

// Where a decision came from, strongest first (see overrides.ts).
export type OrgSource = "override" | "rules" | "frontMatter" | "inference";

// Why the engine did something. The text lives in en.json under `key`; the engine never builds sentences.
export interface Why {
  key: string;
  params: Record<string, string | number>;
  source: OrgSource;
  confidence: "high" | "medium" | "low";
}

// A document as the engine sees it: the grouping input plus what the scan read from the file.
export interface OrgDoc extends GroupInput {
  // First heading.
  title?: string;
  // Keys of the open documents this one waits on (resolved `Needs:` links).
  needs?: string[];
  // Read from the top of the file (frontMatter.ts).
  tags?: string[];
  group?: string;
}

export type GroupKind = "folder" | "seq" | "stem" | "tag" | "files" | "manual" | "other";

export interface SeqRange {
  // phase, part, step, stage, version, milestone or order.
  label: string;
  from: number;
  to: number;
}

export interface OrgGroup {
  // project:kind:key, derived from the group's own key, never from a member.
  id: string;
  kind: GroupKind;
  project: string;
  // Cleaned name before the range is added; the display name comes from displayName().
  name: string;
  // A group listed by hand: the name as the rules file holds it (tidied), never clipped or made unique. Writes use this.
  stored?: string;
  range?: SeqRange;
  // Logical folder (status and date segments removed), "" for the project root.
  folder: string;
  parent?: string;
  // Direct members, sorted. Sub-groups hold their own.
  members: string[];
  // Documents in this group and below.
  total: number;
  emoji: string;
  colour: OrgColour | string;
  tag?: string;
  // True when the user set the name, emoji or colour (shown as "set by you").
  edited: boolean;
  oversize: boolean;
  why: Why;
  nameWhy: Why;
  emojiWhy: Why;
  colourWhy: Why;
}

export interface TagHit {
  where: "folder" | "file" | "title";
  word: string;
}

export interface TagMatch {
  tagId: string;
  score: number;
  hits: TagHit[];
  why: Why;
}

export interface OrgResult {
  groups: OrgGroup[];
  // Document key to its innermost group.
  groupOf: Map<string, string>;
  // Document key to the tags that apply to it, best first.
  tagsOf: Map<string, TagMatch[]>;
  // Why a document is where it is, when that is not simply its group's reason.
  docWhy: Map<string, Why>;
  hubs: Set<string>;
  // Band, MIN and MAX used for each project; pass back as OrgOptions.previous on the next run.
  layouts: Record<string, { band: number; min: number; max: number }>;
  // Front matter tags that name no tag in the dictionary.
  unknownTags: Array<{ key: string; tag: string }>;
  // Overrides that point at nothing.
  stale: Array<{ kind: "assign" | "untag" | "group"; ref: string }>;
}

export interface OrgOptions {
  // Groups from the rules file (globs of "project/path").
  manual?: Array<{ name: string; match: string[] }>;
  ungrouped?: string[];
  hubWords?: number;
  hubDocRefs?: number;
  // Band and MAX of each project from the previous run (OrgResult.layouts), for the 10 percent hysteresis (layout.ts).
  previous?: Record<string, { band: number; max: number }>;
}
