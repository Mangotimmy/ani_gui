// metadata.js - AniList GraphQL API metadata provider
import './dnsFallback.js';
import * as OpenCC from 'opencc-js';
import { enrichWithChineseTitles, enrichWithChineseTitlesAsync, resolveTitleZh, setMachineTranslator } from './chineseTitleService.js';
import { BoundedCache } from './cache.js';
import { lookupAlias, getCachedSearch, setCachedSearch } from './db.js';

const ANILIST_URL = 'https://graphql.anilist.co';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Rate Limiter & Concurrency Controller for AniList API (Cap: 60 req/min, max 2 concurrent)
class AniListRateLimiter {
  constructor() {
    this.queue = [];
    this.active = 0;
    this.maxConcurrent = 2;
    this.minIntervalMs = 150;
    this.lastRequestTime = 0;
    this.timestamps = [];
    this.rateLimitedUntil = 0;
  }

  async acquire() {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.processQueue();
    });
  }

  release() {
    this.active = Math.max(0, this.active - 1);
    this.processQueue();
  }

  setRateLimited(seconds = 30) {
    this.rateLimitedUntil = Date.now() + (seconds * 1000);
    console.warn(`[AniList] Rate limit active (HTTP 429). Pausing outbound requests for ${seconds}s.`);
  }

  processQueue() {
    if (this.queue.length === 0) return;
    if (this.active >= this.maxConcurrent) return;

    const now = Date.now();
    if (now < this.rateLimitedUntil) {
      const waitTime = this.rateLimitedUntil - now;
      setTimeout(() => this.processQueue(), Math.min(waitTime, 2000));
      return;
    }

    // Clean sliding window (last 60 seconds)
    const windowStart = now - 60000;
    this.timestamps = this.timestamps.filter(t => t > windowStart);
    if (this.timestamps.length >= 60) {
      const waitTime = (this.timestamps[0] + 60000) - now;
      setTimeout(() => this.processQueue(), Math.max(waitTime, 200));
      return;
    }

    // Enforce minInterval
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minIntervalMs) {
      setTimeout(() => this.processQueue(), this.minIntervalMs - elapsed);
      return;
    }

    this.active++;
    this.lastRequestTime = Date.now();
    this.timestamps.push(this.lastRequestTime);
    const next = this.queue.shift();
    if (next) next();
  }
}

const anilistLimiter = new AniListRateLimiter();

async function anilistQuery(query, variables = {}) {
  // If rate-limited, skip immediately to prevent cascading timeouts
  if (Date.now() < anilistLimiter.rateLimitedUntil) {
    return null;
  }

  await anilistLimiter.acquire();
  try {
    const res = await fetch(ANILIST_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': BROWSER_UA
      },
      body: JSON.stringify({ query, variables })
    });

    if (res.status === 429) {
      const retryAfterHeader = res.headers.get('retry-after');
      const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 30;
      anilistLimiter.setRateLimited(isNaN(retryAfter) ? 30 : retryAfter);
      return null;
    }

    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`AniList HTTP ${res.status}`);
    }
    const json = await res.json();
    return json.data;
  } catch (err) {
    if (!err.message?.includes('404')) {
      const cause = err.cause?.message || err.cause?.code || '';
      console.warn('AniList fetch notice:', err.message, cause ? `(${cause})` : '');
    }
    return null;
  } finally {
    anilistLimiter.release();
  }
}

const MEDIA_FIELDS = `
  id
  title {
    english
    romaji
    native
  }
  bannerImage
  coverImage {
    extraLarge
    large
    medium
    color
  }
  description
  averageScore
  episodes
  duration
  status
  season
  seasonYear
  genres
  isAdult
  siteUrl
  externalLinks {
    site
    url
    type
    language
  }
  nextAiringEpisode {
    episode
    timeUntilAiring
    airingAt
  }
  startDate {
    year
    month
    day
  }
  trailer {
    id
    site
    thumbnail
  }
`;

const metadataListCache = new BoundedCache(300, 45 * 60 * 1000); // 45 min TTL
const detailsCache = new BoundedCache(500, 30 * 60 * 1000); // 30 min TTL
const searchCache = new BoundedCache(300, 15 * 60 * 1000); // 15 min TTL

export async function getTrending(page = 1, perPage = 50) {
  const cacheKey = `trending_${page}_${perPage}`;
  const cached = metadataListCache.get(cacheKey);
  if (cached) return cached;

  const query = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(sort: TRENDING_DESC, type: ANIME) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;
  const data = await anilistQuery(query, { page: parseInt(page), perPage: parseInt(perPage) });
  const result = await enrichWithChineseTitlesAsync(data?.Page?.media || [], { budgetMs: 2500 });
  if (result && result.length > 0) metadataListCache.set(cacheKey, result);
  return result;
}

export async function getPopular(page = 1, perPage = 50) {
  const cacheKey = `popular_${page}_${perPage}`;
  const cached = metadataListCache.get(cacheKey);
  if (cached) return cached;

  const query = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(sort: POPULARITY_DESC, type: ANIME) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;
  const data = await anilistQuery(query, { page: parseInt(page), perPage: parseInt(perPage) });
  const result = await enrichWithChineseTitlesAsync(data?.Page?.media || [], { budgetMs: 2500 });
  if (result && result.length > 0) metadataListCache.set(cacheKey, result);
  return result;
}

export async function getTopRated(page = 1, perPage = 50) {
  const cacheKey = `topRated_${page}_${perPage}`;
  const cached = metadataListCache.get(cacheKey);
  if (cached) return cached;

  const query = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(sort: SCORE_DESC, type: ANIME) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;
  const data = await anilistQuery(query, { page: parseInt(page), perPage: parseInt(perPage) });
  const result = await enrichWithChineseTitlesAsync(data?.Page?.media || [], { budgetMs: 2500 });
  if (result && result.length > 0) metadataListCache.set(cacheKey, result);
  return result;
}

export async function getUpcoming(page = 1, perPage = 50) {
  const cacheKey = `upcoming_${page}_${perPage}`;
  const cached = metadataListCache.get(cacheKey);
  if (cached) return cached;

  const query = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(status: NOT_YET_RELEASED, sort: POPULARITY_DESC, type: ANIME) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;
  const data = await anilistQuery(query, { page: parseInt(page), perPage: parseInt(perPage) });
  const result = await enrichWithChineseTitlesAsync(data?.Page?.media || [], { budgetMs: 2500 });
  if (result && result.length > 0) metadataListCache.set(cacheKey, result);
  return result;
}

