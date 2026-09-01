"""Language match for the feed: French with French, Hausa with Hausa, etc.

Uses script + function-word overlap so we do not download a language model.
Unknown / mixed text returns "" and is treated as a soft match, not a ban.
"""

from __future__ import annotations

import re

# Highest-signal closed-class words per language. Short on purpose so a caption
# of a few tokens can still vote. Hausa / Yoruba / Igbo are Latin-script and
# need their own lists because generic detectors skip them.
_LEX: dict[str, frozenset[str]] = {
    "en": frozenset("the and you that this with have for are was not but from they your just about".split()),
    "fr": frozenset("les une des est pour dans avec pas plus vous nous que une je il elle aux sur".split()),
    "ha": frozenset(
        "wannan kuma amma don suna yake ita shi ina yaya nagode sannu ne ce ba ko sai da na".split()
    ),
    "yo": frozenset("awọn jẹ́ ṣe nitori nitori pé lati pẹlu ninu fun mi wa ni ti ko".split()),
    "ig": frozenset("nke dị ka ụnụ unu anyị gị ya n'ime n’ime maka nke a".split()),
    "sw": frozenset("na ya wa kwa kwa ajili sio kama sana habari asante karibu mimi wewe".split()),
    "ar": frozenset(),
    "es": frozenset("los las una del por con para esta este pero como más hay muy".split()),
    "pt": frozenset("uma dos das para com não mais você isso esta este pelo pela".split()),
    "de": frozenset("und die der das nicht mit sich auf für den dem eine auch".split()),
}

_ARABIC = re.compile(r"[\u0600-\u06FF]")
_HAUSA_HOOK = re.compile(r"[ƙɗɓƴƘƊƁƳ]")
_TOKEN = re.compile(r"[a-zàâäéèêëïîôùûüçñọẹịụńṣƙɗɓƴ']+", re.I)


def tokenize(text: str) -> list[str]:
    return [t.lower() for t in _TOKEN.findall(text or "")]


def detect_lang(*parts: str) -> str:
    blob = " ".join(p for p in parts if p).strip()
    if not blob:
        return ""
    if _ARABIC.search(blob) and len(_ARABIC.findall(blob)) >= 3:
        return "ar"
    tokens = tokenize(blob)
    if _HAUSA_HOOK.search(blob):
        return "ha"
    if not tokens:
        return ""
    bag = set(tokens)
    scores: list[tuple[int, str]] = []
    for lang, words in _LEX.items():
        if not words:
            continue
        hit = len(bag & words)
        if hit:
            scores.append((hit, lang))
    if not scores:
        return ""
    scores.sort(reverse=True)
    top_n, top_lang = scores[0]
    second = scores[1][0] if len(scores) > 1 else 0
    if top_n < 2 and len(tokens) > 8:
        return ""
    if top_n == 1 and len(tokens) < 4:
        return top_lang
    if top_n >= 2 and top_n > second:
        return top_lang
    if top_n >= 2 and top_n == second:
        return top_lang
    return top_lang if top_n >= 2 else ""


def lang_affinity(post_lang: str, viewer_lang: str) -> float:
    if not post_lang or not viewer_lang:
        return 0.42
    if post_lang == viewer_lang:
        return 1.0
    return 0.12
