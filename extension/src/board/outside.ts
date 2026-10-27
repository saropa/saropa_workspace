// What comes from outside the document scan: Claude sessions that touched a document,
// pull requests waiting for the user's review, and groups other extensions contribute.
// Pure: the host fetches the data; this module only cleans it, since all of it is untrusted.
// None of it changes a project's light.

export interface OutsideItem {
  title: string;
  detail?: string;
  // https only; the host opens it after checking it against the model it rendered.
  url?: string;
}

// A titled list of items handed over by another extension.
export interface OutsideGroup {
  id: string;
  label: string;
  items: OutsideItem[];
}

// Session counts per document and the groups from other extensions.
export interface Outside {
  // "project/path" of an open document -> number of Claude sessions that touched it.
  chats: Record<string, number>;
  groups: OutsideGroup[];
}

// An Outside with nothing in it.
export const emptyOutside = (): Outside => ({ chats: {}, groups: [] });

// Most groups kept from other extensions.
export const MAX_GROUPS = 8;
// Most items kept in one group.
export const MAX_ITEMS = 20;
const MAX_TEXT = 200;

const text = (v: unknown, max = MAX_TEXT): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.replace(/[\r\n\t]+/g, " ").trim().slice(0, max) : undefined;

// The URL when it is a valid https link, otherwise undefined.
export function safeUrl(v: unknown): string | undefined {
  if (typeof v !== "string") {
    return undefined;
  }
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

// Keeps the items that have a title, as plain text with a safe link, up to the item limit.
export function cleanItems(raw: unknown): OutsideItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: OutsideItem[] = [];
  for (const r of raw) {
    const o = (typeof r === "object" && r !== null ? r : {}) as Record<string, unknown>;
    const title = text(o.title);
    if (title !== undefined && out.length < MAX_ITEMS) {
      out.push({ title, detail: text(o.detail), url: safeUrl(o.url) });
    }
  }
  return out;
}

// A group handed over by another extension: bounded and stripped to plain text and https links.
export function cleanGroup(id: unknown, label: unknown, items: unknown): OutsideGroup | undefined {
  const gid = text(id, 80);
  const glabel = text(label, 80);
  const clean = cleanItems(items);
  return gid && glabel && clean.length > 0 ? { id: gid, label: glabel, items: clean } : undefined;
}

// The GitHub search result for "is:pr is:open review-requested:@me".
export function parseReviewRequests(json: unknown): OutsideItem[] {
  const list = (json as { items?: unknown } | null)?.items;
  if (!Array.isArray(list)) {
    return [];
  }
  return cleanItems(
    list.map((r: { title?: unknown; html_url?: unknown; number?: unknown; repository_url?: unknown }) => {
      const repo = typeof r?.repository_url === "string" ? r.repository_url.split("/").slice(-2).join("/") : "";
      return { title: r?.title, detail: repo && typeof r?.number === "number" ? `${repo}#${r.number}` : repo || undefined, url: r?.html_url };
    })
  );
}

// The Chat Explorer reply, reduced to a count. A reply that is not understood is no count.
export function chatCount(reply: unknown): number | undefined {
  const r = reply as { indexing?: unknown; total?: unknown } | null;
  return r && r.indexing !== true && typeof r.total === "number" && r.total > 0 ? Math.floor(r.total) : undefined;
}
