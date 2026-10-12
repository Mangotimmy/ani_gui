// server/services/sources/framextv.js - FramexTV HD Stream Resolver
import { BoundedCache } from '../cache.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const framexCache = new BoundedCache(120, 30 * 60 * 1000); // 30m TTL

/**
 * Resolve FramexTV stream / embed URL
 */
export async function resolveFramexStream({ 
  title, 
  candidates = [], 
  episode = 1, 
  season = 1, 
  tmdbId = null,
  isMovie = false 
}) {
  const epNum = Number(episode) || 1;
  const seasonNum = Number(season) || 1;
  const cacheKey = `framex_${title}_s${seasonNum}_e${epNum}`.toLowerCase();

  if (framexCache.has(cacheKey)) {
    return framexCache.get(cacheKey);
  }

  // 1. If explicit TMDB ID is available
  if (tmdbId) {
    const embedUrl = isMovie
      ? `https://framextv.xyz/embed/movie/${tmdbId}`
      : `https://framextv.xyz/embed/tv/${tmdbId}/${seasonNum}/${epNum}`;

    const result = {
      success: true,
      source: 'framextv',
      serverName: 'FramexTV (HD 多伺服器 / VidLink)',
      mode: 'sub',
      episode: epNum,
      streamUrl: embedUrl,
      proxiedStreamUrl: embedUrl,
      isEmbed: true,
      referer: 'https://framextv.xyz/',
      subtitles: [],
      proxiedSubtitles: []
    };
    framexCache.set(cacheKey, result);
    return result;
  }

  // 2. Query TMDB search API if title provided
  try {
    const query = (title || (Array.isArray(candidates) ? candidates[0] : candidates) || '').trim();
    if (!query) throw new Error('No query provided for FramexTV');

    let resolvedTmdbId = null;

    // Search TMDB public endpoint for matching series
    try {
      const tmdbSearchUrl = `https://api.themoviedb.org/3/search/tv?api_key=e86e3f5d5e5c7a5f6e8d1234567890ab&query=${encodeURIComponent(query)}`;
      const tmdbRes = await fetch(tmdbSearchUrl, { headers: { 'User-Agent': USER_AGENT } });
      if (tmdbRes.ok) {
        const tmdbData = await tmdbRes.json();
        if (tmdbData.results && tmdbData.results[0]) {
          resolvedTmdbId = tmdbData.results[0].id;
        }
      }
    } catch {}

    // Fallback: slug-based embed endpoint
    const finalId = resolvedTmdbId || encodeURIComponent(query.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    const embedUrl = isMovie
      ? `https://framextv.xyz/embed/movie/${finalId}`
      : `https://framextv.xyz/embed/tv/${finalId}/${seasonNum}/${epNum}`;

    const result = {
      success: true,
      source: 'framextv',
      serverName: 'FramexTV (HD 多伺服器 / VidLink)',
      mode: 'sub',
      episode: epNum,
      streamUrl: embedUrl,
      proxiedStreamUrl: embedUrl,
      isEmbed: true,
      referer: 'https://framextv.xyz/',
      subtitles: [],
      proxiedSubtitles: []
    };

    framexCache.set(cacheKey, result);
    return result;
  } catch (err) {
    return {
      success: false,
      source: 'framextv',
      error: `FramexTV: ${err.message}`
    };
  }
}

export default { resolveFramexStream };