export async function getAiringSchedule(startUnix, endUnix) {
  const cacheKey = `schedule_${startUnix}_${endUnix}`;
  const cached = metadataListCache.get(cacheKey);
  if (cached) return cached;

  const query = `
    query ($page: Int, $start: Int, $end: Int) {
      Page(page: $page, perPage: 50) {
        pageInfo { hasNextPage }
        airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME) {
          episode
          airingAt
          media {
            ${MEDIA_FIELDS}
          }
        }
      }
    }
  `;
  const items = [];
  for (let page = 1; page <= 6; page++) {
    const data = await anilistQuery(query, { page, start: startUnix, end: endUnix });
    const rows = data?.Page?.airingSchedules || [];
    items.push(...rows);
    if (!data?.Page?.pageInfo?.hasNextPage) break;
  }

  const visible = items.filter(r => r.media && !r.media.isAdult);
  const enriched = await enrichWithChineseTitlesAsync(visible.map(r => r.media), { budgetMs: 4000 });
  const result = visible.map((r, i) => ({
    episode: r.episode,
    airingAt: r.airingAt,
    media: enriched[i] || r.media
  }));
  if (result.length > 0) metadataListCache.set(cacheKey, result);
  return result;
}

export async function getByGenre(genre, page = 1, perPage = 50) {
  const cacheKey = `genre_${genre}_${page}_${perPage}`;
  const cached = metadataListCache.get(cacheKey);
  if (cached) return cached;

  const query = `
    query ($genre: String, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(genre: $genre, sort: POPULARITY_DESC, type: ANIME) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;
  const data = await anilistQuery(query, { genre, page: parseInt(page), perPage: parseInt(perPage) });
  const result = await enrichWithChineseTitlesAsync(data?.Page?.media || [], { budgetMs: 2500 });
  if (result && result.length > 0) metadataListCache.set(cacheKey, result);
  return result;
}

// Smart Query Expander for Anime Aliases, Seasons & Release Years
function expandSmartQuery(rawQuery) {
  const trimmed = (rawQuery || '').trim();
  if (!trimmed) return { queries: [], targetSeason: null, targetYear: null, franchise: null };
  const lower = trimmed.toLowerCase();

  // 1. Direct alias check
  const direct = lookupAlias(lower);
  if (direct) {
    return {
      queries: [direct.canonical, direct.romaji, direct.chinese].filter(Boolean),
      targetSeason: null,
      targetYear: null,
      franchise: direct.franchise
    };
  }

  // 2. Tokenized pattern: <alias> <season|year|movie>
  // e.g. "sao 3", "konosuba 2019", "aot s4", "jjk 2"
  const tokens = lower.split(/\s+/);
  if (tokens.length >= 2) {
    const aliasCandidate = tokens[0];
    const aliasInfo = lookupAlias(aliasCandidate);
    if (aliasInfo) {
      const rest = tokens.slice(1).join(' ');
      const yearMatch = rest.match(/\b(19\d\d|20\d\d)\b/);
      const seasonMatch = rest.match(/(?:season|s|part)?\s*(\d+|iii|ii|iv|v|vi)\b/i);

      const targetYear = yearMatch ? parseInt(yearMatch[1], 10) : null;
      let targetSeason = null;
      if (seasonMatch) {
        const sVal = seasonMatch[1].toLowerCase();
        const romanMap = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6 };
        targetSeason = romanMap[sVal] || parseInt(sVal, 10);
      }

      const queries = [];

      // Specific known franchises
      if (aliasCandidate === 'sao') {
        if (targetSeason === 3) {
          queries.push('Sword Art Online Alicization', 'Sword Art Online Season 3', 'Sword Art Online');
        } else if (targetSeason === 2) {
          queries.push('Sword Art Online II', 'Sword Art Online');
        } else if (targetSeason === 1) {
          queries.push('Sword Art Online');
        }
      } else if (aliasCandidate === 'konosuba') {
        if (targetYear === 2019 || rest.includes('movie') || rest.includes('crimson') || rest.includes('紅傳說')) {
          queries.push('KonoSuba Legend of Crimson', 'Kono Subarashii Sekai ni Shukufuku wo! Kurenai Densetsu', 'KonoSuba 3', 'KonoSuba');
        } else if (targetSeason === 3) {
          queries.push('KonoSuba 3', 'Kono Subarashii Sekai ni Shukufuku wo! 3', 'KonoSuba');
        } else if (targetSeason === 2) {
          queries.push('KonoSuba 2', 'Kono Subarashii Sekai ni Shukufuku wo! 2');
        }
      }

      if (targetSeason && queries.length === 0) {
        queries.push(`${aliasInfo.canonical} Season ${targetSeason}`, `${aliasInfo.canonical} ${targetSeason}`, aliasInfo.canonical);
      }
      if (targetYear && queries.length === 0) {
        queries.push(`${aliasInfo.canonical} ${targetYear}`, aliasInfo.canonical);
      }
      if (queries.length === 0) {
        queries.push(`${aliasInfo.canonical} ${rest}`, aliasInfo.canonical);
      }

      return {
        queries: Array.from(new Set(queries)),
        targetSeason,
        targetYear,
        franchise: aliasInfo.franchise
      };
    }
  }

  return {
    queries: [trimmed],
    targetSeason: null,
    targetYear: null,
    franchise: null
  };
}

export async function searchAnime(keyword, page = 1, perPage = 50) {
  const cleanKeyword = (keyword || '').trim();
  if (!cleanKeyword) return [];

  const cacheKey = `${cleanKeyword.toLowerCase()}_${page}_${perPage}`;
  const memoryCached = searchCache.get(cacheKey);
  if (memoryCached) return memoryCached;

  // Check persistent SQLite search cache for sub-millisecond instant hit
  const sqliteCached = getCachedSearch(cacheKey);
  if (sqliteCached && Array.isArray(sqliteCached) && sqliteCached.length > 0) {
    searchCache.set(cacheKey, sqliteCached);
    return sqliteCached;
  }

  const smart = expandSmartQuery(cleanKeyword);
  const searchQueries = smart.queries.length > 0 ? smart.queries : [cleanKeyword];

  const query = `
    query ($search: String, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(search: $search, sort: SEARCH_MATCH, type: ANIME) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;

  let results = [];
  const existingIds = new Set();

  for (const q of searchQueries) {
    try {
      const data = await anilistQuery(query, { search: q, page, perPage });
      const mediaList = data?.Page?.media || [];
      for (const item of mediaList) {
        if (!existingIds.has(item.id)) {
          existingIds.add(item.id);
          results.push(item);
        }
      }
      if (results.length >= perPage) break;
    } catch (err) {
      console.warn(`[AniList Search] Query "${q}" error:`, err.message);
    }
  }

  // If results are sparse and keyword contains Chinese characters, resolve via Bangumi
  const hasChinese = /[\u4e00-\u9fa5]/.test(cleanKeyword);
  if (results.length < 3 && hasChinese) {
    try {
      const bgmRes = await fetch(
        `https://api.bgm.tv/search/subject/${encodeURIComponent(cleanKeyword)}?type=2&responseGroup=small`,
        { headers: { 'User-Agent': BROWSER_UA } }
      );
      if (bgmRes.ok) {
        const bgmData = await bgmRes.json();
        const matches = (bgmData.list || []).slice(0, 3);

        for (const m of matches) {
          const jpTitle = m.name;
          if (jpTitle && jpTitle !== cleanKeyword) {
            try {
              const fallbackData = await anilistQuery(query, { search: jpTitle, page: 1, perPage: 10 });
              const fallbackMedia = fallbackData?.Page?.media || [];
              for (const item of fallbackMedia) {
                if (!existingIds.has(item.id)) {
                  existingIds.add(item.id);
                  results.push(item);
                }
              }
            } catch {}
          }
        }
      }
    } catch (bgmErr) {
      console.warn('Bangumi search translation fallback error:', bgmErr.message);
    }
  }

  // Smart Rerank if target season or target year was specified
  if (smart.targetSeason || smart.targetYear) {
    results.sort((a, b) => {
      let aScore = 0;
      let bScore = 0;

      const aTitle = ((a.title?.romaji || '') + ' ' + (a.title?.english || '')).toLowerCase();
      const bTitle = ((b.title?.romaji || '') + ' ' + (b.title?.english || '')).toLowerCase();

      if (smart.targetSeason) {
        const s = smart.targetSeason;
        if (s === 3 && (aTitle.includes('alicization') || aTitle.includes('season 3') || aTitle.includes(' 3') || aTitle.includes('iii'))) aScore += 10;
        if (s === 3 && (bTitle.includes('alicization') || bTitle.includes('season 3') || bTitle.includes(' 3') || bTitle.includes('iii'))) bScore += 10;
        if (s === 2 && (aTitle.includes('season 2') || aTitle.includes(' 2') || aTitle.includes('ii'))) aScore += 10;
        if (s === 2 && (bTitle.includes('season 2') || bTitle.includes(' 2') || bTitle.includes('ii'))) bScore += 10;
      }

      if (smart.targetYear) {
        if (a.seasonYear === smart.targetYear || a.startDate?.year === smart.targetYear) aScore += 15;
        if (b.seasonYear === smart.targetYear || b.startDate?.year === smart.targetYear) bScore += 15;
      }

      return bScore - aScore;
    });
  }

  const enriched = await enrichWithChineseTitlesAsync(results, { budgetMs: 2500 });
  if (enriched && enriched.length > 0) {
    searchCache.set(cacheKey, enriched);
    setCachedSearch(cacheKey, enriched);
  }
  return enriched;
}

export async function getAnimeDetails(id) {
  const numId = parseInt(id, 10);
  if (!numId || isNaN(numId)) return null;

  const cached = detailsCache.get(numId);
  if (cached) return cached;

  const query = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        ${MEDIA_FIELDS}
        studios(isMain: true) {
          nodes {
            name
          }
        }
      }
    }
  `;
  const data = await anilistQuery(query, { id: numId });
  const media = data?.Media || null;
  if (!media) return null;
  const enriched = await enrichWithChineseTitlesAsync([media], { budgetMs: 3000 });
  const result = enriched[0] || media;
  detailsCache.set(numId, result);
  return result;
}

export async function getRecommendationsForAnime(id, limit = 10) {
  const numId = parseInt(id, 10);
  if (!numId || isNaN(numId)) return [];

  const query = `
    query ($id: Int, $perPage: Int) {
      Media(id: $id) {
        recommendations(sort: RATING_DESC, page: 1, perPage: $perPage) {
          nodes {
            rating
            mediaRecommendation {
              ${MEDIA_FIELDS}
            }
          }
        }
      }
    }
  `;
  try {
    const data = await anilistQuery(query, { id: numId, perPage: limit });
    const nodes = data?.Media?.recommendations?.nodes || [];
    const recs = nodes
      .map(n => n.mediaRecommendation)
      .filter(m => m && m.id);
    return await enrichWithChineseTitlesAsync(recs, { budgetMs: 2000 });
  } catch (err) {
    return [];
  }
}

export function getCurrentSeasonInfo() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  let season = 'FALL';
  if (month >= 1 && month <= 3) season = 'WINTER';
  else if (month >= 4 && month <= 6) season = 'SPRING';
  else if (month >= 7 && month <= 9) season = 'SUMMER';
  else season = 'FALL';

  const seasonLabels = {
    WINTER: 'Winter',
    SPRING: 'Spring',
    SUMMER: 'Summer',
    FALL: 'Fall'
  };

  return {
    year,
    season,
    label: `${seasonLabels[season]} ${year}`
  };
}

export async function getCatalog({
  year = new Date().getFullYear(),
  season = null,
  sort = 'POPULARITY_DESC',
  page = 1,
  perPage = 24,
  isAdult = false,
  studio = null
} = {}) {
  const variables = { page: parseInt(page), perPage: parseInt(perPage) };

  if (isAdult !== null && isAdult !== undefined && isAdult !== 'all') {
    variables.isAdult = Boolean(isAdult);
  }

  // 1. Studio-specific catalog query
  if (studio && studio !== 'ALL' && studio.trim()) {
    const cleanStudio = studio.trim();
    const studioCacheKey = `catalog_studio_${cleanStudio}_${page}_${perPage}`;
    const cachedStudio = metadataListCache.get(studioCacheKey);
    if (cachedStudio) return cachedStudio;

    const studioQuery = `
      query ($studio: String, $page: Int, $perPage: Int) {
        Studio(search: $studio) {
          id
          name
          media(page: $page, perPage: $perPage, sort: [START_DATE_DESC, POPULARITY_DESC]) {
            pageInfo {
              total
              currentPage
              lastPage
              hasNextPage
              perPage
            }
            nodes {
              ${MEDIA_FIELDS}
            }
          }
        }
      }
    `;

    try {
      const data = await anilistQuery(studioQuery, { studio: cleanStudio, page: parseInt(page), perPage: parseInt(perPage) });
      const mediaNodes = data?.Studio?.media?.nodes || [];
      const result = {
        media: await enrichWithChineseTitlesAsync(mediaNodes, { budgetMs: 2500 }),
        pageInfo: data?.Studio?.media?.pageInfo || { hasNextPage: false }
      };
      if (result.media && result.media.length > 0) {
        metadataListCache.set(studioCacheKey, result);
      }
      return result;
    } catch (err) {
      console.warn(`[AniList Studio] Query for "${cleanStudio}" failed:`, err.message);
    }
  }

  if (year && year !== 'ALL') {
    variables.seasonYear = parseInt(year);
  }

  if (season && season !== 'ALL') {
    const sUpper = season.toUpperCase();
    if (sUpper === 'FALL' || sUpper === '10-12') variables.season = 'FALL';
    else if (sUpper === 'SUMMER' || sUpper === '7-9') variables.season = 'SUMMER';
    else if (sUpper === 'SPRING' || sUpper === '4-6') variables.season = 'SPRING';
    else if (sUpper === 'WINTER' || sUpper === '1-3') variables.season = 'WINTER';
    else variables.season = sUpper;
  }

  variables.sort = Array.isArray(sort) ? sort : [sort];

  const query = `
    query ($seasonYear: Int, $season: MediaSeason, $sort: [MediaSort], $isAdult: Boolean, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo {
          total
          currentPage
          lastPage
          hasNextPage
          perPage
        }
        media(seasonYear: $seasonYear, season: $season, sort: $sort, isAdult: $isAdult, type: ANIME) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;

  const cacheKey = `catalog_${year}_${season}_${variables.sort.join(',')}_${page}_${perPage}_${variables.isAdult}`;
  const cached = metadataListCache.get(cacheKey);
  if (cached) return cached;

  try {
    const data = await anilistQuery(query, variables);
    const result = {
      media: await enrichWithChineseTitlesAsync(data?.Page?.media || [], { budgetMs: 2500 }),
      pageInfo: data?.Page?.pageInfo || { hasNextPage: false }
    };
    if (result.media && result.media.length > 0) {
      metadataListCache.set(cacheKey, result);
    }
    return result;
  } catch (err) {
    console.error('Failed to get seasonal catalog:', err.message);
    return { media: [], pageInfo: { hasNextPage: false } };
  }
}

