// server/services/streamResolver.js - Native high-speed anime stream resolver
// Scrapes HiAnime/ZokoAnime streaming endpoints directly without CLI/Bash overhead
import './dnsFallback.js';
import { BoundedCache } from './cache.js';
import { resolveAnime1Stream } from './sources/anime1.js';
import { resolveFramexStream } from './sources/framextv.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const DEOBFUSCATE_KEY = Buffer.from('otaku-embed-v1', 'utf-8');

// In-memory bounded cache for fast episode switching without heap leaks
const searchCache = new BoundedCache(200, 30 * 60 * 1000); // 30m TTL
const episodesCache = new BoundedCache(200, 60 * 60 * 1000); // 1h TTL

const DEFAULT_REFERER = 'https://zokoanime.video/';

// 1. Search Anime with multi-candidate queries and strict similarity cutoff
function normalizeForMatching(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[\(\)\[\]\{\}\:;,\.!\?'"–—\-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function calculateMatchScore(query, item) {
  const qNorm = normalizeForMatching(query);
  const titleNorm = normalizeForMatching(item.title);
  const jnameNorm = normalizeForMatching(item.jname);

  if (!qNorm) return 0;
  if (qNorm === jnameNorm || qNorm === titleNorm) return 1.0;

  if (jnameNorm && (jnameNorm.includes(qNorm) || qNorm.includes(jnameNorm))) {
    return Math.min(qNorm.length, jnameNorm.length) / Math.max(qNorm.length, jnameNorm.length);
  }
  if (titleNorm && (titleNorm.includes(qNorm) || qNorm.includes(titleNorm))) {
    return Math.min(qNorm.length, titleNorm.length) / Math.max(qNorm.length, titleNorm.length);
  }

  // Token overlap (ignore 1-2 char words)
  const qTokens = new Set(qNorm.split(' ').filter(w => w.length > 2));
  const tTokens = new Set((titleNorm + ' ' + jnameNorm).split(' ').filter(w => w.length > 2));
  if (qTokens.size === 0 || tTokens.size === 0) return 0;

  let common = 0;
  for (const t of qTokens) {
    if (tTokens.has(t)) common++;
  }
  return (2 * common) / (qTokens.size + tTokens.size);
}

async function searchSingleQuery(query) {
  const cleanQuery = query.toLowerCase().trim();
  if (!cleanQuery) return null;
  if (searchCache.has(cleanQuery)) {
    return searchCache.get(cleanQuery);
  }

  const url = `https://hianime.at/search?keyword=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT }
  });

  if (!res.ok) {
    return null;
  }

  const html = await res.text();
  const items = [...html.matchAll(/<h3 class="film-name">\s*<a\s+([^>]+)>/g)].map(m => {
    const attrs = m[1];
    const href = (attrs.match(/href="([^"]+)"/) || [])[1] || '';
    const title = (attrs.match(/title="([^"]+)"/) || [])[1] || '';
    const jname = (attrs.match(/data-jname="([^"]+)"/) || [])[1] || '';
    const slug = href.split('/').pop();
    return {
      slug,
      id: slug.split('-').pop(),
      title,
      jname
    };
  });

  if (items.length === 0) {
    return null;
  }

  // Score all items against query
  const scored = items
    .map(item => ({ ...item, score: calculateMatchScore(query, item) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  // Strict cutoff: only accept if score >= 0.40
  if (best && best.score >= 0.40) {
    searchCache.set(cleanQuery, best);
    return best;
  }

  return null;
}

async function searchAnime(queryOrCandidates) {
  let queries = [];
  if (Array.isArray(queryOrCandidates)) {
    queries = queryOrCandidates;
  } else if (typeof queryOrCandidates === 'string') {
    queries = queryOrCandidates.split(/\|\||\||,/);
  }

  queries = Array.from(new Set(queries.map(q => (q || '').trim()).filter(Boolean)));
  if (queries.length === 0) {
    throw new Error('No valid anime title query provided');
  }

  for (const q of queries) {
    const result = await searchSingleQuery(q);
    if (result) {
      return result;
    }
    // Also try stripped version if title contains subtitles/colons
    const stripped = q.replace(/[:\-–—].*$/, '').trim();
    if (stripped && stripped.toLowerCase() !== q.toLowerCase()) {
      const strippedRes = await searchSingleQuery(stripped);
      if (strippedRes) return strippedRes;
    }
    // Try stripping season suffix e.g. "Season 3", "3rd Season", "Part 2", "第三季", "第3期"
    const noSeason = q.replace(/(season\s*\d+|part\s*\d+|\d+(st|nd|rd|th)\s*season|第[一二三四五六七八九十\d]+[季期])/gi, '').trim();
    if (noSeason && noSeason.length > 2 && noSeason.toLowerCase() !== q.toLowerCase()) {
      const noSeasonRes = await searchSingleQuery(noSeason);
      if (noSeasonRes) return noSeasonRes;
    }
  }

  throw new Error(`No anime results matching: "${queries.join('", "')}"`);
}

// 2. Fetch Episodes List
async function getEpisodeMap(animeId) {
  if (episodesCache.has(animeId)) {
    return episodesCache.get(animeId);
  }

  const url = `https://hianime.at/api/theme/episode/list/${animeId}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT }
  });

  if (!res.ok) {
    throw new Error(`Episode list fetch failed with status ${res.status}`);
  }

  const data = await res.json();
  if (!data || !data.html) {
    throw new Error('Invalid episode list response');
  }

  const matches = [...data.html.matchAll(/data-number="([^"]*)"[^>]*data-id="([0-9]+)"/g)];
  if (matches.length === 0) {
    throw new Error('No episodes extracted from list');
  }

  const epMap = new Map();
  for (const m of matches) {
    epMap.set(String(m[1]), m[2]);
  }

  episodesCache.set(animeId, epMap);
  return epMap;
}

