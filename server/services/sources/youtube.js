// server/services/sources/youtube.js - YouTube Full Anime Series & Episode Resolver
import { BoundedCache } from '../cache.js';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Caches for YouTube series episode matching
const youtubeSeriesCache = new BoundedCache(300, 2 * 60 * 60 * 1000); // 2h TTL for hits
const youtubeSeriesFailCache = new BoundedCache(200, 10 * 60 * 1000);  // 10m TTL for misses

/**
 * Checks YouTube playability & country availability for a video ID.
 * Detects "The uploader has not made this video available in your country" or embed blocks.
 */
export async function checkPlayability(videoId) {
  if (!videoId) return { ok: false, reason: 'No videoId' };
  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Language': 'zh-TW,zh;q=0.9,ja;q=0.8,en;q=0.7'
      },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const html = await res.text();
    const m = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
    if (!m) return { ok: false, reason: 'Unable to extract player response' };
    const data = JSON.parse(m[1]);
    const playability = data?.playabilityStatus;
    const isPlayable = playability?.status === 'OK' && playability?.playableInEmbed !== false;
    const reason = playability?.reason ||
      playability?.errorScreen?.playerInterstitialRenderer?.content?.interstitialViewModel?.description?.content ||
      playability?.errorScreen?.playerErrorMessageRenderer?.reason?.simpleText ||
      playability?.messages?.[0] ||
      (isPlayable ? '' : 'Video unavailable: The uploader has not made this video available in your country');

    return {
      ok: isPlayable,
      status: playability?.status || 'UNKNOWN',
      reason,
      playableInEmbed: playability?.playableInEmbed !== false
    };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

