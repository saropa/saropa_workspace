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
        self.assertEqual(_find_long_functions(code), [])

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
        found = _find_long_functions(code)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0][0], "big")
        self.assertGreater(found[0][1], FUNCTION_LINES_WARN)

    def test_short_function_is_not_flagged(self) -> None:
        _, code = _tokenize_ts("function small() {\n  return 1;\n}\n")
        self.assertEqual(_find_long_functions(code), [])

    def test_control_flow_block_is_not_a_function(self) -> None:
        # A long `if` block must not be reported as a function.
        body = "\n".join(f"  doThing({i});" for i in range(FUNCTION_LINES_WARN + 10))
        src = f"if (ready) {{\n{body}\n}}\n"
        _, code = _tokenize_ts(src)
        self.assertEqual(_find_long_functions(code), [])


class AnyDetectionTest(unittest.TestCase):
    def test_any_in_code_counts(self) -> None:
        _, code = _tokenize_ts("let v: any = read();\n")
        self.assertEqual(len(_ANY_RE.findall(code)), 1)

    def test_any_inside_string_does_not_count(self) -> None:
        _, code = _tokenize_ts('const label = "accept any value";\n')
        self.assertEqual(len(_ANY_RE.findall(code)), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
