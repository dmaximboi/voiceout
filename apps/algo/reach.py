"""Distribution cap so one voice cannot blanket the whole user base.

Under 300 live users there is no cap (random fill if nothing matches).
From 300 → 800 the cap eases in toward 2/5 of users.
Above 800 the 2/5 slowly shrinks — not aggressive.
"""

from __future__ import annotations


def reach_fraction(user_count: int) -> float:
    n = max(0, int(user_count))
    if n < 300:
        return 1.0
    if n <= 800:
        t = (n - 300) / 500.0
        return 1.0 - t * 0.6
    return max(0.28, 0.4 * (800 / n) ** 0.12)


def over_reach_cap(unique_reach: int, user_count: int) -> bool:
    n = max(0, int(user_count))
    if n < 300:
        return False
    return unique_reach >= reach_fraction(n) * n


def time_decay(hours: float, gravity: float = 1.55) -> float:
    """Hacker News / Reddit-style: a hot post cools even if raw counts stay high."""
    return 1.0 / ((max(hours, 0.0) + 2.0) ** gravity)
