"""End-to-end smoke test: synthesize -> train -> load -> query.

Runs on plain CPython (no pytest, no network):

    python tests/test_pipeline.py
"""

from __future__ import annotations

import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.store import VectorStore  # noqa: E402
from src.train import main as train_main  # noqa: E402


def run() -> int:
    artifacts = Path(tempfile.mkdtemp(prefix="rec-artifacts-"))
    try:
        code = train_main([
            "--synthetic", "--engine", "svd",
            "--synthetic-users", "50", "--synthetic-items", "150",
            "--components", "16", "--trees", "10",
            "--artifact-dir", str(artifacts), "--quiet",
        ])
        assert code == 0, "training returned " + str(code)

        for name in ("id_mapping.json", "user_mapping.json", "item_embeddings.npy",
                     "user_embeddings.npy", "train_meta.json"):
            assert (artifacts / name).exists(), "missing artifact: " + name

        store = VectorStore(artifacts)
        store.load()
        assert store.ready, "store is not ready"
        print("backend:", store.backend, "| items:", store.item_count, "| users:", store.stats()["users"])

        similar = store.similar_items("video7", k=8)
        assert len(similar) == 8, "expected 8 neighbours, got " + str(len(similar))
        assert all(candidate != "video7" for candidate, _ in similar), "query item leaked into results"
        scores = [score for _, score in similar]
        assert scores == sorted(scores, reverse=True), "neighbours are not sorted by score"
        print("similar(video7):", [(c, round(s, 4)) for c, s in similar[:5]])

        exclusions = {candidate for candidate, _ in similar[:3]}
        filtered = store.similar_items("video7", k=8, exclude=exclusions)
        assert not (exclusions & {candidate for candidate, _ in filtered}), "exclude was ignored"

        user_items, strategy = store.recommend_for_user("user1", k=5)
        assert len(user_items) == 5, "expected 5 user recommendations"
        unknown_items, unknown_strategy = store.recommend_for_user("nobody", k=5)
        assert len(unknown_items) == 5, "popularity fallback returned nothing"
        print("user1 strategy:", strategy, "| cold-start strategy:", unknown_strategy)

        print("PASS")
        return 0
    finally:
        shutil.rmtree(artifacts, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(run())