// Scrape YouTube for multiple official anime PVs, teasers, and trailers
export async function fetchOfficialYouTubePVs(searchTitle) {
  if (!searchTitle) return [];
  try {
    const q = `${searchTitle} anime official trailer PV 本予告`;
    const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%253D%253D`;
    const res = await fetch(ytUrl, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Language': 'ja,zh-TW,en-US;q=0.8'
      }
    });
    if (!res.ok) return [];
    const html = await res.text();
    const dataMatch = html.match(/ytInitialData\s*=\s*({.+?});<\/script>/);
    if (!dataMatch) return [];
    const json = JSON.parse(dataMatch[1]);
    const contents = json?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];

    const pvs = [];
    for (const item of contents) {
      const v = item?.videoRenderer;
      if (!v || !v.videoId) continue;
      const vTitle = v.title?.runs?.[0]?.text || '';
      const channel = v.ownerText?.runs?.[0]?.text || '';
      const combined = (vTitle + ' ' + channel).toLowerCase();

      const isOfficial = /official|pv|trailer|teaser|特報|本予告|予告|キャラクター|宣傳|第\d+弾|aniplex|toho|kadokawa|crunchyroll|twin engine|warner|netflix|muse|ani-one/i.test(combined);
      if (!isOfficial) continue;

      let badge = 'Official PV';
      if (/teaser|特報/i.test(combined)) badge = 'Teaser PV';
      else if (/main\s*pv|本予告|第\d+弾/i.test(combined)) badge = 'Main PV';
      else if (/character|キャラクター/i.test(combined)) badge = 'Character PV';
      else if (/trailer/i.test(combined)) badge = 'Trailer';

      const thumb = v.thumbnail?.thumbnails?.pop()?.url || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;
      pvs.push({
        id: v.videoId,
        site: 'youtube',
        title: vTitle,
        channel,
        badge,
        thumbnail: thumb,
        embedUrl: `https://www.youtube-nocookie.com/embed/${v.videoId}?autoplay=1&rel=0`,
        url: `https://www.youtube.com/watch?v=${v.videoId}`
      });
      if (pvs.length >= 10) break;
    }
    return pvs;
  } catch (err) {
    return [];
  }
}

