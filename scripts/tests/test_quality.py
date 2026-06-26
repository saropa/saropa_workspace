#!/usr/bin/env python3
"""
Regression tests for the code-quality heuristics in modules/_quality.py.

Focused on the string/comment/regex-aware tokenizer, because a desync there
silently corrupts every downstream metric (brace matching, `any` counts,
comment density). The headline case: a JS/TS regex literal containing a quote
and a brace (e.g. /[\\s"]/) must not be read as a string, or a 3-line function
"spans" hundreds of lines.

Run:  python scripts/tests/test_quality.py
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

# Make `modules` importable the same way the entry scripts do.
_SCRIPTS_DIR = str(Path(__file__).resolve().parent.parent)
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

from modules._quality import (  # noqa: E402
    FUNCTION_LINES_WARN,
    _ANY_RE,
    FileQuality,
    _find_long_functions,
    _tokenize_ts,
)


class TokenizerTest(unittest.TestCase):
    def test_line_comment_not_counted_as_code(self) -> None:
        comment_lines, code = _tokenize_ts('const x = 1; // set\nconst y = 2;\n')
        self.assertIn(1, comment_lines)
        self.assertNotIn(2, comment_lines)
        # The comment text is blanked in the code-only view.
        self.assertNotIn("set", code)

    def test_double_slash_inside_string_is_not_a_comment(self) -> None:
        comment_lines, _ = _tokenize_ts('const url = "http://x";\n')
        self.assertEqual(comment_lines, set())

    def test_regex_literal_with_quote_and_brace_does_not_desync(self) -> None:
        # The exact shape that produced the original false positive: a regex
        # holding a double-quote and a brace, used after `return`.
        src = (
            "function quote(value: string): string {\n"
            '  return /[\\s"]/.test(value) ? `"${value.replace(/"/g, \'q\')}"` : value;\n'
            "}\n"
            "const after = 1;\n"
        )
        _, code = _tokenize_ts(src)
        # Braces must balance to zero across the whole snippet.
        self.assertEqual(code.count("{"), code.count("}"))
        # The 3-line function must not register as a long function.
        self.assertEqual(_find_long_functions(code, set()), [])

    def test_division_is_not_treated_as_regex(self) -> None:
        # `a / b / c` is division; mishandling it as a regex would blank `b`.
        _, code = _tokenize_ts("const r = total / count / 2;\n")
        self.assertIn("total", code)
        self.assertIn("count", code)


class LongFunctionTest(unittest.TestCase):
    def test_genuinely_long_function_is_flagged(self) -> None:
        body = "\n".join(f"  const v{i} = {i};" for i in range(FUNCTION_LINES_WARN + 10))
        src = f"function big() {{\n{body}\n}}\n"
        _, code = _tokenize_ts(src)
        found = _find_long_functions(code, set())
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0][0], "big")
        self.assertGreater(found[0][1], FUNCTION_LINES_WARN)

    def test_short_function_is_not_flagged(self) -> None:
        _, code = _tokenize_ts("function small() {\n  return 1;\n}\n")
        self.assertEqual(_find_long_functions(code, set()), [])

    def test_control_flow_block_is_not_a_function(self) -> None:
        # A long `if` block must not be reported as a function.
        body = "\n".join(f"  doThing({i});" for i in range(FUNCTION_LINES_WARN + 10))
        src = f"if (ready) {{\n{body}\n}}\n"
        _, code = _tokenize_ts(src)
        self.assertEqual(_find_long_functions(code, set()), [])


class CommentExclusionTest(unittest.TestCase):
    """The function-length span counts CODE lines only — comment-only lines inside
    a body are subtracted, so an encouraged WHY-comment never inflates a function
    past the cap. A line carrying code plus a trailing comment still counts."""

    @staticmethod
    def _comment_only(comment_lines: set[int], code: str) -> set[int]:
        # Mirror collect_file_quality: a comment-only line is a commented line whose
        # code-only view is blank (not code with a trailing comment).
        code_lines = code.splitlines()
        return {
            ln
            for ln in comment_lines
            if 1 <= ln <= len(code_lines) and not code_lines[ln - 1].strip()
        }

    def test_function_long_only_due_to_comments_is_not_flagged(self) -> None:
        comments = "\n".join(f"  // explanation line {i}" for i in range(FUNCTION_LINES_WARN + 10))
        src = f"function documented() {{\n{comments}\n  return 1;\n}}\n"
        comment_lines, code = _tokenize_ts(src)
        comment_only = self._comment_only(comment_lines, code)
        # Raw span exceeds the cap; subtracting the comment-only lines drops it under.
        self.assertEqual(_find_long_functions(code, comment_only), [])

    def test_genuinely_long_function_still_flagged_with_comments(self) -> None:
        body = "\n".join(f"  const v{i} = {i};" for i in range(FUNCTION_LINES_WARN + 5))
        src = f"function big() {{\n  // a documenting comment\n{body}\n}}\n"
        comment_lines, code = _tokenize_ts(src)
        comment_only = self._comment_only(comment_lines, code)
        found = _find_long_functions(code, comment_only)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0][0], "big")


class AnyDetectionTest(unittest.TestCase):
    def test_any_in_code_counts(self) -> None:
        _, code = _tokenize_ts("let v: any = read();\n")
        self.assertEqual(len(_ANY_RE.findall(code)), 1)

    def test_any_inside_string_does_not_count(self) -> None:
        _, code = _tokenize_ts('const label = "accept any value";\n')
        self.assertEqual(len(_ANY_RE.findall(code)), 0)


class TemplateDominatedTest(unittest.TestCase):
    """Webview asset modules (one big exported `...` template literal) are excused
    from the sparse-comment flag. The tokenizer blanks template interiors, so the
    `//` / `/* */` comments embedded in the script are invisible to the density
    heuristic and the file would otherwise read as a false-positive "sparse"."""

    @staticmethod
    def _fq(lines: int, embedded: int) -> FileQuality:
        return FileQuality(
            rel_path="x.ts",
            lines=lines,
            comment_lines=0,
            any_count=0,
            todo_count=0,
            hardcoded_strings=0,
            embedded_text_lines=embedded,
        )

    def test_mostly_template_is_dominated(self) -> None:
        # A file that is overwhelmingly template-literal text is an asset module.
        self.assertTrue(self._fq(100, 90).template_dominated)

    def test_normal_module_with_a_few_strings_is_not_dominated(self) -> None:
        # A handful of inline strings must NOT excuse a real code file from the flag.
        self.assertFalse(self._fq(100, 10).template_dominated)

    def test_threshold_is_inclusive_at_sixty_percent(self) -> None:
        # The 0.6 cutoff: 60% excused, just under is not.
        self.assertTrue(self._fq(100, 60).template_dominated)
        self.assertFalse(self._fq(100, 59).template_dominated)

    def test_empty_file_is_not_dominated(self) -> None:
        # Guard the divide-by-zero edge: a zero-line file is never dominated.
        self.assertFalse(self._fq(0, 0).template_dominated)


if __name__ == "__main__":
    unittest.main(verbosity=2)
