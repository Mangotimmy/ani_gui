// server/services/sources/framextv.js - FramexTV HD Stream & Embed Resolver
import { BoundedCache } from '../cache.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const REFERER = 'https://framextv.xyz/';
const framexCache = new BoundedCache(150, 30 * 60 * 1000); // 30m TTL

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

  // 1. Try Direct FramexTV Anime Streaming API
  if (targetAnilistId) {
    try {
      const apiUrl = `https://api.framextv.tech/anime/api/stream?id=${targetAnilistId}&season=${seasonNum}&episode=${epNum}&sub_type=${subMode}`;
      const apiRes = await fetch(apiUrl, {
        headers: { 'User-Agent': USER_AGENT, 'Referer': REFERER },
        signal: AbortSignal.timeout(6000)
      });

      if (apiRes.ok) {
        const data = await apiRes.json();
        if (data?.success && Array.isArray(data.sources) && data.sources.length > 0) {
          let sourceUrl = data.sources[0].url || '';
          if (sourceUrl.startsWith('/')) {
            sourceUrl = 'https://api.framextv.tech' + sourceUrl;
          }

          const rawReferer = data.sources[0].headers?.Referer || 'https://megaplay.buzz/';
          const proxiedStreamUrl = `/api/proxy?url=${encodeURIComponent(sourceUrl)}&referer=${encodeURIComponent(rawReferer)}`;

          // Format subtitles
          const subtitles = (data.subtitles || []).map(s => {
            let subUrl = s.url || '';
            if (subUrl.startsWith('/')) {
              subUrl = 'https://api.framextv.tech' + subUrl;
            }
            return {
              lang: s.label || s.lang || s.language || 'English',
              url: subUrl,
              default: s.lang === 'en' || s.language === 'en'
            };
          });

          const proxiedSubtitles = subtitles.map(s => ({
            ...s,
            url: `/api/proxy?url=${encodeURIComponent(s.url)}&referer=${encodeURIComponent(rawReferer)}`
          }));

          const embedUrl = `https://framextv.xyz/embed/anime?id=${targetAnilistId}&season=${seasonNum}&episode=${epNum}&sub_type=${subMode}`;

          const result = {
            success: true,
            source: 'framextv',
            serverName: `FramexTV (${data.server || 'Direct 1080p HLS'})`,
            mode: subMode,
            episode: epNum,
            streamUrl: sourceUrl,
            proxiedStreamUrl,
            isEmbed: false, // Plays natively in VideoPlayer!
            embedFallbackUrl: embedUrl,
            referer: rawReferer,
            subtitles,
            proxiedSubtitles
          };

          framexCache.set(cacheKey, result);
          return result;
        }
      }
    } catch (err) {
      console.warn('[FramexTV] Direct stream API failed, falling back to AnimeEmbed:', err.message);
    }
  }

  // 2. Fallback to FramexTV Dedicated AnimeEmbedPage (/embed/anime)
  const validAnilistId = targetAnilistId || encodeURIComponent((title || 'anime').toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  const embedUrl = `https://framextv.xyz/embed/anime?id=${validAnilistId}&season=${seasonNum}&episode=${epNum}&sub_type=${subMode}`;

  const result = {
    success: true,
    source: 'framextv',
    serverName: 'FramexTV (HD 內嵌播放器 / VidLink)',
    mode: subMode,
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

export default { resolveFramexStream };
