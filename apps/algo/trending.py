from __future__ import annotations
import json
import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import psycopg
import redis
from lang import detect_lang
from geo import detect_region
from reach import over_reach_cap, time_decay
from sentiment import REACTION_TO_SENTIMENT, dominant_label, label_comment, mix_entropy
REDIS_KEY = "voiceout:trending:ids"
REDIS_SIGNALS = "voiceout:post_signals"
LONG_HOURS = 24
DIVERSITY_CUTOFF = 0.72
RHYME_CUTOFF = 0.58

def _conn() -> psycopg.Connection:
    url = os.environ.get("DATABASE_OWNER_URL") or os.environ["DATABASE_URL"]
    return psycopg.connect(url)

def _redis() -> redis.Redis:
    return redis.Redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379"), decode_responses=True)

def load_trending() -> list[str]:
    raw = _redis().get(REDIS_KEY)
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return list(data)
    except json.JSONDecodeError:
        return []

def load_signals() -> dict[str, dict]:
    raw = _redis().get(REDIS_SIGNALS)
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}

def _hours_ago(ts: datetime, now: datetime) -> float:
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return max(0.0, (now - ts).total_seconds() / 3600.0)

def recompute_trending() -> list[str]:
    now = datetime.now(timezone.utc)
    long_since = now - timedelta(hours=LONG_HOURS)
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("select count(*) from users where deleted_at is null")
            user_count = int(cur.fetchone()[0])
            cur.execute(
                """
                select p.id, p.author_id, p.caption, p.transcript, p.created_at, p.lang, p.region
                from posts p
                where p.status = 'published' and p.created_at > %s
                """,
                (long_since,),
            )
            post_rows = cur.fetchall()
            cur.execute(
                """
                select c.post_id, c.body, c.sticker_id, c.created_at
                from comments c
                join posts p on p.id = c.post_id
                where p.status = 'published' and c.created_at > %s
                """,
                (long_since,),
            )
            comments = cur.fetchall()
            cur.execute(
                """
                select r.post_id, r.type, r.created_at
                from post_reactions r
                join posts p on p.id = r.post_id
                where p.status = 'published' and r.created_at > %s
                """,
                (long_since,),
            )
            reactions = cur.fetchall()
            cur.execute(
                """
                select post_id, count(*) from reposts
                where created_at > %s
                group by post_id
                """,
                (long_since,),
            )
            repost_n = {str(pid): int(n) for pid, n in cur.fetchall()}
            cur.execute(
                """
                select post_id, count(*) from share_clicks
                where created_at > %s
                group by post_id
                """,
                (long_since,),
            )
            click_n = {str(pid): int(n) for pid, n in cur.fetchall()}
            cur.execute(
                """
                select post_id,
                       count(distinct user_id)::int as reach,
                       count(*) filter (
                         where duration_ms > 0 and listened_ms >= duration_ms * 0.85
                       )::int as completes
                from listen_events
                where created_at > %s
                group by post_id
                """,
                (long_since,),
            )
            listen_stats = {
                str(pid): {"reach": int(reach), "completes": int(comp)} for pid, reach, comp in cur.fetchall()
            }
            rise_since = now - timedelta(hours=3)
            cur.execute(
                """
                select post_id, count(*)::int
                from listen_events
                where created_at > %s
                group by post_id
                """,
                (rise_since,),
            )
            rising = {str(pid): int(n) for pid, n in cur.fetchall()}
            cur.execute(
                """
                select author_id, id, created_at
                from posts
                where status = 'published'
                order by author_id, created_at desc
                """
            )
            latest_by_author: dict[str, str] = {}
            prev_by_author: dict[str, str] = {}
            for author_id, pid, _created in cur.fetchall():
                a = str(author_id)
                p = str(pid)
                if a not in latest_by_author:
                    latest_by_author[a] = p
                elif a not in prev_by_author:
                    prev_by_author[a] = p
    posts = {
        str(pid): {
            "author_id": str(author_id),
            "caption": caption or "",
            "transcript": transcript or "",
            "created_at": created_at,
            "lang": (lang or "") if lang else detect_lang(caption or "", transcript or ""),
            "region": (region or "") if region else "",
        }
        for pid, author_id, caption, transcript, created_at, lang, region in post_rows
    }
    for meta in posts.values():
        if not meta["region"]:
            meta["region"] = detect_region(meta["caption"], meta["transcript"], lang=meta["lang"])
    langs_to_store = [(meta["lang"], pid) for pid, meta in posts.items() if meta["lang"]]
    regions_to_store = [(meta["region"], pid) for pid, meta in posts.items() if meta["region"]]
    if langs_to_store or regions_to_store:
        with _conn() as conn:
            with conn.cursor() as cur:
                for lang, pid in langs_to_store:
                    cur.execute(
                        "update posts set lang = %s where id = %s and (lang is null or lang = '')",
                        (lang, pid),
                    )
                for region, pid in regions_to_store:
                    cur.execute(
                        "update posts set region = %s where id = %s and (region is null or region = '')",
                        (region, pid),
                    )
            conn.commit()
    long_labels: dict[str, list[str]] = defaultdict(list)
    comment_labels: dict[str, list[str]] = defaultdict(list)
    first_event: dict[str, tuple[datetime, str, str]] = {}
    for post_id, body, sticker_id, created_at in comments:
        pid = str(post_id)
        lab = label_comment(body or "", sticker_id)
        long_labels[pid].append(lab)
        comment_labels[pid].append(lab)
        prev = first_event.get(pid)
        if prev is None or created_at < prev[0]:
            first_event[pid] = (created_at, "comment", lab)
    for post_id, rtype, created_at in reactions:
        pid = str(post_id)
        lab = REACTION_TO_SENTIMENT.get(str(rtype), "neutral")
        long_labels[pid].append(lab)
        prev = first_event.get(pid)
        if prev is None or created_at < prev[0]:
            first_event[pid] = (created_at, "reaction", lab)
    share_by_post = {pid: repost_n.get(pid, 0) + click_n.get(pid, 0) for pid in set(repost_n) | set(click_n)}
    shares_lists: dict[str, list[int]] = defaultdict(list)
    for pid, meta in posts.items():
        shares_lists[meta["author_id"]].append(share_by_post.get(pid, 0))
    author_avg = {a: (sum(v) / len(v) if v else 0.0) for a, v in shares_lists.items()}
    signals: dict[str, dict] = {}
    scored: list[tuple[float, str]] = []
    for pid, meta in posts.items():
        labels = long_labels.get(pid, [])
        comments_only = comment_labels.get(pid, [])
        ent = mix_entropy(labels) if labels else 1.0
        dom, share = dominant_label(comments_only if comments_only else labels)
        rhyme = bool(dom and share >= RHYME_CUTOFF and len(comments_only) >= 3)
        stats = listen_stats.get(pid, {"reach": 0, "completes": 0})
        unique_reach = stats["reach"]
        completes = stats["completes"]
        shares = share_by_post.get(pid, 0)
        comment_n = len(comments_only)
        react_n = max(0, len(labels) - comment_n)
        first_kind, first_lab = ("", "")
        if pid in first_event:
            first_kind, first_lab = first_event[pid][1], first_event[pid][2]
        raw = (
            comment_n * 1.4
            + react_n * 1.0
            + shares * 1.8
            + completes * 0.35
            + unique_reach * 0.12
            + rising.get(pid, 0) * 0.9
        )
        if rhyme:
            raw += 4.0 * share
        if first_kind == "comment":
            raw += 2.0
        elif first_lab == "happy":
            raw += 0.8
        hours = _hours_ago(meta["created_at"], now)
        gravity = 1.15 if first_lab == "sad" else 1.55
        score = raw * time_decay(hours, gravity)
        latest = latest_by_author.get(meta["author_id"])
        prior_boost = 0.0
        if latest == pid:
            prev_id = prev_by_author.get(meta["author_id"])
            if prev_id:
                prev_shares = share_by_post.get(prev_id, 0)
                avg = author_avg.get(meta["author_id"], 0.0)
                if prev_shares > avg and prev_shares > 0:
                    prior_boost = min(8.0, 6.0 * (prev_shares - avg) / (avg + 1.0))
                    score += prior_boost
        if over_reach_cap(unique_reach, user_count):
            score *= 0.2
        if labels and ent >= DIVERSITY_CUTOFF:
            score *= 0.35
        signals[pid] = {
            "emotion": dom or "",
            "rhyme": rhyme,
            "lang": meta["lang"],
            "region": meta["region"],
            "unique_reach": unique_reach,
            "completes": completes,
            "shares": shares,
            "first_kind": first_kind,
            "first_emotion": first_lab,
            "prior_share_boost": prior_boost,
            "over_cap": over_reach_cap(unique_reach, user_count),
        }
        scored.append((score, pid))
    emotion_updates = [(sig["emotion"], pid) for pid, sig in signals.items() if sig.get("emotion")]
    if emotion_updates:
        with _conn() as conn:
            with conn.cursor() as cur:
                for emotion, pid in emotion_updates:
                    cur.execute("update posts set comment_emotion = %s where id = %s", (emotion, pid))
            conn.commit()
    scored.sort(reverse=True)
    ids = [pid for _, pid in scored[:25]]
    r = _redis()
    r.set(REDIS_KEY, json.dumps(ids), ex=10 * 60)
    r.set(REDIS_SIGNALS, json.dumps(signals), ex=10 * 60)
    if ids:
        with _conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "insert into trending_snapshots (post_ids) values (%s)",
                    (json.dumps(ids),),
                )
            conn.commit()
    return ids
