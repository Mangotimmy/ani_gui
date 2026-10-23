// server/services/segmentPrefetcher.js - Background HLS readahead
//
// Playback used to start cold: the browser asked for segment N, our server had to fetch it
// from the CDN before a single byte reached <video>, and every seek paid the same toll.
// This module warms the disk cache ahead of the playhead so the built-in cache actually
// serves the first seconds (and the next ones) instantly.
//
// It is deliberately conservative: two parallel upstream downloads, a small bounded queue,
// no retries, and it never blocks a user request.
import { mediaCache } from './mediaCache.js';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const MAX_CONCURRENT = Number(process.env.ANIFLIX_PREFETCH_CONCURRENCY || 2);
const MAX_QUEUE = Number(process.env.ANIFLIX_PREFETCH_QUEUE || 48);

const queue = [];
const queued = new Set();
const inFlight = new Set();
let active = 0;

function enqueue(job) {
  if (!job?.url) return;
  if (queued.has(job.url) || inFlight.has(job.url)) return;
  if (mediaCache.hasSegment(job.url)) return;
  if (queue.length >= MAX_QUEUE) return;
  queued.add(job.url);
  queue.push(job);
  pump();
}

function pump() {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift();
    queued.delete(job.url);
    active++;
    inFlight.add(job.url);
    download(job)
      .catch(() => {})
      .finally(() => {
        active--;
        inFlight.delete(job.url);
        pump();
      });
  }
}

async function download({ url, referer, cookies }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        'Referer': referer || 'https://zokoanime.video/',
        'Accept': '*/*',
        ...(cookies ? { Cookie: cookies } : {})
      },
      signal: controller.signal
    });
    if (!res.ok) return;
    const contentLength = Number(res.headers.get('content-length') || 0);
    if (contentLength > mediaCache.maxSingleFileBytes) return;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length || buffer.length > mediaCache.maxSingleFileBytes) return;
    mediaCache.saveSegmentBuffer(url, buffer);
  } catch {
    // Prefetch is best-effort: a failure must never surface to the user.
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Queue individual segment URLs for background caching.
 */
export function prefetchSegments(urls, { referer, cookies } = {}) {
  if (!Array.isArray(urls)) return 0;
  let added = 0;
  for (const url of urls) {
    if (!url) continue;
    const before = queue.length;
    enqueue({ url, referer, cookies });
    if (queue.length > before) added++;
  }
  return added;
}

function parsePlaylistLines(text) {
  const lines = String(text || '').split(/\r?\n/);
  const isMaster = lines.some(l => l.trim().startsWith('#EXT-X-STREAM-INF'));
  const uris = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    uris.push(line);
  }
  return { isMaster, uris };
}

function absoluteUri(uri, baseUrl) {
  try {
    return new URL(uri, baseUrl).href;
  } catch {
    return null;
  }
}

/**
 * Fetch a (rewritten or original) HLS playlist and warm the first `limit` media segments.
 * For a master playlist only the first variant is inspected — that is the one hls.js starts
 * with by default, so it is the one that decides time-to-first-frame.
 */
export async function prefetchFromPlaylistText(text, baseUrl, { referer, cookies, limit = 6 } = {}) {
  try {
    const { isMaster, uris } = parsePlaylistLines(text);
    if (isMaster) {
      const variant = uris.map(u => absoluteUri(u, baseUrl)).filter(Boolean)[0];
      if (!variant) return 0;
      return prefetchPlaylist(variant, { referer, cookies, limit });
    }
    const absolute = uris.map(u => absoluteUri(u, baseUrl)).filter(Boolean);
    return prefetchSegments(absolute.slice(0, limit), { referer, cookies });
  } catch {
    return 0;
  }
}

export async function prefetchPlaylist(playlistUrl, { referer, cookies, limit = 6 } = {}) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(playlistUrl, {
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        'Referer': referer || 'https://zokoanime.video/',
        'Accept': '*/*',
        ...(cookies ? { Cookie: cookies } : {})
      },
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) return 0;
    const text = await res.text();
    const baseUrl = res.url || playlistUrl;
    const { isMaster, uris } = parsePlaylistLines(text);

    if (isMaster) {
      const variant = uris.map(u => absoluteUri(u, baseUrl)).filter(Boolean)[0];
      if (!variant) return 0;
      // Only one level of recursion: master -> media playlist -> segments.
      return prefetchPlaylist(variant, { referer, cookies, limit });
    }

    const absolute = uris.map(u => absoluteUri(u, baseUrl)).filter(Boolean);
    return prefetchSegments(absolute.slice(0, limit), { referer, cookies });
  } catch {
    return 0;
  }
}

export default { prefetchSegments, prefetchPlaylist, prefetchFromPlaylistText };
