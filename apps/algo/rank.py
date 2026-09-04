from __future__ import annotations

from datetime import datetime, timezone

import math
import numpy as np
from pydantic import BaseModel

from graphfeat import proximity_from_edges, source_score
from lang import detect_lang, lang_affinity
from geo import detect_region, region_affinity
from sentiment import emotion_affinity
from textsim import cosine_to_user, item_texts

FACTOR_WEIGHTS: dict[str, float] = {
    "recency": 0.075, "source": 0.095, "graph proximity": 0.060,
    "duration fit": 0.045, "text similarity": 0.050, "search similarity": 0.040,
    "comment engagement": 0.035, "replay": 0.035, "language match": 0.030,
    "emotion match": 0.025, "region match": 0.020, "share affinity": 0.035,
    "completion": 0.040, "bookmark affinity": 0.030, "reply affinity": 0.035,
    "author familiarity": 0.040, "seen fatigue": -0.060, "reaction affinity": 0.035,
    "comment affinity": 0.035, "repost affinity": 0.030, "voice affinity": 0.030,
    "time of day": 0.020, "category affinity": 0.040, "novelty": 0.025,
    "explore bonus": 0.020, "reach fairness": 0.025,     "premium badge": 0.005,
    "negative feedback": -0.110,
    "wilson engagement": 0.040,
    "affinity harmonic": 0.035,
    "cold start prior": 0.020,
    "zipf reach": 0.020,
    "information gain": 0.030,
    "completion odds": 0.030,
    "half life freshness": 0.025,
}
FACTOR_NAMES = tuple(FACTOR_WEIGHTS)
FEATURE_WEIGHTS = np.array(list(FACTOR_WEIGHTS.values()), dtype=float)


class Candidate(BaseModel):
    post_id: str
    author_id: str
    caption: str
    duration_ms: int
    created_at: str
    source: str
    comment_boost: float = 0
    transcript: str = ""
    replay_count: int = 0
    lang: str = ""
    emotion: str = ""
    share_affinity: float = 0
    prior_share_boost: float = 0
    complete_listen: float = 0
    unique_reach: int = 0
    over_reach_cap: bool = False
    region: str = ""
    bookmark_affinity: float = 0
    graph_proximity: float = 0
    search_similarity: float = 0
    reply_affinity: float = 0
    author_familiarity: float = 0
    seen_count: int = 0
    reaction_affinity: float = 0
    comment_affinity: float = 0
    repost_affinity: float = 0
    voice_affinity: float = 0
    category_affinity: float = 0
    novelty: float = 0.5
    explore: bool = False
    premium_badge: bool = False
    negative_feedback: float = 0
    category: str = ""


def _recency(created_at: str) -> float:
    try:
        ts = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    except ValueError:
        return 0.3
    now = datetime.now(timezone.utc)
    hours = max(0.0, (now - ts).total_seconds() / 3600.0)
    age = float(np.exp(-hours / 18.0))
    delta = min(abs(now.hour - ts.hour), 24 - abs(now.hour - ts.hour))
    tod = float(np.exp(-delta / 6.0))
    return float(np.clip(0.75 * age + 0.25 * tod, 0.0, 1.0))


def _age_and_tod(created_at: str) -> tuple[float, float]:
    try:
        ts = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        hours = max(0.0, (now - ts).total_seconds() / 3600.0)
        delta = min(abs(now.hour - ts.hour), 24 - abs(now.hour - ts.hour))
        return float(np.exp(-hours / 18.0)), float(np.exp(-delta / 6.0))
    except ValueError:
        return 0.3, 0.5


def _duration_scores(duration_ms: np.ndarray, avg_listen_ms: int) -> np.ndarray:
    avg = float(avg_listen_ms if avg_listen_ms > 0 else 90_000)
    diff = np.abs(duration_ms - avg) / max(avg, 15_000.0)
    similar = np.exp(-diff * 1.35)
    shorter = np.where(duration_ms < avg, 0.12, 0.0)
    return np.clip(similar + shorter, 0.0, 1.0)


def _replay_score(n: int) -> float:
    """Three replays is the signal. A fourth play does not add more."""
    return min(max(int(n), 0), 3) / 3.0


