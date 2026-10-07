// server/services/recommendation.js - Advanced Video Platform Recommendation Engine
import { getRecommendationsForAnime, getTrending, getPopular, getByGenre } from './metadata.js';

/**
 * Computes deep personalized anime recommendations by synthesizing explicit favorites
 * and implicit watch history (with recency decay & episode engagement) like modern video platforms.
 */
export async function computeRecommendations({ 
  favoriteIds = [], 
  favorites = [], 
  watchHistory = [], 
  limit = 20 
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
  // Path A: Top watched anime seeds (up to 3)
  const topWatchedSeeds = normalizedHistory.slice(0, 3);
  // Path B: Top favorites seeds (up to 3)
  const topFavSeeds = favorites.slice(0, 3);

  const fetchSeedRecs = async (seeds, type) => {
    const tasks = seeds.map(async (seed) => {
      const anime = seed.anime || seed;
      try {
        const recs = await getRecommendationsForAnime(anime.id, 8);
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
      const genreCandidates = await getByGenre(topGenre, 1, 15);
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
      const [trend, pop] = await Promise.all([getTrending(1, 12), getPopular(1, 12)]);
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
