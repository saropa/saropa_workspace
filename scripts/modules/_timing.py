#!/usr/bin/env python3
"""
Step timing and end-of-run summary.

A small summary table at the end shows where the run spent time and which steps
passed, mirroring the larger Saropa publishers. Used as a context manager:
``with timer.step("Build"): ...`` records duration and success per step.

Version:   1.0
Copyright: (c) 2026 Saropa
"""

from __future__ import annotations

import time
from contextlib import contextmanager
from dataclasses import dataclass

from modules._utils import Color, _c, is_quiet


@dataclass
class _StepRecord:
    name: str
    duration: float
    ok: bool


class StepTimer:
    def __init__(self) -> None:
        self._steps: list[_StepRecord] = []
        self._start = time.monotonic()

    @contextmanager
    def step(self, name: str):
        start = time.monotonic()
        ok = True
        try:
            yield
        except BaseException:
            ok = False
            raise
        finally:
            self._steps.append(_StepRecord(name, time.monotonic() - start, ok))

    def print_summary(self) -> None:
        if is_quiet() or not self._steps:
            return
        total = time.monotonic() - self._start
        longest = max(s.duration for s in self._steps)
        print()
        print(_c("=" * 64, Color.CYAN))
        print(_c("  Timing", Color.CYAN))
        print(_c("=" * 64, Color.CYAN))
        for s in self._steps:
            icon = _c("+", Color.GREEN) if s.ok else _c("x", Color.RED)
            # Bar length scales to the longest step so the slow ones stand out.
            bar = ""
            if s.duration >= 0.5 and longest > 0:
                bar = "  " + _c("#" * max(1, int(s.duration / longest * 15)), Color.DIM)
            print(f"  {icon}  {s.name:<28}{_fmt_duration(s.duration):>8}{bar}")
        print(f"    {'Total':<28}{_fmt_duration(total):>8}")
        print()


def _fmt_duration(seconds: float) -> str:
    if seconds < 1.0:
        return f"{int(seconds * 1000)}ms"
    if seconds < 60.0:
        return f"{seconds:.1f}s"
    return f"{int(seconds // 60)}m {int(seconds % 60):02d}s"
