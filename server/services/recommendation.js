// server/services/recommendation.js - Advanced Video Platform Recommendation Engine
//
// Two ranking paths share one public contract (computeRecommendations):
//   1. LightFM + Annoy micro-service (set REC_SERVICE_URL) - learned item embeddings
//      served from a memory-mapped index; see lightfm-annoy-rec/.
//   2. The content-based graph scorer below - always available, used as the fallback
//      whenever the service is missing, slow, empty or unhealthy.
import { getRecommendationsForAnime, getTrending, getPopular, getByGenre, getAnimeDetails } from './metadata.js';

// ---- LightFM + Annoy service configuration ---------------------------------
const REC_SERVICE_URL = (process.env.REC_SERVICE_URL || '').replace(/\/+$/, '');
const REC_TIMEOUT_MS = Number(process.env.REC_TIMEOUT_MS || 600);
const REC_SEED_LIMIT = Number(process.env.REC_SEED_LIMIT || 8);
const REC_PER_SEED = Number(process.env.REC_PER_SEED || 20);
const REC_CANDIDATE_FLOOR = Number(process.env.REC_CANDIDATE_FLOOR || 8);
const REC_COOLDOWN_MS = Number(process.env.REC_COOLDOWN_MS || 60000);
const REC_HEALTH_TTL_MS = Number(process.env.REC_HEALTH_TTL_MS || 30000);
// Quality-first by default: while the trainer reports data_quality != 'ok' (too few users /
// interactions for collaborative filtering to mean anything) the content-based scorer stays in
// charge. Set REC_USE_ONLY_WITH_GOOD_DATA=0 to force the learned ranking on anyway.
const REC_ONLY_GOOD_DATA = !/^(0|false|no|off)$/i.test(process.env.REC_USE_ONLY_WITH_GOOD_DATA || '1');
let weakDataWarned = false;

const recServiceState = { health: null, checkedAt: 0, downUntil: 0 };

function titleOf(anime) {
  return anime?.titleZhTW || anime?.titleZh || anime?.title?.english || anime?.title?.romaji || 'Anime';
}