// In-memory cache for media videos (PV, OP, ED) - Capped at 300 entries, 24h TTL
const mediaVideosCache = new BoundedCache(300, 24 * 60 * 60 * 1000);

export async function getAnimeMediaVideos(animeId, romajiTitle = '', englishTitle = '') {
  const id = parseInt(animeId);
  if (!id) return { trailers: [], themes: { op: [], ed: [] } };

  if (mediaVideosCache.has(id)) {
    return mediaVideosCache.get(id);
  }

  const result = {
    trailers: [],
    themes: { op: [], ed: [] }
  };

  try {
    // 1. Fetch AniList Trailer (Official PV)
    const animeDetails = await getAnimeDetails(id);
    if (animeDetails?.trailer && animeDetails.trailer.id) {
      const tr = animeDetails.trailer;
      result.trailers.push({
        id: tr.id,
        site: tr.site || 'youtube',
        title: 'Official Teaser / PV',
        badge: 'AniList Official PV',
        thumbnail: tr.thumbnail || (tr.site === 'youtube' ? `https://i.ytimg.com/vi/${tr.id}/hqdefault.jpg` : null),
        embedUrl: tr.site === 'youtube' ? `https://www.youtube-nocookie.com/embed/${tr.id}?autoplay=1&rel=0` : null,
        url: tr.site === 'youtube' ? `https://www.youtube.com/watch?v=${tr.id}` : null
      });
    }

    const titleToSearch = romajiTitle || animeDetails?.title?.romaji || englishTitle || animeDetails?.title?.english || '';

    // 2. Extract multiple official PVs & Trailers from YouTube
    if (titleToSearch) {
      try {
        const ytPvs = await fetchOfficialYouTubePVs(titleToSearch);
        const seenIds = new Set(result.trailers.map(t => t.id));
        for (const pv of ytPvs) {
          if (!seenIds.has(pv.id)) {
            seenIds.add(pv.id);
            result.trailers.push(pv);
          }
        }
      } catch (ytErr) {
        console.warn(`[Metadata] YouTube PV scrape error for "${titleToSearch}":`, ytErr.message);
      }
    }

    // 2. Fetch OP and ED from AnimeThemes API
    try {
      let themeUrl = `https://api.animethemes.moe/anime?filter[has]=resources&filter[site]=AniList&filter[external_id]=${id}&include=animethemes.animethemeentries.videos,animethemes.song`;
      let res = await fetch(themeUrl, { headers: { 'User-Agent': 'AniFlix/1.0' } });
      let themeData = await res.json();
      let themeAnime = themeData?.anime?.[0];

      // Fallback: search by title
      if (!themeAnime && titleToSearch) {
        themeUrl = `https://api.animethemes.moe/anime?filter[name]=${encodeURIComponent(titleToSearch)}&include=animethemes.animethemeentries.videos,animethemes.song`;
        res = await fetch(themeUrl, { headers: { 'User-Agent': 'AniFlix/1.0' } });
        themeData = await res.json();
        themeAnime = themeData?.anime?.[0];
      }

      if (themeAnime?.animethemes) {
        for (const t of themeAnime.animethemes) {
          const video = t.animethemeentries?.[0]?.videos?.[0];
          if (!video?.link) continue;

          const themeEntry = {
            id: t.id,
            type: t.type, // 'OP' or 'ED'
            sequence: t.sequence || 1,
            tag: `${t.type} ${t.sequence || 1}`,
            title: t.song?.title || `${t.type} ${t.sequence || 1}`,
            artist: (t.song?.artists || []).map(a => a.name).join(', ') || '',
            videoUrl: video.link,
            resolution: video.resolution || 720
          };

          if (t.type === 'OP') {
            result.themes.op.push(themeEntry);
          } else if (t.type === 'ED') {
            result.themes.ed.push(themeEntry);
          }
        }
      }
    } catch (themeErr) {
      console.warn(`[Metadata] AnimeThemes fetch error for ${id}:`, themeErr.message);
    }

    mediaVideosCache.set(id, result);
    return result;
  } catch (err) {
    console.error(`[Metadata] Error getting media videos for ${id}:`, err.message);
    return result;
  }
}

