import { HealthConfig } from "./health";
import { Profile, SeverityDict } from "./severity";
import { NeedsDict } from "./needs";
// Release Board: shared types. The board core (this folder) never imports "vscode"
// (a unit test enforces it) so it runs under the plain node test runner and works the
// same for local, remote and test file sources.

// The six states a document can be in, plus "reference" (read, never counted).
export type BoardStatus =
  | "red"
  | "amber"
  | "purple"
  | "blue"
  | "green"
  | "reference"
  | "grey";

// Every state, in the order they are counted.
export const ALL_STATUSES: readonly BoardStatus[] = [
  "red",
  "amber",
  "purple",
  "blue",
  "green",
  "reference",
  "grey",
];

// What a rule sets on a match.
export interface RuleSet_Set {
  status: BoardStatus;
  kind?: string;
  note?: string;
}

// A rule matches on the project-relative path, the file name, or both. Globs support
// "**" (any depth), "*" (one segment), "?" and "{a,b}" alternation; "$name" is
// replaced by the rule set's parameter of that name (a list becomes "a,b").
export interface RuleWhen {
  path?: string;
  name?: string;
}

// One rule: when it matches a file, what state it sets.
export interface Rule {
  id: string;
  when: RuleWhen;
  set: RuleSet_Set;
}

// A Status line in the first 20 lines can move a live item to another state.
export interface StatusLineConfig {
  appliesTo: BoardStatus[];
  words: Record<string, BoardStatus>;
}

// A rule parameter: one text, or a list of texts.
export type ParamValue = string | string[];

// A named set of rules with parameters, shared by projects.
export interface RuleSetDef {
  description?: string;
  params?: Record<string, ParamValue>;
  rules?: Rule[];
  statusLine?: StatusLineConfig;
}

// One project: where its documents are and which rules apply.
export interface ProjectDef {
  id: string;
  name?: string;
  // Directory of the project on disk (absolute, or relative to the scan base).
  path: string;
  // Folders under `path` that hold the documents.
  roots: string[];
  importance?: "high" | "normal" | "low";
  dependsOn?: string[];
  ruleSets: string[];
  // Regex sources (case-insensitive) that say a document mentions this project, e.g.
  // "supabase". Used for the "also mentions" mark on documents of other projects.
  mentions?: string[];
  params?: Record<string, ParamValue>;
  rules?: Rule[];
  // Where lint and test evidence comes from (see health.ts).
  health?: HealthConfig;
  // The project comes from the user's list of extra projects, not from an open workspace folder.
  extra?: boolean;
}

// Why a chosen folder is not on the board: it is not there, it is not a folder, it could
// not be read in time, or the list is longer than the board takes.
export type SkipReason = "missing" | "notFolder" | "unreadable" | "overLimit" | "timedOut";

// A chosen folder shown as a grey row: its name and why it was not read. Never its path.
export interface SkippedProject {
  name: string;
  reason: SkipReason;
}

// The rules file: rule sets, projects and the optional settings of the board.
export interface BoardConfig {
  version: number;
  ignore: string[];
  ruleSets: Record<string, RuleSetDef>;
  projects: ProjectDef[];
  // File extensions that are scanned (lower-case, with the dot).
  extensions?: string[];
  // Folders whose files count as "source files named" in a document.
  sourceDirs?: string[];
  // Groups made by hand: documents matching any glob of "project/path" form one group.
  groups?: Array<{ name: string; match: string[] }>;
  // Globs of "project/path" that are never grouped.
  ungrouped?: string[];
  // Parts of the severity dictionary a team replaces (phrases, weights, negation ...).
  severity?: Partial<SeverityDict>;
  // Parts of the needs dictionary a team replaces (contexts and phrases; see needs-dictionary.json).
  needs?: Partial<NeedsDict>;
  // Which documents are the owner's own checks, for the Sittings list: documents whose
  // rule kind is one of these (default "owner action"), or that sit under a folder with one
  // of these names (default none; the shipped owner rule already names its folders by the
  // `ownerFolders` rule parameter).
  ownerKinds?: string[];
  ownerFolders?: string[];
  // What stops a release: rush (extreme, critical), deliberate (adds high), zero (adds medium).
  profile?: Profile;
  // Documents pinned as critical, as "project/path" globs. They stay on the first screen.
  pinned?: string[];
  // Chosen folders that could not be read; the board shows each as a grey row.
  skipped?: SkippedProject[];
  // How many chosen projects the "open project only" scope hides.
  hidden?: number;
}

// One file as seen by a scan.
export interface ScanFile {
  // Path relative to the project directory, "/" separated.
  path: string;
  size: number;
  mtimeMs: number;
}

// The result of classifying one file.
export interface Classified {
  project: string;
  path: string;
  status: BoardStatus;
  kind: string;
  note: string;
  // Id of the rule that decided the state, or undefined when no rule matched (grey).
  rule?: string;
  // Name of the rule set the rule came from ("project" for a project's own rule).
  ruleSet?: string;
  // The Status-line word that moved the state, if any.
  statusWord?: string;
}

// How many documents are in each state.
export type StatusCounts = Record<BoardStatus, number>;

// Counts with every state at zero.
export function emptyCounts(): StatusCounts {
  return {
    red: 0,
    amber: 0,
    purple: 0,
    blue: 0,
    green: 0,
    reference: 0,
    grey: 0,
  };
}
