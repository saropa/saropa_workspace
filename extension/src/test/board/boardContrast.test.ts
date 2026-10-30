// Pill and status-chip text must reach 4.5:1 against its own background in the dark and the
// light theme. The colors come from the style sheet itself (its rules are parsed here), with the
// theme tokens the page falls back on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { STYLE } from "../../board/boardHtmlAssets";

type Rgb = [number, number, number];
interface Paint {
  rgb: Rgb;
  a: number;
}

const THEMES: Record<string, Record<string, string>> = {
  dark: { bg: "#1e1e1e", panel: "#181818", fg: "#cccccc", mute: "#9d9d9d", red: "#f14c4c", amber: "#cca700", purple: "#b180d7", green: "#89d185" },
  light: { bg: "#ffffff", panel: "#f8f8f8", fg: "#3b3b3b", mute: "#717171", red: "#e51400", amber: "#bf8803", purple: "#652d90", green: "#388a34" },
};

function hex(h: string): Rgb {
  const s = h.length === 4 ? [...h.slice(1)].map((c) => c + c).join("") : h.slice(1);
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as Rgb;
}

// Splits "a,b,c" at top-level commas.
function args(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    depth += s[i] === "(" ? 1 : s[i] === ")" ? -1 : 0;
    if (s[i] === "," && depth === 0) {
      out.push(s.slice(from, i).trim());
      from = i + 1;
    }
  }
  out.push(s.slice(from).trim());
  return out;
}

function paint(expr: string, th: Record<string, string>): Paint {
  const e = expr.trim();
  if (e === "transparent") {
    return { rgb: [0, 0, 0], a: 0 };
  }
  if (e.startsWith("#")) {
    return { rgb: hex(e), a: 1 };
  }
  const v = /^var\(--([a-z]+)\)$/.exec(e);
  if (v) {
    return { rgb: hex(th[v[1]]), a: 1 };
  }
  const m = /^color-mix\((.*)\)$/.exec(e);
  assert.ok(m, `cannot read ${e}`);
  const [, a, b] = args(m[1]);
  const pa = /^(.*)\s(\d+)%$/.exec(a);
  assert.ok(pa, `cannot read ${a}`);
  const p = Number(pa[2]) / 100;
  const x = paint(pa[1], th);
  const y = paint(b, th);
  if (y.a === 0) {
    return { rgb: x.rgb, a: p };
  }
  return { rgb: x.rgb.map((c, i) => c * p + y.rgb[i] * (1 - p)) as Rgb, a: 1 };
}

function over(top: Paint, base: Rgb): Rgb {
  return top.rgb.map((c, i) => c * top.a + base[i] * (1 - top.a)) as Rgb;
}

function lum(c: Rgb): number {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// The value of a declaration in the rule with exactly this selector.
function decl(selector: string, prop: string): string {
  const rule = new RegExp(`(?:^|\\})${selector.replace(/[.[\]]/g, "\\$&")}\\{([^}]*)\\}`, "m").exec(STYLE) ?? new RegExp(`${selector.replace(/[.[\]]/g, "\\$&")}\\{([^}]*)\\}`).exec(STYLE);
  assert.ok(rule, `rule ${selector}`);
  const d = new RegExp(`(?:^|;)${prop}:([^;]*(?:\\([^)]*\\)[^;]*)*)`).exec(rule[1]);
  assert.ok(d, `${selector} has ${prop}`);
  return d[1];
}

const CHIPS = [".go.no-go", ".go.unverified", ".stat.red", ".stat.amber", ".stat.purple", ".go.go", ".pill.warn", ".imp", ".imp.guess"];

test("every pill and status chip has 4.5:1 text contrast in the dark and the light theme", () => {
  const bad: string[] = [];
  for (const [name, th] of Object.entries(THEMES)) {
    for (const sel of CHIPS) {
      const color = paint(decl(sel, "color"), th);
      let bg: Paint;
      try {
        bg = paint(decl(sel, "background"), th);
      } catch {
        bg = { rgb: hex(th.panel), a: 0 };
      }
      for (const base of [th.bg, th.panel]) {
        const back = over(bg, hex(base));
        const r = ratio(over(color, back), back);
        if (r < 4.5) {
          bad.push(`${name} ${sel} on ${base}: ${r.toFixed(2)}`);
        }
      }
    }
  }
  assert.deepEqual(bad, []);
});

test("the contrast reader agrees with known pairs", () => {
  assert.ok(Math.abs(ratio([0, 0, 0], [255, 255, 255]) - 21) < 0.01);
  assert.ok(Math.abs(ratio([119, 119, 119], [255, 255, 255]) - 4.48) < 0.02);
});
