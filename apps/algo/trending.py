from __future__ import annotations

import json
import math
import os
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

import psycopg
import redis

from geo import detect_region
from lang import detect_lang
from sentiment import classify_comment, dominant_label

REDIS_KEY = "voiceout:trending:ids"
REDIS_SIGNALS = "voiceout:post_signals"
REDIS_KEY_V2 = "voiceout:trending:v2"
REDIS_SIGNALS_V2 = "voiceout:post_signals:v2"
LONG_HOURS = 24

TRENDING_FACTOR_WEIGHTS: dict[str, float] = {
    "velocity": 1.20, "acceleration": 0.85, "unique reach": 0.65,
    "completion rate": 0.80, "replay rate": 0.55, "comments": 0.65,
    "comment likes": 0.35, "reactions": 0.55, "shares": 0.85,
    "bookmarks": 0.60, "voices": 0.55, "reposts": 0.75,
    "follower spread": 0.45, "language spread": 0.20, "region spread": 0.20,
    "category mix": 0.20, "question ratio": 0.20, "informative ratio": 0.20,
    "support ratio": 0.18, "negative ratio": -0.45, "reports": -1.25,
    "freshness": 0.75, "author novelty": 0.28, "prior momentum": 0.35,
    "reach fairness": 0.30, "premium badge": 0.04,
}
TRENDING_FACTOR_NAMES = tuple(TRENDING_FACTOR_WEIGHTS)


def _conn() -> psycopg.Connection:
    return psycopg.connect(os.environ.get("DATABASE_OWNER_URL") or os.environ["DATABASE_URL"])


_redis_client: redis.Redis | None = None


def _redis() -> redis.Redis:
    """Reuse one client — opening a connection per call burns Upstash command budget."""
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.Redis.from_url(
            os.environ.get("REDIS_URL", "redis://localhost:6379"),
            decode_responses=True,
            socket_keepalive=True,
            health_check_interval=60,
        )
    return _redis_client