// ==========================================
// Chinese Metadata & OpenCC Translation
// ==========================================
// Chinese Metadata & OpenCC Translation
// ==========================================
const s2tw = OpenCC.Converter ? OpenCC.Converter({ from: 'cn', to: 'tw' }) : (s => s);
const t2cn = OpenCC.Converter ? OpenCC.Converter({ from: 'tw', to: 'cn' }) : (s => s);
const chineseInfoCache = new BoundedCache(500, 24 * 60 * 60 * 1000);

/**
 * Free text translation helper with Google Translate & MyMemory fallback and OpenCC post-processing.
 * Never leaks error messages (e.g. QUERY LENGTH LIMIT EXCEEDED).
 */
export async function translateText(text, targetLang = 'zh-TW') {
  if (!text || !text.trim()) return '';
  const clean = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';

  const gLang = targetLang === 'zh-CN' ? 'zh-CN' : targetLang === 'ja' ? 'ja' : 'zh-TW';

  // Helper to test if a string looks like an error message
  const isErrorText = (str) => {
    if (!str || typeof str !== 'string') return true;
    const s = str.toUpperCase();
    return (
      s.includes('QUERY LENGTH LIMIT EXCEEDED') ||
      s.includes('MYMEMORY WARNING') ||
      s.includes('ALL AVAILABLE FREE TRANSLATIONS') ||
      s.includes('INVALID KEY') ||
      s.includes('DAILY LIMIT REACHED')
    );
  };

  // 1. Primary Engine: Google Translate API (Handles up to 4000+ chars, zero query limits)
  try {
    const gUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${gLang}&dt=t&q=${encodeURIComponent(clean.slice(0, 3500))}`;
    const res = await fetch(gUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(6000)
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.[0])) {
        const fullTranslated = data[0].map(item => item[0] || '').join('').trim();
        if (fullTranslated && !isErrorText(fullTranslated)) {
          if (targetLang === 'zh-TW') return s2tw(fullTranslated);
          if (targetLang === 'zh-CN') return t2cn(fullTranslated);
          return fullTranslated;
        }
      }
    }
  } catch (err) {
    // Fall through to the next engine
  }

  // 1b. Optional self-hosted / commercial engine (LibreTranslate-compatible).
  //     Set TRANSLATE_ENDPOINT (and TRANSLATE_API_KEY when required) to survive the
  //     public Google/MyMemory quotas, which rate-limit shared and datacenter IPs.
  const customEndpoint = process.env.TRANSLATE_ENDPOINT;
  if (customEndpoint) {
    try {
      const res = await fetch(customEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.TRANSLATE_API_KEY ? { Authorization: `Bearer ${process.env.TRANSLATE_API_KEY}` } : {})
        },
        body: JSON.stringify({
          q: clean.slice(0, 3500),
          source: 'auto',
          target: targetLang === 'zh-CN' ? 'zh' : 'zt',
          format: 'text',
          ...(process.env.TRANSLATE_API_KEY ? { api_key: process.env.TRANSLATE_API_KEY } : {})
        }),
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) {
        const data = await res.json();
        const out = (data?.translatedText || (Array.isArray(data) ? data[0] : '') || '').trim();
        if (out && !isErrorText(out) && out !== clean) {
          if (targetLang === 'zh-TW') return s2tw(out);
          if (targetLang === 'zh-CN') return t2cn(out);
          return out;
        }
      }
    } catch {
      /* try the next engine */
    }
  }

  // 2. Secondary Engine: MyMemory API with strict CJK sentence chunking (<= 300 chars)
  try {
    const isJapanese = /[\u3040-\u309F\u30A0-\u30FF]/.test(clean);
    const pair = isJapanese 
      ? (targetLang === 'zh-CN' ? 'ja|zh-CN' : 'ja|zh-TW') 
      : (targetLang === 'zh-CN' ? 'en|zh-CN' : 'en|zh-TW');

    // Split on CJK punctuation (。！？) or English (.!?) or newlines
    const rawSentences = clean.match(/[^。！？.!?\n\r]+[。！？.!?\n\r]*/g) || [clean];
    const chunks = [];
    let currentChunk = '';

    for (const s of rawSentences) {
      // If a single sentence exceeds 300 characters, hard-slice it
      const parts = s.length > 300 ? s.match(/.{1,300}/g) || [s] : [s];
      for (const p of parts) {
        if ((currentChunk + ' ' + p).length > 300) {
          if (currentChunk) chunks.push(currentChunk.trim());
          currentChunk = p;
        } else {
          currentChunk = (currentChunk ? currentChunk + ' ' : '') + p;
        }
      }
    }
    if (currentChunk) chunks.push(currentChunk.trim());

    // Limit to top 6 chunks to avoid timeout
    const limitedChunks = chunks.slice(0, 6);

    const translatedParts = await Promise.all(limitedChunks.map(async (chunk) => {
      try {
        const mmUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${pair}`;
        const res = await fetch(mmUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AniFlix/1.0' },
          signal: AbortSignal.timeout(4000)
        });
        if (!res.ok) return chunk;
        const data = await res.json();
        const transText = data?.responseData?.translatedText;
        if (transText && !isErrorText(transText)) {
          return transText;
        }
        return chunk;
      } catch {
        return chunk;
      }
    }));

    let fullTranslated = translatedParts.join(' ').trim();
    if (fullTranslated && !isErrorText(fullTranslated)) {
      if (targetLang === 'zh-TW') return s2tw(fullTranslated);
      if (targetLang === 'zh-CN') return t2cn(fullTranslated);
      return fullTranslated;
    }
  } catch (err) {
    // ignore
  }

  // 3. Fallback: Return original clean text (never leak error messages!)
  return clean;
}

