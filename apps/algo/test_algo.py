from rank import Candidate, rank_candidates, score_candidate
from sentiment import mix_entropy, dominant_label, label_text, label_comment, emotion_affinity
from lang import detect_lang, lang_affinity
from reach import reach_fraction, time_decay, over_reach_cap


def test_rank_prefers_graph_over_following():
    graph = Candidate(
        post_id="c",
        author_id="3",
        caption="hello",
        duration_ms=60000,
        created_at="2099-01-01T00:00:00+00:00",
        source="graph_interact",
    )
    following = Candidate(
        post_id="b",
        author_id="1",
        caption="hello",
        duration_ms=60000,
        created_at="2099-01-01T00:00:00+00:00",
        source="following",
    )
    ids = rank_candidates([following, graph], [], 60000)
    assert ids[0] == "c"


def test_rank_prefers_following():
    following = Candidate(
        post_id="a",
        author_id="1",
        caption="hello world voice",
        duration_ms=60000,
        created_at="2099-01-01T00:00:00+00:00",
        source="following",
    )
    public = Candidate(
        post_id="b",
        author_id="2",
        caption="hello world voice",
        duration_ms=60000,
        created_at="2099-01-01T00:00:00+00:00",
        source="public",
    )
    ids = rank_candidates([public, following], [], 90000)
    assert ids[0] == "a"


def test_long_duration_downranked():
    short = Candidate(
        post_id="s",
        author_id="1",
        caption="hi",
        duration_ms=30000,
        created_at="2099-01-01T00:00:00+00:00",
        source="following",
    )
    long = Candidate(
        post_id="l",
        author_id="1",
        caption="hi",
        duration_ms=30 * 60 * 1000,
        created_at="2099-01-01T00:00:00+00:00",
        source="following",
    )
    assert score_candidate(short, [], 90000) > score_candidate(long, [], 90000)


def test_diverse_entropy_high():
    labels = ["happy", "sad", "anger", "fear", "surprise", "neutral"]
    assert mix_entropy(labels) > 0.7


def test_dominant_happy():
    lab, share = dominant_label(["happy", "happy", "happy", "sad"])
    assert lab == "happy"
    assert share == 0.75


def test_label_happy_text():
    assert label_text("I love this so much, amazing and wonderful!") == "happy"


def test_tfidf_prefers_matching_transcript():
    liked = Candidate(
        post_id="match",
        author_id="1",
        caption="jumuah",
        transcript="friday prayer peace jumuah mubarak",
        duration_ms=60000,
        created_at="2099-01-01T00:00:00+00:00",
        source="public",
    )
    other = Candidate(
        post_id="other",
        author_id="2",
        caption="traffic",
        transcript="cars horns downtown commute",
        duration_ms=60000,
        created_at="2099-01-01T00:00:00+00:00",
        source="public",
    )
    ids = rank_candidates([other, liked], ["jumuah mubarak friday prayer"], 60000)
    assert ids[0] == "match"


def test_graph_proximity_one_hop():
    from graphfeat import proximity_from_edges

    scores = proximity_from_edges(
        "A",
        ["B", "C", "Z"],
        [("A", "B"), ("B", "C")],
    )
    assert scores["B"] > scores["C"] > scores["Z"]


def test_transcribe_url_allowlist(monkeypatch):
    from transcribe import allowed_media_url

    monkeypatch.setenv("S3_ENDPOINT", "http://minio:9000")
    monkeypatch.setenv("TRANSCRIBE_URL_HOSTS", "minio,localhost")
    assert allowed_media_url("http://minio:9000/voiceout/o/a.webm")
    assert not allowed_media_url("http://169.254.169.254/latest/meta-data/")
    assert not allowed_media_url("file:///etc/passwd")
    assert not allowed_media_url("https://evil.example/audio")


def test_trending_dies_with_age():
    assert time_decay(1) > time_decay(24) > time_decay(72)


def test_sad_cools_slower_than_viral():
    assert time_decay(12, 1.15) > time_decay(12, 1.55)


def test_replay_caps_at_three():
    a = Candidate(
        post_id="a",
        author_id="1",
        caption="hi",
        duration_ms=60000,
        created_at="2099-01-01T00:00:00+00:00",
        source="public",
        replay_count=3,
    )
    b = Candidate(
        post_id="b",
        author_id="1",
        caption="hi",
        duration_ms=60000,
        created_at="2099-01-01T00:00:00+00:00",
        source="public",
        replay_count=9,
    )
    assert score_candidate(a, [], 60000) == score_candidate(b, [], 60000)


