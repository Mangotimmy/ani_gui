// server/services/aniskip.js - AniSkip (https://api.aniskip.com) opening/ending timestamps
import { BoundedCache } from './cache.js';
import { getAnimeDetails } from './metadata.js';

const skipCache = new BoundedCache(500, 12 * 60 * 60 * 1000); // 12h
const USER_AGENT = 'AniFlix/2.7 (+https://github.com/Mangotimmy/ani_gui)';
const TYPE_MAP = { op: 'op', ed: 'ed', 'mixed-op': 'op', 'mixed-ed': 'ed', recap: 'recap' };

/**
 * Skip intervals for one episode. AniSkip is keyed by MyAnimeList id, so the AniList id is
 * translated through \`idMal\`. Never throws: unknown shows simply return { found: false }.
 * @returns {Promise<{found:boolean, malId:number|null, intervals:Array<{type:string,start:number,end:number}>}>}
 */
export async function getSkipTimes(anilistId, episode = 1, episodeLength = 0) {
  const empty = { found: false, malId: null, intervals: [] };
  const ep = Math.max(1, parseInt(episode, 10) || 1);
  const key = `${anilistId}_${ep}`;
  const cached = skipCache.get(key);
  if (cached) return cached;

  let malId = null;
  try {
    const details = await getAnimeDetails(anilistId);
    malId = details?.idMal || null;
  } catch {}
  if (!malId) {
    skipCache.set(key, empty);
    return empty;
  }

  try {
    const qs = new URLSearchParams();
    ['op', 'ed', 'recap', 'mixed-op', 'mixed-ed'].forEach(t => qs.append('types', t));
    qs.set('episodeLength', String(Math.max(0, Math.round(Number(episodeLength) || 0))));
    const res = await fetch(`https://api.aniskip.com/v2/skip-times/${malId}/${ep}?${qs.toString()}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(5000)
    });
    // 404 = no community timestamps for this episode.
    if (res.status === 404) {
      const none = { ...empty, malId };
      skipCache.set(key, none);
      return none;
    }
    if (!res.ok) return { ...empty, malId };
    const data = await res.json();
    const intervals = (Array.isArray(data?.results) ? data.results : [])
      .map(r => ({
        type: TYPE_MAP[r.skipType] || r.skipType,
        start: Number(r.interval?.startTime),
        end: Number(r.interval?.endTime)
      }))
      .filter(i => Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start)
      .sort((a, b) => a.start - b.start);
    const out = { found: intervals.length > 0, malId, intervals };
    skipCache.set(key, out);
    return out;
  } catch (err) {
    console.warn('[AniSkip] lookup failed:', err.message);
    return { ...empty, malId };
  }
}

export default { getSkipTimes };
