// server/services/sources/anime1.js - Anime1 Stream Resolver (Anime1.me 1080p MP4 + Anime1.one Classic HLS)
import * as OpenCC from 'opencc-js';
import { BoundedCache } from '../cache.js';
import { lookupAlias, getAliasCandidates } from '../db.js';

const s2t = OpenCC.Converter({ from: 'cn', to: 'tw' });

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const REFERER_ME = 'https://anime1.me/';
const REFERER_ONE = 'https://anime1.one/';
const anime1Cache = new BoundedCache(200, 30 * 60 * 1000); // 30m TTL

/**
 * Clean and normalize query for Anime1 search
 */
function cleanQuery(query) {
  if (!query) return '';
  const converted = s2t(query);
  return converted
    .replace(/[【】\[\]\(\)]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse episode number from Anime1 post title
 * Examples: "鬼滅之刃 柱訓練篇 [08]", "為美好的世界獻上祝福！3 [01]", "七大罪 戒律的復活 (第二季) [01]", "第1話", "01"
 */
function extractEpNumber(titleStr) {
  if (!titleStr) return null;
  const bracketMatch = titleStr.match(/\[(\d+)\]/);
  if (bracketMatch) return parseInt(bracketMatch[1], 10);

  const epMatch = titleStr.match(/第\s*(\d+)\s*[話集期]/);
  if (epMatch) return parseInt(epMatch[1], 10);

  const numMatch = titleStr.match(/\b(\d{1,4})\b/);
  if (numMatch) return parseInt(numMatch[1], 10);

  return null;
}

/**
 * Build rich candidate queries covering multi-regional Chinese variations (TW, HK, CN)
 */
function buildQueryList(title, candidates = []) {
  const rawList = [
    ...(Array.isArray(candidates) ? candidates : [candidates]),
    title
  ].filter(Boolean);

  const querySet = new Set();

  for (const raw of rawList) {
    if (!raw) continue;

    // Check SQLite alias candidates (e.g. One Piece -> 航海王, 海賊王)
    const dbAliases = getAliasCandidates(raw);
    for (const a of dbAliases) {
      const cleaned = cleanQuery(a);
      if (cleaned.length >= 2) querySet.add(cleaned);
    }

    // Split any slashed or delimited terms (e.g. "航海王 / 海賊王")
    const splitParts = String(raw).split(/[\/、，,\|\+]/).map(s => s.trim()).filter(Boolean);
    for (const p of splitParts) {
      const directClean = cleanQuery(p);
      if (directClean.length >= 2) querySet.add(directClean);

      // Also add version without generic season words
      const stripSeason = directClean.replace(/(season\s*\d+|第\s*\d+\s*季|part\s*\d+)/gi, '').trim();
      if (stripSeason.length >= 2) querySet.add(stripSeason);
    }
  }

  // Ensure title is present as fallback
  const fallbackClean = cleanQuery(title);
  if (fallbackClean.length >= 2) querySet.add(fallbackClean);

  return Array.from(querySet);
}

/**
 * 1. Resolve stream from Anime1.me (Primary: 1080p MP4 with signed cookies)
 */
async function resolveFromAnime1Me(queryList, epNum) {
  for (const q of queryList) {
    if (!q || q.length < 2) continue;

    try {
      const searchUrl = `https://anime1.me/?s=${encodeURIComponent(q)}`;
      const searchRes = await fetch(searchUrl, {
        headers: { 'User-Agent': USER_AGENT, 'Referer': REFERER_ME },
        signal: AbortSignal.timeout(5000)
      });

      if (!searchRes.ok) continue;
      const html = await searchRes.text();

      const articleMatches = [...html.matchAll(/<h2 class="entry-title">\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)];
      if (articleMatches.length === 0) continue;

      let targetArticle = null;

      // 1. Direct search page match
      for (const m of articleMatches) {
        if (extractEpNumber(m[2]) === epNum) {
          targetArticle = { url: m[1], title: m[2] };
          break;
        }
      }

      // 2. If not on search page, traverse category pages (pages 1 to 3)
      if (!targetArticle) {
        const catMatch = html.match(/<a href="([^"]*\/category\/[^"]+)"/);
        if (catMatch) {
          const catBase = catMatch[1].replace(/\/page\/\d+/, '').replace(/\/$/, '');
          for (let page = 1; page <= 3; page++) {
            try {
              const pageUrl = page === 1 ? catBase : `${catBase}/page/${page}`;
              const catRes = await fetch(pageUrl, {
                headers: { 'User-Agent': USER_AGENT, 'Referer': REFERER_ME },
                signal: AbortSignal.timeout(5000)
              });
              if (!catRes.ok) break;
              const catHtml = await catRes.text();
              const catArticles = [...catHtml.matchAll(/<h2 class="entry-title">\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)];
              for (const cm of catArticles) {
                if (extractEpNumber(cm[2]) === epNum) {
                  targetArticle = { url: cm[1], title: cm[2] };
                  break;
                }
              }
              if (targetArticle) break;
            } catch {}
          }
        }
      }

      // 3. Fallback: if requesting episode 1 and only 1 post found
      if (!targetArticle && epNum === 1 && articleMatches.length > 0) {
        targetArticle = { url: articleMatches[articleMatches.length - 1][1], title: articleMatches[articleMatches.length - 1][2] };
      }

      if (!targetArticle) continue;

      // Fetch the episode post page
      const epPageRes = await fetch(targetArticle.url, {
        headers: { 'User-Agent': USER_AGENT, 'Referer': REFERER_ME },
        signal: AbortSignal.timeout(5000)
      });
      if (!epPageRes.ok) continue;

      const epHtml = await epPageRes.text();
      const apiReqMatch = epHtml.match(/data-apireq="([^"]+)"/);
      if (!apiReqMatch) continue;

      const rawApiReq = apiReqMatch[1];

      // Request stream video endpoint from https://v.anime1.me/api
      const apiRes = await fetch('https://v.anime1.me/api', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': targetArticle.url,
          'User-Agent': USER_AGENT
        },
        body: `d=${rawApiReq}`,
        signal: AbortSignal.timeout(5000)
      });

      if (!apiRes.ok) continue;

      const apiData = await apiRes.json();
      if (!apiData || !apiData.s || !apiData.s[0] || !apiData.s[0].src) continue;

      let rawSrc = apiData.s[0].src;
      if (rawSrc.startsWith('//')) {
        rawSrc = 'https:' + rawSrc;
      }

      // Extract Set-Cookies (e, p, h)
      let cookies = [];
      if (typeof apiRes.headers.getSetCookie === 'function') {
        cookies = apiRes.headers.getSetCookie();
      } else if (apiRes.headers.get('set-cookie')) {
        cookies = [apiRes.headers.get('set-cookie')];
      }

      const cookieStr = cookies
        .map(c => c ? c.split(';')[0] : '')
        .filter(Boolean)
        .join('; ');

      const proxiedStreamUrl = `/api/proxy?url=${encodeURIComponent(rawSrc)}&referer=${encodeURIComponent(REFERER_ME)}${cookieStr ? `&cookies=${encodeURIComponent(cookieStr)}` : ''}`;

      return {
        success: true,
        source: 'anime1',
        serverName: 'Anime1.me (1080p MP4 / 原生繁中硬字)',
        mode: 'sub',
        episode: epNum,
        streamUrl: rawSrc,
        proxiedStreamUrl,
        cookies: cookieStr,
        isMp4: true,
        referer: REFERER_ME,
        subtitles: [
          {
            lang: '繁體中文 (Anime1 官方原生內嵌字幕)',
            url: '',
            default: true,
            isEmbedded: true
          }
        ],
        proxiedSubtitles: []
      };
    } catch (err) {
      console.warn(`[Anime1.me] Search failed for "${q}":`, err.message);
    }
  }

  return null;
}

