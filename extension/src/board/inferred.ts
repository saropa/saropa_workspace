// Suggested links: a document that names another open document of the same project by file
// name probably waits on it, or at least belongs with it. Shown dashed; the user accepts
// (it becomes a Needs line kept in the marks) or rejects (never suggested again).

export interface InferInput {
  project: string;
  path: string;
  // File names or paths of other documents this one names.
  refs: string[];
}

// A link the board guesses between two documents of one project.
export interface Suggestion {
  fromProject: string;
  fromPath: string;
  toPath: string;
  // "from->to", the key a rejection is stored under.
  key: string;
}

const MAX = 50;

// The key a suggested link is stored under when it is rejected.
export function suggestionKey(project: string, from: string, to: string): string {
  return `${project}/${from}->${project}/${to}`;
}

// `linked` holds "project/from->project/to" for links that already exist (Needs lines),
// `rejected` the suggestions turned down.
export function inferLinks(items: InferInput[], linked: ReadonlySet<string>, rejected: ReadonlySet<string>): Suggestion[] {
  const byName = new Map<string, InferInput[]>();
  for (const i of items) {
    const name = i.path.slice(i.path.lastIndexOf("/") + 1).toLowerCase();
    (byName.get(name) ?? byName.set(name, []).get(name)!).push(i);
  }
  const out: Suggestion[] = [];
  for (const from of items) {
    for (const ref of new Set(from.refs)) {
      const name = ref.slice(ref.lastIndexOf("/") + 1).toLowerCase();
      // Only a name that points at exactly one open document of the same project.
      const hits = (byName.get(name) ?? []).filter((t) => t.project === from.project && t.path !== from.path);
      if (hits.length !== 1) {
        continue;
      }
      const key = suggestionKey(from.project, from.path, hits[0].path);
      if (linked.has(key) || rejected.has(key) || out.some((s) => s.key === key)) {
        continue;
      }
      out.push({ fromProject: from.project, fromPath: from.path, toPath: hits[0].path, key });
      if (out.length >= MAX) {
        return out;
      }
    }
  }
  return out;
}
