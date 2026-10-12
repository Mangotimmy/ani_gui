// server/services/sources/anime1.js - Anime1.me Stream Resolver (1080p MP4 + Native Traditional Chinese)
import * as OpenCC from 'opencc-js';
import { BoundedCache } from '../cache.js';
import { lookupAlias } from '../db.js';

const s2t = OpenCC.Converter({ from: 'cn', to: 'tw' });

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const REFERER = 'https://anime1.me/';
const anime1Cache = new BoundedCache(150, 30 * 60 * 1000); // 30m TTL

/**
 * Clean and normalize query for Anime1 search
 * Anime1 exclusively indexes Traditional Chinese titles
 */
function cleanQuery(query) {
  if (!query) return '';
  const converted = s2t(query);
  return converted
    .replace(/[【】\[\]\(\)]/g, ' ')
    .replace(/(season\s*\d+|第\s*\d+\s*季|part\s*\d+)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse episode number from Anime1 post title
 * Examples: "鬼滅之刃 柱訓練篇 [08]", "為美好的世界獻上祝福！3 [01]", "第1話", "01"
 */
function extractEpNumber(titleStr) {
  if (!titleStr) return null;
  const bracketMatch = titleStr.match(/\[(\d+)\]/);
  if (bracketMatch) return parseInt(bracketMatch[1], 10);

  const epMatch = titleStr.match(/第\s*(\d+)\s*[話集期]/);
  if (epMatch) return parseInt(epMatch[1], 10);

  const numMatch = titleStr.match(/\b(\d{1,3})\b/);
  if (numMatch) return parseInt(numMatch[1], 10);

  return null;
}

/**
 * Search Anime1 for target anime and episode
 */
export async function resolveAnime1Stream({ title, candidates = [], episode = 1 }) {
  const epNum = Number(episode) || 1;

  // Build candidate query list, prioritizing Traditional Chinese titles
  const rawCandidates = [
    ...(Array.isArray(candidates) ? candidates : [candidates]),
    title
  ].filter(Boolean);

  const querySet = new Set();

  for (const c of rawCandidates) {
    if (!c) continue;
    // Check local SQLite alias dictionary for pre-mapped Traditional Chinese title
    const aliasRecord = lookupAlias(c);
    if (aliasRecord?.chinese) {
      querySet.add(cleanQuery(aliasRecord.chinese));
    }
    const trad = cleanQuery(c);
    if (trad && trad.length >= 2) {
      querySet.add(trad);
    }
  }

  const queryList = Array.from(querySet);
  if (queryList.length === 0) {
    queryList.push(cleanQuery(title));
  }

  const cacheKey = `anime1_${queryList[0]}_ep${epNum}`.toLowerCase();
  if (anime1Cache.has(cacheKey)) {
    return anime1Cache.get(cacheKey);
  }

  for (const q of queryList) {
    if (!q || q.length < 2) continue;

    try {
      const searchUrl = `https://anime1.me/?s=${encodeURIComponent(q)}`;
      const searchRes = await fetch(searchUrl, {
        headers: { 'User-Agent': USER_AGENT, 'Referer': REFERER },
        signal: AbortSignal.timeout(5000)
      });

      if (!searchRes.ok) continue;
      const html = await searchRes.text();

      // Extract article posts: <h2 class="entry-title"><a href="url">title</a></h2>
      const articleMatches = [...html.matchAll(/<h2 class="entry-title">\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)];
      if (articleMatches.length === 0) continue;

      // Find the article matching the requested episode number
      let targetArticle = null;
      for (const m of articleMatches) {
        const postUrl = m[1];
        const postTitle = m[2];
        const parsedEp = extractEpNumber(postTitle);
        if (parsedEp === epNum) {
          targetArticle = { url: postUrl, title: postTitle };
          break;
        }
      }

      // If exact episode wasn't found on search index, check if category link is available
      if (!targetArticle) {
        const catMatch = html.match(/<a href="([^"]*\/category\/[^"]+)"/);
        if (catMatch) {
          try {
            const catRes = await fetch(catMatch[1], { 
              headers: { 'User-Agent': USER_AGENT, 'Referer': REFERER },
              signal: AbortSignal.timeout(5000)
            });
            if (catRes.ok) {
              const catHtml = await catRes.text();
              const catArticles = [...catHtml.matchAll(/<h2 class="entry-title">\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)];
              for (const cm of catArticles) {
                if (extractEpNumber(cm[2]) === epNum) {
                  targetArticle = { url: cm[1], title: cm[2] };
                  break;
                }
              }
            }
          } catch {}
        }
      }

      // Fallback: if requesting episode 1 and only 1 post found
      if (!targetArticle && epNum === 1 && articleMatches.length > 0) {
        targetArticle = { url: articleMatches[articleMatches.length - 1][1], title: articleMatches[articleMatches.length - 1][2] };
      }

      if (!targetArticle) continue;

      // Fetch the episode page to locate <video ... data-apireq="...">
      const epPageRes = await fetch(targetArticle.url, {
        headers: { 'User-Agent': USER_AGENT, 'Referer': REFERER },
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

      const proxiedStreamUrl = `/api/proxy?url=${encodeURIComponent(rawSrc)}&referer=${encodeURIComponent('https://anime1.me/')}${cookieStr ? `&cookies=${encodeURIComponent(cookieStr)}` : ''}`;

      const result = {
        success: true,
        source: 'anime1',
        serverName: 'Anime1.me (1080p MP4 / 原生繁中硬字)',
        mode: 'sub',
        episode: epNum,
        streamUrl: rawSrc,
        proxiedStreamUrl,
        cookies: cookieStr,
        isMp4: true,
        referer: 'https://anime1.me/',
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

      anime1Cache.set(cacheKey, result);
      return result;
    } catch (err) {
      console.warn(`[Anime1] Search failed for "${q}":`, err.message);
    }
  }

  return {
    success: false,
    source: 'anime1',
    error: `Anime1.me 找不到《${title}》第 ${episode} 集的串流資源。`
  };
}

export default { resolveAnime1Stream };