// 3. Fetch Server Embed URL
async function getServerEmbed(episodeId, mode = 'sub') {
  const url = `https://hianime.at/api/theme/episode/servers?episodeId=${episodeId}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT }
  });

  if (!res.ok) {
    throw new Error(`Servers fetch failed with status ${res.status}`);
  }

  const data = await res.json();
  if (!data || !data.html) {
    throw new Error('Invalid servers response');
  }

  const matches = [...data.html.matchAll(/data-type="([^"]*)"\s*data-server-name="([^"]*)"\s*data-hash="([^"]*)"/g)];
  if (matches.length === 0) {
    throw new Error('No streaming servers available for this episode');
  }

  // Preference order: Target mode with ZokoAnime -> Target mode with any server -> First available
  const target = matches.find(m => m[1] === mode && m[2] === 'ZokoAnime') ||
                 matches.find(m => m[1] === mode) ||
                 matches[0];

  const embedUrl = Buffer.from(target[3], 'base64').toString('utf-8');
  return {
    embedUrl,
    serverName: target[2],
    mode: target[1]
  };
}

// 4. Deobfuscate Stream URL and Subtitles
async function extractStream(embedUrl) {
  const res = await fetch(embedUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      'Referer': 'https://hianime.at/'
    }
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch embed page (${res.status})`);
  }

  const html = await res.text();
  const match = html.match(/window\.__P\s*=\s*"([^"]*)"/);
  if (!match) {
    throw new Error('Streaming signature window.__P not found on embed page');
  }

  const blob = match[1];
  const buf = Buffer.from(blob, 'base64');
  const out = Buffer.alloc(buf.length);

  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i] ^ DEOBFUSCATE_KEY[i % DEOBFUSCATE_KEY.length];
  }

  const streamConfig = JSON.parse(out.toString('utf-8'));
  return streamConfig;
}

export function buildSourceList(activeId = 'auto') {
  return [
    { id: 'auto', name: '自動線路 (Auto Failover)', badge: '推薦', active: activeId === 'auto' },
    { id: 'anime1', name: 'Anime1.me (1080p MP4 / 原生繁中硬字)', badge: '繁中', active: activeId === 'anime1' },
    { id: 'framextv', name: 'FramexTV (HD 多伺服器 / VidLink)', badge: '備用', active: activeId === 'framextv' },
    { id: 'hianime', name: 'HiAnime / Zoko (多畫質 HLS / 多國字幕)', badge: '國際', active: activeId === 'hianime' }
  ];
}