def feature_matrix(
    candidates: list[Candidate],
    recent_texts: list[str],
    avg_listen_ms: int,
    follow_edges: list[tuple[str, str]] | None = None,
    viewer_id: str | None = None,
    viewer_lang: str = "",
    viewer_emotion: str = "",
    viewer_region: str = "",
) -> np.ndarray:
    n = len(candidates)
    age_tod = [_age_and_tod(c.created_at) for c in candidates]
    recency = np.array([v[0] for v in age_tod], dtype=float)
    tod = np.array([v[1] for v in age_tod], dtype=float)
    source = np.array([source_score(c.source) for c in candidates], dtype=float)
    graph = np.array([c.graph_proximity for c in candidates], dtype=float)
    if follow_edges and viewer_id:
        prox = proximity_from_edges(viewer_id, [c.author_id for c in candidates], follow_edges)
        graph = np.maximum(graph, np.array([prox[c.author_id] for c in candidates], dtype=float))
    duration = _duration_scores(np.array([c.duration_ms for c in candidates], dtype=float), avg_listen_ms)
    text = cosine_to_user(
        item_texts([c.caption for c in candidates], [c.transcript for c in candidates]),
        recent_texts,
    )
    if text.shape[0] != n:
        text = np.full(n, 0.2, dtype=float)
    boost = np.clip(0.15 * np.array([c.comment_boost for c in candidates], dtype=float), 0.0, 1.0)
    replay = np.array([_replay_score(c.replay_count) for c in candidates], dtype=float)
    langs = []
    regions = []
    for c in candidates:
        langs.append(c.lang or detect_lang(c.caption, c.transcript))
        regions.append(c.region or detect_region(c.caption, c.transcript, lang=langs[-1]))
    lang = np.array([lang_affinity(lg, viewer_lang) for lg in langs], dtype=float)
    emotion = np.array([emotion_affinity(viewer_emotion, c.emotion) for c in candidates], dtype=float)
    share = np.clip(np.array([c.share_affinity + 0.04 * c.prior_share_boost for c in candidates], dtype=float), 0.0, 1.0)
    complete = np.clip(np.array([c.complete_listen for c in candidates], dtype=float), 0.0, 1.0)
    region = np.array([region_affinity(rg, viewer_region) for rg in regions], dtype=float)
    bookmark = np.clip(np.array([c.bookmark_affinity for c in candidates], dtype=float), 0.0, 1.0)
    reach_fairness = np.array([
        0.15 if c.over_reach_cap else (1.0 if c.unique_reach < 8 else 1.0 / (1.0 + c.unique_reach / 500.0))
        for c in candidates
    ])
    seen = np.array([max(0, c.seen_count) for c in candidates], dtype=float)
    trials = np.maximum(1.0, seen + np.round(10 * complete) + np.round(boost / 0.15))
    wins = np.round(8 * complete) + np.round(2 * (boost / 0.15)) + np.minimum(3, np.array([c.replay_count for c in candidates], dtype=float))
    p = np.clip(wins / trials, 0.0, 1.0)
    z2 = 1.96 ** 2
    denom = 1.0 + z2 / trials
    centre = p + z2 / (2.0 * trials)
    margin = 1.96 * np.sqrt((p * (1.0 - p) + z2 / (4.0 * trials)) / trials)
    wilson = np.clip((centre - margin) / denom, 0.0, 1.0)
    aff = np.stack([lang, emotion, region], axis=1)
    harm = np.clip(3.0 / np.sum(1.0 / np.maximum(aff, 1e-3), axis=1), 0.0, 1.0)
    cold = np.clip(1.0 / (1.0 + 4.0 * np.array([c.author_familiarity for c in candidates], dtype=float)), 0.0, 1.0)
    zipf = np.clip(1.0 / np.log2(2.0 + np.array([c.unique_reach for c in candidates], dtype=float)), 0.0, 1.0)
    info = np.clip(1.0 - text, 0.0, 1.0)
    odds = np.clip(np.exp(complete) / (np.exp(complete) + np.exp(np.minimum(1.0, seen / 8.0))), 0.0, 1.0)
    half_list: list[float] = []
    now = datetime.now(timezone.utc)
    for c in candidates:
        try:
            ts = datetime.fromisoformat(c.created_at.replace("Z", "+00:00"))
            hours = max(0.0, (now - ts).total_seconds() / 3600.0)
            half_list.append(float(math.pow(0.5, hours / 14.0)))
        except ValueError:
            half_list.append(0.3)
    half = np.clip(np.array(half_list, dtype=float), 0.0, 1.0)
    matrix = np.column_stack([
        recency, source, graph, duration, text,
        np.clip([c.search_similarity for c in candidates], 0, 1), boost, replay, lang, emotion,
        region, share, complete, bookmark,
        np.clip([c.reply_affinity for c in candidates], 0, 1),
        np.clip([c.author_familiarity for c in candidates], 0, 1),
        np.clip([np.log1p(c.seen_count) / np.log(6) for c in candidates], 0, 1),
        np.clip([c.reaction_affinity for c in candidates], 0, 1),
        np.clip([c.comment_affinity for c in candidates], 0, 1),
        np.clip([c.repost_affinity for c in candidates], 0, 1),
        np.clip([c.voice_affinity for c in candidates], 0, 1),
        tod, np.clip([c.category_affinity for c in candidates], 0, 1),
        np.clip([c.novelty for c in candidates], 0, 1),
        [1.0 if c.explore else 0.0 for c in candidates], reach_fairness,
        [1.0 if c.premium_badge else 0.0 for c in candidates],
        np.clip([c.negative_feedback for c in candidates], 0, 1),
        wilson, harm, cold, zipf, info, odds, half,
    ])
    return np.asarray(matrix, dtype=float)


