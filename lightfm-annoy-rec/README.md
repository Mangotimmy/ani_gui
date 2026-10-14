# LightFM + Annoy recommender for ani_gui

A small, self-hosted recommendation service that replaces the heuristic ranking in
`server/services/recommendation.js` with learned embeddings, while staying inside a
**2 GB RAM** budget on a NAS or lightweight server.

## How it works

```
platform data (users/*.json)                    artifacts (./data)
        |                                              ^
        v                                              |
   src/train.py  -- LightFM(no_components=32, loss=warp) -- item embeddings -- Annoy(angular, n_trees=10)
        |
        v
   src/main.py   -- FastAPI -- mmap'd Annoy index -- GET /api/v1/recommend/{video_id}
```

* **LightFM** turns the real favourites + watch history into a 32-dimensional item
  embedding space.
* **Annoy** stores those vectors in an `angular` index built with `n_trees=10`.
* At inference the index is opened with `load(path, prefault=False)`, i.e. **memory-mapped**:
  the OS pages in only the nodes a query touches, so the resident set stays small.
* If a title has never been seen in training, the service still answers: item lookups fall
  back to an exact numpy cosine search over the mmap'd `item_embeddings.npy`, and user
  lookups fall back to stored popularity.

## Layout

```
lightfm-annoy-rec/
  Dockerfile            multi-stage, compiles lightfm/annoy once in the builder
  docker-compose.yml    rec-service (+ a one-shot trainer profile), ./data mounted
  requirements.txt      pinned; numpy held below 2.x for the lightfm 1.17 ABI
  src/config.py         env-driven paths and defaults
  src/dataset.py        reads users/*.json (and optional SQLite) into weighted interactions
  src/idmap.py          video id <-> contiguous index mapping (int, string or UUID ids)
  src/train.py          training CLI
  src/main.py           FastAPI inference service
  src/store.py          mmap Annoy index + numpy fallback
  tests/test_pipeline.py  offline end-to-end smoke test
  data/                 generated artifacts (git-ignored)
```

## Quickstart (Docker)

```bash
cd lightfm-annoy-rec

# 1. train once against the platform's real interaction data
docker compose run --rm trainer

# 2. serve
docker compose up -d --build
curl http://localhost:8080/healthz
curl "http://localhost:8080/api/v1/recommend/21?k=10"
```

The trainer reads `./data/users/*.json` - the same volume the AniFlix container writes -
and writes `id_mapping.json`, `video_index.ann`, `item_embeddings.npy`,
`user_embeddings.npy`, `user_mapping.json` and `train_meta.json` back into `./data`.

## Training

```bash
python -m src.train --data-dir ../data --artifact-dir ./data          # LightFM (default)
python -m src.train --synthetic --engine svd --dry-run                # pipeline check, writes nothing
python -m src.train --sqlite ../server/data/aniflix.db                # also mine a SQLite DB
python -m src.train --epochs 60 --components 32 --trees 10            # tuning
```

`--engine svd` exists for hosts where `lightfm` cannot be compiled: it produces the same
artifacts from a numpy-only truncated SVD, so the service keeps working.

