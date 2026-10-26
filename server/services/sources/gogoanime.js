// server/services/sources/gogoanime.js - Gogoanime / Anitaku Stream Resolver
// Multi-mirror scraper with direct Vidmoly 1080p HLS extraction & MegaPlay HD Embed fallback
import { BoundedCache } from '../cache.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const GOGO_MIRRORS = [
  'https://gogoanimes.fi',
  'https://gogoanime3.co',
  'https://anitaku.pe'
];

const gogoCache = new BoundedCache(200, 30 * 60 * 1000); // 30m TTL
const gogoFailCache = new BoundedCache(150, 5 * 60 * 1000); // 5m negative cache

function normalizeForMatching(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[\(\)\[\]\{\}\:;,\.!\?'"–—\-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function calculateMatchScore(query, title) {
  const qNorm = normalizeForMatching(query);
  const tNorm = normalizeForMatching(title);
  if (!qNorm || !tNorm) return 0;
  if (qNorm === tNorm) return 1.0;
  if (tNorm.includes(qNorm) || qNorm.includes(tNorm)) {
    return Math.min(qNorm.length, tNorm.length) / Math.max(qNorm.length, tNorm.length);
  }
  const qTokens = new Set(qNorm.split(' ').filter(w => w.length > 2));
  const tTokens = new Set(tNorm.split(' ').filter(w => w.length > 2));
  if (qTokens.size === 0 || tTokens.size === 0) return 0;
  let common = 0;
  for (const t of qTokens) {
    if (tTokens.has(t)) common++;
  }
  return (2 * common) / (qTokens.size + tTokens.size);
}

/**
 * Search Gogoanime mirror for anime candidates
 */
async function searchMirror(mirror, query, isDub = false) {
  try {
    const url = `${mirror}/search.html?keyword=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(4500)
    });
    if (!res.ok) return [];

    const html = await res.text();
    const regex = /<p class="name">\s*<a href="([^"]+)" title="([^"]+)">/g;
    let m;
    const items = [];
    while ((m = regex.exec(html)) !== null) {
      const href = m[1];
      const title = m[2].trim();
      const slug = href.replace('/category/', '').trim();
      const itemIsDub = slug.endsWith('-dub') || /\bdub\b/i.test(title);
      items.push({ slug, title, isDub: itemIsDub });
    }

    if (isDub) {
      // Prioritize dub items
      return items.filter(i => i.isDub).concat(items.filter(i => !i.isDub));
    }
    // Sub: prioritize non-dub items
    return items.filter(i => !i.isDub).concat(items.filter(i => i.isDub));
  } catch {
    return [];
  }
}

/**
 * Validate that an M3U8 URL is reachable and returns #EXTM3U
 */
async function validateM3u8(url, referer) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Referer': referer },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return false;
    const text = await res.text();
    return text.trimStart().startsWith('#EXTM3U');
  } catch {
    return false;
  }
}

/**
 * Extract direct M3U8 from Vidmoly embed URL
 */
async function extractVidmolyM3u8(vidmolyUrl, referer) {
  try {
    let cleanUrl = vidmolyUrl.trim();
    if (cleanUrl.startsWith('//')) cleanUrl = 'https:' + cleanUrl;
    const res = await fetch(cleanUrl, {
      headers: { 'User-Agent': USER_AGENT, 'Referer': referer },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m3u8Match = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i);
    if (!m3u8Match) return null;

    const m3u8Url = m3u8Match[0];
    const isValid = await validateM3u8(m3u8Url, 'https://vidmoly.net/');
    return isValid ? m3u8Url : null;
  } catch {
    return null;
  }
}

/**
 * Main Gogoanime Stream Resolver
 */
export async function resolveGogoanimeStream({
  title,
  candidates = [],
  episode = 1,
  mode = 'sub',
  season = 1
}) {
  const isDub = mode === 'dub';
  const epNum = Number(episode) || 1;
  const seasonNum = Number(season) || 1;

  // Build query list
  const rawList = [
    ...(Array.isArray(candidates) ? candidates : [candidates]),
    title
  ].filter(Boolean);

  const queryList = [];
  for (const q of rawList) {
    if (!q || q.length < 2) continue;
    // Don't search purely Chinese/Japanese characters on Gogoanime
    if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\s\d\-_]+$/u.test(q)) continue;

    queryList.push(q);

    // If season > 1, add season explicit query
    if (seasonNum > 1 && !new RegExp(`season\\s*${seasonNum}|part\\s*${seasonNum}`, 'i').test(q)) {
      queryList.push(`${q} Season ${seasonNum}`);
      queryList.push(`${q} Part ${seasonNum}`);
    }

    // Also stripped version if subtitle/colon
    const stripped = q.replace(/[:\-–—].*$/, '').trim();
    if (stripped && stripped.toLowerCase() !== q.toLowerCase() && stripped.length >= 3) {
      queryList.push(stripped);
      if (seasonNum > 1) {
        queryList.push(`${stripped} Season ${seasonNum}`);
      }
    }
  }

  // Deduplicate queries
  const uniqueQueries = Array.from(new Set(queryList.map(q => q.trim()).filter(Boolean)));
  if (uniqueQueries.length === 0) {
    return {
      success: false,
      source: 'gogoanime',
      error: `Gogoanime 無法匹配非英數之標題：「${title}」。`
    };
  }

  const cacheKey = `gogo_${uniqueQueries[0]}_s${seasonNum}_e${epNum}_${mode}`.toLowerCase();
  if (gogoCache.has(cacheKey)) {
    return gogoCache.get(cacheKey);
  }
  if (gogoFailCache.has(cacheKey)) {
    return gogoFailCache.get(cacheKey);
  }

  for (const mirror of GOGO_MIRRORS) {
    for (const q of uniqueQueries) {
      try {
        let results = await searchMirror(mirror, q, isDub);
        if (results.length === 0 && isDub) {
          // Fall back to sub if dub is requested but not found
          results = await searchMirror(mirror, q, false);
        }
        if (results.length === 0) continue;

        // Score results
        const scored = results
          .map(r => ({ ...r, score: calculateMatchScore(q, r.title) }))
          .sort((a, b) => b.score - a.score);

        const best = scored[0];
        if (!best || best.score < 0.32) continue;

        const epUrl = `${mirror}/${best.slug}-episode-${epNum}`;
        const epRes = await fetch(epUrl, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(5000)
        });
        if (!epRes.ok) continue;

        const epHtml = await epRes.text();

        // 1. Check for Vidmoly direct M3U8
        const vidmolyMatch = epHtml.match(/data-video="([^"]*vidmoly[^"]*)"/i);
        if (vidmolyMatch) {
          const directM3u8 = await extractVidmolyM3u8(vidmolyMatch[1], mirror);
          if (directM3u8) {
            const proxiedStreamUrl = `/api/proxy?url=${encodeURIComponent(directM3u8)}&referer=${encodeURIComponent('https://vidmoly.net/')}`;
            const result = {
              success: true,
              source: 'gogoanime',
              serverName: `Gogoanime (Direct 1080p HLS · ${best.isDub ? 'Dub' : 'Sub'})`,
              mode: best.isDub ? 'dub' : 'sub',
              episode: epNum,
              streamUrl: directM3u8,
              proxiedStreamUrl,
              isEmbed: false,
              referer: 'https://vidmoly.net/',
              subtitles: [],
              proxiedSubtitles: []
            };
            gogoCache.set(cacheKey, result);
            return result;
          }
        }

        // 2. Fall back to clean responsive Embed player (MegaPlay / Gogo Player)
        const iframeMatch = epHtml.match(/<iframe[^>]+src="([^"]+)"/i);
        if (iframeMatch) {
          let embedUrl = iframeMatch[1];
          if (embedUrl.startsWith('//')) embedUrl = 'https:' + embedUrl;
          const result = {
            success: true,
            source: 'gogoanime',
            serverName: `Gogoanime (MegaPlay HD · ${best.isDub ? 'Dub' : 'Sub'})`,
            mode: best.isDub ? 'dub' : 'sub',
            episode: epNum,
            streamUrl: embedUrl,
            proxiedStreamUrl: embedUrl,
            isEmbed: true,
            referer: mirror,
            subtitles: [],
            proxiedSubtitles: []
          };
          gogoCache.set(cacheKey, result);
          return result;
        }
      } catch (err) {
        console.warn(`[Gogoanime] Mirror ${mirror} failed for "${q}":`, err.message);
      }
    }
  }

  const failure = {
    success: false,
    source: 'gogoanime',
    error: `Gogoanime 目前找不到《${title}》第 ${epNum} 集的播放線路。`
  };
  gogoFailCache.set(cacheKey, failure);
  return failure;
}

export default { resolveGogoanimeStream };
