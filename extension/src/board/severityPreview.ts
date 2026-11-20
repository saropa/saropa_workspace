import { Profile, Severity, SeverityDict, scoreDocument, stops } from "./severity";

// The keyword editor of the board, preview part: which open documents would change level under a
// dictionary. severityEdit re-exports everything here.

// One open document as the preview reads it: its text, and its level under the saved dictionary.
export interface PreviewDoc {
  title: string;
  project: string;
  path: string;
  text: string;
  before: Severity;
}

export interface PreviewExample {
  title: string;
  project: string;
  from: Severity;
  to: Severity;
  // The document stops the release before / after, under the chosen profile.
  stopsFrom: boolean;
  stopsTo: boolean;
}

export interface PreviewResult {
  checked: number;
  changed: number;
  lowered: number;
  raised: number;
  // Documents that stop the release now and would not after the edit: the light could turn greener.
  eased: number;
  // Documents that would start stopping the release.
  tightened: number;
  examples: PreviewExample[];
}

const RANK: Record<Severity, number> = { extreme: 0, critical: 1, high: 2, medium: 3, low: 4 };

// A preview being added to: the result so far and every changed document.
export interface PreviewAcc extends PreviewResult {
  all: PreviewExample[];
}

export function emptyPreview(): PreviewAcc {
  return { checked: 0, changed: 0, lowered: 0, raised: 0, eased: 0, tightened: 0, examples: [], all: [] };
}

// Scores a batch of documents under the dictionary and adds the changes to `acc`. All the
// changed documents are kept; `finishPreview` picks the examples.
export function addToPreview(acc: PreviewAcc, docs: readonly PreviewDoc[], dict: SeverityDict, profile: Profile): void {
  for (const d of docs) {
    acc.checked += 1;
    const to = scoreDocument(d.text, d.path, dict).severity;
    if (to === d.before) {
      continue;
    }
    acc.changed += 1;
    const stopsFrom = stops(profile, d.before);
    const stopsTo = stops(profile, to);
    if (RANK[to] > RANK[d.before]) {
      acc.lowered += 1;
    } else {
      acc.raised += 1;
    }
    if (stopsFrom && !stopsTo) {
      acc.eased += 1;
    } else if (!stopsFrom && stopsTo) {
      acc.tightened += 1;
    }
    acc.all.push({ title: d.title, project: d.project, from: d.before, to, stopsFrom, stopsTo });
  }
}

// The result with its examples: documents that would stop the release no longer first, then
// the biggest jumps in level.
export function finishPreview(acc: PreviewAcc, max = 8): PreviewResult {
  const jump = (e: PreviewExample): number => Math.abs(RANK[e.to] - RANK[e.from]);
  const examples = [...acc.all]
    .sort((a, b) => Number(b.stopsFrom && !b.stopsTo) - Number(a.stopsFrom && !a.stopsTo) || jump(b) - jump(a) || a.title.localeCompare(b.title))
    .slice(0, max);
  const { all: _all, ...rest } = acc;
  return { ...rest, examples };
}

// One call for a whole list: the documents whose level changes under the dictionary.
export function previewChanges(docs: readonly PreviewDoc[], dict: SeverityDict, profile: Profile, max = 8): PreviewResult {
  const acc = emptyPreview();
  addToPreview(acc, docs, dict, profile);
  return finishPreview(acc, max);
}