function parseDurationSeconds(durationStr) {
  if (!durationStr) return 0;
  const parts = durationStr.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

/**
 * Ensures the video title actually contains the anime title or its keywords,
 * avoiding unrelated videos from official channels (e.g. Crunchyroll uploading other anime).
 */
function matchesAnimeTitle(videoTitle, titleCandidates) {
  if (!videoTitle) return false;
  const normVideo = videoTitle.toLowerCase().replace(/[\s\-_:;,\.!\?'"~()\[\]【】]/g, '');
  for (const raw of titleCandidates) {
    if (!raw) continue;
    const clean = String(raw).trim().toLowerCase();
    const normCandidate = clean.replace(/[\s\-_:;,\.!\?'"~()\[\]【】]/g, '');
    if (normCandidate.length >= 2 && normVideo.includes(normCandidate)) {
      return true;
    }
    const words = clean.split(/[\s\-_:;,\.!\?'"~()\[\]【】]+/).filter(w => w.length >= 3);
    if (words.length > 0 && words.every(w => normVideo.includes(w))) {
      return true;
    }
  }
  return false;
}

/**
 * Searches YouTube for an official full series episode (NOT trailers / clips).
 * Targets licensed anime distributors (Muse, Ani-One, Bilibili, Toei, etc.).
 */
export async function findYouTubeSeriesEpisode(titleCandidates, episode = 1) {
  const epNum = Number(episode) || 1;
  const epPad = String(epNum).padStart(2, '0');

  const titles = (Array.isArray(titleCandidates) ? titleCandidates : [titleCandidates])
    .filter(Boolean)
    .map(t => String(t).trim())
    .filter(t => t.length > 0);

  if (titles.length === 0) return null;

  const cacheKey = `${titles[0]}_ep${epNum}`.toLowerCase();
  if (youtubeSeriesCache.has(cacheKey)) {
    return youtubeSeriesCache.get(cacheKey);
  }
  if (youtubeSeriesFailCache.has(cacheKey)) {
    return null;
  }

  const queryTemplates = [
    (t) => `${t} 第${epPad}話`,
    (t) => `${t} 第${epNum}集`,
    (t) => `${t} Episode ${epNum} Muse`,
    (t) => `${t} Episode ${epNum} Ani-One`,
    (t) => `${t} Episode ${epNum}`
  ];

  const queries = [];
  for (const t of titles) {
    for (const tmpl of queryTemplates) {
      queries.push(tmpl(t));
    }
  }

  const uniqueQueries = Array.from(new Set(queries)).slice(0, 6);

  for (const q of uniqueQueries) {
    const ytUrl = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q) + '&sp=EgIQAQ%253D%253D';
    try {
      const res = await fetch(ytUrl, {
        headers: {
          'User-Agent': BROWSER_UA,
          'Accept-Language': 'zh-TW,zh;q=0.9,ja;q=0.8,en;q=0.7'
        },
        signal: AbortSignal.timeout(4500)
      });
      if (!res.ok) continue;

      const html = await res.text();
      const dataMatch = html.match(/ytInitialData\s*=\s*({.+?});<\/script>/);
      if (!dataMatch) continue;
      const json = JSON.parse(dataMatch[1]);
      const contents = json?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];

      for (const item of contents) {
        const v = item?.videoRenderer;
        if (!v || !v.videoId) continue;
        const vTitle = v.title?.runs?.[0]?.text || '';
        const channel = v.ownerText?.runs?.[0]?.text || '';
        const lengthText = v.lengthText?.simpleText || '';
        const durationSec = parseDurationSeconds(lengthText);

        const lowerTitle = vTitle.toLowerCase();
        const lowerChannel = channel.toLowerCase();

        // 1. Exclude trailers, clips, PVs, reviews, reactions, AMVs, summaries, games, collabs, marathons
        const isExcluded = /trailer|teaser|pv|本予告|特報|精華|片段|花絮|剪輯|解說|一口氣看完|速通|盤點|吐槽|反應|reaction|review|amv|op|ed|ost|【コラボ】|コラボ|實況|手遊|walkthrough|playthrough|gameplay|預告|予告|馬拉松|合集/i.test(lowerTitle);
        if (isExcluded) continue;

        // 2. Must be single episode duration: between 10 mins and 45 mins
        if (durationSec < 600 || durationSec > 2700) continue;

        // 3. Must match episode number:
        const epRegex = new RegExp(`(?:第\\s*0*${epNum}\\s*[話集期]|episode\\s*0*${epNum}\\b|ep\\.?\\s*0*${epNum}\\b|\\b0*${epNum}\\s*[話集]|【\\s*0*${epNum}\\s*】)`, 'i');
        if (!epRegex.test(vTitle)) continue;

        // 4. Must be from official licensor OR have standard anime streaming keywords
        const isOfficialLicensor = /muse|木棉花|ani-one|羚邦|bilibili|gundam|toei|kadokawa|crunchyroll|tms|netflix/i.test(lowerChannel) ||
                                  /動畫|線上看|中文配音|日語原聲|雙語/i.test(vTitle);

        if (!isOfficialLicensor) continue;

        // 5. Must match the specific anime title
        if (!matchesAnimeTitle(vTitle, titles)) continue;

        // 6. Verify playability in user's region & embed permission
        const playability = await checkPlayability(v.videoId);
        if (!playability.ok) {
          console.log(`[YouTube] Video ${v.videoId} ("${vTitle}") is unplayable or geo-blocked: ${playability.reason}`);
          continue;
        }

        const matchResult = {
          id: v.videoId,
          title: vTitle,
          channel,
          duration: lengthText,
          durationSec,
          isOfficial: isOfficialLicensor,
          playability
        };

        youtubeSeriesCache.set(cacheKey, matchResult);
        return matchResult;
      }
    } catch {
      // Continue next query candidate
    }
  }

  youtubeSeriesFailCache.set(cacheKey, true);
  return null;
}

/**
 * Checks whether a YouTube series episode is available (used to dynamically show/hide the option).
 */
export async function checkYouTubeSeriesAvailability(titleCandidates, episode = 1) {
  const result = await findYouTubeSeriesEpisode(titleCandidates, episode);
  return Boolean(result && result.id);
}

/**
 * Resolves a full YouTube anime series episode for the VideoPlayer.
 * (Strictly series episode, NOT promotional trailer).
 */
export async function resolveYouTubeStream({ 
  title, 
  candidates = [], 
  episode = 1, 
  anilistId = null 
}) {
  const rawTitle = title || candidates[0] || '';
  const queryCandidates = [
    rawTitle,
    ...(Array.isArray(candidates) ? candidates : [candidates])
  ].filter(Boolean);

  const matchedEpisode = await findYouTubeSeriesEpisode(queryCandidates, episode);

  if (matchedEpisode && matchedEpisode.id) {
    const videoId = matchedEpisode.id;
    const streamUrl = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&enablejsapi=1`;
    return {
      success: true,
      source: 'youtube',
      activeSource: 'youtube',
      serverName: `YouTube (${matchedEpisode.channel || '正版系列'} / 第 ${episode} 集)`,
      streamUrl,
      proxiedStreamUrl: streamUrl,
      isEmbed: true,
      isEmbedSource: true,
      videoId,
      watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
      videoTitle: matchedEpisode.title,
      channel: matchedEpisode.channel,
      duration: matchedEpisode.duration,
      episode: Number(episode),
      animeTitle: rawTitle
    };
  }

  return {
    success: false,
    source: 'youtube',
    activeSource: 'youtube',
    error: `Video unavailable: The uploader has not made this video available in your country (YouTube 查無《${rawTitle}》第 ${episode} 集可在您地區播放之正版系列影集)。`
  };
}

export default { resolveYouTubeStream, findYouTubeSeriesEpisode, checkYouTubeSeriesAvailability };
