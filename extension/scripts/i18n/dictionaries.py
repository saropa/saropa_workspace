"""Curated phrase dictionaries for extension localization."""

from __future__ import annotations

from typing import Dict

# Technical keywords that stay identical in every locale. Adding a string here
# auto-generates a passthrough ("X" -> "X") in every TRANSLATIONS locale, so the
# coverage gate counts it as translated without duplicating the entry 19+ times.
# Only add strings whose English source value is a technical identifier, column
# header keyword, or code-level token -- never ordinary user-facing prose.
# WARNING: a DO_NOT_TRANSLATE entry silently suppresses translation for EVERY
# locale. Before adding a common word, verify it only appears as a standalone
# source string and is genuinely untranslatable in all target locales.
# generate_locales.py runs _check_dnt_collisions() to catch cases where the
# keyword is embedded in a longer translatable string.
DO_NOT_TRANSLATE: list[str] = []

# Words that are spelled identically in specific locales (cognates, loanwords,
# shared technical terms). Unlike DO_NOT_TRANSLATE, these apply only to the
# listed locales -- the same word might need a real translation elsewhere.
# Format: English source string -> list of locale codes where it is correct as-is.
# The merge loop below injects "X" -> "X" into each listed locale's TRANSLATIONS
# dict at import time, so compute_stats() counts them as translated and MT is
# never consulted for them.
COGNATES: dict[str, list[str]] = {}

# cspell:disable
#
# Curated per-locale translations. Add entries as translation quality is reviewed.
# Format: locale code -> { english_source: translated_value }.
TRANSLATIONS: Dict[str, Dict[str, str]] = {}
# cspell:enable

# Merge DO_NOT_TRANSLATE passthroughs into every locale that doesn't already
# have a curated entry for the string. Runs once at import time.
for _locale_dict in TRANSLATIONS.values():
    for _keyword in DO_NOT_TRANSLATE:
        _locale_dict.setdefault(_keyword, _keyword)

# Merge COGNATES passthroughs into only the locales where the word is a valid
# cognate/loanword. Same setdefault semantics: a curated entry with a real
# translation takes priority over the passthrough.
_valid_locales = frozenset(TRANSLATIONS.keys())
for _cognate_src, _cognate_locales in COGNATES.items():
    if not _cognate_locales:
        raise ValueError(
            f"COGNATES[{_cognate_src!r}] has an empty locale list -- "
            f"remove the entry or add at least one locale code"
        )
    _seen_locales: set[str] = set()
    for _cognate_locale in _cognate_locales:
        if _cognate_locale in _seen_locales:
            raise ValueError(
                f"COGNATES[{_cognate_src!r}] lists locale "
                f"{_cognate_locale!r} more than once"
            )
        _seen_locales.add(_cognate_locale)
        if _cognate_locale not in _valid_locales:
            raise ValueError(
                f"COGNATES[{_cognate_src!r}] references unknown locale "
                f"{_cognate_locale!r}. Valid: {sorted(_valid_locales)}"
            )
        TRANSLATIONS[_cognate_locale].setdefault(_cognate_src, _cognate_src)
