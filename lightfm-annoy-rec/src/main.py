"""FastAPI inference service for the LightFM + Annoy recommender.

Run it with:

    uvicorn src.main:app --host 0.0.0.0 --port 8080

The Annoy index is opened memory-mapped, so resident memory stays far below the
2 GB budget even with a large index.
"""

from __future__ import annotations

import sys
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Query

from . import config
from .store import IndexUnavailable, get_store

store = get_store()


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        store.load()
    except IndexUnavailable as exc:
        # Stay up and report "unavailable" so the platform can fall back instead of
        # treating the whole recommendation stack as broken.
        store.load_errors.append(str(exc))
    yield


app = FastAPI(
    title="ani_gui LightFM + Annoy recommender",
    description="Item-to-item and user-to-item recommendations served from a memory-mapped Annoy index.",
    version="1.0.0",
    lifespan=lifespan,
)


def _require_ready() -> None:
    if not store.ready:
        detail = "; ".join(store.load_errors) or "index artifacts are not loaded"
        raise HTTPException(status_code=503, detail=detail)


def _parse_exclude(raw: Optional[str]):
    if not raw:
        return []
    return [part for part in (chunk.strip() for chunk in raw.split(",")) if part]


@app.get("/healthz")
def healthz() -> dict:
    status = "ok" if store.ready else "unavailable"
    return {"status": status, **store.stats()}


@app.get("/api/v1/stats")
def stats() -> dict:
    return store.stats()


@app.post("/api/v1/reload")
def reload_index() -> dict:
    """Re-reads the artifacts after a retrain (cheap: mmap, no full index read)."""
    try:
        store.load()
    except IndexUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return {"status": "reloaded", **store.stats()}


@app.get("/api/v1/recommend/user/{user_id}")
def recommend_for_user(user_id: str, k: int = Query(config.DEFAULT_K, ge=1, le=100),
                       exclude: str = Query("", description="comma separated video ids to skip")) -> dict:
    _require_ready()
    items, strategy = store.recommend_for_user(user_id, k=k, exclude=_parse_exclude(exclude))
    return {
        "user_id": user_id,
        "strategy": strategy,
        "backend": store.backend,
        "count": len(items),
        "items": [{"video_id": video_id, "score": round(score, 6)} for video_id, score in items],
    }


@app.get("/api/v1/recommend/{video_id}")
def recommend_similar(video_id: str, k: int = Query(config.DEFAULT_K, ge=1, le=100),
                      exclude: str = Query("", description="comma separated video ids to skip")) -> dict:
    _require_ready()
    try:
        items = store.similar_items(video_id, k=k, exclude=_parse_exclude(exclude))
    except IndexUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    if not items:
        raise HTTPException(status_code=404, detail="unknown video id: " + str(video_id))
    return {
        "video_id": video_id,
        "backend": store.backend,
        "count": len(items),
        "items": [{"video_id": candidate, "score": round(score, 6)} for candidate, score in items],
    }


def run() -> None:
    import uvicorn

    uvicorn.run("src.main:app", host=config.HOST, port=config.PORT, log_level="info")


if __name__ == "__main__":
    sys.exit(run())
