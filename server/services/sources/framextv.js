// server/services/sources/framextv.js - FramexTV HD Stream & Embed Resolver
import { BoundedCache } from '../cache.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const REFERER = 'https://framextv.xyz/';
const framexCache = new BoundedCache(150, 30 * 60 * 1000); // 30m TTL
const framexFailCache = new BoundedCache(150, 5 * 60 * 1000); // 5m negative cache

// Framex's own web client talks to several API hosts; several of them are dead and only
// produce CORS/404 errors in the browser. We query them server-side and only accept a
// result that we have verified is a real, playable stream.
const API_HOSTS = ['https://api.framextv.tech', 'https://api.framextv.cc', 'https://api.framextv.xyz'];

/**
 * Check that a stream URL really answers with playable media before we hand it to the player.
 */
async function validateStreamUrl(url, referer) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Referer': referer, 'Range': 'bytes=0-2047' },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok && res.status !== 206) return false;
    const type = (res.headers.get('content-type') || '').toLowerCase();
    const body = await res.text();
    if (/\.m3u8(\?|$)/i.test(url) || type.includes('mpegurl')) return body.trimStart().startsWith('#EXTM3U');
    return type.startsWith('video/') || type.includes('octet-stream');
  } catch {
    return false;
  }
}

/**
 * Helper to resolve AniList ID by title if missing
 */
async function resolveAniListIdByTitle(title, candidates = []) {
  const queryList = [title, ...(Array.isArray(candidates) ? candidates : [candidates])].filter(Boolean);
  const gqlQuery = `
    query ($search: String) {
      Media(search: $search, type: ANIME) {
        id
        title { romaji english native }
      }
    }
  `;

  for (const q of queryList) {
    if (!q || q.length < 2) continue;
    try {
      const resp = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': USER_AGENT },
        body: JSON.stringify({ query: gqlQuery, variables: { search: q } }),
        signal: AbortSignal.timeout(4000)
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data?.data?.Media?.id) {
          return data.data.Media.id;
        }
      }
    } catch {}
  }
  return null;
}

/**
 * Resolve FramexTV stream (Direct HLS API + Valid AnimeEmbedPage Fallback)
 */
export async function resolveFramexStream({ 
  title, 
  candidates = [], 
  episode = 1, 
  season = 1, 
  anilistId = null,
  tmdbId = null,
  mode = 'sub',
  isMovie = false 
}) {
  const epNum = Number(episode) || 1;
  const seasonNum = Number(season) || 1;
  const subMode = mode === 'dub' ? 'dub' : 'sub';

  let targetAnilistId = anilistId;
  if (!targetAnilistId && title) {
    targetAnilistId = await resolveAniListIdByTitle(title, candidates);
  }

  const cacheKey = `framex_${targetAnilistId || title}_s${seasonNum}_e${epNum}_${subMode}`.toLowerCase();
  if (framexCache.has(cacheKey)) {
    return framexCache.get(cacheKey);
  }
  if (framexFailCache.has(cacheKey)) {
    return framexFailCache.get(cacheKey);
  }

  // 1. Direct FramexTV streaming API (server-side, validated)
  if (targetAnilistId) {
    for (const host of API_HOSTS) {
      try {
        const apiUrl = `${host}/anime/api/stream?id=${targetAnilistId}&season=${seasonNum}&episode=${epNum}&sub_type=${subMode}`;
        const apiRes = await fetch(apiUrl, {
          headers: { 'User-Agent': USER_AGENT, 'Referer': REFERER },
          signal: AbortSignal.timeout(3500)
        });
        if (!apiRes.ok) continue;
        const data = await apiRes.json();
        if (!(data?.success && Array.isArray(data.sources) && data.sources.length > 0)) continue;

        let sourceUrl = data.sources[0].url || '';
        if (sourceUrl.startsWith('/')) sourceUrl = host + sourceUrl;
        if (!/^https?:\/\//i.test(sourceUrl)) continue;

        const rawReferer = data.sources[0].headers?.Referer || 'https://megaplay.buzz/';
        if (!(await validateStreamUrl(sourceUrl, rawReferer))) {
          console.warn(`[FramexTV] ${host} returned a stream that is not playable, skipping`);
          continue;
        }

        const proxiedStreamUrl = `/api/proxy?url=${encodeURIComponent(sourceUrl)}&referer=${encodeURIComponent(rawReferer)}`;
        const subtitles = (data.subtitles || []).map(s => {
          let subUrl = s.url || '';
          if (subUrl.startsWith('/')) subUrl = host + subUrl;
          return {
            lang: s.label || s.lang || s.language || 'English',
            url: subUrl,
            default: s.lang === 'en' || s.language === 'en'
          };
        }).filter(s => /^https?:\/\//i.test(s.url));
        const proxiedSubtitles = subtitles.map(s => ({
          ...s,
          url: `/api/proxy?url=${encodeURIComponent(s.url)}&referer=${encodeURIComponent(rawReferer)}`
        }));

        const result = {
          success: true,
          source: 'framextv',
          serverName: `FramexTV (${data.server || 'Direct 1080p HLS'})`,
          mode: subMode,
          episode: epNum,
          streamUrl: sourceUrl,
          proxiedStreamUrl,
          isEmbed: false, // Plays natively in VideoPlayer through /api/proxy (no browser CORS)
          referer: rawReferer,
          subtitles,
          proxiedSubtitles
        };
        framexCache.set(cacheKey, result);
        return result;
      } catch (err) {
        console.warn(`[FramexTV] ${host} stream API failed: ${err.message}`);
      }
    }
  }

  // 2. No verifiable stream. Do NOT fall back to the third-party embed page: its client calls
  //    dead backends (api.framextv.cc / .tech / .xyz) and ends in CORS errors on a broken
  //    player. Report unavailable so the resolver fails over to HiAnime / Anime1.
  const failure = {
    success: false,
    source: 'framextv',
    unavailable: true,
    error: `FramexTV 目前無法提供《${title || targetAnilistId || ''}》第 ${epNum} 集的可驗證串流，請改用其他來源。`
  };
  framexFailCache.set(cacheKey, failure);
  return failure;
}

export default { resolveFramexStream };
