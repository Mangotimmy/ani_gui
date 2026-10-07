// metadata.js - AniList GraphQL API metadata provider
import * as OpenCC from 'opencc-js';
import { enrichWithChineseTitles } from './chineseTitleService.js';
import { BoundedCache } from './cache.js';

const ANILIST_URL = 'https://graphql.anilist.co';

async function anilistQuery(query, variables = {}) {
  try {
    const res = await fetch(ANILIST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ query, variables })
    });
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
      console.warn('AniList fetch notice:', err.message);
    }
    return null;
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
  nextAiringEpisode {
    episode
    timeUntilAiring
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

export async function getTrending(page = 1, perPage = 20) {
  const query = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(sort: TRENDING_DESC, type: ANIME) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;
  const data = await anilistQuery(query, { page, perPage });
  return enrichWithChineseTitles(data?.Page?.media || []);
}

export async function getPopular(page = 1, perPage = 20) {
  const query = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(sort: POPULARITY_DESC, type: ANIME) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;
  const data = await anilistQuery(query, { page, perPage });
  return enrichWithChineseTitles(data?.Page?.media || []);
}

export async function getTopRated(page = 1, perPage = 20) {
  const query = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(sort: SCORE_DESC, type: ANIME) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;
  const data = await anilistQuery(query, { page, perPage });
  return enrichWithChineseTitles(data?.Page?.media || []);
}

export async function getUpcoming(page = 1, perPage = 20) {
  const query = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(status: NOT_YET_RELEASED, sort: POPULARITY_DESC, type: ANIME) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;
  const data = await anilistQuery(query, { page, perPage });
  return enrichWithChineseTitles(data?.Page?.media || []);
}

export async function getByGenre(genre, page = 1, perPage = 20) {
  const query = `
    query ($genre: String, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(genre: $genre, sort: POPULARITY_DESC, type: ANIME) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;
  const data = await anilistQuery(query, { genre, page, perPage });
  return enrichWithChineseTitles(data?.Page?.media || []);
}

export async function searchAnime(keyword, page = 1, perPage = 20) {
  const cleanKeyword = (keyword || '').trim();
  if (!cleanKeyword) return [];

  const query = `
    query ($search: String, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(search: $search, sort: SEARCH_MATCH, type: ANIME) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;

  // 1. First attempt direct search on AniList
  let results = [];
  try {
    const data = await anilistQuery(query, { search: cleanKeyword, page, perPage });
    results = data?.Page?.media || [];
  } catch (err) {
    console.warn('AniList direct search error:', err.message);
  }

  // 2. If results are sparse and keyword contains Chinese characters, resolve via Bangumi
  const hasChinese = /[\u4e00-\u9fa5]/.test(cleanKeyword);
  if (results.length < 3 && hasChinese) {
    try {
      const bgmRes = await fetch(
        `https://api.bgm.tv/search/subject/${encodeURIComponent(cleanKeyword)}?type=2&responseGroup=small`,
        { headers: { 'User-Agent': 'AniFlix/1.0 (contact: github.com/aniflix)' } }
      );
      if (bgmRes.ok) {
        const bgmData = await bgmRes.json();
        const matches = (bgmData.list || []).slice(0, 3);
        const existingIds = new Set(results.map(r => r.id));

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

  return enrichWithChineseTitles(results);
}

export async function getAnimeDetails(id) {
  const numId = parseInt(id, 10);
  if (!numId || isNaN(numId)) return null;

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
  const enriched = enrichWithChineseTitles([media]);
  return enriched[0] || media;
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
    return enrichWithChineseTitles(recs);
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
  isAdult = false
} = {}) {
  const variables = { page: parseInt(page), perPage: parseInt(perPage) };

  if (isAdult !== null && isAdult !== undefined && isAdult !== 'all') {
    variables.isAdult = Boolean(isAdult);
  }

  if (year && year !== 'ALL') {
    variables.seasonYear = parseInt(year);
  }

  if (season && season !== 'ALL') {
    variables.season = season.toUpperCase();
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

  try {
    const data = await anilistQuery(query, variables);
    return {
      media: enrichWithChineseTitles(data?.Page?.media || []),
      pageInfo: data?.Page?.pageInfo || { hasNextPage: false }
    };
  } catch (err) {
    console.error('Failed to get seasonal catalog:', err.message);
    return { media: [], pageInfo: { hasNextPage: false } };
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
        thumbnail: tr.thumbnail || (tr.site === 'youtube' ? `https://i.ytimg.com/vi/${tr.id}/hqdefault.jpg` : null),
        embedUrl: tr.site === 'youtube' ? `https://www.youtube-nocookie.com/embed/${tr.id}?autoplay=1&rel=0` : null,
        url: tr.site === 'youtube' ? `https://www.youtube.com/watch?v=${tr.id}` : null
      });
    }

    const titleToSearch = romajiTitle || animeDetails?.title?.romaji || englishTitle || animeDetails?.title?.english || '';

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
 * Free text translation helper with OpenCC post-processing
 */
async function translateText(text, targetLang = 'zh-TW') {
  if (!text || !text.trim()) return '';
  const clean = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  try {
    const langpair = targetLang === 'zh-CN' ? 'en|zh-CN' : 'en|zh-TW';
    const isJapanese = /[\u3040-\u309F\u30A0-\u30FF]/.test(clean);
    const pair = isJapanese ? (targetLang === 'zh-CN' ? 'ja|zh-CN' : 'ja|zh-TW') : langpair;

    // Split text into chunks if too long
    const sentences = clean.match(/[^.!?\n]+[.!?\n]+/g) || [clean];
    let chunks = [];
    let currentChunk = '';
    for (const s of sentences) {
      if ((currentChunk + ' ' + s).length > 400) {
        if (currentChunk) chunks.push(currentChunk.trim());
        currentChunk = s;
      } else {
        currentChunk = (currentChunk ? currentChunk + ' ' : '') + s;
      }
    }
    if (currentChunk) chunks.push(currentChunk.trim());
    chunks = chunks.slice(0, 4); // limit to top chunks

    const translatedParts = await Promise.all(chunks.map(async (chunk) => {
      try {
        const mmUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${pair}`;
        const res = await fetch(mmUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AniFlix/1.0' }
        });
        if (!res.ok) return chunk;
        const data = await res.json();
        return data?.responseData?.translatedText || chunk;
      } catch {
        return chunk;
      }
    }));

    let fullTranslated = translatedParts.join(' ').trim();
    if (targetLang === 'zh-TW') {
      return s2tw(fullTranslated);
    } else {
      return t2cn(fullTranslated);
    }
  } catch {
    return clean;
  }
}

export async function getAnimeChineseInfo(animeId, { romaji = '', native = '', english = '', description = '' } = {}, targetLang = 'zh-TW') {
  const cacheKey = `${animeId}_${targetLang}`;
  if (chineseInfoCache.has(cacheKey)) {
    return chineseInfoCache.get(cacheKey);
  }

  const searchTitle = native || romaji || english;
  if (!searchTitle) {
    return { id: animeId, titleZh: '', summaryZh: '' };
  }

  try {
    const searchUrl = `https://api.bgm.tv/search/subject/${encodeURIComponent(searchTitle)}?type=2&responseGroup=small`;
    const res = await fetch(searchUrl, {
      headers: { 'User-Agent': 'AniFlix/1.0 (contact: github.com/aniflix)' }
    });

    let topMatch = null;
    if (res.ok) {
      const searchData = await res.json();
      topMatch = (searchData.list || [])[0];
    }

    let rawTitle = topMatch ? (topMatch.name_cn || topMatch.name || '') : '';
    let rawSummary = topMatch ? (topMatch.summary || '') : '';

    // If summary is empty, fetch subject detail
    if (topMatch && !rawSummary && topMatch.id) {
      try {
        const detailRes = await fetch(`https://api.bgm.tv/v0/subjects/${topMatch.id}`, {
          headers: { 'User-Agent': 'AniFlix/1.0 (contact: github.com/aniflix)' }
        });
        if (detailRes.ok) {
          const detailData = await detailRes.json();
          rawTitle = detailData.name_cn || rawTitle;
          rawSummary = detailData.summary || '';
        }
      } catch (e) {
        // ignore detail fetch failure
      }
    }

    // Determine Chinese Title
    let titleZh = '';
    if (rawTitle) {
      titleZh = targetLang === 'zh-TW' ? s2tw(rawTitle) : t2cn(rawTitle);
    } else {
      titleZh = targetLang === 'zh-TW' ? s2tw(native || romaji || english) : (native || romaji || english);
    }

    // Determine Chinese Summary
    let summaryZh = '';
    const hasJapaneseKana = /[\u3040-\u309F\u30A0-\u30FF]/.test(rawSummary);
    if (rawSummary && !hasJapaneseKana) {
      // Already Chinese summary from Bangumi
      summaryZh = targetLang === 'zh-TW' ? s2tw(rawSummary) : t2cn(rawSummary);
    } else if (rawSummary && hasJapaneseKana) {
      // Japanese summary from Bangumi -> translate to Traditional Chinese
      summaryZh = await translateText(rawSummary, targetLang);
    } else if (description) {
      // English description from AniList -> translate to Traditional Chinese
      summaryZh = await translateText(description, targetLang);
    }

    const result = {
      id: animeId,
      bgmId: topMatch?.id || null,
      titleZh,
      summaryZh
    };

    chineseInfoCache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.warn(`[Metadata] Failed to fetch Chinese info for ${searchTitle}:`, err.message);
    let fallbackSummary = '';
    if (description) {
      try {
        fallbackSummary = await translateText(description, targetLang);
      } catch {}
    }
    const fallback = {
      id: animeId,
      titleZh: targetLang === 'zh-TW' ? s2tw(native || romaji || english) : (native || romaji || english),
      summaryZh: fallbackSummary
    };
    chineseInfoCache.set(cacheKey, fallback);
    return fallback;
  }
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

  // Nyaa Candidate queries: prioritizes English and Romaji titles, then Native
  const nyaaCandidates = queries.filter(q => /^[a-zA-Z0-9\s':\-\.,!?]+$/.test(q));
  if (nyaaCandidates.length === 0) {
    nyaaCandidates.push(...queries);
  }
  const topNyaa = Array.from(new Set([...nyaaCandidates, ...queries])).slice(0, 3);

  // 1. Fetch DMHY in parallel with timeout
  const dmhyPromises = topDmhy.map(async (dq) => {
    try {
      const dmhyUrl = `https://share.dmhy.org/topics/rss/rss.xml?keyword=${encodeURIComponent(dq)}`;
      const res = await fetch(dmhyUrl, {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AniFlix/1.0' }
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
      console.warn(`[Metadata] DMHY RSS error for "${dq}":`, err.message);
    }
  });

  // 2. Fetch Nyaa in parallel with timeout
  const nyaaPromises = topNyaa.map(async (nq) => {
    try {
      const nyaaUrl = `https://nyaa.si/?page=rss&c=1_2&q=${encodeURIComponent(nq)}`;
      const res = await fetch(nyaaUrl, {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AniFlix/1.0' }
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
      console.warn(`[Metadata] Nyaa RSS error for "${nq}":`, err.message);
    }
  });

  await Promise.allSettled([...dmhyPromises, ...nyaaPromises]);

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
