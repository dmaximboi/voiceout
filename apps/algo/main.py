from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from rank import Candidate, rank_candidates_with_reasons
from transcribe import transcribe_payload
from geo import infer_geo
from lang import detect_lang
from sentiment import classify_comment
from trending import load_signals, load_trending, recompute_trending

app = FastAPI(title="VoiceOut algo", version="1.0.0")


def require_token(authorization: str | None = Header(default=None)) -> None:
    import hmac
    import os

    expected = os.environ.get("ALGO_SERVICE_TOKEN", "")
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not expected or len(token) != len(expected) or not hmac.compare_digest(token, expected):
        raise HTTPException(status_code=403, detail="Forbidden")


class RankIn(BaseModel):
    user_id: str | None = None
    candidates: list[Candidate]
    recent_captions: list[str] = Field(default_factory=list)
    avg_listen_ms: int = 90_000
    follow_edges: list[tuple[str, str]] = Field(default_factory=list)
    viewer_lang: str = ""
    viewer_emotion: str = ""
    viewer_region: str = ""
    user_count: int = 0


class RankOut(BaseModel):
    post_ids: list[str]
    rank_reasons: dict[str, list[str]] = Field(default_factory=dict)


class TranscribeIn(BaseModel):
    post_id: str
    caption: str = ""
    draft_transcript: str = ""
    download_url: str | None = None


class ClassifyIn(BaseModel):
    body: str = Field(default="", max_length=500)
    sticker_id: str | None = Field(default=None, max_length=32)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "algo"}


@app.post("/v1/rank", response_model=RankOut)
def rank(payload: RankIn, _: None = Depends(require_token)) -> RankOut:
    try:
        signals = load_signals()
    except Exception:
        signals = {}
    viewer_lang = payload.viewer_lang or detect_lang(*payload.recent_captions[:12])
    merged: list[Candidate] = []
    for c in payload.candidates:
        sig = signals.get(c.post_id) or {}
        data = c.model_dump()
        if not data.get("emotion"):
            data["emotion"] = sig.get("emotion") or ""
        if not data.get("lang"):
            data["lang"] = sig.get("lang") or ""
        if not data.get("region"):
            data["region"] = sig.get("region") or ""
        if not data.get("prior_share_boost"):
            data["prior_share_boost"] = float(sig.get("prior_share_boost") or 0)
        if not data.get("over_reach_cap"):
            data["over_reach_cap"] = bool(sig.get("over_cap"))
        if not data.get("complete_listen"):
            reach = float(sig.get("unique_reach") or 0)
            completes = float(sig.get("completes") or 0)
            data["complete_listen"] = (completes / reach) if reach else 0.0
        merged.append(Candidate(**data))
    ids, reasons = rank_candidates_with_reasons(
        merged,
        payload.recent_captions,
        payload.avg_listen_ms,
        payload.follow_edges or None,
        payload.user_id,
        viewer_lang,
        payload.viewer_emotion,
        payload.viewer_region,
    )
    return RankOut(post_ids=ids, rank_reasons=reasons)


class GeoIn(BaseModel):
    text: str = ""


@app.post("/v1/geo")
def geo(payload: GeoIn, _: None = Depends(require_token)) -> dict:
    return infer_geo(payload.text)


@app.post("/v1/classify")
def classify(payload: ClassifyIn, _: None = Depends(require_token)) -> dict:
    result = classify_comment(payload.body, payload.sticker_id)
    return {
        "primary": result.primary,
        "secondary": result.secondary,
        "confidence": result.confidence,
    }


@app.post("/v1/transcribe")
def transcribe(payload: TranscribeIn, _: None = Depends(require_token)) -> dict:
    result = transcribe_payload(payload.caption, payload.draft_transcript, payload.download_url)
    return {"post_id": payload.post_id, **result}


@app.get("/v1/trending")
def trending(_: None = Depends(require_token)) -> dict:
    return {"post_ids": load_trending()}


@app.post("/v1/trending/recompute")
def recompute(_: None = Depends(require_token)) -> dict:
    ids = recompute_trending()
    return {"post_ids": ids, "count": len(ids)}
