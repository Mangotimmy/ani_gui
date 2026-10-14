"""Train LightFM item embeddings and build the Annoy index.

Pipeline
--------
1. read the platform's real interactions (users/*.json, optional SQLite)
2. map video ids (AniList ints, or strings/UUIDs on other deployments) to 0..n-1
3. train LightFM(no_components=32, loss='warp') - or a numpy SVD fallback
4. take the item embeddings, build an Annoy index (angular, n_trees=10)
5. persist id_mapping.json / video_index.ann / item_embeddings.npy / train_meta.json

Examples
--------
    python -m src.train --data-dir ../data --artifact-dir ./data
    python -m src.train --synthetic --engine svd --artifact-dir ./data
    python -m src.train --sqlite ../server/data/aniflix.db --dry-run
"""

from __future__ import annotations

import argparse
import gc
import json
import os
import sys
import time
from pathlib import Path
from typing import Dict, List, Sequence, Tuple

import numpy as np

from . import config
from .dataset import (
    Interaction,
    load_interactions,
    load_interactions_from_sqlite,
    synthesize_interactions,
)
from .idmap import IdMap, canonical_id

MIN_USERS_FOR_COLLABORATIVE = 2
MIN_PAIRS_FOR_COLLABORATIVE = 50


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train LightFM + Annoy artifacts for ani_gui.")
    parser.add_argument("--data-dir", default=str(config.PLATFORM_DATA_DIR),
                        help="platform data dir containing users/*.json")
    parser.add_argument("--users-glob", default="users/*.json",
                        help="glob (relative to --data-dir) for user profiles")
    parser.add_argument("--sqlite", default=None,
                        help="optional SQLite database with interaction tables")
    parser.add_argument("--artifact-dir", default=str(config.ARTIFACT_DIR),
                        help="where the trained artifacts are written")
    parser.add_argument("--engine", choices=("lightfm", "svd"), default="lightfm",
                        help="lightfm (default) or a numpy-only SVD fallback")
    parser.add_argument("--components", type=int, default=config.COMPONENTS)
    parser.add_argument("--loss", default=config.LOSS)
    parser.add_argument("--epochs", type=int, default=config.EPOCHS)
    parser.add_argument("--trees", type=int, default=config.TREES)
    parser.add_argument("--metric", default=config.METRIC)
    parser.add_argument("--threads", type=int, default=config.THREADS)
    parser.add_argument("--seed", type=int, default=config.SEED)
    parser.add_argument("--synthetic", action="store_true",
                        help="train on generated data (pipeline verification)")
    parser.add_argument("--synthetic-users", type=int, default=60)
    parser.add_argument("--synthetic-items", type=int, default=200)
    parser.add_argument("--dry-run", action="store_true",
                        help="train and report, but write no artifacts")
    parser.add_argument("--quiet", action="store_true")
    return parser.parse_args(argv)


def log(message: str, quiet: bool = False) -> None:
    if not quiet:
        print(message, flush=True)


def _sort_key(value: str):
    try:
        return (0, int(value), "")
    except (TypeError, ValueError):
        return (1, 0, value)


def build_mappings(interactions: Sequence[Interaction]) -> Tuple[IdMap, IdMap]:
    item_ids = sorted({i.video_id for i in interactions}, key=_sort_key)
    user_ids = sorted({i.user_id for i in interactions}, key=_sort_key)
    return IdMap(item_ids), IdMap(user_ids)


def _dense_matrix(interactions, item_map: IdMap, user_map: IdMap) -> np.ndarray:
    matrix = np.zeros((len(user_map), len(item_map)), dtype=np.float32)
    for interaction in interactions:
        row = user_map.to_index(interaction.user_id)
        column = item_map.to_index(interaction.video_id)
        if row is None or column is None:
            continue
        if interaction.weight > matrix[row, column]:
            matrix[row, column] = interaction.weight
    return matrix


def _sparse_matrix(interactions, item_map: IdMap, user_map: IdMap):
    from scipy import sparse

    rows: List[int] = []
    columns: List[int] = []
    values: List[float] = []
    seen: Dict[Tuple[int, int], int] = {}
    for interaction in interactions:
        row = user_map.to_index(interaction.user_id)
        column = item_map.to_index(interaction.video_id)
        if row is None or column is None:
            continue
        key = (row, column)
        if key in seen:
            index = seen[key]
            if interaction.weight > values[index]:
                values[index] = float(interaction.weight)
            continue
        seen[key] = len(values)
        rows.append(row)
        columns.append(column)
        values.append(float(interaction.weight))
    shape = (len(user_map), len(item_map))
    return sparse.csr_matrix((values, (rows, columns)), shape=shape, dtype=np.float32)


