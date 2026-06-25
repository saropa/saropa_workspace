#!/usr/bin/env python3
"""
Code-quality metrics and gates for the TypeScript extension.

Read-only static analysis over extension/src/**/*.ts. Reports, per the project's
quality bar:

  * File length            — flags files past a soft and a hard cap.
  * Function length         — heuristic brace scan; flags long functions.
  * Documentation quality   — comment-line density + exported-symbol JSDoc rate.
  * Unit test coverage      — source modules with a matching *.test.ts.
  * `any` usage             — the TypeScript rule bans `any`; counts leaks.
  * TODO/FIXME/HACK markers  — deferred-work debt.
  * Hardcoded UI strings    — show*Message() with a literal instead of l10n().

These are HEURISTICS (string/comment-aware, but not a full TypeScript parser),
so the numbers are a queue signal and a gate, not a proof of quality. Only the
hard file-length cap is a blocking failure by default; everything else reports
as a warning so a release is never blocked by debt that predates this gate.
audit.py runs the full report; publish.py runs the gate in full mode.

Version:   1.0
Copyright: (c) 2026 Saropa
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from modules._utils import (
    Color,
    SRC_DIR,
    _c,
    detail,
    error,
    header,
    info,
    success,
    warn,
)

# --------------------------------------------------------------------------- #
# Tunable thresholds. One place so the gate is easy to retune as the codebase
# grows; the values reflect the project rules (functions <=50 lines preferred)
# and a generous file-length cap that flags genuine bloat, not normal modules.
# --------------------------------------------------------------------------- #
FILE_LINES_WARN = 400
FILE_LINES_FAIL = 700
FUNCTION_LINES_WARN = 50
SPARSE_COMMENT_RATIO = 0.05  # below this share of comment lines a file is "sparse"
TOP_N = 15  # rows per worst-offenders table

# Control-flow keywords that precede a `{` but are NOT function definitions; the
# function-length scan must skip them or every `if (...) {` reads as a function.
_NON_FUNCTION_KEYWORDS = frozenset(
    {"if", "for", "while", "switch", "catch", "else", "do", "try", "return", "function"}
)


# --------------------------------------------------------------------------- #
# Source enumeration.
# --------------------------------------------------------------------------- #


def _source_files() -> list[Path]:
    """All extension/src/*.ts excluding declaration files and test files."""
    out: list[Path] = []
    for p in sorted(SRC_DIR.rglob("*.ts")):
        name = p.name
        if name.endswith(".d.ts") or name.endswith(".test.ts"):
            continue
        out.append(p)
    return out


def _test_files() -> list[Path]:
    return sorted(SRC_DIR.rglob("*.test.ts"))


def _rel(path: Path) -> str:
    return path.relative_to(SRC_DIR.parent).as_posix()


# --------------------------------------------------------------------------- #
# String/comment-aware tokenizer. Returns the set of comment line numbers and a
# "code-only" view of the same length, with comment and string interiors blanked
# to spaces (newlines preserved, structural punctuation kept). Running regexes on
# the code-only view means `: any` inside a string or a `//` inside a literal
# never count. Template `${...}` expressions are kept as code; nested literals
# inside them are rare enough not to skew these high-level metrics.
# --------------------------------------------------------------------------- #


# Keywords after which a `/` begins a regex literal, not a division. Without
# this, `return /[\s"]/...` reads the `"` inside the regex as a string opener and
# desyncs every downstream brace count (a 3-line function then "spans" hundreds).
_REGEX_PRECEDING_WORDS = frozenset(
    {"return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
     "do", "else", "yield", "await", "case"}
)
# Punctuation after which a `/` begins a regex (operators / openers — a value is
# expected next). After an identifier, number, `)`, `]`, `}`, or string a `/` is
# division.
_REGEX_PRECEDING_PUNCT = frozenset("({[,;:?=&|!^~<>+-*%")


def _tokenize_ts(text: str) -> tuple[set[int], str]:
    n = len(text)
    i = 0
    line = 1
    comment_lines: set[int] = set()
    out: list[str] = []
    # Last significant (non-space, non-comment) code char and trailing identifier
    # word, used to disambiguate a regex literal `/.../ ` from a `/` division.
    last_sig = ""
    last_word = ""

    def record(ch: str) -> None:
        nonlocal last_sig, last_word
        if ch.isspace():
            return
        last_sig = ch
        if ch.isalnum() or ch in "_$":
            last_word += ch
        else:
            last_word = ""

    def regex_allowed() -> bool:
        if not last_sig:
            return True  # start of file / nothing before
        if last_word and last_word in _REGEX_PRECEDING_WORDS:
            return True
        if last_word:  # any other identifier/number is a value -> division
            return False
        return last_sig in _REGEX_PRECEDING_PUNCT

    while i < n:
        c = text[i]
        if c == "\n":
            out.append("\n")
            line += 1
            i += 1
            continue
        # Line comment: blank to end of line.
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            comment_lines.add(line)
            while i < n and text[i] != "\n":
                out.append(" ")
                i += 1
            continue
        # Block comment: blank through the closing */, tracking newlines.
        if c == "/" and i + 1 < n and text[i + 1] == "*":
            comment_lines.add(line)
            out.append("  ")
            i += 2
            while i < n and not (text[i] == "*" and i + 1 < n and text[i + 1] == "/"):
                if text[i] == "\n":
                    line += 1
                    out.append("\n")
                else:
                    comment_lines.add(line)
                    out.append(" ")
                i += 1
            if i < n:
                out.append("  ")
                i += 2
            continue
        # Regex literal: only where a value is expected (see regex_allowed). Blank
        # the body; a `[...]` char class can contain an unescaped `/` that does
        # not end the regex, so track class depth.
        if c == "/" and regex_allowed():
            out.append("/")
            i += 1
            in_class = False
            while i < n:
                ch = text[i]
                if ch == "\\":
                    out.append("  " if i + 1 < n else " ")
                    i += 2
                    continue
                if ch == "\n":
                    # An unterminated regex on a line is really division; bail so
                    # we don't swallow the rest of the file.
                    break
                if ch == "[":
                    in_class = True
                elif ch == "]":
                    in_class = False
                elif ch == "/" and not in_class:
                    out.append("/")
                    i += 1
                    break
                out.append(" ")
                i += 1
            record("/")
            continue
        # Single/double quoted string: keep quotes, blank the interior.
        if c == '"' or c == "'":
            out.append(c)
            record(c)
            i += 1
            while i < n and text[i] != c:
                if text[i] == "\\":
                    out.append("  " if i + 1 < n else " ")
                    i += 2
                    continue
                if text[i] == "\n":
                    line += 1
                    out.append("\n")
                else:
                    out.append(" ")
                i += 1
            if i < n:
                out.append(c)
                i += 1
            continue
        # Template literal: blank the text, keep ${...} expressions as code.
        if c == "`":
            out.append("`")
            record("`")
            i += 1
            while i < n and text[i] != "`":
                if text[i] == "\\":
                    out.append("  " if i + 1 < n else " ")
                    i += 2
                    continue
                if text[i] == "$" and i + 1 < n and text[i + 1] == "{":
                    out.append("${")
                    i += 2
                    depth = 1
                    while i < n and depth > 0:
                        ch = text[i]
                        if ch == "{":
                            depth += 1
                        elif ch == "}":
                            depth -= 1
                        if ch == "\n":
                            line += 1
                        out.append(ch)
                        i += 1
                    continue
                if text[i] == "\n":
                    line += 1
                    out.append("\n")
                else:
                    out.append(" ")
                i += 1
            if i < n:
                out.append("`")
                i += 1
            continue
        out.append(c)
        record(c)
        i += 1

    return comment_lines, "".join(out)