// Wire the machine-translation engine into the title resolver. Without this call the
// resolver's MT fallback is dead code and untranslated Japanese titles reach the UI.
setMachineTranslator(translateText);

export async function getAnimeChineseInfo(animeId, { romaji = '', native = '', english = '', description = '' } = {}, targetLang = 'zh-TW') {
  const cacheKey = `${animeId}_${targetLang}`;
  if (chineseInfoCache.has(cacheKey)) {
    return chineseInfoCache.get(cacheKey);
  }

  const searchTitle = native || romaji || english;
  if (!searchTitle) {
    return { id: animeId, titleZh: '', summaryZh: '' };
  }

  // Validated resolution only: exact dictionary -> identity + season checked Bangumi match
  // -> machine translation. The raw Bangumi "first search hit" is deliberately NOT used any
  // more: it was unvalidated, could belong to a different show/season, and it overrode the
  // correctly resolved title in the UI (chineseInfo.titleZh wins over the precomputed one).
  const anime = { id: animeId, title: { romaji, native, english } };
  let entry = null;
  try {
    entry = await resolveTitleZh(anime);
  } catch (err) {
    console.warn(`[Metadata] Failed to resolve Chinese title for ${searchTitle}:`, err.message);
  }

  const titleZh = entry ? (targetLang === 'zh-CN' ? entry.cn : entry.tw) : '';

  let summaryZh = targetLang === 'zh-CN' ? (entry?.summaryCn || '') : (entry?.summaryTw || '');
  if (!summaryZh && description) {
    try {
      summaryZh = await translateText(description, targetLang);
    } catch {}
  }

  const result = {
    id: animeId,
    bgmId: entry?.bgmId || null,
    titleZh,
    titleZhSource: entry?.source || null,
    summaryZh
  };

  chineseInfoCache.set(cacheKey, result);
  return result;
}

// ==========================================
// BitTorrent / Magnet Search (DMHY + Nyaa) - Bounded at 200 queries, 15m TTL
// ==========================================
const torrentsCache = new BoundedCache(200, 15 * 60 * 1000);

function extractFansub(title) {
  const match = title.match(/^\[([^\]]+)\]|^【([^】]+)】/);
  if (match) return (match[1] || match[2] || '').trim();
  return 'Fansub';
}

function extractResolution(title) {
  if (/2160p|4k/i.test(title)) return '4K';
  if (/1080p|1080i/i.test(title)) return '1080p';
  if (/720p/i.test(title)) return '720p';
  if (/480p/i.test(title)) return '480p';
  if (/bdrip/i.test(title)) return 'BDRip';
  return 'HD';
}

function detectTorrentLang(title) {
  const isTW = /(繁體|繁体|CHT|BIG5|繁中|HK|TW|繁日|國語|国语|粵語|粤语|中台)/i.test(title);
  const isCN = /(簡體|简体|CHS|GB|简中|CN|简日|中配)/i.test(title);
  const isBilingual = /(簡繁|简繁|双语|雙語|多国|Multi|中日|双字|雙字)/i.test(title);
  const isEng = /(English|Eng\s*Sub|\[ENG\]|SubsPlease|Erai-raws|HorribleSubs|Judas|ASW|SubsPlus|ToonsHub|Ironclad|DKB)/i.test(title);
  const isRaw = /(RAW|Raws|Non-Sub|NC-RAW|UNCENSORED|Uncensored)/i.test(title);

  if (isBilingual || (isTW && isCN)) return 'zh-TW'; // Traditional users can read bilingual
  if (isTW) return 'zh-TW';
  if (isCN) return 'zh-CN';
  if (isEng) return 'en';
  if (isRaw) return 'raw';

  // If title has Chinese characters, default to Chinese subtitle
  if (/[\u4e00-\u9fa5]/.test(title)) {
    return 'zh-TW';
  }
  return 'other';
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 1) return null;
  const num = parseInt(bytes);
  if (isNaN(num)) return null;
  if (num >= 1073741824) return (num / 1073741824).toFixed(2) + ' GB';
  if (num >= 1048576) return (num / 1048576).toFixed(1) + ' MB';
  return (num / 1024).toFixed(0) + ' KB';
}