def factorize_svd(matrix: np.ndarray, components: int) -> Tuple[np.ndarray, np.ndarray]:
    """numpy-only truncated SVD: returns (item_embeddings, user_embeddings)."""
    dense = np.asarray(matrix, dtype=np.float32)
    if dense.size == 0:
        return np.zeros((dense.shape[1], components), dtype=np.float32), np.zeros((dense.shape[0], components), dtype=np.float32)
    u, s, vt = np.linalg.svd(dense, full_matrices=False)
    k = max(1, min(components, len(s)))
    user_embeddings = (u[:, :k] * s[:k]).astype(np.float32)
    item_embeddings = (vt[:k].T * s[:k]).astype(np.float32)
    return item_embeddings, user_embeddings


def factorize_lightfm(interactions, item_map: IdMap, user_map: IdMap, args) -> Tuple[np.ndarray, np.ndarray, str]:
    try:
        from lightfm import LightFM
    except ImportError as exc:  # pragma: no cover - depends on the image
        raise SystemExit(
            "lightfm is not installed in this Python environment (" + str(exc) + ").\n"
            "Build the Docker image (which compiles it) or run with --engine svd."
        )

    matrix = _sparse_matrix(interactions, item_map, user_map)
    model = LightFM(no_components=args.components, loss=args.loss, random_state=args.seed)
    log("Training LightFM: loss=" + args.loss + " components=" + str(args.components)
        + " epochs=" + str(args.epochs) + " interactions=" + str(matrix.nnz), args.quiet)
    # num_threads must be a positive int when passed; LightFM chokes on None.
    fit_kwargs = {"epochs": args.epochs, "verbose": not args.quiet}
    if args.threads and args.threads > 0:
        fit_kwargs["num_threads"] = args.threads
    model.fit(matrix, **fit_kwargs)
    _item_bias, item_embeddings = model.get_item_representations()
    _user_bias, user_embeddings = model.get_user_representations()
    return (
        np.asarray(item_embeddings, dtype=np.float32),
        np.asarray(user_embeddings, dtype=np.float32),
        "lightfm",
    )


def popularity_from(interactions: Sequence[Interaction], item_map: IdMap) -> Dict[str, float]:
    totals: Dict[str, float] = {}
    for interaction in interactions:
        totals[interaction.video_id] = totals.get(interaction.video_id, 0.0) + float(interaction.weight)
    ranked = sorted(totals.items(), key=lambda pair: -pair[1])
    limit = max(200, min(len(ranked), 5000))
    return {video_id: round(score, 4) for video_id, score in ranked[:limit]}


def atomic_numpy_save(path: Path, array: np.ndarray) -> None:
    """Write through a temp file + rename so a serving process never sees a partial file."""
    path = Path(path)
    tmp = path.with_name(path.name + ".tmp")
    # Pass a file object: np.save would otherwise append .npy to the temp name.
    with open(tmp, "wb") as handle:
        np.save(handle, array)
    os.replace(tmp, path)


def atomic_write_text(path: Path, text: str) -> None:
    path = Path(path)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def build_annoy(item_embeddings: np.ndarray, metric: str, trees: int, destination: Path,
                quiet: bool) -> bool:
    try:
        from annoy import AnnoyIndex
    except ImportError as exc:
        log("[warn] annoy not installed (" + str(exc) + "); skipping video_index.ann.", quiet)
        return False

    count, dimension = item_embeddings.shape
    if count < 2:
        log("[warn] fewer than 2 items; skipping the Annoy index.", quiet)
        return False

    index = AnnoyIndex(dimension, metric)
    for position in range(count):
        index.add_item(position, item_embeddings[position].tolist())
    index.build(trees)
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    tmp = destination.with_name(destination.name + ".tmp")
    index.save(str(tmp))
    # Read the size while the temp file is still the one we just wrote: after the rename,
    # a bind-mounted filesystem (Docker Desktop on Windows) may not expose the new path yet.
    size_bytes = tmp.stat().st_size
    os.replace(tmp, destination)  # atomic on POSIX filesystems
    # Annoy keeps the file it wrote open. On bind mounts the renamed path only becomes
    # observable once that handle is released, so drop the index and collect before use.
    index = None
    gc.collect()
    size_mb = size_bytes / (1024 * 1024)
    log("[ok] Annoy index: " + str(destination) + " (" + str(count) + " items, "
        + str(dimension) + "d, " + str(trees) + " trees, " + format(size_mb, ".2f") + " MB)", quiet)
    return True


