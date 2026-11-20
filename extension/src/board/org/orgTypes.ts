// Shared shapes of the auto-organization engine. Pure data: no vscode, no clock, no randomness.

import type { GroupInput } from "../groups";

// A closed set of names, not hex, so every color stays within the contrast-checked palette in appearance.ts.
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

// How a group was formed; part of the group id, so renaming a kind would orphan stored overrides.
export type GroupKind = "folder" | "seq" | "stem" | "tag" | "files" | "manual" | "other";

// The span of a numbered series, kept apart from the name so the display name can add it and dedup can tell series apart.
export interface SeqRange {
  // phase, part, step, stage, version, milestone or order.
  label: string;
  from: number;
  to: number;
}

// One group on the board, with a separate "why" for each automatic choice so every one can be explained and overridden.
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
  // True when the user set the name, emoji or color (shown as "set by you").
  edited: boolean;
  oversize: boolean;
  why: Why;
  nameWhy: Why;
  emojiWhy: Why;
  colourWhy: Why;
}

// The matched word and where it was found, so the page can highlight it in the folder, file name or title.
export interface TagHit {
  where: "folder" | "file" | "title";
  word: string;
}

// A tag that applies to a document; the score orders competing tags and the hits explain the match.
export interface TagMatch {
  tagId: string;
  score: number;
  hits: TagHit[];
  why: Why;
}

// Everything one run decided, plus the leftovers (unknown tags, stale overrides) the board surfaces for cleanup.
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

// Every field is optional so a bare run works; `previous` carries the last run's layout to stop groups jumping on small changes.
export interface OrgOptions {
  // Groups from the rules file (globs of "project/path").
  manual?: Array<{ name: string; match: string[] }>;
  ungrouped?: string[];
  hubWords?: number;
  hubDocRefs?: number;
  // Band and MAX of each project from the previous run (OrgResult.layouts), for the 10 percent hysteresis (layout.ts).
  previous?: Record<string, { band: number; max: number }>;
  // The naming settings (settingsOf(...).naming).
  naming?: { acronyms?: readonly string[]; dates?: boolean; prefixes?: ReadonlySet<string> };
  // Custom kind words for fileTokens (settingsOf(...).kinds); default: the shipped KIND set.
  kinds?: ReadonlySet<string>;
  // Custom sequence words for fileTokens (settingsOf(...).seqWords); default: the shipped list.
  seqWords?: readonly string[];
  // Custom status-folder words for logicalFolders (settingsOf(...).statusWords); default: the shipped STATUS set.
  statusWords?: ReadonlySet<string>;
  // Custom container-folder words for folderLabel (settingsOf(...).containerWords); default: the shipped CONTAINER set.
  containerWords?: ReadonlySet<string>;
}
