"""Bidirectional mapping between arbitrary video ids and contiguous Annoy indices.

Annoy (like any array-backed index) needs dense 0..n-1 integer positions, while the
platform's video ids are AniList integers - and, on other deployments, string/UUID
ids. Both directions are persisted to data/id_mapping.json.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable, List, Optional, Sequence

MAPPING_VERSION = 1


def canonical_id(value: object) -> str:
    """Ids are compared as strings so int, UUID and str ids all work."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, int):
        return str(value)
    return str(value).strip()


class IdMap:
    def __init__(self, ids: Sequence[object]):
        self.ids: List[str] = [canonical_id(i) for i in ids]
        self._index: dict[str, int] = {}
        for position, video_id in enumerate(self.ids):
            self._index.setdefault(video_id, position)

    def __len__(self) -> int:
        return len(self.ids)

    def to_index(self, video_id: object) -> Optional[int]:
        return self._index.get(canonical_id(video_id))

    def to_id(self, index: int) -> Optional[str]:
        if 0 <= index < len(self.ids):
            return self.ids[index]
        return None

    def to_dict(self) -> dict:
        return {
            "version": MAPPING_VERSION,
            "count": len(self.ids),
            "id_to_index": self._index,
            "index_to_id": self.ids,
        }

    def save(self, path: Path) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(self.to_dict(), ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)

    @classmethod
    def load(cls, path: Path) -> "IdMap":
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        instance = cls(payload.get("index_to_id") or [])
        return instance

    @classmethod
    def from_ids(cls, ids: Iterable[object]) -> "IdMap":
        return cls(list(ids))
