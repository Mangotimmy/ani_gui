"""Central configuration for the LightFM + Annoy recommendation service.

Everything is environment driven so the same image runs on a NAS, under Docker
Compose, or directly from a checkout.
"""

from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _path(env_name: str, default: Path) -> Path:
    raw = os.environ.get(env_name)
    return Path(raw).expanduser().resolve() if raw else default.resolve()


# Where the platform keeps its interaction database (users/*.json and/or aniflix.db).
# In the bundled compose file this is the shared ./data volume.
PLATFORM_DATA_DIR = _path("REC_PLATFORM_DATA_DIR", PROJECT_ROOT.parent / "data")

# Where the trained artifacts live (id_mapping.json, video_index.ann, ...).
ARTIFACT_DIR = _path("REC_ARTIFACT_DIR", PROJECT_ROOT / "data")

ID_MAPPING_FILE = ARTIFACT_DIR / "id_mapping.json"
USER_MAPPING_FILE = ARTIFACT_DIR / "user_mapping.json"
ANNOY_INDEX_FILE = ARTIFACT_DIR / "video_index.ann"
ITEM_EMBEDDINGS_FILE = ARTIFACT_DIR / "item_embeddings.npy"
USER_EMBEDDINGS_FILE = ARTIFACT_DIR / "user_embeddings.npy"
TRAIN_META_FILE = ARTIFACT_DIR / "train_meta.json"

# ---- training defaults (src/train.py flags take precedence) -----------------
COMPONENTS = int(os.environ.get("REC_COMPONENTS", "32"))
LOSS = os.environ.get("REC_LOSS", "warp")
EPOCHS = int(os.environ.get("REC_EPOCHS", "30"))
TREES = int(os.environ.get("REC_TREES", "10"))
METRIC = os.environ.get("REC_METRIC", "angular")
MIN_INTERACTIONS = int(os.environ.get("REC_MIN_INTERACTIONS", "1"))
SEED = int(os.environ.get("REC_SEED", "42"))
THREADS = int(os.environ.get("REC_THREADS", "0"))  # 0 => let the runtime decide

# ---- service defaults ------------------------------------------------------
HOST = os.environ.get("REC_HOST", "0.0.0.0")
PORT = int(os.environ.get("REC_PORT", "8080"))
DEFAULT_K = int(os.environ.get("REC_DEFAULT_K", "10"))
# annoy search_k: higher = more accurate, slower. -1 => max(k * 20, 200).
SEARCH_K = int(os.environ.get("REC_SEARCH_K", "-1"))
# prefault=True maps the whole index into RAM up front (faster, more RAM).
# Keeping it False is what holds inference inside the 2 GB budget on a NAS.
PREFETCH = os.environ.get("REC_PREFETCH", "0").strip().lower() in ("1", "true", "yes", "on")


def search_k_for(k: int) -> int:
    return SEARCH_K if SEARCH_K > 0 else max(k * 20, 200)