def _line_of(code: str, index: int) -> int:
    """1-based line number of *index* within *code*."""
    return code.count("\n", 0, index) + 1


# --------------------------------------------------------------------------- #
# Per-file metric collection.
# --------------------------------------------------------------------------- #


@dataclass
class FileQuality:
    rel_path: str
    lines: int
    comment_lines: int
    any_count: int
    todo_count: int
    hardcoded_strings: int
    long_functions: list[tuple[str, int]] = field(default_factory=list)  # (name, span)

    @property
    def comment_ratio(self) -> float:
        return self.comment_lines / self.lines if self.lines else 0.0


# Function-like headers ending in `{`, evaluated against the code-only view.
_FUNCTION_DECL_RE = re.compile(r"\bfunction\b\s*\*?\s*([A-Za-z0-9_$]*)\s*\([^;{]*\)\s*(?::[^={;]+)?\{")
_ARROW_RE = re.compile(r"([A-Za-z0-9_$]+)?\s*=\s*(?:async\s*)?\([^;{]*\)\s*(?::[^={;]+)?=>\s*\{")
_METHOD_RE = re.compile(
    r"(?:^|\n)[ \t]*(?:(?:public|private|protected|static|async|readonly|get|set|abstract)\s+)*"
    r"([A-Za-z_$][\w$]*)\s*\([^;{]*\)\s*(?::[^={;]+)?\{"
)


