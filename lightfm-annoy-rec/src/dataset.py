"""Real user<->video interaction extraction for the ani_gui platform.

The platform does not keep a classic interactions table. What it does keep is the
per-user profile store:

    <platform-data>/users/<username>.json
        { "favorites":    [ { "id": 21, "genres": [...] }, ... ],
          "watchHistory": [ { "anime": { "id": 214968 }, "episode": 3,
                              "timestamp": 1791818855828 }, ... ] }

This module turns that (optionally also a SQLite database) into weighted
(user_id, video_id, weight) triples that LightFM can consume.
"""

from __future__ import annotations

import glob
import json
import os
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from .idmap import canonical_id

FAVORITE_WEIGHT = 3.5          # explicit positive signal
WATCH_BASE_WEIGHT = 2.5        # implicit signal
MAX_HISTORY_PER_USER = 2000

_ID_COLUMN_HINTS = ("video_id", "videoid", "anime_id", "animeid", "item_id", "itemid",
                    "item", "movie_id", "movieid", "media_id", "mediaid", "content_id")
_USER_COLUMN_HINTS = ("user_id", "userid", "user", "username", "uid", "account_id", "accountid")
_WEIGHT_COLUMN_HINTS = ("weight", "rating", "score", "count", "views", "play_count")
_TIME_COLUMN_HINTS = ("timestamp", "created_at", "createdat", "updated_at", "watched_at", "time")


@dataclass(frozen=True)
class Interaction:
    user_id: str
    video_id: str
    weight: float
    source: str


def _recency_factor(age_days: float) -> float:
    """Mirrors server/services/recommendation.js so both paths agree on freshness."""
    if age_days <= 1:
        return 1.25
    if age_days <= 7:
        return 1.0
    if age_days <= 30:
        return 0.75
    return 0.5


def _extract_id(entry: dict) -> Optional[str]:
    if not isinstance(entry, dict):
        return None
    for key in ("id", "animeId", "anime_id", "videoId", "video_id", "mediaId"):
        value = entry.get(key)
        if value is not None and canonical_id(value):
            return canonical_id(value)
    return None


def iter_user_profiles(platform_data_dir: Path, users_glob: str = "users/*.json") -> Iterable[Tuple[str, dict]]:
    """Yields (username, profile) for every profile JSON under the platform data dir."""
    base = Path(platform_data_dir)
    pattern = str(base / users_glob)
    for file_path in sorted(glob.glob(pattern)):
        name = Path(file_path).name
        if name.endswith(".bak") or ".bak." in name:
            continue
        try:
            payload = json.loads(Path(file_path).read_text(encoding="utf-8"))
        except Exception:
            continue
        username = canonical_id(payload.get("username") or Path(file_path).stem)
        yield username, payload


def interactions_from_profile(username: str, profile: dict, now_ms: Optional[int] = None,
                              include_history: bool = True) -> List[Interaction]:
    now_ms = now_ms or int(time.time() * 1000)
    found: List[Interaction] = []

    for favorite in profile.get("favorites") or []:
        video_id = _extract_id(favorite)
        if video_id:
            found.append(Interaction(username, video_id, FAVORITE_WEIGHT, "favorite"))

    if include_history:
        history = list(profile.get("watchHistory") or [])[-MAX_HISTORY_PER_USER:]
        for entry in history:
            anime = entry.get("anime") if isinstance(entry, dict) else None
            video_id = _extract_id(anime or {})
            if not video_id:
                continue
            timestamp = entry.get("timestamp")
            try:
                age_days = max(0.0, (now_ms - int(timestamp)) / 86_400_000) if timestamp else 365.0
            except (TypeError, ValueError):
                age_days = 365.0
            try:
                episode = max(1, int(entry.get("episode") or 1))
            except (TypeError, ValueError):
                episode = 1
            episode_boost = min(1.0, (episode - 1) * 0.1)
            weight = (WATCH_BASE_WEIGHT * _recency_factor(age_days)) + episode_boost
            found.append(Interaction(username, video_id, round(weight, 4), "history"))

    return found


