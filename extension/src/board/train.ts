import { Light } from "./boardModel";
import { worstLight } from "./sidebar";

// Release train: projects that ship together, shown as one row with one light and the order
// to ship them in. Pure and read-only: it only reads the projects the board already built.
//
// Which projects ship together: a project and the projects it depends on (the rule file's
// `dependsOn`), followed in both directions. When no project declares a dependency, every
// project of the workspace counts as one train. A `dependsOn` entry names a project by id,
// else by display name or folder name (case does not matter). The light is the worst light of the members,
// so it is never greener than any of them. The order puts a project after the projects it
// depends on; a circular dependency is flagged and only the projects inside the circle keep
// the board's order among themselves.

export type TrainNaming = "version" | "folder";

// Plain setting value to a naming mode; anything but folder means version.
export function asTrainNaming(v: unknown): TrainNaming {
  return v === "folder" ? "folder" : "version";
}

// What the train build needs to know about one project.
export interface TrainProject {
  id: string;
  name: string;
  light: Light;
  dependsOn: string[];
  // Name of the project's folder.
  folder: string;
  // The project's version from package.json or pubspec.yaml, when it could be read.
  version?: string;
}

// One project in a train, in shipping order.
export interface TrainMember {
  id: string;
  name: string;
  light: Light;
  // Version when known and wanted, else the folder name.
  label: string;
}

// Projects that ship together, with one light, the order and what holds the light back.
export interface Train {
  // Unique among trains (a project is in one train): the member ids joined.
  key: string;
  // Label of the member that ships last.
  name: string;
  light: Light;
  // In the order to ship.
  members: TrainMember[];
  // Names of the members that hold the light at its worst; empty when the train is GO.
  heldBy: string[];
  // True when the dependencies go in a circle, so the order is only the board's order.
  cycle: boolean;
}

// A version is plain text such as 2.1.0 or 2026.1025.03; anything else is not used.
const VERSION = /^[0-9A-Za-z][0-9A-Za-z._-]{0,39}$/;

