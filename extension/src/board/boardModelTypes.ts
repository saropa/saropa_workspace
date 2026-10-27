import { OutsideGroup } from "./outside";
import { ProjectHealth } from "./health";
import { Audience, Profile, Severity } from "./severity";
import { LiveMark, LiveSignals, LiveUnnamed } from "./liveEvidence";
import { SittingLine, SittingSelection } from "./sittings";
import { TidyOptions, TidyView } from "./tidy";
import { Outside } from "./outside";
import { StatusCounts } from "./types";

// The shapes of the board's view model: what the first screen shows. Kept apart from the
// code that builds them so the page renderer can import the shapes alone.

export type Light = "no-go" | "unverified" | "go";

// Why a project reads UNVERIFIED instead of GO.
export type UnverifiedReason =
  // The scan has not been accepted as the baseline (first scan, or held by the safety check).
  | "baseline"
  // Documents that no rule placed.
  | "grey"
  // No fresh, clean lint and test result exists for the project.
  | "health"
  // Open documents whose text was not read, so their severity is unknown.
  | "unread";

// One open document on the board, with the marks and links the page draws on its row.
export interface BoardItem {
  id: number;
  project: string;
  path: string;
  title: string;
  status: "red" | "amber" | "purple";
  kind: string;
  // Marks, rolled up from the document's facts (absent when its text was not read).
  marks?: ItemMarks;
  // Group heading this item sits under (two or more related documents), if any.
  group?: { id: string; name: string };
  // A very large or heavily cross-referencing document: it links to groups, never merges them.
  hub: boolean;
  // Needs lines: what this item waits on. "open" waits, "done" is satisfied, "flag" needs a look.
  link?: { state: "open" | "done" | "flag"; detail: string };
  // How many open items wait on this one.
  blocksCount: number;
  // Ids of the open, listed items this one waits on (its own prerequisites).
  waitsOn: number[];
  // Claude sessions that read or edited this document (absent when none, or Chat Explorer is not installed).
  chats?: number;
  // Errors and warnings in the source files this document names (absent when quiet or unknown).
  // Information only: it never reaches the light.
  live?: LiveMark;
  // From the phrase dictionary (absent when the text was not read) and the pin list.
  severity?: Severity;
  audience?: Audience;
  pinned: boolean;
  // The item stops a release under the chosen profile.
  stopping: boolean;
}

// The small marks on a row, rolled up from a document's text.
export interface ItemMarks {
  // Steps done and total; total 0 means no checklist.
  done: number;
  total: number;
  // 1 small to 4 very large.
  size: 1 | 2 | 3 | 4;
  // First code language tag, or "" for code with no tag, or undefined for no code.
  code?: string;
  // Names of other projects the document mentions.
  mentions: string[];
  // The exact figures, for the tooltip.
  detail: string;
}

// One project's row: its light, why it reads that way, its open items and its counts.
export interface BoardProject {
  id: string;
  name: string;
  light: Light;
  reasons: UnverifiedReason[];
  // Open items only: red, amber and purple. Blue, green and reference are never listed.
  items: BoardItem[];
  // Amber documents in a "blocked" folder, shown as one line, not one row each.
  blocked: number;
  // How many of those collapsed documents would stop a release under the profile.
  blockedStopping: number;
  counts: StatusCounts;
  dependsOn: string[];
  health?: ProjectHealth;
}

// One step of a chain, in the order things must be finished.
export interface ChainStep {
  project: string;
  title: string;
  path: string;
  // Open items can be clicked; a finished or non-listed target cannot.
  id?: number;
  done: boolean;
}

// The Sittings panel: what can be toggled, what is chosen, and the answer.
export interface SittingsView {
  contexts: Array<{ id: string; label: string }>;
  have: string[];
  timeBox: string;
  // Steps that can be done now, then the untagged steps, in one list: the page opens a
  // line by its index here and never names a path.
  lines: SittingLine[];
  doable: number;
  more: number;
  tooLong: number;
  needOther: number;
  untagged: number;
  untaggedMore: number;
}

// Everything the first screen shows, built by buildBoard.
export interface BoardModel {
  projects: BoardProject[];
  chains: ChainStep[][];
  // Needs lines that point nowhere, at several documents, or at finished work.
  flags: string[];
  // Every item, flat, with its id: the host resolves a click by id and never trusts a path
  // sent by the page.
  items: BoardItem[];
  safetyHold: boolean;
  baseline: boolean;
  profile: Profile;
  // Links the board guesses from documents naming each other; the user accepts or rejects.
  suggestions: Array<{ key: string; fromKey: string; toProject: string; toPath: string; from: { project: string; title: string; id: number }; to: { project: string; title: string; id: number } }>;
  // Folders where documents no rule placed sit, for the "needs a rule" list.
  needsRule: Array<{ project: string; folder: string; count: number }>;
  // Review requests and groups from other extensions. They never change a light.
  outside: OutsideGroup[];
  // Absent when Sittings is switched off.
  sittings?: SittingsView;
  // Absent when the Tidy sweep is switched off.
  tidy?: TidyView;
  // Crash signals in files no open document names. Empty when there are none.
  liveUnnamed?: LiveUnnamed[];
}

// Optional inputs to buildBoard. Each is absent when its feature is off or has nothing to add.
export interface BoardExtra {
  // Links the user accepted: waiting document "project/path" -> targets.
  needs?: Record<string, string[]>;
  // Suggested links the user turned down.
  rejected?: string[];
  // Documents pinned by hand, as "project/path".
  pins?: string[];
  // Review requests, groups and session counts from other extensions.
  outside?: Outside;
  sittings?: { selection: SittingSelection; onlyOwner: boolean };
  tidy?: TidyOptions;
  live?: { signals: LiveSignals; includeWarnings: boolean; fold: boolean; unnamedBox: boolean };
}