def load_interactions(platform_data_dir: Path, users_glob: str = "users/*.json",
                      include_history: bool = True) -> Tuple[List[Interaction], dict]:
    """Reads every profile and aggregates duplicate (user, item) pairs."""
    aggregated: Dict[Tuple[str, str], Interaction] = {}
    profiles = 0
    for username, profile in iter_user_profiles(platform_data_dir, users_glob):
        profiles += 1
        for interaction in interactions_from_profile(username, profile, include_history=include_history):
            key = (interaction.user_id, interaction.video_id)
            previous = aggregated.get(key)
            if previous is None or interaction.weight > previous.weight:
                aggregated[key] = interaction
    stats = {
        "profiles": profiles,
        "unique_pairs": len(aggregated),
        "platform_data_dir": str(Path(platform_data_dir).resolve()),
    }
    return list(aggregated.values()), stats


def _pick_column(columns: Sequence[str], hints: Sequence[str]) -> Optional[str]:
    lowered = {c.lower(): c for c in columns}
    for hint in hints:
        if hint in lowered:
            return lowered[hint]
    for lowered_name, original in lowered.items():
        for hint in hints:
            if hint in lowered_name:
                return original
    return None


def load_interactions_from_sqlite(db_path: Path) -> List[Interaction]:
    """Best-effort reader for deployments that keep interactions in SQLite.

    Any table exposing a user-like and an item-like column is accepted; an optional
    weight/time column refines the weight. Returns [] when nothing suitable exists.
    """
    path = Path(db_path)
    if not path.exists():
        return []
    found: List[Interaction] = []
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        rows = connection.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table','view')"
        ).fetchall()
        for (table_name,) in rows:
            if table_name.startswith("sqlite_"):
                continue
            try:
                columns = [row[1] for row in connection.execute(f'PRAGMA table_info("{table_name}")')]
            except sqlite3.Error:
                continue
            item_column = _pick_column(columns, _ID_COLUMN_HINTS)
            user_column = _pick_column(columns, _USER_COLUMN_HINTS)
            if not item_column or not user_column:
                continue
            weight_column = _pick_column(columns, _WEIGHT_COLUMN_HINTS)
            select_weight = f', "{weight_column}"' if weight_column else ""
            query = f'SELECT "{user_column}", "{item_column}"{select_weight} FROM "{table_name}"'
            try:
                for record in connection.execute(query):
                    user_id = canonical_id(record[0])
                    video_id = canonical_id(record[1])
                    if not user_id or not video_id:
                        continue
                    weight = FAVORITE_WEIGHT
                    if weight_column:
                        try:
                            weight = max(1.0, float(record[2]))
                        except (TypeError, ValueError):
                            weight = FAVORITE_WEIGHT
                    found.append(Interaction(user_id, video_id, weight, f"sqlite:{table_name}"))
            except sqlite3.Error:
                continue
    finally:
        connection.close()
    return found


def synthesize_interactions(n_users: int = 40, n_items: int = 120, per_user: int = 12,
                            seed: int = 42) -> List[Interaction]:
    """Deterministic fake data so the pipeline can be exercised without a live platform."""
    import random

    rng = random.Random(seed)
    # Latent taste clusters: users in a cluster prefer that cluster's items.
    clusters = 4
    item_cluster = {i: i % clusters for i in range(n_items)}
    found: List[Interaction] = []
    for user in range(n_users):
        cluster = user % clusters
        pool = [i for i in range(n_items) if item_cluster[i] == cluster]
        others = [i for i in range(n_items) if item_cluster[i] != cluster]
        rng.shuffle(pool)
        rng.shuffle(others)
        liked = pool[:per_user]
        liked.append(others[0])  # a little cross-cluster noise
        for item in liked:
            found.append(Interaction(f"user{user}", f"video{item}", rng.uniform(1.0, 4.0), "synthetic"))
    return found