// The version in the text of a package.json or pubspec.yaml, without build metadata.
export function parseVersion(fileName: string, text: string): string | undefined {
  let raw: unknown;
  if (/package\.json$/i.test(fileName)) {
    try {
      raw = (JSON.parse(text) as { version?: unknown }).version;
    } catch {
      return undefined;
    }
  } else if (/pubspec\.ya?ml$/i.test(fileName)) {
    raw = /^version:[ \t]*["']?([^\s"'#]+)/m.exec(text)?.[1];
  }
  const v = typeof raw === "string" ? raw.split("+")[0] : "";
  return VERSION.test(v) ? v : undefined;
}

// The same projects with every `dependsOn` entry turned into a project id; entries that
// match no project are dropped.
function resolveDeps(projects: TrainProject[]): TrainProject[] {
  const byId = new Map(projects.map((p) => [p.id, p.id]));
  const byText = new Map<string, string>();
  for (const p of projects) {
    for (const t of [p.name, p.folder]) {
      if (!byText.has(t.toLowerCase())) {
        byText.set(t.toLowerCase(), p.id);
      }
    }
  }
  return projects.map((p) => ({
    ...p,
    dependsOn: p.dependsOn.flatMap((d) => {
      const id = byId.get(d) ?? byText.get(d.toLowerCase());
      return id === undefined ? [] : [id];
    }),
  }));
}

function components(projects: TrainProject[]): TrainProject[][] {
  const ids = new Set(projects.map((p) => p.id));
  const parent = new Map(projects.map((p) => [p.id, p.id]));
  const find = (k: string): string => {
    while (parent.get(k) !== k) {
      k = parent.get(k)!;
    }
    return k;
  };
  let edges = 0;
  for (const p of projects) {
    for (const d of p.dependsOn) {
      if (ids.has(d) && d !== p.id) {
        edges += 1;
        parent.set(find(p.id), find(d));
      }
    }
  }
  if (edges === 0) {
    return [projects];
  }
  const groups = new Map<string, TrainProject[]>();
  for (const p of projects) {
    (groups.get(find(p.id)) ?? groups.set(find(p.id), []).get(find(p.id))!).push(p);
  }
  return [...groups.values()].filter((g) => g.length >= 2);
}

// Dependencies first; ties keep the input order. When the rest is stuck in a circle, the
// projects of the first circle (in input order) are placed together in input order, then
// ordering goes on, so projects before and after the circle still sit correctly.
function shipOrder(group: TrainProject[]): { order: TrainProject[]; cycle: boolean } {
  const ids = new Set(group.map((p) => p.id));
  const deps = new Map(group.map((p) => [p.id, p.dependsOn.filter((d) => ids.has(d) && d !== p.id)]));
  const reach = (from: string): Set<string> => {
    const seen = new Set<string>();
    const stack = [...deps.get(from)!];
    while (stack.length > 0) {
      const k = stack.pop()!;
      if (!seen.has(k)) {
        seen.add(k);
        stack.push(...deps.get(k)!);
      }
    }
    return seen;
  };
  const done = new Set<string>();
  const order: TrainProject[] = [];
  let cycle = false;
  while (order.length < group.length) {
    const next = group.find((p) => !done.has(p.id) && deps.get(p.id)!.every((d) => done.has(d)));
    if (next) {
      done.add(next.id);
      order.push(next);
      continue;
    }
    cycle = true;
    const left = group.filter((p) => !done.has(p.id));
    const seed = left.find((p) => reach(p.id).has(p.id)) ?? left[0];
    const circle = new Set([seed.id, ...reach(seed.id)].filter((k) => !done.has(k) && reach(k).has(seed.id) && reach(seed.id).has(k)));
    circle.add(seed.id);
    for (const p of group.filter((q) => circle.has(q.id))) {
      done.add(p.id);
      order.push(p);
    }
  }
  return { order, cycle };
}

// The trains of a board. Nothing is returned for fewer than two projects.
export function buildTrains(projects: TrainProject[], naming: TrainNaming): Train[] {
  if (projects.length < 2) {
    return [];
  }
  return components(resolveDeps(projects)).map((group) => {
    const { order, cycle } = shipOrder(group);
    const members: TrainMember[] = order.map((p) => ({
      id: p.id,
      name: p.name,
      light: p.light,
      label: naming === "version" && p.version ? p.version : p.folder,
    }));
    const light = worstLight(members.map((m) => m.light)) ?? "unverified";
    const last = order[order.length - 1];
    return {
      key: members.map((m) => m.id).join("+"),
      name: naming === "version" && last.version ? `${last.name} ${last.version}` : last.folder,
      light,
      members,
      heldBy: light === "go" ? [] : members.filter((m) => m.light === light).map((m) => m.name),
      cycle,
    };
  });
}

// The text a train row is made from.
export interface TrainLabels {
  // Contains {name}.
  title: string;
  light: Record<Light, string>;
  // Contains {names}.
  heldBy: string;
  cycle: string;
}

// A train as one row of text.
export interface TrainRow {
  // Unique among trains, for a tree row id.
  key: string;
  name: string;
  light: Light;
  // Short line: the light word and the order.
  description: string;
  tooltip: string[];
}

const fill = (s: string, k: string, v: string): string => s.split(k).join(v);

// Turns trains into rows with a short description and a tooltip.
export function trainRows(trains: Train[], labels: TrainLabels): TrainRow[] {
  return trains.map((t) => {
    const order = t.members.map((m) => m.name).join(" > ");
    const tooltip = [fill(labels.title, "{name}", t.name), `${labels.light[t.light]}: ${order}`];
    if (t.heldBy.length > 0) {
      tooltip.push(fill(labels.heldBy, "{names}", t.heldBy.join(", ")));
    }
    if (t.cycle) {
      tooltip.push(labels.cycle);
    }
    return { key: t.key, name: fill(labels.title, "{name}", t.name), light: t.light, description: `${labels.light[t.light]} · ${order}`, tooltip };
  });
}