def rank_scores(
    candidates: list[Candidate],
    recent_captions: list[str],
    avg_listen_ms: int,
    follow_edges: list[tuple[str, str]] | None = None,
    viewer_id: str | None = None,
    viewer_lang: str = "",
    viewer_emotion: str = "",
    viewer_region: str = "",
) -> np.ndarray:
    if not candidates:
        return np.zeros(0, dtype=float)
    X = feature_matrix(
        candidates,
        recent_captions,
        avg_listen_ms,
        follow_edges,
        viewer_id,
        viewer_lang,
        viewer_emotion,
        viewer_region,
    )
    return X @ FEATURE_WEIGHTS


def rank_reasons(
    candidates: list[Candidate],
    recent_captions: list[str],
    avg_listen_ms: int,
    follow_edges: list[tuple[str, str]] | None = None,
    viewer_id: str | None = None,
    viewer_lang: str = "",
    viewer_emotion: str = "",
    viewer_region: str = "",
) -> dict[str, list[str]]:
    if not candidates:
        return {}
    matrix = feature_matrix(candidates, recent_captions, avg_listen_ms, follow_edges, viewer_id,
                            viewer_lang, viewer_emotion, viewer_region)
    reasons: dict[str, list[str]] = {}
    for c, row in zip(candidates, matrix):
        positives = [(float(value) * weight, name) for name, value, weight in zip(FACTOR_NAMES, row, FEATURE_WEIGHTS)
                     if weight > 0 and value > 0]
        positives.sort(key=lambda item: (-item[0], item[1]))
        reasons[c.post_id] = [name for _, name in positives[:3]]
    return reasons


def score_candidate(
    c: Candidate,
    recent_captions: list[str],
    avg_listen_ms: int,
    viewer_lang: str = "",
    viewer_emotion: str = "",
    viewer_region: str = "",
) -> float:
    return float(
        rank_scores([c], recent_captions, avg_listen_ms, None, None, viewer_lang, viewer_emotion, viewer_region)[0]
    )


def _diversify(candidates: list[Candidate], order: np.ndarray) -> list[int]:
    remaining = [int(i) for i in order]
    picked: list[int] = []
    last_author: str | None = None
    while remaining:
        pick = 0
        if last_author is not None:
            for i, idx in enumerate(remaining):
                if candidates[idx].author_id != last_author:
                    pick = i
                    break
        chosen = remaining.pop(pick)
        picked.append(chosen)
        last_author = candidates[chosen].author_id
    return picked


def rank_candidates(
    candidates: list[Candidate],
    recent_captions: list[str],
    avg_listen_ms: int,
    follow_edges: list[tuple[str, str]] | None = None,
    viewer_id: str | None = None,
    viewer_lang: str = "",
    viewer_emotion: str = "",
    viewer_region: str = "",
) -> list[str]:
    scores = rank_scores(
        candidates,
        recent_captions,
        avg_listen_ms,
        follow_edges,
        viewer_id,
        viewer_lang,
        viewer_emotion,
        viewer_region,
    )
    order = np.argsort(-scores)
    mixed = _diversify(candidates, order)
    seen: set[str] = set()
    out: list[str] = []
    for i in mixed:
        pid = candidates[i].post_id
        if pid in seen:
            continue
        seen.add(pid)
        out.append(pid)
    return out


def rank_candidates_with_reasons(
    candidates: list[Candidate],
    recent_captions: list[str],
    avg_listen_ms: int,
    follow_edges: list[tuple[str, str]] | None = None,
    viewer_id: str | None = None,
    viewer_lang: str = "",
    viewer_emotion: str = "",
    viewer_region: str = "",
) -> tuple[list[str], dict[str, list[str]]]:
    ids = rank_candidates(candidates, recent_captions, avg_listen_ms, follow_edges, viewer_id,
                          viewer_lang, viewer_emotion, viewer_region)
    return ids, rank_reasons(candidates, recent_captions, avg_listen_ms, follow_edges, viewer_id,
                             viewer_lang, viewer_emotion, viewer_region)