def _match_brace_span(code: str, open_index: int) -> int | None:
    """Return the index just past the `}` matching the `{` at *open_index*."""
    depth = 0
    i = open_index
    n = len(code)
    while i < n:
        ch = code[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return None


def _find_long_functions(code: str) -> list[tuple[str, int]]:
    """Heuristic: function/arrow/method bodies spanning > FUNCTION_LINES_WARN lines.

    Brace-matched on the code-only view so strings/comments never miscount. Dedup
    by the opening-brace position because a method can match more than one regex.
    """
    seen_open: set[int] = set()
    found: list[tuple[str, int]] = []
    candidates: list[tuple[int, str]] = []  # (brace_index, name)

    for rx in (_FUNCTION_DECL_RE, _ARROW_RE, _METHOD_RE):
        for m in rx.finditer(code):
            brace = code.rfind("{", m.start(), m.end())
            if brace < 0:
                continue
            name = (m.group(1) or "anonymous").strip() or "anonymous"
            if name in _NON_FUNCTION_KEYWORDS:
                continue
            candidates.append((brace, name))

    for brace, name in candidates:
        if brace in seen_open:
            continue
        seen_open.add(brace)
        end = _match_brace_span(code, brace)
        if end is None:
            continue
        span = _line_of(code, end - 1) - _line_of(code, brace) + 1
        if span > FUNCTION_LINES_WARN:
            found.append((name, span))
    found.sort(key=lambda t: -t[1])
    return found


# `any` leaks, evaluated on the code-only view so strings/comments don't count.
_ANY_RE = re.compile(r":\s*any\b|\bas\s+any\b|<\s*any\s*>|\bany\s*\[\]|Array<\s*any\s*>")
# A literal first argument to a user-facing message call, with no l10n() wrapper.
_HARDCODED_MSG_RE = re.compile(
    r"\.show(?:Information|Warning|Error)Message\(\s*(?!l10n\b)[`'\"]"
)
_TODO_RE = re.compile(r"\b(?:TODO|FIXME|HACK|XXX)\b")


def collect_file_quality(path: Path) -> FileQuality:
    text = path.read_text(encoding="utf-8", errors="replace")
    comment_lines, code = _tokenize_ts(text)
    lines = len(text.splitlines())
    any_count = len(_ANY_RE.findall(code))
    hardcoded = len(_HARDCODED_MSG_RE.findall(code))
    # TODO markers are counted only on comment lines (the code-only view blanks
    # comments, so search the original text but restrict to comment line numbers).
    todo = 0
    src_lines = text.splitlines()
    for ln in comment_lines:
        if 1 <= ln <= len(src_lines) and _TODO_RE.search(src_lines[ln - 1]):
            todo += 1
    return FileQuality(
        rel_path=_rel(path),
        lines=lines,
        comment_lines=len(comment_lines),
        any_count=any_count,
        todo_count=todo,
        hardcoded_strings=hardcoded,
        long_functions=_find_long_functions(code),
    )


# --------------------------------------------------------------------------- #
# Exported-symbol JSDoc coverage. A real documentation-quality signal: an
# exported function/class/type with no `/** */` block directly above it ships an
# undocumented public surface. Re-exports (`export {`, `export * from`) are not
# declarations and are excluded.
# --------------------------------------------------------------------------- #

_EXPORT_DECL_RE = re.compile(
    r"^export\s+(?:default\s+)?(?:abstract\s+)?(?:async\s+)?"
    r"(function|class|const|let|interface|type|enum)\s+([A-Za-z0-9_$]+)"
)


def _exported_symbol_doc_coverage() -> tuple[int, int, list[str]]:
    """Return (documented, total, undocumented_rel_paths_with_name)."""
    documented = 0
    total = 0
    undocumented: list[str] = []
    for path in _source_files():
        src_lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        for idx, raw in enumerate(src_lines):
            m = _EXPORT_DECL_RE.match(raw)
            if not m:
                continue
            total += 1
            # Walk back over blank lines / decorators to the nearest real line;
            # a JSDoc block ends in `*/`, which is the documentation signal.
            prev = idx - 1
            while prev >= 0 and not src_lines[prev].strip():
                prev -= 1
            if prev >= 0 and src_lines[prev].rstrip().endswith("*/"):
                documented += 1
            else:
                undocumented.append(f"{_rel(path)}: {m.group(1)} {m.group(2)}")
    return documented, total, undocumented


# --------------------------------------------------------------------------- #
# Unit test coverage. A source module bar.ts is "covered" when some bar.test.ts
# exists in the tree. Basename mapping is coarse but matches the project's
# one-test-file-per-module convention and needs no test execution.
# --------------------------------------------------------------------------- #


def _test_coverage() -> tuple[int, int, list[str]]:
    """Return (covered, total, untested_rel_paths)."""
    sources = _source_files()
    test_stems = {p.name[: -len(".test.ts")] for p in _test_files()}
    covered = 0
    untested: list[str] = []
    for p in sources:
        stem = p.name[: -len(".ts")]
        if stem in test_stems:
            covered += 1
        else:
            untested.append(_rel(p))
    return covered, len(sources), untested


# --------------------------------------------------------------------------- #
# Report assembly + rendering.
# --------------------------------------------------------------------------- #


@dataclass
class QualityReport:
    files: list[FileQuality]
    doc_documented: int
    doc_total: int
    doc_undocumented: list[str]
    test_covered: int
    test_total: int
    test_untested: list[str]

    @property
    def oversized_files(self) -> list[FileQuality]:
        return [f for f in self.files if f.lines > FILE_LINES_FAIL]

    @property
    def failures(self) -> int:
        # Only the hard file-length cap blocks; debt metrics are warnings so a
        # release is never blocked by pre-existing gaps this gate just surfaced.
        return len(self.oversized_files)


def collect_quality() -> QualityReport:
    files = [collect_file_quality(p) for p in _source_files()]
    doc_documented, doc_total, doc_undoc = _exported_symbol_doc_coverage()
    test_covered, test_total, test_untested = _test_coverage()
    return QualityReport(
        files=files,
        doc_documented=doc_documented,
        doc_total=doc_total,
        doc_undocumented=doc_undoc,
        test_covered=test_covered,
        test_total=test_total,
        test_untested=test_untested,
    )


def _pct(part: int, whole: int) -> float:
    return (part / whole * 100.0) if whole else 0.0


def _print_file_length(report: QualityReport) -> None:
    detail(_c("  File length", Color.WHITE))
    longest = sorted(report.files, key=lambda f: -f.lines)
    over_warn = [f for f in report.files if f.lines > FILE_LINES_WARN]
    over_fail = report.oversized_files
    detail(
        f"    {len(report.files)} source file(s); "
        f"{len(over_warn)} over {FILE_LINES_WARN} lines, "
        f"{len(over_fail)} over the {FILE_LINES_FAIL}-line hard cap."
    )
    for f in longest[:TOP_N]:
        if f.lines <= FILE_LINES_WARN:
            break
        marker = "x" if f.lines > FILE_LINES_FAIL else "!"
        col = Color.RED if f.lines > FILE_LINES_FAIL else Color.YELLOW
        detail(_c(f"      {marker} {f.lines:>5}  {f.rel_path}", col))
    if not over_warn:
        success(f"All files within {FILE_LINES_WARN} lines.")


def _print_function_length(report: QualityReport) -> None:
    detail(_c("  Function length (heuristic)", Color.WHITE))
    rows: list[tuple[int, str, str]] = []
    for f in report.files:
        for name, span in f.long_functions:
            rows.append((span, name, f.rel_path))
    rows.sort(key=lambda r: -r[0])
    if not rows:
        success(f"No functions over {FUNCTION_LINES_WARN} lines detected.")
        return
    detail(f"    {len(rows)} function(s) over {FUNCTION_LINES_WARN} lines:")
    for span, name, rel in rows[:TOP_N]:
        detail(_c(f"      ! {span:>4}  {name}  ({rel})", Color.YELLOW))


def _print_documentation(report: QualityReport) -> None:
    detail(_c("  Documentation", Color.WHITE))
    total_lines = sum(f.lines for f in report.files)
    total_comments = sum(f.comment_lines for f in report.files)
    detail(
        f"    Comment lines: {total_comments:,} / {total_lines:,} "
        f"({_pct(total_comments, total_lines):.1f}%) "
        "(heuristic: //, /* */ outside strings)."
    )
    detail(
        f"    Exported symbols with JSDoc: {report.doc_documented} / {report.doc_total} "
        f"({_pct(report.doc_documented, report.doc_total):.1f}%)."
    )
    sparse = sorted(
        (f for f in report.files if f.lines >= 30 and f.comment_ratio < SPARSE_COMMENT_RATIO),
        key=lambda f: f.comment_ratio,
    )
    for f in sparse[:TOP_N]:
        detail(
            _c(
                f"      ! {f.comment_ratio * 100:4.1f}%  {f.rel_path} "
                f"({f.comment_lines}/{f.lines} lines)",
                Color.YELLOW,
            )
        )
    if report.doc_undocumented:
        detail(f"    {len(report.doc_undocumented)} undocumented export(s); first {TOP_N}:")
        for item in report.doc_undocumented[:TOP_N]:
            detail(_c(f"      ! {item}", Color.YELLOW))


def _print_test_coverage(report: QualityReport) -> None:
    detail(_c("  Unit test coverage", Color.WHITE))
    pct = _pct(report.test_covered, report.test_total)
    detail(
        f"    Source modules with a matching *.test.ts: "
        f"{report.test_covered} / {report.test_total} ({pct:.1f}%)."
    )
    if report.test_untested and report.test_covered < report.test_total:
        shown = report.test_untested[:TOP_N]
        detail(f"    {len(report.test_untested)} untested module(s); first {len(shown)}:")
        for rel in shown:
            detail(_c(f"      ! {rel}", Color.YELLOW))
    elif report.test_total and report.test_covered == report.test_total:
        success("Every source module has a matching test file.")


def _print_misc(report: QualityReport) -> None:
    detail(_c("  Type safety, debt, and i18n", Color.WHITE))
    any_total = sum(f.any_count for f in report.files)
    todo_total = sum(f.todo_count for f in report.files)
    hard_total = sum(f.hardcoded_strings for f in report.files)
    detail(f"    `any` usages (rule bans `any`): {any_total}")
    detail(f"    TODO/FIXME/HACK/XXX markers: {todo_total}")
    detail(f"    Hardcoded show*Message() strings (should use l10n): {hard_total}")
    flagged = sorted(
        (f for f in report.files if f.any_count or f.hardcoded_strings),
        key=lambda f: -(f.any_count + f.hardcoded_strings),
    )
    for f in flagged[:TOP_N]:
        bits = []
        if f.any_count:
            bits.append(f"{f.any_count} any")
        if f.hardcoded_strings:
            bits.append(f"{f.hardcoded_strings} hardcoded")
        detail(_c(f"      ! {f.rel_path}: {', '.join(bits)}", Color.YELLOW))


def run_quality_audit(strict: bool = False) -> int:
    """Run the full quality report. Returns the count of BLOCKING failures.

    Blocking failures are files over the hard line cap (see QualityReport). When
    *strict* (a full publish) those fail the run; otherwise the report is purely
    informational. Debt metrics never block — they are surfaced as warnings.
    """
    header("CODE QUALITY")
    if not SRC_DIR.exists():
        warn(f"No source directory at {SRC_DIR}; skipping quality audit.")
        return 0
    report = collect_quality()
    if not report.files:
        warn("No TypeScript source files found; skipping quality audit.")
        return 0

    _print_file_length(report)
    print()
    _print_function_length(report)
    print()
    _print_documentation(report)
    print()
    _print_test_coverage(report)
    print()
    _print_misc(report)

    print()
    failures = report.failures
    if failures:
        names = ", ".join(f.rel_path for f in report.oversized_files)
        msg = f"{failures} file(s) over the {FILE_LINES_FAIL}-line hard cap: {names}"
        if strict:
            error(msg)
        else:
            warn(msg + " (informational; blocks only a full publish).")
    else:
        success("Quality gate clean (no files over the hard line cap).")
    return failures if strict else 0
