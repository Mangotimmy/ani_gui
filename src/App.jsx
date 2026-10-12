// src/App.jsx - AniFlix Desktop Netflix Application
import React, { useState, useEffect, useMemo, useCallback, useRef, startTransition, Suspense } from 'react';
import Navbar from './components/Navbar';
import HeroBanner from './components/HeroBanner';
import AnimeCarousel from './components/AnimeCarousel';
import DownloadManager from './components/DownloadManager';
import SettingsModal from './components/SettingsModal';
import SetupWizardModal from './components/SetupWizardModal';
import DownloadedFilesModal from './components/DownloadedFilesModal';
import UserProfileModal from './components/UserProfileModal';
import AnimeCard from './components/AnimeCard';
import MarqueeTicker from './components/animata/MarqueeTicker';
import { getPlatformInfo } from './utils/platform';

// Code-split heavy modals to eliminate main-thread evaluation on boot and minimize INP latency
const DetailModal = React.lazy(() => import('./components/DetailModal'));
const BatchDownloadModal = React.lazy(() => import('./components/BatchDownloadModal'));
const VideoPlayer = React.lazy(() => import('./components/VideoPlayer'));
import { 
  Flame, Star, Trophy, Swords, Sparkles, Loader2, 
  Search, Heart, Calendar, History, Trash2, Clock, Play,
  Compass, Filter, Layers, ChevronDown, Building2
} from 'lucide-react';
import { getSavedLanguage, saveLanguage, createTranslator } from './utils/i18n';
import { 
  sendAnimeNotification, 
  requestNotificationPermission, 
  checkFavoritesForNewAiring 
} from './utils/notifications';
import { getAnimeCoverUrl } from './utils/image';

// Dynamically compute future years so catalog, UI and scraper seamlessly scale to 2027, 2028 and beyond
const CURRENT_YEAR = new Date().getFullYear();
const MAX_FUTURE_YEAR = CURRENT_YEAR + 3; // e.g. 2026 -> 2029
const ALL_YEARS = Array.from({ length: MAX_FUTURE_YEAR - 1970 + 1 }, (_, i) => MAX_FUTURE_YEAR - i);
const QUICK_YEARS = Array.from({ length: Math.min(18, MAX_FUTURE_YEAR - 2010 + 1) }, (_, i) => MAX_FUTURE_YEAR - i);
const DECADES = [
  ...(MAX_FUTURE_YEAR >= 2030 ? [{ label: '2030s', year: 2030 }] : []),
  { label: '2020s', year: Math.min(2025, CURRENT_YEAR) },
  { label: '2010s', year: 2015 },
  { label: '2000s', year: 2005 },
  { label: '1990s', year: 1995 },
  { label: '1980s', year: 1985 },
  { label: '1970s', year: 1975 }
];

export default function App() {
  // Navigation & Search State
  const [activeTab, setActiveTab] = useState('home');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  // Localization State
  const [currentLang, setCurrentLang] = useState(getSavedLanguage);
  const t = useMemo(() => createTranslator(currentLang), [currentLang]);

  const handleSelectLang = (langCode) => {
    saveLanguage(langCode);
    setCurrentLang(langCode);
  };

const HOME_CACHE_KEY = 'aniflix_home_cache_v2';

function getHomeCache(key) {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HOME_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed[key]) ? parsed[key] : [];
  } catch {
    return [];
  }
}