// AnimeTosho API integration (Official high-speed Nyaa mirror, immune to regional ISP SSL interception)
async function fetchAnimeTosho(q) {
  try {
    const toshoUrl = `https://feed.animetosho.net/json?q=${encodeURIComponent(q)}`;
    const res = await fetch(toshoUrl, {
      signal: AbortSignal.timeout(7000),
      headers: { 'User-Agent': BROWSER_UA }
    });
    if (!res.ok) return [];
    const items = await res.json();
    if (!Array.isArray(items)) return [];

    return items.map((item) => {
      const title = item.title || item.torrent_name || '';
      let magnet = item.magnet_uri || null;
      if (!magnet && item.info_hash) {
        magnet = `magnet:?xt=urn:btih:${item.info_hash}&dn=${encodeURIComponent(title)}`;
      }
      return {
        id: `tosho_${item.id || item.nyaa_id || Math.random().toString(36).slice(2, 9)}`,
        title,
        fansub: extractFansub(title),
        resolution: extractResolution(title),
        magnet,
        torrentUrl: item.torrent_url || null,
        size: formatBytes(item.total_size) || (item.total_size ? `${(item.total_size / (1024 * 1024)).toFixed(1)} MB` : 'Unknown'),
        seeders: typeof item.seeders === 'number' ? item.seeders : 0,
        pubDate: item.timestamp ? new Date(item.timestamp * 1000).toLocaleDateString() : '',
        source: 'AnimeTosho (Nyaa Mirror)',
        lang: detectTorrentLang(title),
        infoHash: item.info_hash || null
      };
    }).filter(t => t.magnet);
  } catch (err) {
    const cause = err.cause?.message || err.cause?.code || '';
    console.warn(`[Metadata] AnimeTosho error for "${q}":`, err.message, cause ? `(${cause})` : '');
    return [];
  }
}

