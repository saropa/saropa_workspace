// Glob to RegExp for the board rules. The existing exec/globMatch.ts treats braces as
// literal characters, and the rules need "{a,b}" alternation, so the board has its own.
// Supports "**/" (zero or more folders), "**" (anything), "*" (one segment), "?" (one
// character) and "{a,b}" alternation. Mirrors the prototype engine so the golden test
// matches it exactly. Alternatives may hold wildcards; braces do not nest. Every other
// character, backslash included, is matched literally.

const escapeRe = (s: string): string => s.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");

function translate(g: string): string {
  let out = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") {
        if (g[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if (c === "{") {
      const end = g.indexOf("}", i);
      if (end > i && !g.slice(i + 1, end).includes("{")) {
        out += "(?:" + g.slice(i + 1, end).split(",").map(translate).join("|") + ")";
        i = end;
      } else {
        out += escapeRe(c);
      }
    } else {
      out += escapeRe(c);
    }
  }
  return out;
}

// Turns a board glob into a regular expression that must match the whole text.
export function globToRegExp(glob: string): RegExp {
  return new RegExp("^" + translate(glob) + "$");
}