function hasHomeCache() {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem(HOME_CACHE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.trending) && parsed.trending.length > 0;
  } catch {
    return false;
  }
}

  // Content Data with Instant Local Cache Hydration (0ms F5 reload)
  const [trending, setTrending] = useState(() => getHomeCache('trending'));
  const [popular, setPopular] = useState(() => getHomeCache('popular'));
  const [topRated, setTopRated] = useState(() => getHomeCache('topRated'));
  const [upcoming, setUpcoming] = useState(() => getHomeCache('upcoming'));
  const [actionAnimes, setActionAnimes] = useState(() => getHomeCache('actionAnimes'));
  const [fantasyAnimes, setFantasyAnimes] = useState(() => getHomeCache('fantasyAnimes'));
  const [recommendations, setRecommendations] = useState([]);
  const [isLoading, setIsLoading] = useState(() => !hasHomeCache());

  // Infinite Horizontal Carousel Pagination State
  const [carouselPages, setCarouselPages] = useState({
    thisSeason: 1,
    trending: 1,
    topRated: 1,
    popular: 1,
    upcoming: 1,
    action: 1,
    fantasy: 1,
    recommendations: 1,
  });
  const [carouselLoadingMore, setCarouselLoadingMore] = useState({});
  const [carouselHasMore, setCarouselHasMore] = useState({
    thisSeason: true,
    trending: true,
    topRated: true,
    popular: true,
    upcoming: true,
    action: true,
    fantasy: true,
    recommendations: true,
  });

  const handleLoadMoreCarousel = async (category) => {
    if (carouselLoadingMore[category] || carouselHasMore[category] === false) return;
    setCarouselLoadingMore(prev => ({ ...prev, [category]: true }));
    const nextPage = (carouselPages[category] || 1) + 1;

    try {
      let url = '';
      if (category === 'trending') url = `/api/trending?page=${nextPage}&perPage=50`;
      else if (category === 'topRated') url = `/api/top-rated?page=${nextPage}&perPage=50`;
      else if (category === 'popular') url = `/api/popular?page=${nextPage}&perPage=50`;
      else if (category === 'upcoming') url = `/api/upcoming?page=${nextPage}&perPage=50`;
      else if (category === 'action') url = `/api/genre/Action?page=${nextPage}&perPage=50`;
      else if (category === 'fantasy') url = `/api/genre/Fantasy?page=${nextPage}&perPage=50`;
      else if (category === 'thisSeason') url = `/api/catalog?year=${currentSeasonInfo.year}&season=${currentSeasonInfo.season}&page=${nextPage}&perPage=50`;
      else if (category === 'recommendations') url = `/api/trending?page=${nextPage}&perPage=50`;

      if (url) {
        const res = await fetch(url).then(r => r.json());
        const items = res.data || res.media || [];
        if (items && items.length > 0) {
          if (category === 'trending') setTrending(prev => [...prev, ...items]);
          else if (category === 'topRated') setTopRated(prev => [...prev, ...items]);
          else if (category === 'popular') setPopular(prev => [...prev, ...items]);
          else if (category === 'upcoming') setUpcoming(prev => [...prev, ...items]);
          else if (category === 'action') setActionAnimes(prev => [...prev, ...items]);
          else if (category === 'fantasy') setFantasyAnimes(prev => [...prev, ...items]);
          else if (category === 'thisSeason') setThisSeasonAnimes(prev => [...prev, ...items]);
          else if (category === 'recommendations') setRecommendations(prev => [...prev, ...items]);

          setCarouselPages(prev => ({ ...prev, [category]: nextPage }));
        } else {
          setCarouselHasMore(prev => ({ ...prev, [category]: false }));
        }
      }
    } catch (err) {
      console.warn(`Failed to load more for ${category}:`, err);
    } finally {
      setCarouselLoadingMore(prev => ({ ...prev, [category]: false }));
    }
  };

  // Catalog & Seasonal Content State
  const [currentSeasonInfo, setCurrentSeasonInfo] = useState({ year: CURRENT_YEAR, season: 'FALL', label: `Fall ${CURRENT_YEAR}` });
  const [thisSeasonAnimes, setThisSeasonAnimes] = useState(() => getHomeCache('thisSeasonAnimes'));
  const [catalogYear, setCatalogYear] = useState(CURRENT_YEAR);
  const [catalogSeason, setCatalogSeason] = useState('ALL');
  const [catalogStudio, setCatalogStudio] = useState('ALL');
  const [catalogSort, setCatalogSort] = useState('POPULARITY_DESC');
  const [catalogAnimes, setCatalogAnimes] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogPage, setCatalogPage] = useState(1);
  const [hasMoreCatalog, setHasMoreCatalog] = useState(false);

  // Content Safety & R-18 Filter State (Defaults to TRUE - Hiding R-18 adult content)
  const [hideR18, setHideR18] = useState(() => {
    try {
      const stored = localStorage.getItem('aniflix_hide_r18');
      return stored !== null ? stored === 'true' : true;
    } catch {
      return true;
    }
  });

  const handleToggleHideR18 = (val) => {
    const nextVal = typeof val === 'boolean' ? val : !hideR18;
    setHideR18(nextVal);
    try {
      localStorage.setItem('aniflix_hide_r18', String(nextVal));
    } catch {}
  };

  const filterAnimeList = useCallback((list) => {
    if (!Array.isArray(list)) return [];
    if (!hideR18) return list;
    return list.filter(a => !a.isAdult && !(a.genres && a.genres.includes('Hentai')));
  }, [hideR18]);

  // Memoized carousel pipelines - Prevents 9x array re-allocations and stops UI draw thrashing
  const filteredTrending = useMemo(() => filterAnimeList(trending), [trending, filterAnimeList]);
  const filteredPopular = useMemo(() => filterAnimeList(popular), [popular, filterAnimeList]);
  const filteredTopRated = useMemo(() => filterAnimeList(topRated), [topRated, filterAnimeList]);
  const filteredAction = useMemo(() => filterAnimeList(actionAnimes), [actionAnimes, filterAnimeList]);
  const filteredFantasy = useMemo(() => filterAnimeList(fantasyAnimes), [fantasyAnimes, filterAnimeList]);
  const filteredUpcoming = useMemo(() => filterAnimeList(upcoming), [upcoming, filterAnimeList]);
  const filteredThisSeason = useMemo(() => filterAnimeList(thisSeasonAnimes), [thisSeasonAnimes, filterAnimeList]);
  const filteredRecommendations = useMemo(() => filterAnimeList(recommendations), [recommendations, filterAnimeList]);

  // User Preferences & Persistence (Favorites & Watch History)
  const [favorites, setFavorites] = useState(() => {
    try {
      const stored = localStorage.getItem('aniflix_favorites');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [watchHistory, setWatchHistory] = useState(() => {
    try {
      const stored = localStorage.getItem('aniflix_watch_history');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const favoriteIds = useMemo(() => new Set(favorites.map(f => f.id)), [favorites]);
  const filteredFavorites = useMemo(() => filterAnimeList(favorites), [favorites, filterAnimeList]);
  const filteredWatchHistoryAnimes = useMemo(
    () => filterAnimeList(watchHistory.map(w => w.anime).filter(Boolean)), 
    [watchHistory, filterAnimeList]
  );

  // User Profile & Cross-Device Account State
  const [isUserProfileOpen, setIsUserProfileOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const stored = localStorage.getItem('aniflix_current_user');
      return stored ? JSON.parse(stored) : { username: 'Default', displayName: 'Default', avatar: 'cat' };
    } catch {
      return { username: 'Default', displayName: 'Default', avatar: 'cat' };
    }
  });

  // Switch or Login User Handler
  const handleSwitchUser = useCallback((userObj) => {
    if (!userObj || !userObj.username) return;
    setCurrentUser(userObj);
    try {
      localStorage.setItem('aniflix_current_user', JSON.stringify(userObj));
    } catch {}

    if (userObj.data) {
      if (Array.isArray(userObj.data.favorites)) {
        setFavorites(userObj.data.favorites);
        try {
          localStorage.setItem('aniflix_favorites', JSON.stringify(userObj.data.favorites));
        } catch {}
      }
      if (Array.isArray(userObj.data.watchHistory)) {
        setWatchHistory(userObj.data.watchHistory);
        try {
          localStorage.setItem('aniflix_watch_history', JSON.stringify(userObj.data.watchHistory));
        } catch {}
      }
    }
  }, []);

  // Sync user data to server with 1s debounce whenever favorites or watchHistory changes
  const isInitialUserSyncRef = useRef(true);
  useEffect(() => {
    if (isInitialUserSyncRef.current) {
      isInitialUserSyncRef.current = false;
      return;
    }
    if (!currentUser || !currentUser.username) return;

    const timer = setTimeout(() => {
      fetch('/api/users/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: currentUser.username,
          favorites,
          watchHistory
        })
      }).catch((err) => {
        console.warn('Background user profile sync warning:', err);
      });
    }, 1200);

    return () => clearTimeout(timer);
  }, [favorites, watchHistory, currentUser]);

  // Modals & Overlays
  const [selectedAnime, setSelectedAnime] = useState(null);
  const [activePlayer, setActivePlayer] = useState(null); // { anime, episode, audioMode }
  const [batchDownloadData, setBatchDownloadData] = useState(null); // { anime, audioMode, initialRange }
  const [isDownloadsOpen, setIsDownloadsOpen] = useState(false);
  const isDownloadsOpenRef = useRef(false);
  useEffect(() => {
    isDownloadsOpenRef.current = isDownloadsOpen;
  }, [isDownloadsOpen]);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState('content');
  const [isSetupWizardOpen, setIsSetupWizardOpen] = useState(false);
  const [isDownloadedFilesOpen, setIsDownloadedFilesOpen] = useState(false);
  const [serverInfo, setServerInfo] = useState({ isContainer: false, platform: 'win32' });

  const handleOpenSettings = (tab = 'content') => {
    setSettingsInitialTab(tab);
    setIsSettingsOpen(true);
  };

  useEffect(() => {
    fetch('/api/system/info')
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setServerInfo({
            isContainer: Boolean(data.isContainer),
            platform: data.platform || 'win32'
          });
        }
      })
      .catch(() => {});
  }, []);

  // Downloader Real-Time State (SSE)
  const [downloadTasks, setDownloadTasks] = useState([]);
  const [downloadDir, setDownloadDir] = useState('');
  const [gpuSettings, setGpuSettings] = useState(() => {
    try {
      const stored = localStorage.getItem('aniflix_gpu_settings');
      if (stored) return JSON.parse(stored);
    } catch {}
    return {
      gpuProfile: 'igpu',
      enableUpscale: false,
      enableBackdropBlur: false,
      mpvProfile: 'igpu'
    };
  });

  // 1. Initial Content Data Fetching (Parallelized SWR Background Revalidation)
  useEffect(() => {
    async function loadInitialData() {
      // Only show full-screen blocking spinner if we have no cached data at all
      if (!hasHomeCache()) {
        setIsLoading(true);
      }

      try {
        const now = new Date();
        const currentYear = now.getFullYear();
        const m = now.getMonth() + 1;
        const currentSeason = (m >= 1 && m <= 3) ? 'WINTER' : (m >= 4 && m <= 6) ? 'SPRING' : (m >= 7 && m <= 9) ? 'SUMMER' : 'FALL';

        // Fetch all 7 categories + this season catalog simultaneously in parallel (NO waterfall delay!)
        const [trendRes, popRes, topRes, actRes, fanRes, upRes, seasonRes, thisSeasonData] = await Promise.all([
          fetch('/api/trending?perPage=50').then(r => r.json()).catch(() => ({ success: false })),
          fetch('/api/popular?perPage=50').then(r => r.json()).catch(() => ({ success: false })),
          fetch('/api/top-rated?perPage=50').then(r => r.json()).catch(() => ({ success: false })),
          fetch('/api/genre/Action?perPage=50').then(r => r.json()).catch(() => ({ success: false })),
          fetch('/api/genre/Fantasy?perPage=50').then(r => r.json()).catch(() => ({ success: false })),
          fetch('/api/upcoming?perPage=50').then(r => r.json()).catch(() => ({ success: false })),
          fetch('/api/catalog/current-season').then(r => r.json()).catch(() => ({ success: false })),
          fetch(`/api/catalog?year=${currentYear}&season=${currentSeason}&perPage=50`).then(r => r.json()).catch(() => ({ success: false }))
        ]);

        const newCache = {};
        if (trendRes.success && trendRes.data) { setTrending(trendRes.data); newCache.trending = trendRes.data; }
        if (popRes.success && popRes.data) { setPopular(popRes.data); newCache.popular = popRes.data; }
        if (topRes.success && topRes.data) { setTopRated(topRes.data); newCache.topRated = topRes.data; }
        if (actRes.success && actRes.data) { setActionAnimes(actRes.data); newCache.actionAnimes = actRes.data; }
        if (fanRes.success && fanRes.data) { setFantasyAnimes(fanRes.data); newCache.fantasyAnimes = fanRes.data; }
        if (upRes.success && upRes.data) { setUpcoming(upRes.data); newCache.upcoming = upRes.data; }
        if (thisSeasonData.success && Array.isArray(thisSeasonData.media)) {
          setThisSeasonAnimes(thisSeasonData.media);
          newCache.thisSeasonAnimes = thisSeasonData.media;
        }

        if (seasonRes && seasonRes.success) {
          setCurrentSeasonInfo({ year: seasonRes.year, season: seasonRes.season, label: seasonRes.label });
          setCatalogYear(seasonRes.year);
        }

        try {
          if (Object.keys(newCache).length > 0) {
            localStorage.setItem(HOME_CACHE_KEY, JSON.stringify(newCache));
          }
        } catch {}
      } catch (err) {
        console.error('Failed to load anime categories:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadInitialData();

    // Check environment readiness (suppressed in Docker containers)
    fetch('/api/environment/status')
      .then(r => r.json())
      .then(d => {
        if (d.success && !d.ready && !d.isContainer) {
          setIsSetupWizardOpen(true);
        }
      })
      .catch(() => {});

    // Load persistent settings (Downloads & GPU profile)
    fetch('/api/settings')
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          if (d.downloadDir) setDownloadDir(d.downloadDir);
          setGpuSettings(prev => {
            const merged = {
              ...prev,
              ...(d.gpuProfile !== undefined ? { gpuProfile: d.gpuProfile } : {}),
              ...(d.enableUpscale !== undefined ? { enableUpscale: d.enableUpscale } : {}),
              ...(d.enableBackdropBlur !== undefined ? { enableBackdropBlur: d.enableBackdropBlur } : {}),
              ...(d.mpvProfile !== undefined ? { mpvProfile: d.mpvProfile } : {})
            };
            try {
              localStorage.setItem('aniflix_gpu_settings', JSON.stringify(merged));
            } catch {}
            return merged;
          });
        }
      })
      .catch(() => {});
  }, []);

  // 2. Fetch Personalized Recommendations
  useEffect(() => {
    async function loadRecs() {
      try {
        const res = await fetch('/api/recommendations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            favoriteIds: favorites.map(f => f.id),
            favorites,
            watchHistory,
            limit: 60
          })
        });
        const d = await res.json();
        if (d.success && Array.isArray(d.data)) {
          setRecommendations(d.data);
        }
      } catch (err) {
        console.warn('Failed to fetch recommendations:', err);
      }
    }

    loadRecs();
  }, [favorites, watchHistory]);

  // 3. Catalog Fetching Handler
  const loadCatalogData = async (year, season, sort, page = 1, append = false, studio = catalogStudio) => {
    setCatalogLoading(true);
    try {
      const sParam = season && season !== 'ALL' ? `&season=${season}` : '';
      const adultParam = `&isAdult=${!hideR18}`;
      const studioParam = studio && studio !== 'ALL' ? `&studio=${encodeURIComponent(studio)}` : '';
      const url = `/api/catalog?year=${year}${sParam}&sort=${sort}&page=${page}&perPage=50${adultParam}${studioParam}`;
      const res = await fetch(url).then(r => r.json());
      if (res.success && Array.isArray(res.media)) {
        if (append) {
          setCatalogAnimes(prev => [...prev, ...res.media]);
        } else {
          setCatalogAnimes(res.media);
        }
        setHasMoreCatalog(!!res.pageInfo?.hasNextPage);
        setCatalogPage(page);
      }
    } catch (err) {
      console.error('Failed to load catalog anime:', err);
    } finally {
      setCatalogLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'catalog') {
      loadCatalogData(catalogYear, catalogSeason, catalogSort, 1, false, catalogStudio);
    }
  }, [activeTab, catalogYear, catalogSeason, catalogSort, catalogStudio, hideR18]);

  // 3. Real-Time Server-Sent Events (SSE) for Downloads
  useEffect(() => {
    const eventSource = new EventSource('/api/downloads/events');

    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'SNAPSHOT') {
          setDownloadTasks(data.tasks);
        } else if (data.type === 'TASKS_ADDED') {
          setDownloadTasks(prev => [...data.tasks, ...prev]);
        } else if (data.type === 'TASK_UPDATED') {
          // If the drawer is open, update so user sees live progress/speed
          // If closed, only update if task status changed (to update active count badge)
          if (isDownloadsOpenRef.current) {
            setDownloadTasks(prev => 
              prev.map(t => t.id === data.task.id ? data.task : t)
            );
          } else {
            setDownloadTasks(prev => {
              const existing = prev.find(t => t.id === data.task.id);
              if (existing && existing.status !== data.task.status) {
                return prev.map(t => t.id === data.task.id ? data.task : t);
              }
              return prev; // Same reference -> React skips re-render!
            });
          }
        }
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.warn('SSE connection notice (auto-reconnecting):', err?.type || err);
    };

    // Load initial settings
    fetch('/api/settings')
      .then(r => r.json())
      .then(d => { if (d.downloadDir) setDownloadDir(d.downloadDir); })
      .catch(() => {});

    return () => {
      eventSource.close();
    };
  }, []);

  // 4. Debounced Search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const delayDebounceFn = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
        const data = await res.json();
        if (data.success) {
          setSearchResults(data.data);
        }
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        setIsSearching(false);
      }
    }, 350);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery]);

  // Featured Anime for Netflix Hero Banner
  const featuredAnime = useMemo(() => {
    const list = filterAnimeList(trending.length > 0 ? trending : popular);
    return list[0] || null;
  }, [trending, popular, hideR18]);

  // Favorite toggle handler with real-time notification trigger
  const handleToggleFavorite = (anime) => {
    if (!anime || !anime.id) return;
    setFavorites(prev => {
      const exists = prev.some(f => f.id === anime.id);
      let updated;
      if (exists) {
        updated = prev.filter(f => f.id !== anime.id);
      } else {
        updated = [anime, ...prev];
        const title = anime.title?.chinese || anime.title?.romaji || anime.title?.english || '動漫';
        sendAnimeNotification({
          title: `💖 已加入追蹤關注`,
          body: `當《${title}》開播或有新集數發布時，將第一時間向您通知！`,
          icon: getAnimeCoverUrl(anime) || '/build/icon.png',
          animeId: anime.id
        });
        requestNotificationPermission().catch(() => {});
      }
      try {
        localStorage.setItem('aniflix_favorites', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  // Listen for open anime event triggered by notification click
  useEffect(() => {
    const handleOpenAnimeFromNotif = async (e) => {
      const animeId = e.detail?.animeId;
      if (!animeId) return;
      try {
        const res = await fetch(`/api/anime/${animeId}`);
        const data = await res.json();
        if (data.success && data.data) {
          setSelectedAnime(data.data);
        }
      } catch (err) {
        console.warn('Failed to load anime from notification:', err);
      }
    };
    window.addEventListener('aniflix:open_anime', handleOpenAnimeFromNotif);
    return () => window.removeEventListener('aniflix:open_anime', handleOpenAnimeFromNotif);
  }, []);

  // Periodic Favorite Airing Status Checker
  useEffect(() => {
    if (favorites.length > 0) {
      checkFavoritesForNewAiring(favorites);
      const interval = setInterval(() => checkFavoritesForNewAiring(favorites), 15 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [favorites]);

  // Handlers for Player & Downloads
  const handlePlay = (anime, episode = 1, audioMode = 'sub') => {
    startTransition(() => {
      setActivePlayer({ anime, episode, audioMode });
    });
    // Append to watch history deferred out of pointer interaction frame to eliminate INP latency
    setTimeout(() => {
      setWatchHistory(prev => {
        const filtered = prev.filter(item => item.anime?.id !== anime.id);
        const updated = [{ anime, episode, timestamp: Date.now() }, ...filtered].slice(0, 30);
        try {
          localStorage.setItem('aniflix_watch_history', JSON.stringify(updated));
        } catch {}
        return updated;
      });
    }, 0);
  };

  const handleMoreInfo = (anime) => {
    startTransition(() => {
      setSelectedAnime(anime);
    });
  };

  const handleClearWatchHistory = () => {
    setWatchHistory([]);
    try {
      localStorage.removeItem('aniflix_watch_history');
    } catch {}
  };

  const handleRemoveWatchHistory = (animeId) => {
    setWatchHistory(prev => {
      const updated = prev.filter(item => item.anime?.id !== animeId);
      try {
        localStorage.setItem('aniflix_watch_history', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const formatTimeAgo = (timestamp) => {
    if (!timestamp) return '';
    const diffMs = Date.now() - timestamp;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Yesterday';
    return `${diffDays}d ago`;
  };

  const handlePlayMpv = async (anime, episode = 1, audioMode = 'sub', directStreamUrl = null) => {
    const title = anime.title?.english || anime.title?.romaji || 'Anime';
    try {
      let streamUrl = directStreamUrl;
      let referer = 'https://zokoanime.video/';
      if (!streamUrl) {
        const candidates = [
          anime.title?.romaji, 
          anime.title?.english, 
          anime.title?.native, 
          anime.titleZhTW,
          anime.titleZhCN,
          anime.titleZh
        ].filter(Boolean);
        const maxAiredCap = (anime.nextAiringEpisode?.episode && anime.nextAiringEpisode.episode > 1) 
          ? anime.nextAiringEpisode.episode - 1 
          : undefined;

        const res = await fetch('/api/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            animeTitle: title, 
            episode, 
            mode: audioMode, 
            candidates, 
            maxAiredCap 
          })
        });
        const d = await res.json();
        streamUrl = d.data?.streamUrl;
        if (d.data?.referer) referer = d.data.referer;
      }

      await fetch('/api/play/mpv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          streamUrl,
          title: `${title} - Ep ${episode}`,
          referer,
          profile: gpuSettings.mpvProfile,
          enableUpscale: gpuSettings.enableUpscale
        })
      });
    } catch (err) {
      console.error('MPV launch error:', err);
    }
  };

  const handleOpenBatchDownload = (anime, audioMode = 'sub', initialRange = '') => {
    startTransition(() => {
      setBatchDownloadData({ anime, audioMode, initialRange });
      setSelectedAnime(null);
    });
  };

  const handleStartDownload = async (payload) => {
    try {
      await fetch('/api/downloads/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      setBatchDownloadData(null);
      setIsDownloadsOpen(true);
    } catch (err) {
      console.error('Download queue error:', err);
    }
  };

  const handleCancelTask = async (id) => {
    await fetch('/api/downloads/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
  };

  const handleClearCompleted = async () => {
    await fetch('/api/downloads/clear', { method: 'POST' });
  };

  const handleOpenFolder = async (folderPath) => {
    const platform = getPlatformInfo();
    const cleanPath = typeof folderPath === 'string' && folderPath.trim() ? folderPath.trim() : null;

    // On mobile devices (iOS / Android) or remote web browser, launch the in-app DownloadedFilesModal
    if (platform.isMobile || !platform.isLocalhost) {
      setIsDownloadedFilesOpen(true);
      return;
    }

    try {
      const res = await fetch('/api/downloads/open-folder', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanPath ? { folderPath: cleanPath } : {})
      });
      const data = await res.json();
      if (data.mode === 'web') {
        setIsDownloadedFilesOpen(true);
      }
    } catch {
      setIsDownloadedFilesOpen(true);
    }
  };

  const handlePlayDownloadedFile = (fileInfo) => {
    setActivePlayer({
      anime: {
        id: `local_${Date.now()}`,
        title: {
          english: fileInfo.title,
          romaji: fileInfo.title,
          native: fileInfo.title
        },
        episodes: 1,
        isLocal: true
      },
      episode: 1,
      audioMode: 'sub',
      directStreamUrl: fileInfo.streamUrl
    });
  };

  const handleSaveSettings = async (settings) => {
    // 1. Optimistically update local state & localStorage immediately (0ms UI reaction)
    setGpuSettings(prev => {
      const updated = {
        ...prev,
        ...(settings.gpuProfile !== undefined ? { gpuProfile: settings.gpuProfile } : {}),
        ...(settings.enableUpscale !== undefined ? { enableUpscale: settings.enableUpscale } : {}),
        ...(settings.enableBackdropBlur !== undefined ? { enableBackdropBlur: settings.enableBackdropBlur } : {}),
        ...(settings.mpvProfile !== undefined ? { mpvProfile: settings.mpvProfile } : {})
      };
      try {
        localStorage.setItem('aniflix_gpu_settings', JSON.stringify(updated));
      } catch {}
      return updated;
    });

    // 2. Persist to backend server
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      const d = await res.json();
      if (d.downloadDir) setDownloadDir(d.downloadDir);
      if (d.success) {
        setGpuSettings(prev => {
          const synced = {
            ...prev,
            ...(d.gpuProfile !== undefined ? { gpuProfile: d.gpuProfile } : {}),
            ...(d.enableUpscale !== undefined ? { enableUpscale: d.enableUpscale } : {}),
            ...(d.enableBackdropBlur !== undefined ? { enableBackdropBlur: d.enableBackdropBlur } : {}),
            ...(d.mpvProfile !== undefined ? { mpvProfile: d.mpvProfile } : {})
          };
          try {
            localStorage.setItem('aniflix_gpu_settings', JSON.stringify(synced));
          } catch {}
          return synced;
        });
      }
    } catch (err) {
      console.warn('Failed to save settings:', err);
    }
  };

  const activeDownloadsCount = downloadTasks.filter(
    t => t.status === 'DOWNLOADING' || t.status === 'QUEUED'
  ).length;

  return (
    <div className="min-h-screen bg-[#141414] text-white flex flex-col justify-between selection:bg-[#E50914] selection:text-white">
      {/* Top Navigation */}
      <Navbar
        searchQuery={searchQuery}
        onSearch={setSearchQuery}
        activeDownloadsCount={activeDownloadsCount}
        onOpenDownloads={() => setIsDownloadsOpen(true)}
        onOpenSettings={() => handleOpenSettings('content')}
        onOpenUserProfile={() => setIsUserProfileOpen(true)}
        currentUser={currentUser}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        favoritesCount={favorites.length}
        watchHistoryCount={watchHistory.length}
        currentLang={currentLang}
        onSelectLang={handleSelectLang}
        t={t}
      />

      {/* Top Status & Announcement Marquee Bar */}
      {activeTab === 'home' && !searchQuery && (
        <div className="pt-[58px] sm:pt-[64px] relative z-30">
          <MarqueeTicker 
            currentLang={currentLang}
            isContainer={serverInfo.isContainer}
          />
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 pb-16">
        {/* Search Results Grid View */}
        {searchQuery ? (
          <div className="pt-24 px-4 md:px-12">
            <div className="flex items-center gap-2 mb-6">
              <Search className="w-5 h-5 text-[#E50914]" />
              <h2 className="text-xl font-bold">
                Search results for <span className="text-[#E50914]">"{searchQuery}"</span>
              </h2>
            </div>

            {isSearching ? (
              <div className="h-64 flex items-center justify-center">
                <Loader2 className="w-10 h-10 text-[#E50914] animate-spin" />
              </div>
            ) : searchResults.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {filterAnimeList(searchResults).map((anime) => (
                  <AnimeCard
                    key={anime.id}
                    anime={anime}
                    currentLang={currentLang}
                    onPlay={handlePlay}
                    onDownload={handleOpenBatchDownload}
                    onMoreInfo={setSelectedAnime}
                    isFavorite={favoriteIds.has(anime.id)}
                    onToggleFavorite={handleToggleFavorite}
                  />
                ))}
              </div>
            ) : (
              <div className="h-64 flex flex-col items-center justify-center text-zinc-500">
                <p className="text-base font-semibold">{t('noAnimeFound')} "{searchQuery}"</p>
                <p className="text-xs mt-1">{t('tryAnotherQuery')}</p>
              </div>
            )}
          </div>
        ) : activeTab === 'favorites' ? (
          /* Favorites Tab Grid */
          <div className="pt-24 px-4 md:px-12">
            <div className="flex items-center gap-2 mb-6">
              <Heart className="w-6 h-6 text-red-500 fill-red-500" />
              <h2 className="text-2xl font-black text-white">{t('myFavorites')} ({filterAnimeList(favorites).length})</h2>
            </div>

            {filterAnimeList(favorites).length === 0 ? (
              <div className="h-80 flex flex-col items-center justify-center text-zinc-400 bg-zinc-900/30 rounded-2xl border border-zinc-800">
                <Heart className="w-12 h-12 text-zinc-600 mb-3" />
                <p className="text-base font-bold text-zinc-300">{t('favoritesEmpty')}</p>
                <p className="text-xs text-zinc-500 mt-1 max-w-sm text-center">
                  {t('favoritesEmptyDesc')}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {filterAnimeList(favorites).map((anime) => (
                  <AnimeCard
                    key={anime.id}
                    anime={anime}
                    currentLang={currentLang}
                    onPlay={handlePlay}
                    onDownload={handleOpenBatchDownload}
                    onMoreInfo={setSelectedAnime}
                    isFavorite={true}
                    onToggleFavorite={handleToggleFavorite}
                  />
                ))}
              </div>
            )}
          </div>
        ) : activeTab === 'history' ? (
          /* Watch History Tab Grid */
          <div className="pt-24 px-4 md:px-12">
            <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <History className="w-6 h-6 text-indigo-400" />
                <h2 className="text-2xl font-black text-white">{t('watchHistoryTitle')} ({watchHistory.filter(i => i.anime && (!hideR18 || (!i.anime.isAdult && !i.anime.genres?.includes('Hentai')))).length})</h2>
              </div>
              {watchHistory.length > 0 && (
                <button
                  onClick={handleClearWatchHistory}
                  className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-red-400 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-red-900/50 transition-colors shadow-sm"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{t('clearWatchHistory')}</span>
                </button>
              )}
            </div>

            {watchHistory.filter(i => i.anime && (!hideR18 || (!i.anime.isAdult && !i.anime.genres?.includes('Hentai')))).length === 0 ? (
              <div className="h-80 flex flex-col items-center justify-center text-zinc-400 bg-zinc-900/30 rounded-2xl border border-zinc-800">
                <History className="w-12 h-12 text-zinc-600 mb-3" />
                <p className="text-base font-bold text-zinc-300">{t('watchHistoryEmpty')}</p>
                <p className="text-xs text-zinc-500 mt-1 max-w-sm text-center">
                  {t('watchHistoryEmptyDesc')}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {watchHistory.filter(i => i.anime && (!hideR18 || (!i.anime.isAdult && !i.anime.genres?.includes('Hentai')))).map((item) => {
                  const anime = item.anime;
                  if (!anime) return null;
                  return (
                    <div key={anime.id} className="relative group/history">
                      <AnimeCard
                        anime={anime}
                        currentLang={currentLang}
                        onPlay={(a) => handlePlay(a, item.episode || 1)}
                        onDownload={handleOpenBatchDownload}
                        onMoreInfo={setSelectedAnime}
                        isFavorite={favoriteIds.has(anime.id)}
                        onToggleFavorite={handleToggleFavorite}
                      />
                      {/* Watch Progress Pill & Actions */}
                      <div className="mt-1.5 flex items-center justify-between text-xs px-1">
                        <span className="font-semibold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded text-[11px] border border-emerald-500/30 flex items-center gap-1">
                          <Play className="w-2.5 h-2.5 fill-emerald-400" />
                          {currentLang === 'ja' ? `第 ${item.episode || 1} 話` : currentLang.startsWith('zh') ? `第 ${item.episode || 1} 集` : `Ep ${item.episode || 1}`}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-zinc-500">
                            {formatTimeAgo(item.timestamp)}
                          </span>
                          <button
                            onClick={() => handleRemoveWatchHistory(anime.id)}
                            className="text-zinc-500 hover:text-red-400 p-0.5 transition-colors"
                            title={currentLang === 'ja' ? '履歴から削除' : currentLang.startsWith('zh') ? '從觀看歷史移除' : 'Remove from history'}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : activeTab === 'catalog' ? (
          /* Anime Catalog by Year & Season Tab Grid */
          <div className="pt-24 px-4 md:px-12">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                  <Compass className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-2xl font-black text-white flex items-center gap-2">
                    Anime Catalog
                    <span className="text-xs font-semibold text-amber-400 bg-amber-950/60 px-2.5 py-0.5 rounded-full border border-amber-500/30">
                      {catalogYear} {catalogSeason !== 'ALL' ? catalogSeason : 'All Seasons'}
                    </span>
                  </h2>
                  <p className="text-xs text-zinc-400">Browse anime releases by year, seasonal broadcast, and popularity</p>
                </div>
              </div>

              {/* Sort Select */}
              <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 self-start sm:self-auto">
                <Filter className="w-3.5 h-3.5 text-zinc-400" />
                <label htmlFor="catalog-sort-select" className="text-xs text-zinc-400 font-medium cursor-pointer">
                  {t('filterSort')}
                </label>
                <select
                  id="catalog-sort-select"
                  name="catalogSort"
                  aria-label={t('filterSort') || '排序方式'}
                  value={catalogSort}
                  onChange={(e) => setCatalogSort(e.target.value)}
                  className="bg-transparent text-xs text-white font-semibold focus:outline-none cursor-pointer"
                >
                  <option value="POPULARITY_DESC" className="bg-zinc-900 text-white">{t('sortPopular')}</option>
                  <option value="SCORE_DESC" className="bg-zinc-900 text-white">{t('sortScore')}</option>
                  <option value="TRENDING_DESC" className="bg-zinc-900 text-white">{t('sortTrending')}</option>
                  <option value="START_DATE_DESC" className="bg-zinc-900 text-white">{t('sortNewest')}</option>
                </select>
              </div>
            </div>

            {/* Filter Pills Bar */}
            <div className="space-y-3 mb-8 bg-zinc-900/50 p-4 rounded-2xl border border-zinc-800/80">
              {/* Decade Fast Jumps */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider shrink-0 mr-1">
                  {t('decades')}
                </span>
                {DECADES.map(d => (
                  <button
                    key={d.label}
                    onClick={() => setCatalogYear(d.year)}
                    className={`px-2.5 py-0.5 rounded-full text-xs font-semibold shrink-0 transition-all ${
                      catalogYear >= d.year - 4 && catalogYear <= d.year + 5
                        ? 'bg-rose-600 text-white font-bold shadow'
                        : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>

              {/* Year Selector with Dropdown */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                <label htmlFor="catalog-year-select" className="text-xs font-bold text-zinc-400 uppercase tracking-wider shrink-0 mr-1 cursor-pointer">
                  {t('filterYear')}
                </label>

                {/* Full Year Dropdown Picker (1970 - 2026 + ALL) */}
                <div className="flex items-center gap-1.5 bg-zinc-800/90 border border-zinc-700 px-2.5 py-1 rounded-full shrink-0">
                  <select
                    id="catalog-year-select"
                    name="catalogYear"
                    aria-label={t('filterYear') || '年份篩選'}
                    value={catalogYear}
                    onChange={(e) => setCatalogYear(e.target.value === 'ALL' ? 'ALL' : parseInt(e.target.value))}
                    className="bg-transparent text-xs text-amber-400 font-bold focus:outline-none cursor-pointer"
                  >
                    <option value="ALL" className="bg-zinc-900 text-white">{t('allYears')}</option>
                    {ALL_YEARS.map((yr) => (
                      <option key={yr} value={yr} className="bg-zinc-900 text-white">
                        {yr === currentSeasonInfo.year ? `${yr} (${t('thisYear')})` : `${yr}`}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Quick Year Pills (2026 down to 2010) */}
                {QUICK_YEARS.map((yr) => (
                  <button
                    key={yr}
                    onClick={() => setCatalogYear(yr)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold shrink-0 transition-all ${
                      catalogYear === yr
                        ? 'bg-[#E50914] text-white shadow-md shadow-red-600/30 font-bold'
                        : 'bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700 hover:text-white border border-zinc-700/50'
                    }`}
                  >
                    {yr === currentSeasonInfo.year ? `${yr} (${t('thisYear')})` : yr}
                  </button>
                ))}
              </div>

              {/* Season Selector */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider shrink-0 mr-1">
                  {t('filterSeason')}
                </span>
                {[
                  { id: 'ALL', label: t('allSeasons') || '全部季度 (All)', emoji: '🌟' },
                  { id: 'FALL', label: '10 - 12 月 (秋季新番 / Fall)', emoji: '🍁' },
                  { id: 'SUMMER', label: '7 - 9 月 (夏季新番 / Summer)', emoji: '☀️' },
                  { id: 'SPRING', label: '4 - 6 月 (春季新番 / Spring)', emoji: '🌸' },
                  { id: 'WINTER', label: '1 - 3 月 (冬季新番 / Winter)', emoji: '❄️' }
                ].map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setCatalogSeason(s.id)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold shrink-0 transition-colors motion-safe:active:scale-[0.96] ${
                      catalogSeason === s.id
                        ? 'bg-amber-500 text-black shadow-md shadow-amber-500/30 font-bold'
                        : 'bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700 hover:text-white border border-zinc-700/50'
                    }`}
                  >
                    <span>{s.emoji}</span>
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>

              {/* Studio / Mainfactory Selector */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none mt-2">
                <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider shrink-0 mr-1 flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5 text-rose-400" />
                  動畫公司 (Studio)
                </span>
                {[
                  { id: 'ALL', label: '全部動畫製作公司 (All Studios)' },
                  { id: 'ufotable', label: 'ufotable (幽浮社)' },
                  { id: 'MAPPA', label: 'MAPPA' },
                  { id: 'Kyoto Animation', label: 'Kyoto Animation (京阿尼)' },
                  { id: 'CloverWorks', label: 'CloverWorks' },
                  { id: 'A-1 Pictures', label: 'A-1 Pictures' },
                  { id: 'Bones', label: 'Bones (骨頭社)' },
                  { id: 'WIT Studio', label: 'WIT Studio (霸權社)' },
                  { id: 'Madhouse', label: 'MADHOUSE' },
                  { id: 'Production I.G', label: 'Production I.G' },
                  { id: 'Shaft', label: 'SHAFT' },
                  { id: 'TRIGGER', label: 'TRIGGER (扳機社)' },
                  { id: 'Toei Animation', label: 'Toei Animation (東映)' }
                ].map((st) => (
                  <button
                    key={st.id}
                    onClick={() => setCatalogStudio(st.id)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold shrink-0 transition-colors motion-safe:active:scale-[0.96] ${
                      catalogStudio === st.id
                        ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30 font-bold'
                        : 'bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700 hover:text-white border border-zinc-700/50'
                    }`}
                  >
                    <span>🏢</span>
                    <span>{st.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Content Grid */}
            {catalogLoading && catalogAnimes.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-zinc-500">
                <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
                <p className="text-sm mt-3">{t('loadingCatalog')}</p>
              </div>
            ) : catalogAnimes.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-zinc-500">
                <p className="text-base font-semibold text-zinc-400">{t('noCatalogFound')}</p>
                <p className="text-xs text-zinc-500 mt-1">{t('tryDifferentFilters')}</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {filterAnimeList(catalogAnimes).map((anime) => (
                    <AnimeCard
                      key={anime.id}
                      anime={anime}
                      currentLang={currentLang}
                      onPlay={handlePlay}
                      onDownload={handleOpenBatchDownload}
                      onMoreInfo={setSelectedAnime}
                      isFavorite={favoriteIds.has(anime.id)}
                      onToggleFavorite={handleToggleFavorite}
                    />
                  ))}
                </div>

                {/* Load More Button */}
                {hasMoreCatalog && (
                  <div className="mt-8 mb-12 flex justify-center">
                    <button
                      onClick={() => loadCatalogData(catalogYear, catalogSeason, catalogSort, catalogPage + 1, true, catalogStudio)}
                      disabled={catalogLoading}
                      className="px-6 py-2.5 rounded-full bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-xs border border-zinc-700 flex items-center gap-2 transition-colors motion-safe:active:scale-[0.96] disabled:opacity-50"
                    >
                      {catalogLoading ? <Loader2 className="w-4 h-4 animate-spin text-amber-400" /> : <Layers className="w-4 h-4 text-amber-400" />}
                      <span>{catalogLoading ? 'Loading more...' : t('loadMore')}</span>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ) : activeTab === 'upcoming' ? (
          /* Upcoming / Coming Soon Tab Grid */
          <div className="pt-24 px-4 md:px-12">
            <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <Calendar className="w-6 h-6 text-indigo-400" />
                <h2 className="text-2xl font-black text-white">Coming Soon / Anticipated Releases ({filterAnimeList(upcoming).length})</h2>
              </div>
              {carouselHasMore.upcoming && (
                <span className="text-xs font-bold text-red-400 bg-red-950/50 px-2.5 py-1 rounded-full border border-red-800/40 uppercase tracking-wider">
                  ∞ 無限載入已啟用
                </span>
              )}
            </div>

            {filterAnimeList(upcoming).length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-zinc-500">
                <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                <p className="text-sm mt-3">Loading upcoming releases...</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {filterAnimeList(upcoming).map((anime) => (
                    <AnimeCard
                      key={anime.id}
                      anime={anime}
                      currentLang={currentLang}
                      onPlay={handlePlay}
                      onDownload={handleOpenBatchDownload}
                      onMoreInfo={setSelectedAnime}
                      isFavorite={favoriteIds.has(anime.id)}
                      onToggleFavorite={handleToggleFavorite}
                    />
                  ))}
                </div>

                {carouselHasMore.upcoming && (
                  <div className="mt-8 mb-12 flex justify-center">
                    <button
                      onClick={() => handleLoadMoreCarousel('upcoming')}
                      disabled={carouselLoadingMore.upcoming}
                      className="px-6 py-2.5 rounded-full bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-xs border border-zinc-700 flex items-center gap-2 transition-all disabled:opacity-50"
                    >
                      {carouselLoadingMore.upcoming ? <Loader2 className="w-4 h-4 animate-spin text-indigo-400" /> : <Layers className="w-4 h-4 text-indigo-400" />}
                      <span>{carouselLoadingMore.upcoming ? 'Loading more...' : t('loadMore')}</span>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ) : ['trending', 'top-rated', 'Action', 'Fantasy'].includes(activeTab) ? (
          /* Dedicated Category Discover Grid with Unlimited Infinite Load More */
          <div className="pt-24 px-4 md:px-12">
            {(() => {
              const catMap = {
                trending: { title: t('trendingNow'), icon: Flame, list: filteredTrending, key: 'trending', color: 'text-amber-400' },
                'top-rated': { title: t('highScoreClassics'), icon: Trophy, list: filteredTopRated, key: 'topRated', color: 'text-yellow-400' },
                Action: { title: t('actionCarousel'), icon: Swords, list: filteredAction, key: 'action', color: 'text-rose-400' },
                Fantasy: { title: t('fantasyCarousel'), icon: Sparkles, list: filteredFantasy, key: 'fantasy', color: 'text-purple-400' },
              };
              const config = catMap[activeTab] || catMap.trending;
              const IconComp = config.icon;
              return (
                <>
                  <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                    <div className="flex items-center gap-2">
                      <IconComp className={`w-6 h-6 ${config.color}`} />
                      <h2 className="text-2xl font-black text-white">{config.title} ({config.list.length})</h2>
                    </div>
                    {carouselHasMore[config.key] && (
                      <span className="text-xs font-bold text-red-400 bg-red-950/50 px-2.5 py-1 rounded-full border border-red-800/40 uppercase tracking-wider">
                        ∞ 無限載入已啟用
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {config.list.map((anime) => (
                      <AnimeCard
                        key={anime.id}
                        anime={anime}
                        currentLang={currentLang}
                        onPlay={handlePlay}
                        onDownload={handleOpenBatchDownload}
                        onMoreInfo={setSelectedAnime}
                        isFavorite={favoriteIds.has(anime.id)}
                        onToggleFavorite={handleToggleFavorite}
                      />
                    ))}
                  </div>

                  {carouselHasMore[config.key] && (
                    <div className="mt-8 mb-12 flex justify-center">
                      <button
                        onClick={() => handleLoadMoreCarousel(config.key)}
                        disabled={carouselLoadingMore[config.key]}
                        className="px-6 py-2.5 rounded-full bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-xs border border-zinc-700 flex items-center gap-2 transition-all disabled:opacity-50"
                      >
                        {carouselLoadingMore[config.key] ? <Loader2 className="w-4 h-4 animate-spin text-red-500" /> : <Layers className="w-4 h-4 text-red-500" />}
                        <span>{carouselLoadingMore[config.key] ? 'Loading more...' : t('loadMore')}</span>
                      </button>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        ) : (
          /* Normal Netflix Browsing Rows */
          <>
            {/* Top Featured Hero Banner (with zero-CLS skeleton placeholder) */}
            {activeTab === 'home' && (
              featuredAnime ? (
                <HeroBanner
                  anime={featuredAnime}
                  currentLang={currentLang}
                  t={t}
                  onPlay={handlePlay}
                  onDownload={handleOpenBatchDownload}
                  onMoreInfo={handleMoreInfo}
                />
              ) : (
                <div className="relative w-full h-[76vh] min-h-[580px] max-h-[820px] select-none overflow-hidden bg-gradient-to-b from-zinc-950 via-zinc-900/60 to-[#141414] flex flex-col justify-end pt-20 pb-16 sm:pb-20 md:pb-24 px-4 md:px-12">
                  <div className="max-w-xl space-y-4 animate-pulse">
                    <div className="h-5 w-28 bg-zinc-800/80 rounded-full" />
                    <div className="h-10 w-72 sm:w-96 bg-zinc-800/90 rounded-xl" />
                    <div className="h-14 w-full max-w-md bg-zinc-800/40 rounded-xl hidden sm:block" />
                    <div className="flex gap-3 pt-2">
                      <div className="h-10 w-28 bg-zinc-800/90 rounded-xl" />
                      <div className="h-10 w-28 bg-zinc-800/50 rounded-xl" />
                    </div>
                  </div>
                  {/* Bottom fade gradient */}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-[#141414]/70 to-transparent pointer-events-none" />
                </div>
              )
            )}

            {/* Loading Indicator */}
            {isLoading && (
              <div className="h-96 flex items-center justify-center">
                <Loader2 className="w-12 h-12 text-[#E50914] animate-spin" />
              </div>
            )}

            {/* Horizontal Carousels */}
            {!isLoading && (
              <div className={`space-y-6 min-h-[600px] ${activeTab === 'home' ? 'relative z-20 -mt-8 md:-mt-12' : 'pt-24'}`}>
                {/* 0. Continue Watching Carousel */}
                {activeTab === 'home' && watchHistory.length > 0 && (
                  <AnimeCarousel
                    title={t('continueWatching')}
                    subtitle={t('continueWatchingSub')}
                    icon={History}
                    animes={filteredWatchHistoryAnimes}
                    currentLang={currentLang}
                    onPlay={(anime) => {
                      const historyItem = watchHistory.find(w => w.anime?.id === anime.id);
                      handlePlay(anime, historyItem?.episode || 1);
                    }}
                    onDownload={handleOpenBatchDownload}
                    onMoreInfo={handleMoreInfo}
                    favoriteIds={favoriteIds}
                    onToggleFavorite={handleToggleFavorite}
                  />
                )}

                {/* 1. Personalized Recommendations Carousel */}
                {activeTab === 'home' && recommendations.length > 0 && (
                  <AnimeCarousel
                    title={t('recommendedForYou')}
                    subtitle={
                      watchHistory.length > 0 && favorites.length > 0
                        ? t('recommendedSubBoth')
                        : favorites.length > 0
                        ? t('recommendedSubFav')
                        : t('recommendedSubHist')
                    }
                    icon={Sparkles}
                    animes={filteredRecommendations}
                    currentLang={currentLang}
                    onPlay={handlePlay}
                    onDownload={handleOpenBatchDownload}
                    onMoreInfo={handleMoreInfo}
                    favoriteIds={favoriteIds}
                    onToggleFavorite={handleToggleFavorite}
                    onLoadMore={() => handleLoadMoreCarousel('recommendations')}
                    isLoadingMore={Boolean(carouselLoadingMore.recommendations)}
                    hasMore={Boolean(carouselHasMore.recommendations)}
                  />
                )}

                {/* 2. This Season's Anime Carousel */}
                {activeTab === 'home' && thisSeasonAnimes.length > 0 && (
                  <AnimeCarousel
                    title={`${t('trendingNow')} (${currentSeasonInfo.label})`}
                    subtitle={t('trendingNowSub')}
                    icon={Compass}
                    animes={filteredThisSeason}
                    currentLang={currentLang}
                    onPlay={handlePlay}
                    onDownload={handleOpenBatchDownload}
                    onMoreInfo={handleMoreInfo}
                    favoriteIds={favoriteIds}
                    onToggleFavorite={handleToggleFavorite}
                    onLoadMore={() => handleLoadMoreCarousel('thisSeason')}
                    isLoadingMore={Boolean(carouselLoadingMore.thisSeason)}
                    hasMore={Boolean(carouselHasMore.thisSeason)}
                  />
                )}

                {/* 3. Trending Now */}
                {activeTab === 'home' && (
                  <AnimeCarousel
                    title={t('trendingNow')}
                    subtitle={t('trendingNowSub')}
                    icon={Flame}
                    animes={filteredTrending}
                    currentLang={currentLang}
                    onPlay={handlePlay}
                    onDownload={handleOpenBatchDownload}
                    onMoreInfo={handleMoreInfo}
                    favoriteIds={favoriteIds}
                    onToggleFavorite={handleToggleFavorite}
                    onLoadMore={() => handleLoadMoreCarousel('trending')}
                    isLoadingMore={Boolean(carouselLoadingMore.trending)}
                    hasMore={Boolean(carouselHasMore.trending)}
                  />
                )}

                {/* 4. Top Rated Anime */}
                {activeTab === 'home' && (
                  <AnimeCarousel
                    title={t('highScoreClassics')}
                    subtitle={t('highScoreClassicsSub')}
                    icon={Trophy}
                    animes={filteredTopRated}
                    currentLang={currentLang}
                    onPlay={handlePlay}
                    onDownload={handleOpenBatchDownload}
                    onMoreInfo={handleMoreInfo}
                    favoriteIds={favoriteIds}
                    onToggleFavorite={handleToggleFavorite}
                    onLoadMore={() => handleLoadMoreCarousel('topRated')}
                    isLoadingMore={Boolean(carouselLoadingMore.topRated)}
                    hasMore={Boolean(carouselHasMore.topRated)}
                  />
                )}

                {/* 5. Popular This Season */}
                {activeTab === 'home' && (
                  <AnimeCarousel
                    title={t('allTimePopular')}
                    subtitle={t('allTimePopularSub')}
                    icon={Star}
                    animes={filteredPopular}
                    currentLang={currentLang}
                    onPlay={handlePlay}
                    onDownload={handleOpenBatchDownload}
                    onMoreInfo={handleMoreInfo}
                    favoriteIds={favoriteIds}
                    onToggleFavorite={handleToggleFavorite}
                    onLoadMore={() => handleLoadMoreCarousel('popular')}
                    isLoadingMore={Boolean(carouselLoadingMore.popular)}
                    hasMore={Boolean(carouselHasMore.popular)}
                  />
                )}

                {/* 6. Coming Soon & Anticipated Releases */}
                {activeTab === 'home' && upcoming.length > 0 && (
                  <AnimeCarousel
                    title={t('upcoming')}
                    subtitle={t('unreleasedNotice')}
                    icon={Calendar}
                    animes={filteredUpcoming}
                    currentLang={currentLang}
                    onPlay={handlePlay}
                    onDownload={handleOpenBatchDownload}
                    onMoreInfo={handleMoreInfo}
                    favoriteIds={favoriteIds}
                    onToggleFavorite={handleToggleFavorite}
                    onLoadMore={() => handleLoadMoreCarousel('upcoming')}
                    isLoadingMore={Boolean(carouselLoadingMore.upcoming)}
                    hasMore={Boolean(carouselHasMore.upcoming)}
                  />
                )}

                {/* 7. Action & Adventure */}
                {activeTab === 'home' && (
                  <AnimeCarousel
                    title={t('actionCarousel')}
                    icon={Swords}
                    animes={filteredAction}
                    currentLang={currentLang}
                    onPlay={handlePlay}
                    onDownload={handleOpenBatchDownload}
                    onMoreInfo={handleMoreInfo}
                    favoriteIds={favoriteIds}
                    onToggleFavorite={handleToggleFavorite}
                    onLoadMore={() => handleLoadMoreCarousel('action')}
                    isLoadingMore={Boolean(carouselLoadingMore.action)}
                    hasMore={Boolean(carouselHasMore.action)}
                  />
                )}

                {/* 8. Sci-Fi & Fantasy */}
                {activeTab === 'home' && (
                  <AnimeCarousel
                    title={t('fantasyCarousel')}
                    icon={Sparkles}
                    animes={filteredFantasy}
                    currentLang={currentLang}
                    onPlay={handlePlay}
                    onDownload={handleOpenBatchDownload}
                    onMoreInfo={handleMoreInfo}
                    favoriteIds={favoriteIds}
                    onToggleFavorite={handleToggleFavorite}
                    onLoadMore={() => handleLoadMoreCarousel('fantasy')}
                    isLoadingMore={Boolean(carouselLoadingMore.fantasy)}
                    hasMore={Boolean(carouselHasMore.fantasy)}
                  />
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800/80 py-6 px-4 md:px-12 text-center text-xs text-zinc-500">
        <p>AniFlix • Powered by ani-cli, yt-dlp, aria2c, and AniList</p>
      </footer>

      {/* Modals & Overlays */}

      {/* Lazy-Loaded Modals & Overlays wrapped in Suspense for zero main-thread blocking */}
      <Suspense fallback={null}>
        {/* Anime Detail & Episode Picker Modal */}
        {selectedAnime && (
          <DetailModal
            anime={selectedAnime}
            onClose={() => setSelectedAnime(null)}
            onPlay={handlePlay}
            onOpenBatchDownload={handleOpenBatchDownload}
            onPlayMpv={handlePlayMpv}
            isFavorite={favoriteIds.has(selectedAnime.id)}
            onToggleFavorite={handleToggleFavorite}
            onSelectAnime={(newAnime) => setSelectedAnime(newAnime)}
            currentLang={currentLang}
            hideR18={hideR18}
            gpuSettings={gpuSettings}
            onUpdateGpuSettings={handleSaveSettings}
            t={t}
          />
        )}

        {/* Batch Downloader Modal */}
        {batchDownloadData && (
          <BatchDownloadModal
            anime={batchDownloadData.anime}
            initialAudioMode={batchDownloadData.audioMode}
            initialRange={batchDownloadData.initialRange}
            onClose={() => setBatchDownloadData(null)}
            onStartDownload={handleStartDownload}
          />
        )}

        {/* Embedded In-Browser Video Player */}
        {activePlayer && (
          <VideoPlayer
            anime={activePlayer.anime}
            episode={activePlayer.episode}
            audioMode={activePlayer.audioMode}
            directStreamUrl={activePlayer.directStreamUrl}
            totalEpisodes={activePlayer.anime?.episodes}
            onClose={() => setActivePlayer(null)}
            onSelectEpisode={(ep) => setActivePlayer(prev => ({ ...prev, episode: ep }))}
            onNextEpisode={() => setActivePlayer(prev => ({ ...prev, episode: prev.episode + 1 }))}
            onPrevEpisode={() => setActivePlayer(prev => ({ ...prev, episode: Math.max(1, prev.episode - 1) }))}
            onLaunchMpv={(anime, ep, mode, stream) => handlePlayMpv(anime, ep, mode, stream)}
            currentLang={currentLang}
            gpuSettings={gpuSettings}
            onUpdateGpuSettings={handleSaveSettings}
            t={t}
          />
        )}
      </Suspense>

      {/* Slide-Out Download Manager Drawer */}
      <DownloadManager
        isOpen={isDownloadsOpen}
        onClose={() => setIsDownloadsOpen(false)}
        tasks={downloadTasks}
        downloadDir={downloadDir}
        onCancelTask={handleCancelTask}
        onClearCompleted={handleClearCompleted}
        onOpenFolder={handleOpenFolder}
        onOpenDownloadedFiles={() => setIsDownloadedFilesOpen(true)}
      />

      {/* Settings & Plugins Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        currentDir={downloadDir}
        onSaveSettings={handleSaveSettings}
        onOpenFolder={handleOpenFolder}
        onOpenDownloadedFiles={() => setIsDownloadedFilesOpen(true)}
        hideR18={hideR18}
        onToggleHideR18={handleToggleHideR18}
        currentLang={currentLang}
        gpuSettings={gpuSettings}
        onUpdateGpuSettings={handleSaveSettings}
        initialTab={settingsInitialTab}
        serverInfo={serverInfo}
        trendingCount={filteredTrending.length}
        activeDownloadsCount={downloadTasks.length}
      />

      {/* User Profile & Account Switcher Modal */}
      <UserProfileModal
        isOpen={isUserProfileOpen}
        onClose={() => setIsUserProfileOpen(false)}
        currentUser={currentUser}
        onSwitchUser={handleSwitchUser}
        currentLang={currentLang}
        favoritesCount={favorites.length}
        historyCount={watchHistory.length}
      />

      {/* Downloaded Anime Files Browser Modal (Mobile & Web) */}
      <DownloadedFilesModal
        isOpen={isDownloadedFilesOpen}
        onClose={() => setIsDownloadedFilesOpen(false)}
        onPlayFile={handlePlayDownloadedFile}
        currentLang={currentLang}
        t={t}
      />

      {/* First-Run Environment Setup Wizard */}
      <SetupWizardModal
        isOpen={isSetupWizardOpen}
        onClose={() => setIsSetupWizardOpen(false)}
        onComplete={() => setIsSetupWizardOpen(false)}
      />
    </div>
  );
}
