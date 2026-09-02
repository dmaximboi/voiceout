from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
import re
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

_analyzer = SentimentIntensityAnalyzer()

LABELS = (
    "happy", "sad", "anger", "fear", "surprise", "neutral", "informative",
    "questioning", "supportive", "critical", "humorous", "agreement",
    "disagreement", "personal_story", "advice", "spam", "off_topic",
)

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

_RULES = {
    "questioning": (r"\?", r"\b(why|what|when|where|who|how|can|could|would|does|is it)\b"),
    "supportive": (r"\b(proud of you|you got this|stay strong|sending love|well done|congrats|thank you)\b",),
    "critical": (r"\b(problem|flawed|misleading|incorrect|bad take|needs improvement)\b", r"\bwrong because\b"),
    "humorous": (r"\b(lol|lmao|rofl|joke|hilarious|funny|dead)\b",),
    "agreement": (r"\b(i agree|exactly|absolutely|facts|true that|same here)\b",),
    "disagreement": (r"\b(i disagree|not true|no way|actually no|false|nah|but I)\b",),
    "personal_story": (r"\b(i remember|when i|my experience|happened to me|i was|in my life)\b",),
    "advice": (r"\b(you should|try to|consider|my advice|recommend|make sure|avoid|tip:)\b",),
    "informative": (r"\b(according to|research|study|because|means that|for example|source|data|fact)\b",),
    "spam": (r"\b(follow me|check my bio|dm me|click (the )?link|free money|giveaway|crypto)\b", r"https?://"),
    "off_topic": (r"\b(unrelated|off topic|anyway subscribe)\b",),
}


@dataclass(frozen=True)
class CommentClassification:
    primary: str
    secondary: str | None
    confidence: float
    scores: dict[str, float]


def classify_comment(
    body: str,
    sticker_id: str | None = None,
    reaction: str | None = None,
) -> CommentClassification:
    """Rule/VADER classifier. Visual-only signals are deliberately capped."""
    text = (body or "").strip()
    lower = text.lower()
    scores: defaultdict[str, float] = defaultdict(float)
    vader = _analyzer.polarity_scores(text)
    meaningful = len(re.findall(r"\b[\w']+\b", text)) >= 2

    if vader["compound"] >= 0.2:
        scores["happy"] += 0.75 * vader["compound"] + 0.2
    elif vader["compound"] <= -0.2:
        negative = abs(vader["compound"])
        if re.search(r"\b(hate|angry|rage|furious|disgust|awful)\b", lower):
            scores["anger"] += 0.65 + 0.35 * negative
        elif re.search(r"\b(scared|afraid|terror|worried|anxious|danger)\b", lower):
            scores["fear"] += 0.65 + 0.35 * negative
        else:
            scores["sad"] += 0.55 + 0.4 * negative

    for label, patterns in _RULES.items():
        hits = sum(bool(re.search(pattern, lower, re.I)) for pattern in patterns)
        if hits:
            scores[label] += min(1.05, 0.68 + 0.22 * (hits - 1))
            if label == "critical":
                scores[label] += 0.28
    if text.count("?") >= 2:
        scores["questioning"] += 0.16
    if text.count("!") >= 2:
        scores["surprise"] += 0.18
    if re.search(r"\b(wow|omg|unexpected|can't believe)\b", lower):
        scores["surprise"] += 0.72

    # Emoji/stickers/reactions can classify empty visual comments, but only nudge text.
    visual_weight = 0.16 if meaningful else 0.62
    for emoji, label in _EMOJI_TO_SENTIMENT.items():
        if emoji in text:
            scores[label] += visual_weight
    sticker_label = STICKER_TO_SENTIMENT.get(sticker_id or "")
    if sticker_label:
        scores[sticker_label] += visual_weight
    reaction_label = REACTION_TO_SENTIMENT.get(reaction or "")
    if reaction_label:
        scores[reaction_label] += visual_weight * 0.65

    if not scores:
        scores["neutral"] = 0.62 if text else 0.5
    ordered = sorted(scores.items(), key=lambda item: (-item[1], LABELS.index(item[0])))
    primary, top = ordered[0]
    secondary = ordered[1][0] if len(ordered) > 1 and ordered[1][1] >= max(0.22, top * 0.36) else None
    margin = top - (ordered[1][1] if len(ordered) > 1 else 0.0)
    confidence = max(0.35, min(0.98, 0.5 + 0.3 * top + 0.2 * margin))
    return CommentClassification(primary, secondary, round(confidence, 4), dict(scores))


def label_text(text: str) -> str:
    return classify_comment(text).primary


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
    return ent / math.log(min(6, max(2, len(counts))))


def dominant_label(labels: list[str]) -> tuple[str | None, float]:
    if not labels:
        return None, 0.0
    counts = Counter(labels)
    label, n = counts.most_common(1)[0]
    return label, n / len(labels)


def label_comment(body: str, sticker_id: str | None = None) -> str:
    return classify_comment(body, sticker_id).primary


def emotion_affinity(viewer_emotion: str, post_emotion: str) -> float:
    """All six labels, not only happy/sad. Laugh/love viewers see happy-comment posts."""
    v = REACTION_TO_SENTIMENT.get((viewer_emotion or "").strip(), (viewer_emotion or "").strip())
    p = (post_emotion or "").strip()
    if not v or not p or v == "neutral" or p == "neutral":
        return 0.35
    if v == p:
        return 1.0
    return 0.08
