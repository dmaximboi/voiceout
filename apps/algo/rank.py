from __future__ import annotations

from datetime import datetime, timezone

import numpy as np
from pydantic import BaseModel

from graphfeat import proximity_from_edges, source_score
from lang import detect_lang, lang_affinity
from geo import detect_region, region_affinity
from sentiment import emotion_affinity
from textsim import cosine_to_user, item_texts

# recency, graph, listen-duration, text, comments,
# replay (cap 3), lang, emotion, share-graph, complete-listen, region, bookmark
FEATURE_WEIGHTS = np.array(
    [0.14, 0.26, 0.11, 0.09, 0.04, 0.06, 0.07, 0.05, 0.05, 0.04, 0.06, 0.03],
    dtype=float,
)


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
    recency = np.array([_recency(c.created_at) for c in candidates], dtype=float)
    source = np.array([source_score(c.source) for c in candidates], dtype=float)
    if follow_edges and viewer_id:
        prox = proximity_from_edges(viewer_id, [c.author_id for c in candidates], follow_edges)
        source = np.maximum(source, np.array([prox[c.author_id] for c in candidates], dtype=float))
    duration = _duration_scores(np.array([c.duration_ms for c in candidates], dtype=float), avg_listen_ms)
    text = cosine_to_user(
        item_texts([c.caption for c in candidates], [c.transcript for c in candidates]),
        recent_texts,
    )
    if text.shape[0] != n:
        text = np.full(n, 0.2, dtype=float)
    boost = np.clip(0.2 + 0.15 * np.array([c.comment_boost for c in candidates], dtype=float), 0.0, 1.0)
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
    matrix = np.column_stack(
        [recency, source, duration, text, boost, replay, lang, emotion, share, complete, region, bookmark]
    )
    cap = np.array([0.18 if c.over_reach_cap and c.source in {"public", "trending"} else 1.0 for c in candidates])
    discovery = np.array(
        [1.08 if (c.source in {"public", "lang_match", "region_match"} and c.unique_reach < 8) else 1.0 for c in candidates]
    )
    return matrix * cap[:, None] * discovery[:, None]


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