def _decode_ids(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return [str(value) for value in data]
        if isinstance(data, dict):
            return [str(value) for value in data.get("post_ids", [])]
    except (json.JSONDecodeError, TypeError):
        pass
    return []


def load_trending() -> list[str]:
    r = _redis()
    return _decode_ids(r.get(REDIS_KEY_V2)) or _decode_ids(r.get(REDIS_KEY))


def load_signals() -> dict[str, dict]:
    r = _redis()
    for key in (REDIS_SIGNALS_V2, REDIS_SIGNALS):
        raw = r.get(key)
        if raw:
            try:
                data = json.loads(raw)
                if isinstance(data, dict) and "signals" in data:
                    data = data["signals"]
                if isinstance(data, dict):
                    return data
            except json.JSONDecodeError:
                continue
    return {}


def _log(n: float) -> float:
    return math.log1p(max(0.0, n))


def _ratio(n: float, denominator: float) -> float:
    return max(0.0, min(1.0, n / denominator)) if denominator > 0 else 0.0


def score_trending_factors(factor_values: dict[str, float]) -> float:
    """Score only complete registries so factors cannot silently drift."""
    expected = set(TRENDING_FACTOR_WEIGHTS)
    actual = set(factor_values)
    if actual != expected:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        raise ValueError(f"trending factor mismatch: missing={missing}, extra={extra}")
    return sum(weight * factor_values[name] for name, weight in TRENDING_FACTOR_WEIGHTS.items())


def diversify_trending(scored: list[tuple[float, str]], metadata: dict[str, dict], limit: int = 25) -> list[str]:
    """Deterministic greedy diversity: avoid adjacent authors and repeated categories."""
    remaining = sorted(scored, key=lambda item: (-item[0], item[1]))
    output: list[str] = []
    last_author = ""
    category_counts: Counter[str] = Counter()
    while remaining and len(output) < limit:
        pick = 0
        for index, (_, pid) in enumerate(remaining):
            meta = metadata.get(pid, {})
            author = meta.get("author_id", "")
            category = meta.get("category", "neutral")
            if author != last_author and category_counts[category] <= max(1, len(output) // 4):
                pick = index
                break
        _, pid = remaining.pop(pick)
        output.append(pid)
        last_author = metadata.get(pid, {}).get("author_id", "")
        category_counts[metadata.get(pid, {}).get("category", "neutral")] += 1
    return output


def recompute_trending() -> list[str]:
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=LONG_HOURS)
    recent = now - timedelta(hours=3)
    previous = now - timedelta(hours=6)
    with _conn() as conn, conn.cursor() as cur:
        cur.execute(
            """select p.id, p.author_id, p.caption, p.transcript, p.created_at, p.lang, p.region,
                      false as premium
               from posts p
               where p.status='published' and p.created_at > %s
               order by p.created_at desc limit 1000""",
            (since,),
        )
        post_rows = cur.fetchall()
        if not post_rows:
            return []
        post_ids = [row[0] for row in post_rows]
        author_ids = list({row[1] for row in post_rows})
        cur.execute(
            """select author_id,count(*)::int from posts
               where author_id=any(%s) and status='published' and created_at>%s group by author_id""",
            (author_ids, now - timedelta(days=30)),
        )
        author_post_count = {str(author): int(n) for author, n in cur.fetchall()}
        cur.execute(
            """select p.author_id,count(s.id)::int from posts p join share_clicks s on s.post_id=p.id
               where p.author_id=any(%s) and p.created_at between %s and %s group by p.author_id""",
            (author_ids, since - timedelta(days=7), since),
        )
        prior_author_momentum = {str(author): int(n) for author, n in cur.fetchall()}
        cur.execute(
            """select c.id,c.post_id,c.author_id,c.body,c.sticker_id,c.created_at,count(cl.user_id)::int
               from comments c left join comment_likes cl on cl.comment_id=c.id
               where c.post_id=any(%s) and c.created_at>%s
               group by c.id""",
            (post_ids, since),
        )
        comment_rows = cur.fetchall()
        cur.execute(
            """select post_id,
                count(*)::int listens, count(distinct user_id)::int reach,
                count(*) filter(where created_at>%s)::int recent,
                count(*) filter(where created_at between %s and %s)::int previous,
                count(*) filter(where duration_ms>0 and listened_ms>=duration_ms*.85)::int completes,
                greatest(count(*)-count(distinct user_id),0)::int replays
               from listen_events where post_id=any(%s) and created_at>%s group by post_id""",
            (recent, previous, recent, post_ids, since),
        )
        listen = {str(r[0]): tuple(int(v) for v in r[1:]) for r in cur.fetchall()}

        counts: dict[str, dict[str, int]] = defaultdict(dict)
        for name, query in {
            "reactions": "select post_id,count(*)::int from post_reactions where post_id=any(%s) and created_at>%s group by post_id",
            "shares": "select post_id,count(*)::int from share_clicks where post_id=any(%s) and created_at>%s group by post_id",
            "bookmarks": "select post_id,count(*)::int from bookmarks where post_id=any(%s) and created_at>%s group by post_id",
            "voices": "select post_id,count(*)::int from voices where post_id=any(%s) and created_at>%s group by post_id",
            "reposts": "select post_id,count(*)::int from reposts where post_id=any(%s) and created_at>%s group by post_id",
            "reports": "select target_id,count(*)::int from reports where target_type='post' and target_id=any(%s) and created_at>%s group by target_id",
        }.items():
            cur.execute(query, (post_ids, since))
            for pid, number in cur.fetchall():
                counts[str(pid)][name] = int(number)

        cur.execute(
            """select e.post_id,count(distinct e.user_id)::int,
                      count(distinct coalesce(u.lang,''))::int,count(distinct coalesce(u.region,''))::int
               from user_events e join users u on u.id=e.user_id
               where e.post_id=any(%s) and e.created_at>%s group by e.post_id""",
            (post_ids, since),
        )
        spread = {str(r[0]): tuple(int(v) for v in r[1:]) for r in cur.fetchall()}

        classifications: list[tuple[str, str | None, float, object]] = []
        categories: dict[str, list[str]] = defaultdict(list)
        comment_likes: Counter[str] = Counter()
        comment_authors: dict[str, set[str]] = defaultdict(set)
        for cid, pid_raw, author, body, sticker, _created, likes in comment_rows:
            pid = str(pid_raw)
            result = classify_comment(body or "", sticker)
            classifications.append((result.primary, result.secondary, result.confidence, cid))
            categories[pid].append(result.primary)
            if result.secondary:
                categories[pid].append(result.secondary)
            comment_likes[pid] += int(likes)
            comment_authors[pid].add(str(author))
        if classifications:
            cur.executemany(
                "update comments set category=%s,secondary_category=%s,category_confidence=%s where id=%s",
                classifications,
            )

        metadata: dict[str, dict] = {}
        scored: list[tuple[float, str]] = []
        signals: dict[str, dict] = {}
        for row in post_rows:
            pid, author, caption, transcript, created_at, lang, region, premium = row
            pid, author = str(pid), str(author)
            labels = categories.get(pid, [])
            histogram = dict(Counter(labels))
            primary, _ = dominant_label(labels)
            cur.execute(
                "update posts set comment_categories=%s::jsonb,comment_emotion=%s where id=%s",
                (json.dumps(histogram), primary or "neutral", pid),
            )
            listens, reach, recent_n, previous_n, completes, replays = listen.get(pid, (0, 0, 0, 0, 0, 0))
            total_comments = len(comment_rows) and sum(1 for r in comment_rows if str(r[1]) == pid) or 0
            event_users, lang_spread, region_spread = spread.get(pid, (0, 0, 0))
            c = counts[pid]
            age_hours = max(0.0, (now - created_at).total_seconds() / 3600)
            total_labels = max(1, len(labels))
            negative = sum(histogram.get(x, 0) for x in ("sad", "anger", "fear", "critical", "spam"))
            factor_values = {
                "velocity": _log(recent_n), "acceleration": math.tanh((recent_n - previous_n) / max(1, previous_n)),
                "unique reach": _log(reach), "completion rate": _ratio(completes, listens),
                "replay rate": _ratio(replays, listens), "comments": _log(total_comments),
                "comment likes": _log(comment_likes[pid]), "reactions": _log(c.get("reactions", 0)),
                "shares": _log(c.get("shares", 0)), "bookmarks": _log(c.get("bookmarks", 0)),
                "voices": _log(c.get("voices", 0)), "reposts": _log(c.get("reposts", 0)),
                "follower spread": _log(len(comment_authors[pid]) + event_users),
                "language spread": _log(lang_spread), "region spread": _log(region_spread),
                "category mix": min(1.0, len(histogram) / 6), "question ratio": histogram.get("questioning", 0) / total_labels,
                "informative ratio": histogram.get("informative", 0) / total_labels,
                "support ratio": histogram.get("supportive", 0) / total_labels,
                "negative ratio": negative / total_labels, "reports": _log(c.get("reports", 0)),
                "freshness": math.exp(-age_hours / 18),
                "author novelty": 1 / (1 + author_post_count.get(author, 0) / 5),
                "prior momentum": min(1.0, _log(prior_author_momentum.get(author, 0)) / 3),
                "reach fairness": 1 / (1 + reach / 500), "premium badge": 1.0 if premium else 0.0,
            }
            score = score_trending_factors(factor_values)
            detected_lang = lang or detect_lang(caption or "", transcript or "")
            detected_region = region or detect_region(caption or "", transcript or "", lang=detected_lang)
            metadata[pid] = {"author_id": author, "category": primary or "neutral"}
            signals[pid] = {
                "version": 2, "emotion": primary or "neutral", "categories": histogram,
                "lang": detected_lang, "region": detected_region, "unique_reach": reach,
                "completes": completes, "shares": c.get("shares", 0) + c.get("reposts", 0),
                "over_cap": reach > 500, "factors": factor_values,
            }
            scored.append((score, pid))
        conn.commit()

    ids = diversify_trending(scored, metadata)
    payload = {"version": 2, "computed_at": now.isoformat(), "post_ids": ids}
    signal_payload = {"version": 2, "computed_at": now.isoformat(), "signals": signals}
    r = _redis()
    # v2 only + longer TTL: half the writes, fewer refreshes on Upstash free tier.
    ttl = int(os.environ.get("TRENDING_REDIS_TTL_SEC", "3600"))
    r.set(REDIS_KEY_V2, json.dumps(payload), ex=ttl)
    r.set(REDIS_SIGNALS_V2, json.dumps(signal_payload), ex=ttl)
    if ids:
        with _conn() as conn, conn.cursor() as cur:
            cur.execute("insert into trending_snapshots (post_ids) values (%s::jsonb)", (json.dumps(ids),))
            conn.commit()
    return ids