/**
 * 2. Resolve stream from Anime1.one (Secondary / Mirror: Full long-running classic series archive)
 */
async function resolveFromAnime1One(queryList, epNum) {
  for (const q of queryList) {
    if (!q || q.length < 2) continue;

    try {
      const searchUrl = `https://anime1.one/?s=${encodeURIComponent(q)}`;
      const searchRes = await fetch(searchUrl, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(5000)
      });

      if (!searchRes.ok) continue;
      const html = await searchRes.text();

      // Extract series slug from post matches, e.g. /199902074-11180000 or /199902074/
      const seriesMatch = html.match(/\/(\d{8,10})[-/]/);
      if (!seriesMatch) continue;

      const seriesId = seriesMatch[1];
      // Deterministic episode calculation on anime1.one
      const epCode = 10000000 + (epNum * 1000);
      const epSlug = `https://anime1.one/${seriesId}-${epCode}`;

      const epRes = await fetch(epSlug, {
        headers: { 'User-Agent': USER_AGENT, 'Referer': REFERER_ONE },
        signal: AbortSignal.timeout(5000)
      });

      if (!epRes.ok) continue;

      const epHtml = await epRes.text();
      const playerMatch = epHtml.match(/src="(\/_player_x_\/[^"]+)"/);
      if (!playerMatch) continue;

      const playerUrl = `https://anime1.one${playerMatch[1]}`;
      const playerRes = await fetch(playerUrl, {
        headers: { 'User-Agent': USER_AGENT, 'Referer': epSlug },
        signal: AbortSignal.timeout(5000)
      });

      if (!playerRes.ok) continue;

      const playerHtml = await playerRes.text();
      const m3u8Match = playerHtml.match(/src="([^"]+\.m3u8[^"]*)"/);
      if (!m3u8Match) continue;

      const rawM3u8 = m3u8Match[1];
      const proxiedStreamUrl = `/api/proxy?url=${encodeURIComponent(rawM3u8)}&referer=${encodeURIComponent(REFERER_ONE)}`;

      return {
        success: true,
        source: 'anime1',
        serverName: 'Anime1.one (經典全集 / 繁中 HLS 串流)',
        mode: 'sub',
        episode: epNum,
        streamUrl: rawM3u8,
        proxiedStreamUrl,
        isMp4: false,
        referer: REFERER_ONE,
        subtitles: [
          {
            lang: '繁體中文 (Anime1 內嵌字幕)',
            url: '',
            default: true,
            isEmbedded: true
          }
        ],
        proxiedSubtitles: []
      };
    } catch (err) {
      console.warn(`[Anime1.one] Search failed for "${q}":`, err.message);
    }
  }

  return null;
}

/**
 * Main Anime1 Resolver with Automatic Dual-Source Fallback
 */
export async function resolveAnime1Stream({ title, candidates = [], episode = 1 }) {
  const epNum = Number(episode) || 1;
  const queryList = buildQueryList(title, candidates);

  const cacheKey = `anime1_${queryList[0] || title}_ep${epNum}`.toLowerCase();
  if (anime1Cache.has(cacheKey)) {
    return anime1Cache.get(cacheKey);
  }

  // 1. Try Anime1.me (Primary modern seasonal 1080p MP4)
  const meResult = await resolveFromAnime1Me(queryList, epNum);
  if (meResult) {
    anime1Cache.set(cacheKey, meResult);
    return meResult;
  }

  // 2. Try Anime1.one (Secondary classic long-running series archive)
  const oneResult = await resolveFromAnime1One(queryList, epNum);
  if (oneResult) {
    anime1Cache.set(cacheKey, oneResult);
    return oneResult;
  }

  return {
    success: false,
    source: 'anime1',
    error: `Anime1 (me/one) 找不到《${title}》第 ${episode} 集的串流資源。`
  };
}

export default { resolveAnime1Stream };
