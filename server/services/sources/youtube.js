// server/services/sources/youtube.js - YouTube Stream & Official PV Resolver
import { BoundedCache } from '../cache.js';
import { fetchOfficialYouTubePVs, getAnimeDetails } from '../metadata.js';

const youtubeCache = new BoundedCache(300, 60 * 60 * 1000); // 1 hr TTL

/**
 * Resolves a YouTube stream / official embed for an anime title or episode.
 * Prioritizes AniList official trailer, then queries YouTube for official PVs / trailers.
 */
export async function resolveYouTubeStream({ 
  title, 
  candidates = [], 
  episode = 1, 
  anilistId = null, 
  trailer = null 
}) {
  const rawTitle = title || candidates[0] || '';
  if (!rawTitle && !trailer?.id && !anilistId) {
    return {
      success: false,
      source: 'youtube',
      activeSource: 'youtube',
      error: 'Anime title or trailer information is required'
    };
  }

  const cacheKey = `yt_${anilistId || rawTitle}_ep${episode}`.toLowerCase();
  if (youtubeCache.has(cacheKey)) {
    return youtubeCache.get(cacheKey);
  }

  // 1. Direct trailer object passed from client
  if (trailer?.id && (trailer.site === 'youtube' || !trailer.site)) {
    const result = {
      success: true,
      source: 'youtube',
      activeSource: 'youtube',
      serverName: 'YouTube (官方宣傳預告 PV)',
      streamUrl: `https://www.youtube-nocookie.com/embed/${trailer.id}?autoplay=1&rel=0`,
      proxiedStreamUrl: `https://www.youtube-nocookie.com/embed/${trailer.id}?autoplay=1&rel=0`,
      isEmbed: true,
      isEmbedSource: true,
      videoId: trailer.id,
      episode: Number(episode),
      animeTitle: rawTitle,
      thumbnails: {
        jpg: `https://i.ytimg.com/vi/${trailer.id}/hqdefault.jpg`,
        webp: `https://i.ytimg.com/vi_webp/${trailer.id}/hqdefault.webp`,
        avif: `/api/proxy/image?url=${encodeURIComponent(`https://i.ytimg.com/vi/${trailer.id}/hqdefault.jpg`)}&format=avif`
      }
    };
    youtubeCache.set(cacheKey, result);
    return result;
  }

  // 2. Check AniList details if anilistId is available
  if (anilistId) {
    try {
      const details = await getAnimeDetails(Number(anilistId));
      if (details?.trailer?.id && (details.trailer?.site === 'youtube' || !details.trailer?.site)) {
        const trId = details.trailer.id;
        const result = {
          success: true,
          source: 'youtube',
          activeSource: 'youtube',
          serverName: 'YouTube (AniList 官方 PV)',
          streamUrl: `https://www.youtube-nocookie.com/embed/${trId}?autoplay=1&rel=0`,
          proxiedStreamUrl: `https://www.youtube-nocookie.com/embed/${trId}?autoplay=1&rel=0`,
          isEmbed: true,
          isEmbedSource: true,
          videoId: trId,
          episode: Number(episode),
          animeTitle: details.title?.romaji || rawTitle,
          thumbnails: {
            jpg: `https://i.ytimg.com/vi/${trId}/hqdefault.jpg`,
            webp: `https://i.ytimg.com/vi_webp/${trId}/hqdefault.webp`,
            avif: `/api/proxy/image?url=${encodeURIComponent(`https://i.ytimg.com/vi/${trId}/hqdefault.jpg`)}&format=avif`
          }
        };
        youtubeCache.set(cacheKey, result);
        return result;
      }
    } catch (err) {
      console.warn(`[YouTubeResolver] AniList details lookup error:`, err.message);
    }
  }

  // 3. Query YouTube search for official PVs / Trailers
  const queryCandidates = [
    rawTitle,
    ...(Array.isArray(candidates) ? candidates : [candidates])
  ].filter(Boolean);

  for (const q of queryCandidates) {
    try {
      const pvs = await fetchOfficialYouTubePVs(q);
      if (Array.isArray(pvs) && pvs.length > 0) {
        const topPv = pvs[0];
        const result = {
          success: true,
          source: 'youtube',
          activeSource: 'youtube',
          serverName: `YouTube (${topPv.badge || '官方 PV'})`,
          streamUrl: topPv.embedUrl || `https://www.youtube-nocookie.com/embed/${topPv.id}?autoplay=1&rel=0`,
          proxiedStreamUrl: topPv.embedUrl || `https://www.youtube-nocookie.com/embed/${topPv.id}?autoplay=1&rel=0`,
          isEmbed: true,
          isEmbedSource: true,
          videoId: topPv.id,
          episode: Number(episode),
          animeTitle: rawTitle,
          thumbnails: {
            jpg: `https://i.ytimg.com/vi/${topPv.id}/hqdefault.jpg`,
            webp: `https://i.ytimg.com/vi_webp/${topPv.id}/hqdefault.webp`,
            avif: `/api/proxy/image?url=${encodeURIComponent(`https://i.ytimg.com/vi/${topPv.id}/hqdefault.jpg`)}&format=avif`
          }
        };
        youtubeCache.set(cacheKey, result);
        return result;
      }
    } catch (err) {
      console.warn(`[YouTubeResolver] Query error for "${q}":`, err.message);
    }
  }

  return {
    success: false,
    source: 'youtube',
    activeSource: 'youtube',
    error: `找不到《${rawTitle}》的 YouTube 官方預告或影片資源。`
  };
}

export default { resolveYouTubeStream };