def collect_interactions(args) -> Tuple[List[Interaction], dict]:
    if args.synthetic:
        interactions = synthesize_interactions(
            n_users=args.synthetic_users, n_items=args.synthetic_items, seed=args.seed
        )
        return interactions, {"source": "synthetic", "profiles": args.synthetic_users}

    interactions, stats = load_interactions(args.data_dir, args.users_glob)
    stats["source"] = "profiles"

    if args.sqlite:
        extra = load_interactions_from_sqlite(args.sqlite)
        if extra:
            log("[ok] " + str(len(extra)) + " interactions read from " + args.sqlite, args.quiet)
            merged: Dict[Tuple[str, str], Interaction] = {(i.user_id, i.video_id): i for i in interactions}
            for interaction in extra:
                merged.setdefault((interaction.user_id, interaction.video_id), interaction)
            interactions = list(merged.values())
        else:
            log("[info] no interaction tables found in " + str(args.sqlite), args.quiet)
    return interactions, stats


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    artifact_dir = Path(args.artifact_dir)
    started = time.time()

    interactions, stats = collect_interactions(args)
    if not interactions:
        log("[error] no interactions found under " + str(args.data_dir)
            + ". Point --data-dir at the platform data volume or use --synthetic.", args.quiet)
        return 2

    item_map, user_map = build_mappings(interactions)
    log("[ok] " + str(len(interactions)) + " interactions | " + str(len(user_map)) + " users | "
        + str(len(item_map)) + " items (" + str(stats.get("source")) + ")", args.quiet)

    warnings: List[str] = []
    data_quality = "ok"
    if len(user_map) < MIN_USERS_FOR_COLLABORATIVE or len(interactions) < MIN_PAIRS_FOR_COLLABORATIVE:
        data_quality = "insufficient"
        warnings.append(
            "Only " + str(len(user_map)) + " user(s) and " + str(len(interactions))
            + " interaction(s): collaborative filtering is statistically weak. "
            + "The platform keeps content-based ranking as the primary path until this grows."
        )
        log("[warn] " + warnings[-1], args.quiet)

    if args.engine == "svd":
        dense = _dense_matrix(interactions, item_map, user_map)
        item_embeddings, user_embeddings = factorize_svd(dense, args.components)
        engine_used = "svd"
        log("[ok] numpy SVD factorization complete (" + str(item_embeddings.shape) + ")", args.quiet)
    else:
        item_embeddings, user_embeddings, engine_used = factorize_lightfm(interactions, item_map, user_map, args)

    meta = {
        "trained_at": time.time(),
        "trained_at_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "engine": engine_used,
        "components": int(item_embeddings.shape[1]),
        "loss": args.loss if engine_used == "lightfm" else None,
        "epochs": args.epochs if engine_used == "lightfm" else None,
        "metric": args.metric,
        "trees": args.trees,
        "seed": args.seed,
        "items": int(len(item_map)),
        "users": int(len(user_map)),
        "interactions": int(len(interactions)),
        "data_quality": data_quality,
        "warnings": warnings,
        "platform": stats,
        "popularity": popularity_from(interactions, item_map),
    }

    if args.dry_run:
        log("[dry-run] no artifacts written. items=" + str(meta["items"]) + " users=" + str(meta["users"])
            + " engine=" + engine_used, args.quiet)
        return 0

    artifact_dir.mkdir(parents=True, exist_ok=True)
    # Every artifact is written to a .tmp sibling and renamed into place, so a running
    # service (which memory-maps these files) can never observe a half-written index.
    item_map.save(artifact_dir / "id_mapping.json")  # atomic internally (tmp + replace)
    user_map.save(artifact_dir / "user_mapping.json")
    atomic_numpy_save(artifact_dir / "item_embeddings.npy", item_embeddings)
    atomic_numpy_save(artifact_dir / "user_embeddings.npy", user_embeddings)
    build_annoy(item_embeddings, args.metric, args.trees, artifact_dir / "video_index.ann", args.quiet)
    atomic_write_text(artifact_dir / "train_meta.json", json.dumps(meta, ensure_ascii=False, indent=2))
    log("[ok] artifacts written to " + str(artifact_dir) + " in "
        + format(time.time() - started, ".1f") + "s", args.quiet)
    return 0


if __name__ == "__main__":
    sys.exit(main())
