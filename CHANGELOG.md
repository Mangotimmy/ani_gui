# Changelog

## 2.7.0 — desktop integration, catalog ranges, trending & Chinese-localization

### Windows / desktop
- **Integrated title bar**: `titleBarStyle: 'hidden'` + `titleBarOverlay` (Windows) and
  `hiddenInset` (macOS). A 34 px drag strip is rendered above the navbar; native window
  buttons and Windows 11 Snap Layouts stay available.
- **App icon**: Windows windows now use `build/icon.ico`, `app.setName('AniFlix')` and
  `app.setAppUserModelId('com.aniflix.desktop')` so the taskbar, title bar and toasts show
  the real app identity instead of Electron defaults. Apple touch icon added for the PWA.
- **Windows notifications**: new `electron/preload.cjs` bridge; the renderer calls native
  `Notification` through IPC, clicking a toast focuses the window and opens the anime.
  A "桌面通知：開/關" toggle lives in the notification center header.

### Notifications
- Favorites' newly aired episodes are now detected from **live AniList airing schedules**
  (`/api/notifications/airing?ids=…&hours=48`), not from the frozen favorite snapshot.
  The old implementation read `nextAiringEpisode` from data saved when the user favorited
  the show, which is why the notification list stayed empty.

### PiP / floating player
- The PiP button now leaves the full-screen player, returns to the catalogue and keeps
  playback in the in-app floating player; native OS PiP remains available from the
  floating bar.

### Catalog
- **Decade quick-jump is a real range**: 1970s → 1970-01-01 … 1979-12-31
  (`startDate_greater/lesser`), not a single representative year.
- **Future years are data-driven**: `/api/catalog/years` probes the next three years and
  hides years with no releases (2029 disappears; 2028 with one announced title stays).

### Trending
- "現正熱播" now uses all-time popularity (`/api/popular-now`) instead of AniList's
  airing-buzz `TRENDING_DESC`. The season shelf has its own label (本季新番 / This Season)
  and the duplicate "All-Time Popular" shelf was removed.

### Chinese localization
- New `src/utils/titles.js`: localized titles fall back zh → English → romaji → native
  (previously Japanese `title.native` came before English/romaji, so a Chinese UI showed
  kanji whenever translation had not finished). Applied to cards, hero, navbar, detail
  sheet, player, schedule and notifications.
- `translateText()` now returns `''` on failure instead of the source text, and
  `getAnimeChineseInfo()` returns `{ titleOk, summaryOk, summaryZh }`. Untranslated
  synopses are labelled 原文（翻譯暫時不可用） with a 重新翻譯 button; translated summaries
  are cached on disk for 30 days.
- `GET /api/anime/titles?ids=…` plus two delayed client patches let lists progressively
  switch to Chinese titles as the server finishes resolving them.

### Accessibility & polish (review pass)
- Restored pinch-zoom (removed `maximum-scale`/`user-scalable=no`, WCAG 1.4.4).
- Global `:focus-visible` ring, keyboard-accessible anime cards (real poster button),
  keyboard-reachable notification rows, accessible names on icon buttons, and a real
  `<button>` for the logo.
- `prefers-reduced-motion` now disables the marquee, hover scale and transitions;
  hover effects are gated behind `@media (hover: hover)`.
- Scroll padding for the fixed header, `overscroll-behavior: contain` on menus/dialogs,
  and a hairline outline on content images.

## 2.6.0 — reported-issues fix round

Everything below applies to **both** the browser/server build and the Electron desktop build:
they share `server/` and `src/`, so no separate desktop patch was needed (only the desktop
data directory had to be pointed at the writable `userData` folder).

### 1. Error problems (console 413 / 500 / 504 / SSE resets)
- `express.json` limit raised from the 100 kB default to 64 MB. A synced profile with a few
  hundred favourites is ~600 kB, which used to return an **HTML 413 page** that the client
  reported as `Unexpected token '<' … is not valid JSON`.
- Added a JSON-only API error handler: API failures always return
  `{ success:false, error, code }` instead of Express' HTML error page.
- `/api/recommendations` and `/api/users/sync` clamp oversized payloads and degrade instead
  of failing.
- User profiles are written atomically (temp file + rename).
- Download SSE: `Content-Encoding: identity`, immediate `: connected`, 10 s heartbeat,
  `no-transform`, socket no-delay, plus a client polling fallback when a reverse proxy keeps
  resetting the HTTP/2 stream (`ERR_HTTP2_PROTOCOL_ERROR`).

### 2. Server-side video pre-cache
- New `server/services/segmentPrefetcher.js`: every HLS playlist request warms the next
  media segments (master → first variant → first N segments) in a bounded background queue.