/** Best-effort health probe, cached for REC_HEALTH_TTL_MS and backed off on failure. */
async function probeRecService() {
  const now = Date.now();
  if (recServiceState.checkedAt && now - recServiceState.checkedAt < REC_HEALTH_TTL_MS) {
    return recServiceState.health;
  }
  recServiceState.checkedAt = now;
  try {
    const res = await fetch(`${REC_SERVICE_URL}/healthz`, {
      signal: AbortSignal.timeout(Math.max(400, REC_TIMEOUT_MS))
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const health = await res.json();
    recServiceState.health = health;
    recServiceState.downUntil = 0;
    return health;
  } catch (err) {
    recServiceState.health = null;
    recServiceState.downUntil = now + REC_COOLDOWN_MS;
    console.warn('[Recommendation] LightFM/Annoy service unavailable; using content-based ranking:', err.message);
    return null;
  }
}

async function fetchSimilar(videoId, k) {
  const res = await fetch(
    `${REC_SERVICE_URL}/api/v1/recommend/${encodeURIComponent(videoId)}?k=${k}`,
    { signal: AbortSignal.timeout(REC_TIMEOUT_MS) }
  );
  if (res.status === 404) return null; // id unknown to the index: not an error
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Explicit favourites + recency/episode-weighted history, richest seeds first. */
function collectSeeds({ favoriteIds, favorites, watchHistory }) {
  const seeds = new Map();
  const now = Date.now();
  const push = (id, anime, weight) => {
    const key = String(id);
    if (!key) return;
    const existing = seeds.get(key);
    if (!existing || weight > existing.weight) {
      seeds.set(key, { id: key, title: existing?.title || titleOf(anime), weight });
    }
  };

  for (const id of favoriteIds) push(id, null, 3.5);
  for (const favorite of favorites) {
    if (favorite?.id) push(favorite.id, favorite, 3.5);
  }
  for (const item of watchHistory) {
    const anime = item?.anime || item;
    if (!anime?.id) continue;
    const timestamp = item?.timestamp ? new Date(item.timestamp).getTime() : now;
    const ageDays = Math.max(0, (now - timestamp) / 86400000);
    const recency = ageDays <= 1 ? 1.25 : ageDays <= 7 ? 1.0 : ageDays <= 30 ? 0.75 : 0.5;
    const episode = Number(item?.episode) || 1;
    push(anime.id, anime, (2.5 * recency) + Math.min(1.0, (episode - 1) * 0.1));
  }

  return [...seeds.values()].sort((a, b) => b.weight - a.weight).slice(0, REC_SEED_LIMIT);
}

/**
 * Ranks candidates with the LightFM + Annoy service. Returns null whenever the learned
 * path cannot be trusted, so the caller can fall back to the content-based scorer.
 */
async function rankWithLightfm(seeds, seen) {
  if (!REC_SERVICE_URL || seeds.length === 0) return null;
  if (Date.now() < recServiceState.downUntil) return null;

  const health = await probeRecService();
  if (!health || health.ready === false) return null;
  if (REC_ONLY_GOOD_DATA && health.data_quality && health.data_quality !== 'ok') {
    if (!weakDataWarned) {
      weakDataWarned = true;
      console.warn(
        '[Recommendation] LightFM index reports data_quality=' + health.data_quality +
        ' (' + health.items + ' items / ' + health.users + ' users). Keeping content-based ranking; ' +
        'set REC_USE_ONLY_WITH_GOOD_DATA=0 to force the learned path.'
      );
    }
    return null;
  }

  const settled = await Promise.allSettled(seeds.map((seed) => fetchSimilar(seed.id, REC_PER_SEED)));
  const failures = settled.filter((entry) => entry.status === 'rejected').length;
  if (failures === settled.length) {
    recServiceState.downUntil = Date.now() + REC_COOLDOWN_MS;
    recServiceState.health = null;
    console.warn('[Recommendation] Every LightFM/Annoy query failed; backing off for', REC_COOLDOWN_MS, 'ms');
    return null;
  }

  const candidateMap = new Map();
  settled.forEach((entry, index) => {
    if (entry.status !== 'fulfilled' || !entry.value) return;
    const seed = seeds[index];
    const seedWeight = 0.5 + Math.min(1.5, seed.weight / 2.5);
    for (const item of entry.value.items || []) {
      const id = String(item.video_id);
      if (!id || seen.has(id)) continue;
      const contribution = Math.max(0, Number(item.score) || 0) * 10 * seedWeight;
      const existing = candidateMap.get(id);
      if (existing) {
        existing.score += contribution + 4; // recommended by several seeds
        existing.sources.push(seed);
      } else {
        candidateMap.set(id, { id, score: contribution + 20, sources: [seed] });
      }
    }
  });

  if (candidateMap.size === 0) return null;

  // Degenerate embeddings (e.g. trained from a single user's rank-1 matrix) score every
  // candidate identically. Ranking then carries no information, so do not pretend it does.
  const distinctScores = new Set([...candidateMap.values()].map((entry) => Math.round(entry.score * 1000)));
  if (distinctScores.size < 2) return null;

  const ranked = [...candidateMap.values()].sort((a, b) => b.score - a.score).slice(0, 60);
  const hydrated = await Promise.all(ranked.map(async (entry) => {
    try {
      return { entry, anime: await getAnimeDetails(entry.id) };
    } catch {
      return { entry, anime: null };
    }
  }));

  const results = [];
  for (const { entry, anime } of hydrated) {
    if (!anime) continue;
    const seed = entry.sources[0];
    const crossSource = entry.sources.length > 1;
    results.push({
      ...anime,
      recommendationReason: crossSource
        ? `Matches several of your favourites (LightFM)`
        : `Similar to ${seed?.title || 'your favourites'} (LightFM)`,
      matchPercent: Math.min(99, Math.max(85, Math.round(84 + Math.min(15, entry.score / 6)))),
      _finalScore: entry.score,
      recommendationSource: 'lightfm-annoy'
    });
  }
  return results.length > 0 ? results : null;
}

/**
 * Computes deep personalized anime recommendations by synthesizing explicit favorites
 * and implicit watch history (with recency decay & episode engagement) like modern video platforms.
 */
async function computeContentBasedRecommendations({ 
  favoriteIds = [], 
  favorites = [], 
  watchHistory = [], 
  limit = 60 
}) {
  const seenIds = new Set();
  const candidateMap = new Map(); // id -> candidate data
  const genreAffinity = {}; // genre -> cumulative weighted score
  const now = Date.now();

  // 1. Ingest Favorites (Explicit positive signals: base weight 3.5)
  for (const id of favoriteIds) {
    if (id) seenIds.add(Number(id));
  }
  for (const fav of favorites) {
    if (!fav?.id) continue;
    seenIds.add(Number(fav.id));
    for (const g of (fav.genres || [])) {
      genreAffinity[g] = (genreAffinity[g] || 0) + 3.5;
    }
  }

  // 2. Ingest Watch History (Implicit engagement with recency decay & episode boost)
  // Recent items and higher episode progress indicate strong user affinity
  const normalizedHistory = [];
  for (const item of watchHistory) {
    const anime = item.anime || item;
    if (!anime?.id) continue;
    seenIds.add(Number(anime.id));

    const timestamp = item.timestamp ? new Date(item.timestamp).getTime() : now;
    const ageDays = Math.max(0, (now - timestamp) / (1000 * 60 * 60 * 24));
    
    // Recency decay factor
    let recencyFactor = 0.5;
    if (ageDays <= 1) recencyFactor = 1.25;      // Hot in the last 24h
    else if (ageDays <= 7) recencyFactor = 1.0;  // Past week
    else if (ageDays <= 30) recencyFactor = 0.75;// Past month

    // Episode progress boost (more episodes watched = deeper commitment)
    const episodeNum = item.episode || 1;
    const episodeBoost = Math.min(1.0, (episodeNum - 1) * 0.1);

    const watchWeight = (2.5 * recencyFactor) + episodeBoost;

    for (const g of (anime.genres || [])) {
      genreAffinity[g] = (genreAffinity[g] || 0) + watchWeight;
    }

    normalizedHistory.push({
      anime,
      episode: episodeNum,
      timestamp,
      weight: watchWeight
    });
  }

  // Sort history by weight descending to find top watched seeds
  normalizedHistory.sort((a, b) => b.weight - a.weight);

  // 3. Dual-Path Graph Retrieval:
  // Path A: Top watched anime seeds (up to 5)
  const topWatchedSeeds = normalizedHistory.slice(0, 5);
  // Path B: Top favorites seeds (up to 5)
  const topFavSeeds = favorites.slice(0, 5);

  const fetchSeedRecs = async (seeds, type) => {
    const tasks = seeds.map(async (seed) => {
      const anime = seed.anime || seed;
      try {
        const recs = await getRecommendationsForAnime(anime.id, 15);
        return { seedAnime: anime, episode: seed.episode, type, recs };
      } catch (err) {
        return { seedAnime: anime, type, recs: [] };
      }
    });
    return Promise.all(tasks);
  };

  const [watchedRecGroups, favRecGroups] = await Promise.all([
    fetchSeedRecs(topWatchedSeeds, 'watched'),
    fetchSeedRecs(topFavSeeds, 'favorite')
  ]);

  // Helper to get readable title
  const getTitle = (a) => a?.title?.english || a?.title?.romaji || 'Anime';

  // Ingest Graph Candidates
  const processRecGroup = (group) => {
    const { seedAnime, episode, type, recs } = group;
    const seedTitle = getTitle(seedAnime);

    for (const cand of recs) {
      if (!cand || !cand.id || seenIds.has(Number(cand.id))) continue;
      const cid = Number(cand.id);

      if (!candidateMap.has(cid)) {
        candidateMap.set(cid, {
          anime: cand,
          graphScore: (cand.averageScore || 75) + 30,
          frequency: 1,
          sources: [{ type, title: seedTitle, episode }]
        });
      } else {
        const entry = candidateMap.get(cid);
        entry.graphScore += 25; // boost candidate recommended by multiple sources
        entry.frequency += 1;
        entry.sources.push({ type, title: seedTitle, episode });
      }
    }
  };

  watchedRecGroups.forEach(processRecGroup);
  favRecGroups.forEach(processRecGroup);

  // 4. Secondary Retrieval: Genre Affinity Expansion if candidates < limit * 2
  const sortedAffinityGenres = Object.entries(genreAffinity)
    .sort((a, b) => b[1] - a[1])
    .map(e => e[0]);

  if (candidateMap.size < limit * 2 && sortedAffinityGenres.length > 0) {
    const topGenre = sortedAffinityGenres[0];
    try {
      const genreCandidates = await getByGenre(topGenre, 1, 30);
      for (const cand of (genreCandidates || [])) {
        if (!cand || !cand.id || seenIds.has(Number(cand.id))) continue;
        const cid = Number(cand.id);
        if (!candidateMap.has(cid)) {
          candidateMap.set(cid, {
            anime: cand,
            graphScore: (cand.averageScore || 70) + 12,
            frequency: 1,
            sources: [{ type: 'genre', genre: topGenre }]
          });
        }
      }
    } catch (e) {
      console.warn('Failed to fetch genre candidates:', e.message);
    }
  }

  // 5. Cold Start Fallback (no favorites or history)
  if (candidateMap.size === 0) {
    try {
      const [trend, pop] = await Promise.all([getTrending(1, 30), getPopular(1, 30)]);
      for (const cand of [...(trend || []), ...(pop || [])]) {
        if (!cand || !cand.id || seenIds.has(Number(cand.id))) continue;
        const cid = Number(cand.id);
        if (!candidateMap.has(cid)) {
          candidateMap.set(cid, {
            anime: cand,
            graphScore: (cand.averageScore || 75),
            frequency: 1,
            sources: [{ type: 'trending' }]
          });
        }
      }
    } catch (e) {
      console.warn('Failed to fetch fallback candidates:', e.message);
    }
  }

  // 6. Multi-Factor Scoring, Cross-Affinity Bonus, and Explainability Generation
  const totalGenreWeight = Object.values(genreAffinity).reduce((sum, v) => sum + v, 0) || 1;

  const candidateList = Array.from(candidateMap.values()).map(entry => {
    const anime = entry.anime;
    let finalScore = entry.graphScore;

    // A. Cross-Source Bonus (Recommended by both a watched anime AND a favorite anime)
    const hasWatchedSource = entry.sources.some(s => s.type === 'watched');
    const hasFavSource = entry.sources.some(s => s.type === 'favorite');
    const isCrossAffinity = hasWatchedSource && hasFavSource;

    if (isCrossAffinity) {
      finalScore += 45; // Massive video-platform recommendation boost
    }

    // B. Genre Affinity Match Score
    let matchingGenreCount = 0;
    let genreScore = 0;
    const animeGenres = anime.genres || [];
    for (const g of animeGenres) {
      if (genreAffinity[g]) {
        matchingGenreCount++;
        genreScore += (genreAffinity[g] / totalGenreWeight) * 40;
      }
    }
    finalScore += genreScore;

    // C. Generate Human-Readable Reason Badge
    let reason = '';
    if (isCrossAffinity) {
      const favSrc = entry.sources.find(s => s.type === 'favorite');
      const watchSrc = entry.sources.find(s => s.type === 'watched');
      reason = `Matches both ${watchSrc?.title} & ${favSrc?.title}`;
    } else if (hasWatchedSource) {
      const watchSrc = entry.sources.find(s => s.type === 'watched');
      reason = watchSrc.episode > 1 
        ? `Because you watched ${watchSrc.title} (Ep ${watchSrc.episode})`
        : `Because you watched ${watchSrc.title}`;
    } else if (hasFavSource) {
      const favSrc = entry.sources.find(s => s.type === 'favorite');
      reason = `Because of your favorite ${favSrc.title}`;
    } else if (entry.sources.some(s => s.type === 'genre')) {
      const genreSrc = entry.sources.find(s => s.type === 'genre');
      reason = `Top pick for fans of ${genreSrc.genre}`;
    } else if (sortedAffinityGenres.length > 0 && animeGenres.length > 0) {
      const matched = animeGenres.filter(g => sortedAffinityGenres.includes(g)).slice(0, 2);
      reason = matched.length > 0 ? `Matches your ${matched.join(' & ')} taste` : 'Popular on AniFlix';
    } else {
      reason = 'Trending Recommendation';
    }

    // D. Compute Match Percentage (e.g. 88% - 99%)
    const rawMatch = 84 + Math.min(15, Math.round(finalScore / 18));
    const matchPercent = Math.min(99, Math.max(85, rawMatch));

    return {
      ...anime,
      recommendationReason: reason,
      matchPercent,
      _finalScore: finalScore
    };
  });

  // 7. Sort by final score descending and slice to limit
  candidateList.sort((a, b) => b._finalScore - a._finalScore);
  const ranked = candidateList.slice(0, limit);

  return ranked;
}

/**
 * Public entry point. Tries the learned LightFM + Annoy ranking first and transparently
 * falls back to the content-based scorer, so the API contract never changes.
 */
export async function computeRecommendations({ favoriteIds = [], favorites = [], watchHistory = [], limit = 60 } = {}) {
  const seeds = collectSeeds({ favoriteIds, favorites, watchHistory });
  const seen = new Set();
  for (const id of favoriteIds) if (id !== undefined && id !== null) seen.add(String(id));
  for (const favorite of favorites) if (favorite?.id) seen.add(String(favorite.id));
  for (const item of watchHistory) {
    const anime = item?.anime || item;
    if (anime?.id !== undefined && anime?.id !== null) seen.add(String(anime.id));
  }

  if (seeds.length > 0) {
    try {
      const learned = await rankWithLightfm(seeds, seen);
      if (learned && learned.length >= Math.min(REC_CANDIDATE_FLOOR, limit)) {
        return learned.slice(0, limit);
      }
    } catch (err) {
      console.warn('[Recommendation] LightFM path failed; using content-based ranking:', err.message);
    }
  }

  return computeContentBasedRecommendations({ favoriteIds, favorites, watchHistory, limit });
}

/** Exposed for diagnostics / the settings UI. */
export async function getRecommendationEngineStatus() {
  if (!REC_SERVICE_URL) {
    return { mode: 'content-based', serviceUrl: null, reason: 'REC_SERVICE_URL is not set' };
  }
  const health = await probeRecService();
  return {
    mode: health?.ready ? 'lightfm-annoy' : 'content-based',
    serviceUrl: REC_SERVICE_URL,
    healthy: !!health?.ready,
    backend: health?.backend || null,
    items: health?.items ?? null,
    dataQuality: health?.data_quality ?? null,
    requireGoodData: REC_ONLY_GOOD_DATA
  };
}
