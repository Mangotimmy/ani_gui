---
description: Guide and specifications for reverse-engineering, registering, and proxy-rewriting streaming sources (Anime1.me, FramexTV, HiAnime)
globs: server/services/**/*, src/components/VideoPlayer.jsx
---

# Anime Streaming Sources & Proxy Rewriting Guide

This document captures the reverse-engineering logic, network mechanics, and link rewriting guidelines for AniFlix stream sources.

---

## 1. Source 1: Anime1.me (1080p MP4 + Native Traditional Chinese)

### Architecture & Discovery
- **Language Invariant**: Anime1 strictly indexes **Traditional Chinese (正體中文)** titles (e.g. `鬼滅之刃`, `為美好的世界獻上祝福！`, `葬送的芙莉蓮`).
- Always convert incoming search candidate titles to Traditional Chinese using `opencc-js` (`s2t`) or resolve canonical Chinese titles from `server/services/db.js` (`lookupAlias`) prior to querying `https://anime1.me/?s={query}`.

### Request Flow & Token Extraction
1. **Search**: `GET https://anime1.me/?s={TradChineseQuery}`
   - Returns articles `<h2 class="entry-title"><a href="{postUrl}">{postTitle}</a></h2>`.
   - Episode numbers format: `[08]`, `[1]`, `第8話`, or category link `/category/...`.
2. **Token Extraction**:
   - The episode page contains `<video id="player" data-apireq="{urlEncodedJSON}">`.
   - The token contains `{ "c": "category_id", "e": "ep_id", "t": timestamp }`.
3. **API Resolution**:
   - `POST https://v.anime1.me/api` with body `d={data-apireq}` and `Referer: {postUrl}`.
   - Response returns `{ "s": [{ "src": "//saki.v.anime1.me/{category}/{file}.mp4", "type": "video/mp4" }] }`.
4. **Cookie Security Signature**:
   - Response sets 3 essential domain cookies (`.v.anime1.me`):
     - `e={timestamp}` (Epoch expiration, 8-hour TTL)
     - `p={jwt}` (Signed JWT claim containing the allowed subpath)
     - `h={hash}` (HMAC integrity hash)
   - The stream returns `HTTP 403 Forbidden` if these cookies and `Referer: https://anime1.me/` are not supplied.

### Proxy Rewriting & Playback
- Proxied URL: `/api/proxy?url=${encodeURIComponent(rawSrc)}&referer=${encodeURIComponent('https://anime1.me/')}&cookies=${encodeURIComponent(cookieStr)}`
- Proxy forwards `Cookie: ${req.query.cookies}` and `Range: ${req.headers.range}`.
- Server returns `HTTP 206 Partial Content` with `Content-Type: video/mp4` and `Accept-Ranges: bytes`.
- Frontend `<video>` element plays natively without passing through HLS.js.

---

## 2. Source 2: FramexTV (HD Multi-Server / VidLink Embed)

### Architecture & Discovery
- **Canonical Domain**: `https://framextv.xyz` (Note: `framextv.tech` redirects via HTTP 301 to `framextv.xyz`).
- **Routing**: SPA routes are keyed by **TMDB ID**:
  - TV Shows: `https://framextv.xyz/embed/tv/{tmdbId}/{season}/{episode}`
  - Movies: `https://framextv.xyz/embed/movie/{tmdbId}`
- **Resolver**: The client bundle (`/assets/index-*.js`) interfaces with VidLink (`vidlink.pro`) with WebAssembly encryption.
- **Player Integration**: Returns `{ isEmbed: true, streamUrl: embedUrl }`. `VideoPlayer.jsx` renders an in-player responsive iframe with user controls to switch sources back seamlessly.

---

## 3. Adding New Sources to the Registry

To register a new stream source in AniFlix:
1. **Create Provider Module**: Place in `server/services/sources/{name}.js`.
   - Must export `resolve{Name}Stream({ title, candidates, episode, season, tmdbId })`.
   - Return `{ success: true, source, serverName, streamUrl, proxiedStreamUrl, referer, cookies, isMp4, isEmbed, subtitles }`.
2. **Register in Stream Resolver**: Update `server/services/streamResolver.js`:
   - Add entry to `buildSourceList()`.
   - Add explicit branch for `source === '{name}'`.
   - Add fallback branch inside `source === 'auto'` if applicable.
3. **Frontend Source Switcher**:
   - Render in `src/components/VideoPlayer.jsx` within the `Radio` sources menu.
   - Support stream modes: HLS (`.m3u8`), Native MP4 (`isMp4`), or Embed (`isEmbed`).