// Main Export: Resolve stream for any anime with multi-source support
export async function resolveStream({ 
  animeTitle, 
  candidates = [], 
  episode = 1, 
  mode = 'sub', 
  quality = 'best', 
  maxAiredCap = null, 
  source = 'auto',
  tmdbId = null,
  anilistId = null,
  season = 1,
  synonyms = []
}) {
  const queryCandidates = [
    ...(Array.isArray(candidates) ? candidates : (typeof candidates === 'string' ? candidates.split(/\|\||\||,/) : [])),
    ...(Array.isArray(synonyms) ? synonyms : []),
    animeTitle
  ].filter(Boolean);

  console.log(`[StreamResolver] Resolving stream for [${queryCandidates.join(', ')}] Ep ${episode} (${mode}, Source: ${source}, AniList: ${anilistId || 'n/a'})...`);

  if (maxAiredCap !== null && maxAiredCap !== undefined && Number(maxAiredCap) > 0 && Number(episode) > Number(maxAiredCap)) {
    return {
      success: false,
      error: `Episode ${episode} has not officially aired yet (Latest aired episode: ${maxAiredCap})`,
      animeTitle,
      episode,
      mode
    };
  }

  // 1. Explicit Anime1 selection
  if (source === 'anime1') {
    const a1Res = await resolveAnime1Stream({ title: animeTitle, candidates: queryCandidates, episode });
    if (a1Res && a1Res.success) {
      return {
        ...a1Res,
        activeSource: 'anime1',
        availableSources: buildSourceList('anime1')
      };
    }
    return {
      success: false,
      activeSource: 'anime1',
      availableSources: buildSourceList('anime1'),
      error: a1Res?.error || `Anime1 找不到《${animeTitle}》第 ${episode} 集。`,
      suggestedFallback: 'hianime'
    };
  }

  // 2. Explicit FramexTV selection
  if (source === 'framextv') {
    const fxRes = await resolveFramexStream({ 
      title: animeTitle, 
      candidates: queryCandidates, 
      episode, 
      season, 
      anilistId, 
      tmdbId, 
      mode 
    });
    if (fxRes && fxRes.success) {
      return {
        ...fxRes,
        activeSource: 'framextv',
        availableSources: buildSourceList('framextv')
      };
    }
    return {
      success: false,
      activeSource: 'framextv',
      availableSources: buildSourceList('framextv'),
      error: fxRes?.error || `FramexTV 找不到《${animeTitle}》第 ${episode} 集。`,
      suggestedFallback: 'hianime'
    };
  }

  // 3. HiAnime resolution (used for source === 'hianime' or primary in source === 'auto')
  let hiAnimeError = null;
  try {
    const anime = await searchAnime(queryCandidates);
    console.log(`[StreamResolver] Matched Anime: "${anime.title}" (ID: ${anime.id})`);

    const epMap = await getEpisodeMap(anime.id);
    const epId = epMap.get(String(episode)) || epMap.values().next().value;
    if (!epId) {
      throw new Error(`Episode ${episode} not found in episode list`);
    }

    const serverInfo = await getServerEmbed(epId, mode);
    const streamConfig = await extractStream(serverInfo.embedUrl);
    if (!streamConfig || !streamConfig.src) {
      throw new Error('Stream playlist URL missing in decrypted payload');
    }

    console.log(`[StreamResolver] Successfully extracted master M3U8: ${streamConfig.src}`);
    const proxiedStreamUrl = `/api/proxy?url=${encodeURIComponent(streamConfig.src)}&referer=${encodeURIComponent(DEFAULT_REFERER)}`;

    // Parse subtitles format
    const isTradZh = (label) => /(繁|繁體|繁体|traditional|\b(cht|tc|tw|hk|zh-tw|zh-hk)\b)/i.test(label) && !/\bdutch\b/i.test(label);
    const isSimpZh = (label) => /(简|簡|简体|簡體|simplified|\b(chs|sc|cn|zh-cn|zh-sg)\b)/i.test(label) && !/traditional/i.test(label);
    const isAnyZh = (label) => isTradZh(label) || isSimpZh(label) || /chinese|中文|\bzh\b/i.test(label);

    const rawSubtitles = (streamConfig.subtitles || []).map(s => {
      const origLang = s.label || s.lang || 'Subtitles';
      let cleanLang = origLang;
      if (isTradZh(origLang)) {
        cleanLang = `繁體中文 (官方 / CHT) - ${origLang.replace(/chinese/i, '').replace(/[\(\)\[\]\-]/g, ' ').trim() || 'Full'}`.trim();
      } else if (isSimpZh(origLang)) {
        cleanLang = `简体中文 (官方 / CHS) - ${origLang.replace(/chinese/i, '').replace(/[\(\)\[\]\-]/g, ' ').trim() || 'Full'}`.trim();
      }

      return {
        lang: cleanLang,
        rawLang: origLang,
        url: s.src,
        default: !!s.default
      };
    });

    const hasChineseSub = rawSubtitles.some(s => isAnyZh(s.rawLang || s.lang));

    let sortedSubtitles = [...rawSubtitles].sort((a, b) => {
      const aTrad = isTradZh(a.rawLang || a.lang) ? 2 : (isSimpZh(a.rawLang || a.lang) ? 1 : 0);
      const bTrad = isTradZh(b.rawLang || b.lang) ? 2 : (isSimpZh(b.rawLang || b.lang) ? 1 : 0);
      return bTrad - aTrad;
    });

    if (hasChineseSub) {
      const topZh = sortedSubtitles.find(s => isAnyZh(s.rawLang || s.lang));
      if (topZh) {
        sortedSubtitles.forEach(s => { s.default = false; });
        topZh.default = true;
      }
    } else {
      const baseSub = rawSubtitles.find(s => s.default) || rawSubtitles[0];
      if (baseSub && baseSub.url) {
        const zhTwSub = {
          lang: '繁體中文 (TW/HK - AI繁中)',
          url: `/api/subtitles/translate?url=${encodeURIComponent(baseSub.url)}&referer=${encodeURIComponent(DEFAULT_REFERER)}&to=zh-TW`,
          default: true,
          isAutoTranslated: true
        };
        const zhCnSub = {
          lang: '简体中文 (CN - AI简中)',
          url: `/api/subtitles/translate?url=${encodeURIComponent(baseSub.url)}&referer=${encodeURIComponent(DEFAULT_REFERER)}&to=zh-CN`,
          default: false,
          isAutoTranslated: true
        };
        sortedSubtitles.unshift(zhTwSub, zhCnSub);
      }
    }

    const subtitles = sortedSubtitles;
    const proxiedSubtitles = sortedSubtitles.map(s => ({
      ...s,
      url: s.isAutoTranslated ? s.url : `/api/proxy?url=${encodeURIComponent(s.url)}&referer=${encodeURIComponent(DEFAULT_REFERER)}`
    }));

    return {
      success: true,
      animeTitle: anime.title,
      episode: Number(episode),
      mode: serverInfo.mode,
      activeSource: 'hianime',
      serverName: `${serverInfo.serverName} (Multi-Quality HLS)`,
      availableSources: buildSourceList('hianime'),
      streamUrl: streamConfig.src,
      proxiedStreamUrl,
      subtitles,
      proxiedSubtitles,
      referer: DEFAULT_REFERER
    };
  } catch (err) {
    hiAnimeError = err.message;
    console.warn(`[StreamResolver] HiAnime failed: ${err.message}. Checking alternative sources...`);
  }

  // 4. Fallback in 'auto' mode: Try Anime1
  if (source === 'auto') {
    try {
      const a1Res = await resolveAnime1Stream({ title: animeTitle, candidates: queryCandidates, episode });
      if (a1Res && a1Res.success) {
        console.log(`[StreamResolver] Auto-fallback to Anime1 succeeded for "${animeTitle}" Ep ${episode}`);
        return {
          ...a1Res,
          activeSource: 'anime1',
          availableSources: buildSourceList('anime1')
        };
      }
    } catch {}

    // Try FramexTV fallback (Direct API or Embed)
    try {
      const fxRes = await resolveFramexStream({ 
        title: animeTitle, 
        candidates: queryCandidates, 
        episode, 
        season, 
        anilistId, 
        tmdbId, 
        mode 
      });
      if (fxRes && fxRes.success) {
        console.log(`[StreamResolver] Auto-fallback to FramexTV succeeded for "${animeTitle}" Ep ${episode}`);
        return {
          ...fxRes,
          activeSource: 'framextv',
          availableSources: buildSourceList('framextv')
        };
      }
    } catch {}
  }

  return {
    success: false,
    error: hiAnimeError || `無法取得《${animeTitle}》第 ${episode} 集的串流資源。`,
    animeTitle,
    episode,
    mode,
    availableSources: buildSourceList('hianime')
  };
}

