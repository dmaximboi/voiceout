"""Region from bio / caption place names.

Language is a weak fallback only for languages that cluster in one country.
French is not mapped — it is spoken in too many places.
"""

from __future__ import annotations

import re

from lang import detect_lang, tokenize

# Longer phrases first when we scan the raw blob.
_PLACES: list[tuple[str, str]] = [
    ("port harcourt", "NG"),
    ("côte d'ivoire", "CI"),
    ("cote d'ivoire", "CI"),
    ("ivory coast", "CI"),
    ("south africa", "ZA"),
    ("united states", "US"),
    ("new york", "US"),
    ("saudi arabia", "SA"),
    ("united kingdom", "GB"),
    ("burkina faso", "BF"),
    ("sierra leone", "SL"),
    ("nigeria", "NG"),
    ("lagos", "NG"),
    ("abuja", "NG"),
    ("kano", "NG"),
    ("ibadan", "NG"),
    ("kaduna", "NG"),
    ("enugu", "NG"),
    ("onitsha", "NG"),
    ("benin", "NG"),
    ("warri", "NG"),
    ("jos", "NG"),
    ("abeokuta", "NG"),
    ("ilorin", "NG"),
    ("maiduguri", "NG"),
    ("ghana", "GH"),
    ("accra", "GH"),
    ("kumasi", "GH"),
    ("tamale", "GH"),
    ("kenya", "KE"),
    ("nairobi", "KE"),
    ("mombasa", "KE"),
    ("tanzania", "TZ"),
    ("dar es salaam", "TZ"),
    ("uganda", "UG"),
    ("kampala", "UG"),
    ("senegal", "SN"),
    ("dakar", "SN"),
    ("cameroon", "CM"),
    ("douala", "CM"),
    ("yaounde", "CM"),
    ("yaoundé", "CM"),
    ("mali", "ML"),
    ("bamako", "ML"),
    ("niger", "NE"),
    ("niamey", "NE"),
    ("chad", "TD"),
    ("n'djamena", "TD"),
    ("abidjan", "CI"),
    ("france", "FR"),
    ("paris", "FR"),
    ("lyon", "FR"),
    ("marseille", "FR"),
    ("belgium", "BE"),
    ("brussels", "BE"),
    ("canada", "CA"),
    ("toronto", "CA"),
    ("montreal", "CA"),
    ("london", "GB"),
    ("england", "GB"),
    ("manchester", "GB"),
    ("usa", "US"),
    ("america", "US"),
    ("texas", "US"),
    ("houston", "US"),
    ("atlanta", "US"),
    ("egypt", "EG"),
    ("cairo", "EG"),
    ("morocco", "MA"),
    ("casablanca", "MA"),
    ("algeria", "DZ"),
    ("tunisia", "TN"),
    ("rwanda", "RW"),
    ("kigali", "RW"),
    ("ethiopia", "ET"),
    ("addis", "ET"),
    ("india", "IN"),
    ("pakistan", "PK"),
    ("germany", "DE"),
    ("berlin", "DE"),
    ("brazil", "BR"),
    ("portugal", "PT"),
    ("spain", "ES"),
    ("madrid", "ES"),
]

_LANG_REGION = {
    "ha": "NG",
    "yo": "NG",
    "ig": "NG",
    "sw": "KE",
}

_WORD = re.compile(r"[^\w'-]+", re.I)


def detect_region(*parts: str, lang: str = "") -> str:
    blob = " ".join(p for p in parts if p).strip().lower()
    if not blob:
        return _LANG_REGION.get(lang, "")
    compact = _WORD.sub(" ", blob)
    for place, region in _PLACES:
        if place in compact:
            return region
    tokens = set(tokenize(compact))
    for place, region in _PLACES:
        if " " in place:
            continue
        if place in tokens:
            return region
    guess = lang or detect_lang(*parts)
    return _LANG_REGION.get(guess, "")


def region_affinity(post_region: str, viewer_region: str) -> float:
    if not post_region or not viewer_region:
        return 0.42
    if post_region == viewer_region:
        return 1.0
    return 0.12


def infer_geo(*parts: str) -> dict[str, str]:
    lang = detect_lang(*parts)
    region = detect_region(*parts, lang=lang)
    return {"lang": lang, "region": region}