export async function searchTorrents(query, filterLang = 'all', hideR18 = true) {
  let queries = [];
  if (Array.isArray(query)) {
    queries = query;
  } else if (typeof query === 'string') {
    queries = query.split(/\|\||\||,/);
  }
  queries = Array.from(new Set(queries.map(q => (q || '').trim()).filter(Boolean)));

  if (queries.length === 0) {
    return { success: true, count: 0, items: [] };
  }

  const cacheKey = `${queries.join(';').toLowerCase()}_${filterLang}_${hideR18}`;
  const cached = torrentsCache.get(cacheKey);
  if (cached) {
    return { success: true, count: cached.items.length, items: cached.items };
  }

  const results = [];
  const seenMagnets = new Set();

  // DMHY Candidate queries: prioritizes Chinese and Japanese titles
  const dmhyCandidates = queries.filter(q => /[\u4e00-\u9fa5\u3040-\u30ff]/.test(q));
  if (dmhyCandidates.length === 0 && queries.length > 0) {
    dmhyCandidates.push(queries[0]);
  }
  const topDmhy = dmhyCandidates.slice(0, 3);

  // Nyaa/AnimeTosho Candidate queries: prioritizes English and Romaji titles, then Native
  const nyaaCandidates = queries.filter(q => /^[a-zA-Z0-9\s':\-\.,!?]+$/.test(q));
  if (nyaaCandidates.length === 0) {
    nyaaCandidates.push(...queries);
  }
  const topNyaa = Array.from(new Set([...nyaaCandidates, ...queries])).slice(0, 3);

  // 1. Fetch AnimeTosho in parallel (High-speed, unblocked Nyaa mirror)
  const toshoPromises = topNyaa.map(async (nq) => {
    try {
      const toshoItems = await fetchAnimeTosho(nq);
      for (const item of toshoItems) {
        const hashMatch = item.magnet ? item.magnet.match(/urn:btih:([a-zA-Z0-9]{32,40})/i) : null;
        const magnetKey = hashMatch ? hashMatch[1].toLowerCase() : (item.infoHash ? item.infoHash.toLowerCase() : item.magnet);
        if (!magnetKey || seenMagnets.has(magnetKey)) continue;
        seenMagnets.add(magnetKey);
        results.push(item);
      }
    } catch {}
  });

  // 2. Fetch Nyaa in parallel with timeout and SSL error tolerance
  const nyaaPromises = topNyaa.map(async (nq) => {
    try {
      const nyaaUrl = `https://nyaa.si/?page=rss&c=1_0&q=${encodeURIComponent(nq)}`;
      const res = await fetch(nyaaUrl, {
        signal: AbortSignal.timeout(6000),
        headers: { 'User-Agent': BROWSER_UA }
      });
      if (!res.ok) return;
      const text = await res.text();
      const items = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)];

      for (const m of items) {
        const itemXml = m[1];
        const titleMatch = itemXml.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || itemXml.match(/<title>([\s\S]*?)<\/title>/);
        if (!titleMatch) continue;
        const title = titleMatch[1].trim();

        const infoHashMatch = itemXml.match(/<nyaa:infoHash>([\s\S]*?)<\/nyaa:infoHash>/);
        const linkMatch = itemXml.match(/<link>([\s\S]*?)<\/link>/);
        const sizeMatch = itemXml.match(/<nyaa:size>([\s\S]*?)<\/nyaa:size>/);
        const seedersMatch = itemXml.match(/<nyaa:seeders>([\s\S]*?)<\/nyaa:seeders>/);

        let magnet = null;
        if (infoHashMatch) {
          magnet = `magnet:?xt=urn:btih:${infoHashMatch[1].trim()}&dn=${encodeURIComponent(title)}`;
        }
        if (!magnet && linkMatch && linkMatch[1].includes('magnet:')) {
          magnet = linkMatch[1];
        }
        if (!magnet && linkMatch) {
          magnet = linkMatch[1];
        }
        if (!magnet) continue;

        const hashMatch = magnet.match(/urn:btih:([a-zA-Z0-9]{32,40})/i);
        const magnetKey = hashMatch ? hashMatch[1].toLowerCase() : (infoHashMatch ? infoHashMatch[1].trim().toLowerCase() : magnet);
        if (seenMagnets.has(magnetKey)) continue;
        seenMagnets.add(magnetKey);

        const dateMatch = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
        const lang = detectTorrentLang(title);

        results.push({
          id: `nyaa_${results.length + 1}`,
          title,
          fansub: extractFansub(title),
          resolution: extractResolution(title),
          magnet,
          torrentUrl: linkMatch && linkMatch[1].endsWith('.torrent') ? linkMatch[1] : null,
          size: sizeMatch ? sizeMatch[1].trim() : 'Unknown',
          seeders: seedersMatch ? parseInt(seedersMatch[1]) : 0,
          pubDate: dateMatch ? new Date(dateMatch[1]).toLocaleDateString() : '',
          source: 'Nyaa',
          lang
        });
      }
    } catch (err) {
      const isSslInterception = err.message?.includes('wrong version number') || (err.cause && String(err.cause).includes('wrong version number'));
      if (isSslInterception) {
        console.warn(`[Metadata] Nyaa intercepted by ISP/middlebox (SSL wrong version number) for "${nq}", AnimeTosho mirror active.`);
      } else {
        const cause = err.cause?.message || err.cause?.code || '';
        console.warn(`[Metadata] Nyaa RSS error for "${nq}":`, err.message, cause ? `(${cause})` : '');
      }
    }
  });

  // 3. Fetch DMHY in parallel with timeout (4s timeout)
  const dmhyPromises = topDmhy.map(async (dq) => {
    try {
      const dmhyUrl = `https://share.dmhy.org/topics/rss/rss.xml?keyword=${encodeURIComponent(dq)}`;
      const res = await fetch(dmhyUrl, {
        signal: AbortSignal.timeout(4000),
        headers: { 'User-Agent': BROWSER_UA }
      });
      if (!res.ok) return;
      const text = await res.text();
      const items = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)];

      for (const m of items) {
        const itemXml = m[1];
        const titleMatch = itemXml.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || itemXml.match(/<title>([\s\S]*?)<\/title>/);
        if (!titleMatch) continue;
        const title = titleMatch[1].trim();

        const enclosureMatch = itemXml.match(/<enclosure[^>]*url="([^"]+)"[^>]*length="([^"]*)"/);
        let magnet = enclosureMatch ? enclosureMatch[1] : null;
        if (!magnet) {
          const directMag = itemXml.match(/(magnet:\?[^"<]+)/);
          if (directMag) magnet = directMag[1];
        }
        if (!magnet) continue;

        magnet = magnet.replace(/&amp;/g, '&');
        const hashMatch = magnet.match(/urn:btih:([a-zA-Z0-9]{32,40})/i);
        const magnetKey = hashMatch ? hashMatch[1].toLowerCase() : magnet;
        if (seenMagnets.has(magnetKey)) continue;
        seenMagnets.add(magnetKey);

        const dateMatch = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
        const linkMatch = itemXml.match(/<link>([\s\S]*?)<\/link>/);

        const bytesLength = enclosureMatch ? enclosureMatch[2] : null;
        let size = formatBytes(bytesLength);
        if (!size) {
          const sizeInTitle = title.match(/(\d+(?:\.\d+)?\s*(?:GB|MB|GiB|MiB))/i);
          size = sizeInTitle ? sizeInTitle[1] : 'Unknown';
        }

        const lang = detectTorrentLang(title);
        results.push({
          id: `dmhy_${results.length + 1}`,
          title,
          fansub: extractFansub(title),
          resolution: extractResolution(title),
          magnet,
          pageUrl: linkMatch ? linkMatch[1] : null,
          size,
          seeders: null,
          pubDate: dateMatch ? new Date(dateMatch[1]).toLocaleDateString() : '',
          source: 'DMHY (動漫花園)',
          lang
        });
      }
    } catch (err) {
      const cause = err.cause?.message || err.cause?.code || '';
      console.warn(`[Metadata] DMHY RSS error for "${dq}":`, err.message, cause ? `(${cause})` : '');
    }
  });

  await Promise.allSettled([...toshoPromises, ...nyaaPromises, ...dmhyPromises]);

  // Apply Language Filter if requested
  let filtered = results;
  if (filterLang === 'zh-TW') {
    filtered = results.filter(r => r.lang === 'zh-TW' || /(繁體|繁体|CHT|BIG5|繁中|HK|TW|簡繁|简繁|雙語|双语|中台)/i.test(r.title));
  } else if (filterLang === 'zh-CN') {
    filtered = results.filter(r => r.lang === 'zh-CN' || /(簡體|简体|CHS|GB|简中|CN|簡繁|简繁|雙語|双语|中配)/i.test(r.title));
  } else if (filterLang === 'en') {
    filtered = results.filter(r => r.lang === 'en' || /(English|Eng\s*Sub|\[ENG\]|SubsPlease|Erai-raws|HorribleSubs|Judas|ASW|SubsPlus|ToonsHub|Ironclad|DKB)/i.test(r.title));
  } else if (filterLang === 'raw') {
    filtered = results.filter(r => r.lang === 'raw' || /(RAW|Raws|Non-Sub|NC-RAW|UNCENSORED|Uncensored)/i.test(r.title));
  }

  // Apply R18 adult filtering by default
  if (hideR18) {
    filtered = filtered.filter(r => !/(18禁|R-?18|Hentai|無修正|无修正|里番|エロ)/i.test(r.title));
  }

  // Only cache positive results so temporary network errors do not lock results to 0 for 15 minutes
  if (filtered.length > 0) {
    torrentsCache.set(cacheKey, { items: filtered });
  }

  return { success: true, count: filtered.length, items: filtered };
}
