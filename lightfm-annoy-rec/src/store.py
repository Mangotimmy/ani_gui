"""Runtime vector store: mmap-backed Annoy index (plus a numpy fallback)."""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

import numpy as np

from . import config
from .idmap import IdMap, canonical_id


class IndexUnavailable(RuntimeError):
    """Raised when no usable artifact set has been trained yet."""


class VectorStore:
    """Loads the trained artifacts and answers similarity / user queries.

    The Annoy index is opened through its memory-mapped loader (prefault=False),
    which is what keeps resident memory small on a NAS: the OS pages in only the
    nodes a query actually touches.
    """

    def __init__(self, artifact_dir: Optional[Path] = None):
        self.artifact_dir = Path(artifact_dir or config.ARTIFACT_DIR)
        self._lock = threading.Lock()
        self.id_map: Optional[IdMap] = None
        self.user_map: Optional[IdMap] = None
        self.meta: dict = {}
        self.backend: Optional[str] = None
        self._annoy = None
        self._item_matrix: Optional[np.ndarray] = None
        self._user_matrix: Optional[np.ndarray] = None
        self.loaded_at: Optional[float] = None
        self.load_errors: List[str] = []

    # ---- loading ----------------------------------------------------------
    def load(self) -> None:
        with self._lock:
            self.load_errors = []
            id_mapping = self.artifact_dir / "id_mapping.json"
            if not id_mapping.exists():
                raise IndexUnavailable(
                    "No id_mapping.json in " + str(self.artifact_dir) + "; run src/train.py first."
                )
            self.id_map = IdMap.load(id_mapping)

            meta_file = self.artifact_dir / "train_meta.json"
            self.meta = json.loads(meta_file.read_text(encoding="utf-8")) if meta_file.exists() else {}

            user_mapping = self.artifact_dir / "user_mapping.json"
            self.user_map = IdMap.load(user_mapping) if user_mapping.exists() else None

            self._annoy = None
            self._item_matrix = None
            self._user_matrix = None
            self.backend = None

            annoy_file = self.artifact_dir / "video_index.ann"
            if annoy_file.exists():
                try:
                    from annoy import AnnoyIndex

                    dimension = int(self.meta.get("components") or 0)
                    if dimension <= 0:
                        raise ValueError("train_meta.json is missing 'components'")
                    index = AnnoyIndex(dimension, self.meta.get("metric", config.METRIC))
                    # prefault=False => mmap only, never read the whole file into RAM.
                    index.load(str(annoy_file), prefault=config.PREFETCH)
                    self._annoy = index
                    self.backend = "annoy"
                except Exception as exc:  # pragma: no cover - depends on the image
                    self.load_errors.append("annoy load failed: " + str(exc))

            embeddings_file = self.artifact_dir / "item_embeddings.npy"
            if embeddings_file.exists():
                # mmap_mode keeps the vectors on disk until they are actually used.
                self._item_matrix = np.load(embeddings_file, mmap_mode="r")
                if self.backend is None:
                    self.backend = "numpy"

            if self.backend is None:
                raise IndexUnavailable(
                    "No readable index artifacts found (video_index.ann / item_embeddings.npy)."
                )

            user_embeddings = self.artifact_dir / "user_embeddings.npy"
            if user_embeddings.exists():
                self._user_matrix = np.load(user_embeddings, mmap_mode="r")

            self.loaded_at = time.time()

    @property
    def ready(self) -> bool:
        return self.backend is not None and self.id_map is not None

    @property
    def item_count(self) -> int:
        if self.id_map is not None:
            return len(self.id_map)
        if self._item_matrix is not None:
            return int(self._item_matrix.shape[0])
        return 0

    # ---- scoring helpers ---------------------------------------------------
    def _normalized_items(self) -> np.ndarray:
        if self._item_matrix is None:
            raise IndexUnavailable("item embeddings are not loaded")
        matrix = np.asarray(self._item_matrix, dtype=np.float32)
        norms = np.linalg.norm(matrix, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return matrix / norms

    def similar_items(self, video_id: object, k: int = 10,
                      exclude: Sequence[object] = ()) -> List[Tuple[str, float]]:
        """Top-k items most similar to a given video id (Annoy first, numpy fallback)."""
        if not self.ready or self.id_map is None:
            raise IndexUnavailable("index is not loaded")
        index = self.id_map.to_index(video_id)
        if index is None:
            return []

        excluded = {canonical_id(x) for x in exclude}
        wanted = k + len(excluded) + 1
        results: List[Tuple[str, float]] = []

        if self._annoy is not None:
            search_k = config.search_k_for(wanted)
            ids, distances = self._annoy.get_nns_by_item(index, wanted, search_k, include_distances=True)
            for neighbor, distance in zip(ids, distances):
                if neighbor == index:
                    continue
                neighbor_id = self.id_map.to_id(int(neighbor))
                if neighbor_id is None or neighbor_id in excluded:
                    continue
                # angular distance d -> cosine similarity 1 - d^2 / 2
                results.append((neighbor_id, float(1.0 - (distance * distance) / 2.0)))
                if len(results) >= k:
                    break
            if results:
                return results

        if self._item_matrix is None:
            return results

        matrix = self._normalized_items()
        query = np.asarray(self._item_matrix[index], dtype=np.float32)
        norm = float(np.linalg.norm(query)) or 1.0
        scores = matrix @ (query / norm)
        order = np.argsort(-scores)
        for position in order:
            neighbor_id = self.id_map.to_id(int(position))
            if neighbor_id is None or neighbor_id in excluded or int(position) == index:
                continue
            results.append((neighbor_id, float(scores[position])))
            if len(results) >= k:
                break
        return results

    def recommend_for_user(self, user_id: object, k: int = 10,
                           exclude: Sequence[object] = ()) -> Tuple[List[Tuple[str, float]], str]:
        """Personalised items for a known user, else the popularity fallback."""
        if not self.ready or self.id_map is None:
            raise IndexUnavailable("index is not loaded")
        excluded = {canonical_id(x) for x in exclude}

        if self._user_matrix is not None and self.user_map is not None:
            user_index = self.user_map.to_index(user_id)
            if user_index is not None and user_index < self._user_matrix.shape[0]:
                matrix = self._normalized_items()
                vector = np.asarray(self._user_matrix[user_index], dtype=np.float32)
                norm = float(np.linalg.norm(vector)) or 1.0
                scores = matrix @ (vector / norm)
                order = np.argsort(-scores)
                out: List[Tuple[str, float]] = []
                for position in order:
                    candidate = self.id_map.to_id(int(position))
                    if candidate is None or candidate in excluded:
                        continue
                    out.append((candidate, float(scores[position])))
                    if len(out) >= k:
                        break
                return out, "lightfm-user"

        return self.popular_items(k, exclude=excluded), "popularity-fallback"

    def popular_items(self, k: int = 10, exclude: Sequence[object] = ()) -> List[Tuple[str, float]]:
        excluded = {canonical_id(x) for x in exclude}
        popularity: dict = self.meta.get("popularity") or {}
        ranked = sorted(popularity.items(), key=lambda pair: -float(pair[1]))
        out: List[Tuple[str, float]] = []
        for video_id, score in ranked:
            if video_id in excluded or (self.id_map is not None and self.id_map.to_index(video_id) is None):
                continue
            out.append((video_id, float(score)))
            if len(out) >= k:
                break
        if out or self.id_map is None:
            return out
        # Last resort: the first ids in the mapping.
        for position in range(min(k, len(self.id_map))):
            candidate = self.id_map.to_id(position)
            if candidate and candidate not in excluded:
                out.append((candidate, 0.0))
        return out

    def stats(self) -> dict:
        return {
            "artifact_dir": str(self.artifact_dir),
            "backend": self.backend,
            "ready": self.ready,
            "items": self.item_count,
            "users": len(self.user_map) if self.user_map else 0,
            "components": self.meta.get("components"),
            "metric": self.meta.get("metric"),
            "trees": self.meta.get("trees"),
            "trained_at": self.meta.get("trained_at"),
            "engine": self.meta.get("engine"),
            "data_quality": self.meta.get("data_quality"),
            "loaded_at": self.loaded_at,
            "load_errors": self.load_errors,
            "prefault": config.PREFETCH,
        }


_store: Optional[VectorStore] = None


def get_store() -> VectorStore:
    global _store
    if _store is None:
        _store = VectorStore()
    return _store
