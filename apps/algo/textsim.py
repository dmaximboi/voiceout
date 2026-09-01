"""Content similarity for the feed.

HashingVectorizer is the scale path: no shared vocabulary, thread-safe,
constant memory. Later swap n_features or drop in Faiss ANN without
changing rank.py.
"""

from __future__ import annotations

import numpy as np
from sklearn.feature_extraction.text import HashingVectorizer, TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

_hasher = HashingVectorizer(
    n_features=2**14,
    ngram_range=(1, 2),
    alternate_sign=False,
    norm="l2",
    token_pattern=r"(?u)\b\w\w+\b",
)


def item_texts(captions: list[str], transcripts: list[str] | None = None) -> list[str]:
    transcripts = transcripts or [""] * len(captions)
    return [f"{c} {t}".strip() or " " for c, t in zip(captions, transcripts, strict=True)]


def cosine_to_user(item_docs: list[str], user_docs: list[str]) -> np.ndarray:
    """How close each item is to the user's recent language (captions + STT)."""
    n = len(item_docs)
    if n == 0:
        return np.zeros(0, dtype=float)
    if not user_docs or not any(d.strip() for d in user_docs):
        return np.full(n, 0.2, dtype=float)
    corpus = [d if d.strip() else " " for d in [*user_docs, *item_docs]]
    matrix = _hasher.transform(corpus)
    user_n = len(user_docs)
    user_vec = np.asarray(matrix[:user_n].mean(axis=0)).reshape(1, -1)
    sims = cosine_similarity(matrix[user_n:], user_vec)
    return np.clip(sims.ravel().astype(float), 0.0, 1.0)


def keywords_from_text(text: str, top_n: int = 12) -> list[str]:
    blob = (text or "").strip()
    if not blob:
        return []
    try:
        vec = TfidfVectorizer(ngram_range=(1, 2), min_df=1, token_pattern=r"(?u)\b\w\w+\b")
        matrix = vec.fit_transform([blob])
    except ValueError:
        return []
    terms = vec.get_feature_names_out()
    weights = np.asarray(matrix.sum(axis=0)).ravel()
    if weights.size == 0:
        return []
    order = np.argsort(weights)[::-1][:top_n]
    return [str(terms[i]) for i in order if weights[i] > 0]
