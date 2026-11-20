// Front matter: a YAML block at the top of a document. Only three keys are read: tags, group and needs.
// A block that does not close or does not look like YAML is ignored, never an error.

export interface FrontMatter {
  tags: string[];
  group?: string;
  needs: string[];
}

const MAX_LINES = 100;

function unquote(s: string): string {
  return s.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
}

function listOf(inline: string, block: string[]): string[] {
  const body = inline.trim();
  const items = body === "" ? block : body.replace(/^\[|\]$/g, "").split(",");
  return items.map(unquote).filter((s) => s !== "");
}

export function readFrontMatter(text: string): FrontMatter {
  const none: FrontMatter = { tags: [], needs: [] };
  const lines = text.replace(/^﻿/, "").split(/\r?\n/, MAX_LINES);
  if (lines[0]?.trim() !== "---") {
    return none;
  }
  const end = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l));
  if (end < 0) {
    return none;
  }
  const body = lines.slice(1, end);
  if (body.some((l) => !/^\s*(#.*)?$|^\s*-\s|^[\w-]+\s*:|^\s+\S/.test(l))) {
    return none;
  }
  const out: FrontMatter = { tags: [], needs: [] };
  for (let i = 0; i < body.length; i++) {
    const m = /^([\w-]+)\s*:(.*)$/.exec(body[i]);
    if (!m) {
      continue;
    }
    const block: string[] = [];
    while (i + 1 < body.length && /^\s*-\s/.test(body[i + 1])) {
      block.push(body[i + 1].replace(/^\s*-\s/, ""));
      i += 1;
    }
    const key = m[1].toLowerCase();
    if (key === "tags" || key === "tag") {
      out.tags.push(...listOf(m[2], block));
    } else if (key === "needs") {
      out.needs.push(...listOf(m[2], block));
    } else if (key === "group") {
      out.group = unquote(m[2]) || undefined;
    }
  }
  return out;
}
