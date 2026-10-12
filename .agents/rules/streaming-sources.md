---
description: Guide and specifications for reverse-engineering, registering, and proxy-rewriting streaming sources (Anime1.me, Anime1.one, FramexTV, HiAnime)
globs: server/services/**/*, src/components/VideoPlayer.jsx
---

# Anime Streaming Sources & Proxy Rewriting Guide

This document captures the reverse-engineering logic, network mechanics, and link rewriting guidelines for AniFlix stream sources.

---

## 1. Source 1: Anime1 (Anime1.me 1080p MP4 + Anime1.one Classic HLS)

### Architecture & Multi-Region Naming
- **Language Invariant**: Anime1 strictly indexes in **Traditional Chinese (正體中文)** titles (e.g. `航海王`, `海賊王`, `七大罪`, `鬼滅之刃`, `葬送的芙莉蓮`).
- **Regional Variations**: Always expand search candidates into regional variants (Taiwan: `航海王`, HK/Mainland: `海賊王`; `七大罪`, `七つの大罪`, `The Seven Deadly Sins`).
- **Title Normalization**: Split delimited terms (e.g. `航海王 / 海賊王` into distinct candidates `['航海王', '海賊王']`) and convert to Traditional Chinese via `opencc-js` (`s2t`) or `server/services/db.js` (`getAliasCandidates`).

### Dual-Source Request Flow
1. **Primary: Anime1.me (Modern Seasonal 1080p MP4)**:
   - Search: `GET https://anime1.me/?s={query}`.
   - Category Traversal: If target episode is >14, follow category pagination (`/page/2`, `/page/3`) to locate earlier episodes of 24+ episode seasons.
   - Token Extraction: Read `<video id="player" data-apireq="{urlEncodedJSON}">`.
   - API Resolution: `POST https://v.anime1.me/api` with body `d={data-apireq}` and `Referer: {postUrl}`.
   - Set-Cookies Signature: Forward `e={timestamp}`, `p={jwt}`, and `h={hash}` with `Referer: https://anime1.me/` via `/api/proxy` to prevent HTTP 403.
   - Playback: Proxied with `Range: bytes=0-` returning `HTTP 206 Partial Content` with `Content-Type: video/mp4`.

2. **Secondary: Anime1.one (Classic Long-Running Series Archive)**:
   - For series spanning 100+ to 1100+ episodes (like *One Piece* / *航海王*):
   - Search: `GET https://anime1.one/?s={query}` -> extracts series slug `/(\d{8,10})[-/]`.
   - Deterministic Episode URL: `https://anime1.one/${seriesId}-${10000000 + epNum * 1000}`.
   - Player Frame: Fetch post -> parse `<iframe src="/_player_x_/{id}">`.
   - Stream: Fetch player frame -> extract `<source src="([^"]+\.m3u8)">`.
   - Playback: Proxied via `/api/proxy?url={m3u8}&referer=https%3A%2F%2Fanime1.one%2F` for native HLS playback.

---

## 2. Source 2: FramexTV (Direct 1080p HLS API & Dedicated AnimeEmbedPage)

### Architecture & Routing Discovery
- **Canonical Web Domain**: `https://framextv.xyz`
- **Backend API Domain**: `https://api.framextv.tech`
- **Critical Anime Routing Rule**:
  - `/embed/tv/:tmdbId/:season/:episode` is **ONLY for Western TV shows** in TMDB. For anime, it returns `404 | This page could not be found`.
  - For Anime, FramexTV utilizes a dedicated **`AnimeEmbedPage`**:
    - Web Embed Route: `https://framextv.xyz/embed/anime?id=${anilistId}&season=${season}&episode=${episode}&sub_type=${mode}`
    - Watch Route: `https://framextv.xyz/watch/anime/${anilistId}/${episode}`
  - Both routes strictly require **AniList ID**.

### Direct Streaming API (`api.framextv.tech`)
- Endpoint: `GET https://api.framextv.tech/anime/api/stream?id=${anilistId}&season=${season}&episode=${episode}&sub_type=${mode}`
- Returns JSON with providers (`grand_warden`, `wizard`, `valkyrie`):
  ```json
  {
    "success": true,
    "server": "Grand Warden XI",
    "sources": [{ "url": "/anime/api/proxy?url=https%3A%2F%2F...%2Fmaster.m3u8", "type": "hls", "quality": "1080p" }],
    "subtitles": [{ "url": "https://...vtt", "lang": "English" }]
  }
  ```
- If the source URL starts with `/anime/api/proxy`, prepend `https://api.framextv.tech`.
- Allows native in-app HLS playback (`isEmbed: false`) with full controls, custom subtitles, and fast seeking.
- If direct streaming fails, falls back to `framextv.xyz/embed/anime` with `isEmbed: true`.

---

## 3. Adding New Sources to the Registry

To register a new stream source in AniFlix:
1. **Create Provider Module**: Place in `server/services/sources/{name}.js`.
   - Must export `resolve{Name}Stream({ title, candidates, episode, season, anilistId, tmdbId, mode })`.
   - Return `{ success: true, source, serverName, streamUrl, proxiedStreamUrl, referer, cookies, isMp4, isEmbed, subtitles }`.
2. **Register in Stream Resolver**: Update `server/services/streamResolver.js`:
   - Add entry to `buildSourceList()`.
   - Add explicit branch for `source === '{name}'`.
   - Add cascading fallback inside `source === 'auto'`.
3. **Frontend Source Switcher & Quick Recovery**:
   - Render in `src/components/VideoPlayer.jsx` within the `Radio` sources menu.
   - If an active source fails to resolve, render 1-click fallback pills in the error overlay to immediately switch to an alternative line.
