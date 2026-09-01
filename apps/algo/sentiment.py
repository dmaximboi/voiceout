from __future__ import annotations

from collections import Counter
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

_analyzer = SentimentIntensityAnalyzer()

LABELS = ("happy", "sad", "anger", "fear", "surprise", "neutral")

REACTION_TO_SENTIMENT = {
    "like": "neutral",
    "love": "happy",
    "haha": "happy",
    "wow": "surprise",
    "sad": "sad",
    "angry": "anger",
}

STICKER_TO_SENTIMENT = {
    "fire": "happy",
    "heart": "happy",
    "laugh": "happy",
    "wow": "surprise",
    "sad": "sad",
    "angry": "anger",
    "clap": "happy",
    "hundred": "happy",
    "think": "neutral",
    "mic": "neutral",
    "wave": "happy",
    "sparkles": "happy",
    "skull": "surprise",
    "eyes": "surprise",
    "pray": "happy",
    "flex": "happy",
}

_EMOJI_TO_SENTIMENT = {
    "😂": "happy",
    "🤣": "happy",
    "😊": "happy",
    "😍": "happy",
    "❤️": "happy",
    "❤": "happy",
    "🔥": "happy",
    "👏": "happy",
    "💯": "happy",
    "😢": "sad",
    "😭": "sad",
    "😔": "sad",
    "😡": "anger",
    "🤬": "anger",
    "😮": "surprise",
    "😱": "fear",
    "😨": "fear",
    "🤔": "neutral",
}


def label_text(text: str) -> str:
    scores = _analyzer.polarity_scores(text or "")
    compound = scores["compound"]
    if compound >= 0.35:
        return "happy"
    if compound <= -0.45:
        # anger vs sad from negative words
        lower = text.lower()
        if any(w in lower for w in ("hate", "angry", "rage", "furious", "disgust")):
            return "anger"
        if any(w in lower for w in ("scared", "afraid", "terror", "worried")):
            return "fear"
        return "sad"
    if "!" in text and scores["pos"] > 0.2:
        return "surprise"
    return "neutral"


def mix_entropy(labels: list[str]) -> float:
    if not labels:
        return 1.0
    counts = Counter(labels)
    total = len(labels)
    ent = 0.0
    import math

    for n in counts.values():
        p = n / total
        ent -= p * math.log(p + 1e-12)
    # max entropy for 6 labels ~ 1.79
    return ent / math.log(len(LABELS))


def dominant_label(labels: list[str]) -> tuple[str | None, float]:
    if not labels:
        return None, 0.0
    counts = Counter(labels)
    label, n = counts.most_common(1)[0]
    return label, n / len(labels)


def label_comment(body: str, sticker_id: str | None = None) -> str:
    if sticker_id:
        mapped = STICKER_TO_SENTIMENT.get(sticker_id)
        if mapped:
            return mapped
    for ch, lab in _EMOJI_TO_SENTIMENT.items():
        if ch in (body or ""):
            return lab
    return label_text(body or "")


def emotion_affinity(viewer_emotion: str, post_emotion: str) -> float:
    """All six labels, not only happy/sad. Laugh/love viewers see happy-comment posts."""
    v = REACTION_TO_SENTIMENT.get((viewer_emotion or "").strip(), (viewer_emotion or "").strip())
    p = (post_emotion or "").strip()
    if not v or not p or v == "neutral" or p == "neutral":
        return 0.35
    if v == p:
        return 1.0
    return 0.08