- The prefetch reuses the playlist body already downloaded (no duplicate request) and never
  blocks or fails a user request.

### 3. Video loading performance
- Media/subtitle/DB cache paths are now resolved through one module (`server/services/paths.js`)
  and honour `ANIFLIX_DATA_DIR`; the cache survives restarts and Docker/Electron updates.
- Repetition: hashed `/assets/*` are served `immutable` for a year, the SPA shell is
  `no-store`, so a returning visitor downloads zero JS.
- Catalogue JSON is gzipped (~273 kB → ~40 kB on the trending payload).
- Image proxy streams the bytes while teeing to disk instead of buffering the whole image
  first (hero/LCP image starts immediately).
- hls.js tuned for fast start: `capLevelToPlayerSize`, `startLevel:-1`, smaller forward
  buffer, bounded retries (one slow segment no longer kills playback).
- Boot bundle reduced (SettingsModal/UserProfile/DownloadedFiles/ScheduleView/SetupWizard are
  now lazy chunks): main entry 238 kB → 133 kB.
- Fixed a resolver re-run caused by `displayTitle`/`currentLang` dependencies: the stream no
  longer restarts ~1 s after opening when the Chinese title resolves.

### 4. Missing subtitles
- Root cause found: the player wrapped an already-proxied subtitle URL inside
  `/api/subtitles/translate?url=/api/proxy?…`, which the server could not fetch
  (relative URL → HTTP 500) → no subtitles at all. The translator now resolves relative URLs
  and unwraps its own endpoint.
- A failed subtitle track now falls back to another working track instead of silently showing
  nothing; tracks without a URL (hardcoded/embedded) are no longer rendered as `<track src="">`.
- The CC menu tells the user when a line has no subtitle track and offers the import action.

### 5. Switching stream source
- The resolved source is no longer written back into `activeSource` (that fed the resolver and
  reloaded the video, so switching looked broken).
- Generation guard: a slow resolution for line A can never overwrite line B.
- Playhead is preserved across a line switch; the previous stream is torn down immediately.
- Subtitle/quality state is reset per line; the menu shows which line is actually serving.

### 6. Floating player
- New floating mini player: minimize the player into a draggable picture-in-picture-style
  window (position remembered) while browsing the catalogue, with play/pause, restore and close.
- Native Picture-in-Picture button (Chromium + iOS Safari fallback) next to it.

### 7. Replay not using the cache
- Cache root is stable and persistent (`<data>/cache`), and complete MP4/fMP4 segments are
  cached too (previously excluded, so every replay re-downloaded them).
- Cached segments return `X-Cache-Status: HIT` with `immutable` headers; eviction is LRU by
  access time and runs periodically.
- Subtitles: translated WebVTT is cached in memory **and** on disk for 7 days.

### 8. Japanese translation not working
- Translation responses are parsed correctly (`[[text, detectedLang]]` used to leak `"en"`
  into the last cue).
- Japanese → Japanese is detected and served as-is; Chinese tracks are converted locally.
- Whole-episode translation is batched (1.2 kB blocks, concurrency 6) under a hard time budget,
  returning partial results instead of a 504. A 300-cue episode: >60 s (timeout) → ~5 s.

### 9. Japanese / English titles in the search bar
- The dropdown used to show only "No matching searches" from local history and covered the real
  results grid. It now shows live anime matches from the server with covers and titles.
- Alias DB expanded with Japanese-native titles (ワンピース, ナルト, 鬼滅の刃, 葬送のフリーレン,
  …) and short names (aot, jjk, hxh, sao 3, …). Katakana-only queries that AniList mismatches
  now resolve through the alias table.

### 10. Smarter search
- New `GET /api/search/suggest` typeahead endpoint: alias expansion, season/part stripping,
  kana↔katakana retry, title scoring across romaji/English/native/Chinese.
- Keyboard navigation (↑/↓/Enter/Esc), one click opens the anime detail sheet.
- Query fan-out is capped (literal query first, aliases only when needed) to avoid AniList
  rate limiting; when AniList is unavailable the server answers from the in-memory catalogue
  instead of returning an empty screen.

### Verification
```bash
npm run build            # production bundle
node server/index.js &   # start the API
npm run verify:server    # 22 automated checks for the issues above
```
The UI was additionally smoke-tested in headless Chromium: home renders (hero + carousels),
typeahead shows real matches for 葬送のフリーレン / aot, clicking a suggestion opens the detail
sheet, the player plays HLS, and the floating mini player keeps playing at 416×234 with no
console errors.