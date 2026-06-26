import * as vscode from "vscode";

// Per-shortcut diagnostic / test badges (recipe book #26, #32). The dawn lint sweep and
// test-trend rituals write a report but, until now, left the shortcut itself silent. This
// registry parses a finished run's output for severity counts (error / warning /
// info) or a test pass/fail tally and records them per shortcut, so the tree can badge the
// shortcut with "what did the last sweep find" without the user opening the report.
//
// In-memory and per-session, exactly like runStatusRegistry: a badge is only
// meaningful for the run that produced it, and a fresh window starts clean. The
// runner records after a tracked run; the tree reads and repaints on change.

export interface ShortcutBadge {
  // Diagnostic severity counts from a lint / analyze run. All three present together
  // (a clean sweep records zeros so a stale non-zero badge is cleared).
  errors?: number;
  warnings?: number;
  infos?: number;
  // Test outcome counts from a test run.
  testsPassed?: number;
  testsFailed?: number;
  // Epoch ms the producing run ended.
  at: number;
}

class ShortcutBadgeRegistry {
  private readonly byShortcut = new Map<string, ShortcutBadge>();
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  record(pinId: string, badge: ShortcutBadge): void {
    this.byShortcut.set(pinId, badge);
    this._onDidChange.fire();
  }

  get(pinId: string): ShortcutBadge | undefined {
    return this.byShortcut.get(pinId);
  }

  clear(pinId: string): void {
    if (this.byShortcut.delete(pinId)) {
      this._onDidChange.fire();
    }
  }
}

// Module-level singleton: the runner records, the tree reads.
export const shortcutBadges = new ShortcutBadgeRegistry();

// Parse a finished run's combined output into a badge, or undefined when nothing
// recognizable was found (so a non-lint/non-test run never overwrites a real badge
// with an empty one). A run that is BOTH a lint and a test (e.g. "analyze && test")
// can populate both halves.
export function parseRunBadge(output: string): ShortcutBadge | undefined {
  const diag = parseDiagnostics(output);
  const test = parseTestResults(output);
  if (!diag && !test) {
    return undefined;
  }
  return { ...(diag ?? {}), ...(test ?? {}), at: Date.now() };
}

// Recognize the common linters/analyzers. Order matters: the most specific,
// breakdown-carrying formats are tried first; a generic "clean" marker last so a
// re-run that now passes clears a stale count rather than leaving it. Returns
// undefined when no analyzer output is recognized (leave any prior badge intact).
function parseDiagnostics(
  out: string
): { errors: number; warnings: number; infos: number } | undefined {
  // ESLint summary: "✖ 12 problems (3 errors, 9 warnings)".
  const eslint = /(\d+)\s+problems?\s*\((\d+)\s+errors?,\s*(\d+)\s+warnings?\)/i.exec(
    out
  );
  if (eslint) {
    return { errors: Number(eslint[2]), warnings: Number(eslint[3]), infos: 0 };
  }

  // Dart / Flutter analyze: per-finding lines "error • ... ", "warning • ...",
  // "info • ...". The bullet separator is distinctive, so counting the lines is
  // reliable and carries the full breakdown.
  const dErr = (out.match(/^\s*error\s+•/gim) ?? []).length;
  const dWarn = (out.match(/^\s*warning\s+•/gim) ?? []).length;
  const dInfo = (out.match(/^\s*info\s+•/gim) ?? []).length;
  if (dErr + dWarn + dInfo > 0) {
    return { errors: dErr, warnings: dWarn, infos: dInfo };
  }

  // TypeScript: the "Found N errors" summary tsc prints at the end.
  const tsc = /Found (\d+) errors?/i.exec(out);
  if (tsc) {
    return { errors: Number(tsc[1]), warnings: 0, infos: 0 };
  }

  // Clean markers, so a re-run that now passes clears a stale non-zero badge:
  // dart/flutter ("No issues found!"), eslint-clean is silent (cannot detect), tsc
  // ("Found 0 errors" handled above). Checked last so a real breakdown wins.
  if (/No issues found!?/i.test(out)) {
    return { errors: 0, warnings: 0, infos: 0 };
  }
  return undefined;
}

// Recognize the common test runners. Each returns a passed/failed tally; undefined
// when no runner output is recognized.
function parseTestResults(
  out: string
): { testsPassed: number; testsFailed: number } | undefined {
  // Dart / Flutter test: the live counter "+P -F:" (e.g. "00:03 +12 -1: Some tests
  // failed."). Take the LAST occurrence — it is the final tally.
  const dart = [...out.matchAll(/\+(\d+)(?:\s+-(\d+))?\s*:/g)];
  if (dart.length > 0) {
    const last = dart[dart.length - 1];
    return { testsPassed: Number(last[1]), testsFailed: last[2] ? Number(last[2]) : 0 };
  }

  // Jest / vitest: "Tests: 1 failed, 9 passed, 10 total".
  const jest = /Tests:\s+(?:(\d+) failed,\s+)?(\d+) passed/i.exec(out);
  if (jest) {
    return { testsPassed: Number(jest[2]), testsFailed: jest[1] ? Number(jest[1]) : 0 };
  }

  // Mocha: "9 passing" / "1 failing".
  const mPass = /(\d+) passing/i.exec(out);
  const mFail = /(\d+) failing/i.exec(out);
  if (mPass || mFail) {
    return {
      testsPassed: mPass ? Number(mPass[1]) : 0,
      testsFailed: mFail ? Number(mFail[1]) : 0,
    };
  }

  // Cargo: "test result: ok. 12 passed; 0 failed".
  const cargo = /test result:.*?(\d+) passed;\s*(\d+) failed/i.exec(out);
  if (cargo) {
    return { testsPassed: Number(cargo[1]), testsFailed: Number(cargo[2]) };
  }

  // pytest: "5 passed, 1 failed" (order varies; either may be absent). Checked last
  // because the bare "(\d+) passed/failed" shape is the most permissive.
  const pyPass = /(\d+) passed/i.exec(out);
  const pyFail = /(\d+) failed/i.exec(out);
  if (pyPass || pyFail) {
    return {
      testsPassed: pyPass ? Number(pyPass[1]) : 0,
      testsFailed: pyFail ? Number(pyFail[1]) : 0,
    };
  }
  return undefined;
}

// Compact, glyph-only lead text for the tree row (numbers + symbols, no words —
// nothing to translate). Errors lead, then warnings, then info; a clean sweep reads
// "✓"; a test tally appends "P✓ F✗". Returns undefined for an empty badge.
export function formatBadgeLead(badge: ShortcutBadge): string | undefined {
  const parts: string[] = [];
  const hasDiag =
    badge.errors !== undefined ||
    badge.warnings !== undefined ||
    badge.infos !== undefined;
  if (hasDiag) {
    const e = badge.errors ?? 0;
    const w = badge.warnings ?? 0;
    const i = badge.infos ?? 0;
    if (e === 0 && w === 0 && i === 0) {
      parts.push("✓");
    } else {
      if (e > 0) {
        parts.push(`${e}✖`);
      }
      if (w > 0) {
        parts.push(`${w}⚠`);
      }
      if (i > 0) {
        parts.push(`${i}ⓘ`);
      }
    }
  }
  if (badge.testsPassed !== undefined || badge.testsFailed !== undefined) {
    const p = badge.testsPassed ?? 0;
    const f = badge.testsFailed ?? 0;
    parts.push(f > 0 ? `${p}✓ ${f}✗` : `${p}✓`);
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}