def test_three_replays_beat_zero():
    replayed = Candidate(
        post_id="r",
        author_id="1",
        caption="hi",
        duration_ms=60000,
        created_at="2099-01-01T00:00:00+00:00",
        source="public",
        replay_count=3,
    )
    once = Candidate(
        post_id="o",
        author_id="1",
        caption="hi",
        duration_ms=60000,
        created_at="2099-01-01T00:00:00+00:00",
        source="public",
        replay_count=0,
    )
    assert score_candidate(replayed, [], 60000) > score_candidate(once, [], 60000)


def test_reach_cap_kicks_in_at_300():
    assert reach_fraction(50) == 1.0
    assert abs(reach_fraction(800) - 0.4) < 1e-6
    assert reach_fraction(3000) < reach_fraction(800)
    assert reach_fraction(3000) >= 0.28
    assert not over_reach_cap(10, 50)
    assert over_reach_cap(400, 800)


def test_french_and_hausa_match():
    assert detect_lang("pour les gens dans la ville avec vous") == "fr"
    assert detect_lang("wannan kuma amma don suna yake ita") == "ha"
    assert lang_affinity("fr", "fr") > lang_affinity("fr", "ha")


def test_comment_emoji_and_sticker():
    assert label_comment("", "laugh") == "happy"
    assert label_comment("so good 😂") == "happy"
    assert label_comment("", "sad") == "sad"


def test_laugh_viewer_prefers_happy_comments():
    happy = Candidate(
        post_id="h",
        author_id="1",
        caption="hi",
        duration_ms=60000,
        created_at="2099-01-01T00:00:00+00:00",
        source="public",
        emotion="happy",
    )
    angry = Candidate(
        post_id="a",
        author_id="2",
        caption="hi",
        duration_ms=60000,
        created_at="2099-01-01T00:00:00+00:00",
        source="public",
        emotion="anger",
    )
    ids = rank_candidates([angry, happy], [], 60000, None, None, "", "haha")
    assert ids[0] == "h"
    assert emotion_affinity("haha", "happy") > emotion_affinity("haha", "sad")


def test_share_graph_ranks_above_public():
    shared = Candidate(
        post_id="s",
        author_id="9",
        caption="hi",
        duration_ms=60000,
        created_at="2099-01-01T00:00:00+00:00",
        source="share_graph",
    )
    pub = Candidate(
        post_id="p",
        author_id="8",
        caption="hi",
        duration_ms=60000,
        created_at="2099-01-01T00:00:00+00:00",
        source="public",
    )
    ids = rank_candidates([pub, shared], [], 60000)
    assert ids[0] == "s"


def test_same_language_ranks_above_mismatch():
    fr = Candidate(
        post_id="fr",
        author_id="1",
        caption="pour les gens dans la ville avec vous",
        duration_ms=60000,
        created_at="2099-01-01T00:00:00+00:00",
        source="public",
        lang="fr",
    )
    ha = Candidate(
        post_id="ha",
        author_id="2",
        caption="wannan kuma amma don suna yake ita",
        duration_ms=60000,
        created_at="2099-01-01T00:00:00+00:00",
        source="public",
        lang="ha",
    )
    ids = rank_candidates([ha, fr], [], 60000, None, None, "fr")
    assert ids[0] == "fr"


def test_region_from_bio_and_caption():
    from geo import detect_region, infer_geo, region_affinity

    assert detect_region("from Lagos, Nigeria") == "NG"
    assert detect_region("je vis a Paris") == "FR"
    assert infer_geo("wannan kuma amma don suna yake ita")["lang"] == "ha"
    assert region_affinity("NG", "NG") > region_affinity("NG", "FR")


def test_same_region_ranks_above_mismatch():
    home = Candidate(
        post_id="ng",
        author_id="1",
        caption="lagos night",
        duration_ms=60000,
        created_at="2099-01-01T00:00:00+00:00",
        source="public",
        region="NG",
    )
    away = Candidate(
        post_id="fr",
        author_id="2",
        caption="paris night",
        duration_ms=60000,
        created_at="2099-01-01T00:00:00+00:00",
        source="public",
        region="FR",
    )
    ids = rank_candidates([away, home], [], 60000, None, None, "", "", "NG")
    assert ids[0] == "ng"