// Fetch all currently uploaded / released episodes for an anime
export async function getAvailableEpisodes(queryOrCandidates, forceRefresh = false, maxAiredCap = null) {
  let queries = [];
  if (Array.isArray(queryOrCandidates)) {
    queries = queryOrCandidates;
  } else if (typeof queryOrCandidates === 'string') {
    queries = queryOrCandidates.split(/\|\||\||,/);
  }
  queries = Array.from(new Set(queries.map(q => (q || '').trim()).filter(Boolean)));
  if (queries.length === 0) {
    return { success: false, error: 'Anime title is required', uploadedEpisodes: [] };
  }

  const cacheKey = queries.join(';').toLowerCase();
  if (forceRefresh) {
    searchCache.delete(cacheKey);
  }

  try {
    const anime = await searchAnime(queries);
    if (forceRefresh) {
      episodesCache.delete(anime.id);
    }
    const epMap = await getEpisodeMap(anime.id);
    let uploaded = Array.from(epMap.keys()).map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
    
    // Apply sanity cap if maxAiredCap is provided (e.g. from AniList nextAiringEpisode)
    if (maxAiredCap !== null && maxAiredCap !== undefined && Number(maxAiredCap) > 0) {
      uploaded = uploaded.filter(ep => ep <= Number(maxAiredCap));
    }

    return {
      success: true,
      animeTitle: anime.title,
      animeId: anime.id,
      uploadedEpisodes: uploaded,
      uploadedCount: uploaded.length,
      latestEpisode: uploaded[uploaded.length - 1] || 1
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      uploadedEpisodes: [],
      uploadedCount: 0
    };
  }
}

export const resolveStreamWithFailover = resolveStream;
export default { resolveStream, resolveStreamWithFailover, buildSourceList, getAvailableEpisodes };


