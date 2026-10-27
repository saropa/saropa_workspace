import { Light } from "./boardModel";
import { worstLight } from "./sidebar";

// Release train: projects that ship together, shown as one row with one light and the order
// to ship them in. Pure and read-only: it only reads the projects the board already built.
//
// Which projects ship together: a project and the projects it depends on (the rule file's
// `dependsOn`), followed in both directions. When no project declares a dependency, every
// project of the workspace counts as one train. The light is the worst light of the members,
// so it is never greener than any of them. The order puts a project after the projects it
// depends on; a circular dependency is flagged and those projects keep the board's order.

export type TrainNaming = "version" | "folder";

export function asTrainNaming(v: unknown): TrainNaming {
  return v === "folder" ? "folder" : "version";
}

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

export interface TrainMember {
  id: string;
  name: string;
  light: Light;
  // Version when known and wanted, else the folder name.
  label: string;
}

export interface Train {
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

// Dependencies first; ties and circles keep the input order.
function shipOrder(group: TrainProject[]): { order: TrainProject[]; cycle: boolean } {
  const ids = new Set(group.map((p) => p.id));
  const done = new Set<string>();
  const order: TrainProject[] = [];
  while (order.length < group.length) {
    const next = group.find((p) => !done.has(p.id) && p.dependsOn.every((d) => !ids.has(d) || d === p.id || done.has(d)));
    if (!next) {
      const rest = group.filter((p) => !done.has(p.id));
      return { order: [...order, ...rest], cycle: true };
    }
    done.add(next.id);
    order.push(next);
  }
  return { order, cycle: false };
}

// The trains of a board. Nothing is returned for fewer than two projects.
export function buildTrains(projects: TrainProject[], naming: TrainNaming): Train[] {
  if (projects.length < 2) {
    return [];
  }
  return components(projects).map((group) => {
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
      name: naming === "version" && last.version ? `${last.name} ${last.version}` : last.folder,
      light,
      members,
      heldBy: light === "go" ? [] : members.filter((m) => m.light === light).map((m) => m.name),
      cycle,
    };
  });
}

export interface TrainLabels {
  // Contains {name}.
  title: string;
  light: Record<Light, string>;
  // Contains {names}.
  heldBy: string;
  cycle: string;
}

export interface TrainRow {
  name: string;
  light: Light;
  // Short line: the light word and the order.
  description: string;
  tooltip: string[];
}

const fill = (s: string, k: string, v: string): string => s.split(k).join(v);

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
    return { name: fill(labels.title, "{name}", t.name), light: t.light, description: `${labels.light[t.light]} · ${order}`, tooltip };
  });
}
