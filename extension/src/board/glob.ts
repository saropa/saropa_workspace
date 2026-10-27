// Glob to RegExp for the board rules. The existing exec/globMatch.ts treats braces as
// literal characters, and the rules need "{a,b}" alternation, so the board has its own.
// Supports "**/" (zero or more folders), "**" (anything), "*" (one segment), "?" (one
// character) and "{a,b}" alternation. Mirrors the prototype engine so the golden test
// matches it exactly.

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function globToRegExp(glob: string): RegExp {
  const alts: string[] = [];
  // Pull "{a,b}" out first so its commas and the later "." escaping do not collide.
  let g = glob.replace(/\{([^{}]*)\}/g, (_m, inner: string) => {
    alts.push("(?:" + inner.split(",").map(escapeRe).join("|") + ")");
    return "\u0002" + (alts.length - 1) + "\u0002";
  });
  g = g
    .replace(/\./g, "\\.")
    .replace(/\*\*\//g, "\u0000")
    .replace(/\*\*/g, "\u0001")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\u0000/g, "(?:.*/)?")
    .replace(/\u0001/g, ".*")
    .replace(/\u0002(\d+)\u0002/g, (_m, i: string) => alts[Number(i)]);
  return new RegExp("^" + g + "$");
}