`train_meta.json` records `data_quality`. With very few users or interactions it is set to
`insufficient`, which the Node integration treats as a signal to prefer content-based ranking.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/healthz` | readiness + backend + item/user counts |
| GET | `/api/v1/stats` | full artifact/stat metadata |
| GET | `/api/v1/recommend/{video_id}?k=10&exclude=1,2` | top-k similar video ids |
| GET | `/api/v1/recommend/user/{user_id}?k=10&exclude=1,2` | personalised ids, or popularity |
| POST | `/api/v1/reload` | re-read artifacts after a retrain (mmap, cheap) |

```json
{
  "video_id": "21",
  "backend": "annoy",
  "count": 10,
  "items": [{ "video_id": "11061", "score": 0.873421 }]
}
```

## Configuration

| Env | Default | Meaning |
| --- | --- | --- |
| `REC_PLATFORM_DATA_DIR` | `../data` (image: `/app/data`) | where `users/*.json` live |
| `REC_ARTIFACT_DIR` | `./data` (image: `/app/data`) | where the artifacts are written/read |
| `REC_COMPONENTS` / `REC_LOSS` / `REC_EPOCHS` | 32 / warp / 30 | LightFM training |
| `REC_TREES` / `REC_METRIC` | 10 / angular | Annoy index |
| `REC_PREFETCH` | 0 | 1 = prefault the index into RAM (faster, uses much more) |
| `REC_SEARCH_K` | auto (`max(k*20, 200)`) | Annoy search effort |
| `REC_DEFAULT_K` | 10 | default result count |
| `REC_PORT` | 8080 | listen port |

## Wiring it into the platform

```bash
# root .env / docker-compose environment
REC_SERVICE_URL=http://rec-service:8080
REC_TIMEOUT_MS=600
```

`server/services/recommendation.js` calls the service when `REC_SERVICE_URL` is set, and
falls back to the existing content-based scorer on any timeout, error, missing index or
`data_quality: insufficient`. The `POST /api/recommendations` response shape is unchanged.

Confirm which engine is actually serving:

```bash
curl http://localhost:3000/api/recommendations/engine
# {"mode":"lightfm-annoy","serviceUrl":"http://rec-service:8080","healthy":true,
#  "backend":"annoy","items":13,"dataQuality":"insufficient","requireGoodData":true}
```

## CI & registry

[`.github/workflows/docker.yml`](../.github/workflows/docker.yml) builds and publishes this service next to the app image:

| Job | What it does |
| --- | --- |
| `rec-test` | builds `linux/amd64` with `load: true`, then runs `tests/test_pipeline.py` and `src.train --synthetic --engine lightfm --dry-run` inside the image |
| `rec` | builds and pushes `linux/amd64,linux/arm64` to `ghcr.io/<owner>/ani_gui-rec` |

```
ghcr.io/mangotimmy/ani_gui-rec:latest       # default branch
ghcr.io/mangotimmy/ani_gui-rec:sha-1a2b3c4  # every build
ghcr.io/mangotimmy/ani_gui-rec:2.5.1        # on v* tags
```

* `rec-test` is what protects the three build traps baked into the Dockerfile: **Python 3.10**
  (lightfm's Cython-0.29 C does not compile on 3.11+), **setuptools < 70 with `--no-build-isolation`**,
  and **libgomp1** in the runtime stage for the OpenMP build of the extension.
* The arm64 leg compiles lightfm from source under QEMU emulation, so it is slow (the job allows 120
  minutes). Drop `,linux/arm64` from `platforms:` in the `rec` job to make it amd64-only.
* No trained artifacts are published - they are derived from your own `data/users/*.json` at deploy time.
* GHCR packages are private by default: run `docker login ghcr.io` on the NAS, or make the package public.

## Retraining safely

```bash
docker compose stop rec-service      # release the memory-mapped index (required on Windows bind mounts)
docker compose run --rm rec-trainer  # rewrites the ./data artifacts atomically (tmp + rename)
docker compose start rec-service
curl -X POST http://localhost:8080/api/v1/reload   # optional: re-read without a restart
```

`src/train.py` writes every artifact to a `.tmp` sibling and renames it into place, so a running service
never observes a half-written index. On Linux the rename works even while the old file is mapped; on
Windows/Docker Desktop a mapped file cannot be replaced, hence the `stop` above.

## Verifying

```bash
python tests/test_pipeline.py                 # offline: synthesize -> train -> load -> query
docker compose up -d --build
curl http://localhost:8080/healthz
docker stats --no-stream aniflix-rec          # RSS should sit far below 2 GB
```

## Troubleshooting

* **lightfm fails to build** - three things must line up, and the bundled Dockerfile
  already does: **Python 3.10** (lightfm 1.17 ships Cython-0.29 C that will not compile on
  3.11+), **setuptools < 70** with `--no-build-isolation`, and **numpy 1.x**. Anywhere else,
  run with `--engine svd` - or install the maintained fork `rectools-lightfm`, which keeps
  the same `lightfm` import name and does build on Python 3.12.
* **`/healthz` says unavailable** - the artifacts are missing: run the trainer, then
  `POST /api/v1/reload`.
* **RSS keeps growing** - keep `REC_PREFETCH=0`, `--workers 1`, and do not copy the index
  into a Python list.
* **Retrain cadence** - nightly or weekly is plenty; the Annoy index is read-only, so a
  retrain only needs `docker compose stop rec-service`, `docker compose run --rm rec-trainer`,
  `docker compose start rec-service` and (optionally) `POST /api/v1/reload`.
