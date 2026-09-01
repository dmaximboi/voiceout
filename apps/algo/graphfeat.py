"""Social-graph features.

networkx is the library to grow: PageRank, common neighbors, shortest path.
Today the API already labels hop type on each candidate (`source`).
Pass `follow_edges` later and this module can score live graph distance.
"""

from __future__ import annotations

import networkx as nx

# Viewer → people they follow → people those people just touched.
HOP_SCORE = {
    "graph_interact": 1.0,
    "graph_extended": 0.72,
    "listen_author": 0.8,
    "following": 0.48,
    "fof": 0.4,
    "follower": 0.38,
    "comment_affinity": 0.42,
    "emotion_match": 0.36,
    "lang_match": 0.26,
    "region_match": 0.28,
    "trending": 0.32,
    "share_graph": 0.94,
    "public": 0.18,
}


def source_score(source: str) -> float:
    return HOP_SCORE.get(source, 0.2)


def proximity_from_edges(
    viewer: str,
    author_ids: list[str],
    edges: list[tuple[str, str]],
) -> dict[str, float]:
    """edges are (follower, followee). Closer authors rank higher."""
    out = {a: 0.0 for a in author_ids}
    if not viewer or not edges:
        return out
    graph = nx.DiGraph()
    graph.add_edges_from(edges)
    if viewer not in graph:
        return out
    lengths = nx.single_source_shortest_path_length(graph, viewer, cutoff=3)
    for author in author_ids:
        hops = lengths.get(author)
        if hops is None or hops <= 0:
            continue
        out[author] = max(out[author], 1.0 / hops)
    return out
