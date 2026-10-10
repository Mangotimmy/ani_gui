// src/App.jsx - AniFlix Desktop Netflix Application
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Navbar from './components/Navbar';
import HeroBanner from './components/HeroBanner';
import AnimeCarousel from './components/AnimeCarousel';
import DetailModal from './components/DetailModal';
import BatchDownloadModal from './components/BatchDownloadModal';
import VideoPlayer from './components/VideoPlayer';
import DownloadManager from './components/DownloadManager';
import SettingsModal from './components/SettingsModal';
import SetupWizardModal from './components/SetupWizardModal';
import DownloadedFilesModal from './components/DownloadedFilesModal';
import AnimeCard from './components/AnimeCard';
import MarqueeTicker from './components/animata/MarqueeTicker';
import BentoGrid from './components/animata/BentoGrid';
import { getPlatformInfo } from './utils/platform';
import { 
  Flame, Star, Trophy, Swords, Sparkles, Loader2, 
  Search, Heart, Calendar, History, Trash2, Clock, Play,
  Compass, Filter, Layers, ChevronDown
} from 'lucide-react';
import { getSavedLanguage, saveLanguage, createTranslator } from './utils/i18n';

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

  // Content Data
  const [trending, setTrending] = useState([]);
  const [popular, setPopular] = useState([]);
  const [topRated, setTopRated] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [actionAnimes, setActionAnimes] = useState([]);
  const [fantasyAnimes, setFantasyAnimes] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Catalog & Seasonal Content State
  const [currentSeasonInfo, setCurrentSeasonInfo] = useState({ year: CURRENT_YEAR, season: 'FALL', label: `Fall ${CURRENT_YEAR}` });
  const [thisSeasonAnimes, setThisSeasonAnimes] = useState([]);
  const [catalogYear, setCatalogYear] = useState(CURRENT_YEAR);
  const [catalogSeason, setCatalogSeason] = useState('ALL');
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

  // 1. Initial Content Data Fetching
  useEffect(() => {
    async function loadInitialData() {
      setIsLoading(true);
      try {
        const [trendRes, popRes, topRes, actRes, fanRes, upRes, seasonRes] = await Promise.all([
          fetch('/api/trending').then(r => r.json()),
          fetch('/api/popular').then(r => r.json()),
          fetch('/api/top-rated').then(r => r.json()),
          fetch('/api/genre/Action').then(r => r.json()),
          fetch('/api/genre/Fantasy').then(r => r.json()),
          fetch('/api/upcoming').then(r => r.json()),
          fetch('/api/catalog/current-season').then(r => r.json()).catch(() => ({ success: false }))
        ]);

        if (trendRes.success) setTrending(trendRes.data);
        if (popRes.success) setPopular(popRes.data);
        if (topRes.success) setTopRated(topRes.data);
        if (actRes.success) setActionAnimes(actRes.data);
        if (fanRes.success) setFantasyAnimes(fanRes.data);
        if (upRes.success) setUpcoming(upRes.data);

        if (seasonRes && seasonRes.success) {
          setCurrentSeasonInfo({ year: seasonRes.year, season: seasonRes.season, label: seasonRes.label });
          setCatalogYear(seasonRes.year);

          // Fetch this season's anime for Home row
          try {
            const thisSeasonData = await fetch(`/api/catalog?year=${seasonRes.year}&season=${seasonRes.season}&perPage=20`).then(r => r.json());
            if (thisSeasonData.success && Array.isArray(thisSeasonData.media)) {
              setThisSeasonAnimes(thisSeasonData.media);
            }
          } catch (e) {
            console.warn('Failed to load this season anime:', e);
          }
        }
      } catch (err) {
        console.error('Failed to load anime categories:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadInitialData();

    // Check environment readiness
    fetch('/api/environment/status')
      .then(r => r.json())
      .then(d => {
        if (d.success && !d.ready) {
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
            limit: 20
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
  const loadCatalogData = async (year, season, sort, page = 1, append = false) => {
    setCatalogLoading(true);
    try {
      const sParam = season && season !== 'ALL' ? `&season=${season}` : '';
      const adultParam = `&isAdult=${!hideR18}`;
      const url = `/api/catalog?year=${year}${sParam}&sort=${sort}&page=${page}&perPage=24${adultParam}`;
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
      loadCatalogData(catalogYear, catalogSeason, catalogSort, 1, false);
    }
  }, [activeTab, catalogYear, catalogSeason, catalogSort, hideR18]);

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

  // Favorite toggle handler
  const handleToggleFavorite = (anime) => {
    if (!anime || !anime.id) return;
    setFavorites(prev => {
      const exists = prev.some(f => f.id === anime.id);
      let updated;
      if (exists) {
        updated = prev.filter(f => f.id !== anime.id);
      } else {
        updated = [anime, ...prev];
      }
      try {
        localStorage.setItem('aniflix_favorites', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  // Handlers for Player & Downloads
  const handlePlay = (anime, episode = 1, audioMode = 'sub') => {
    setActivePlayer({ anime, episode, audioMode });
    // Append to watch history
    setWatchHistory(prev => {
      const filtered = prev.filter(item => item.anime?.id !== anime.id);
      const updated = [{ anime, episode, timestamp: Date.now() }, ...filtered].slice(0, 30);
      try {
        localStorage.setItem('aniflix_watch_history', JSON.stringify(updated));
      } catch {}
      return updated;
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
    setBatchDownloadData({ anime, audioMode, initialRange });
    setSelectedAnime(null);
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
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        favoritesCount={favorites.length}
        watchHistoryCount={watchHistory.length}
        currentLang={currentLang}
        onSelectLang={handleSelectLang}
        t={t}
      />

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
                <span className="text-xs text-zinc-400 font-medium">{t('filterSort')}</span>
                <select
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
                <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider shrink-0 mr-1">
                  {t('filterYear')}
                </span>

                {/* Full Year Dropdown Picker (1970 - 2026 + ALL) */}
                <div className="flex items-center gap-1.5 bg-zinc-800/90 border border-zinc-700 px-2.5 py-1 rounded-full shrink-0">
                  <select
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
                  { id: 'ALL', label: t('allSeasons'), emoji: '🌟' },
                  { id: 'WINTER', label: t('winter'), emoji: '❄️' },
                  { id: 'SPRING', label: t('spring'), emoji: '🌸' },
                  { id: 'SUMMER', label: t('summer'), emoji: '☀️' },
                  { id: 'FALL', label: t('fall'), emoji: '🍁' }
                ].map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setCatalogSeason(s.id)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold shrink-0 transition-all ${
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
                      onClick={() => loadCatalogData(catalogYear, catalogSeason, catalogSort, catalogPage + 1, true)}
                      disabled={catalogLoading}
                      className="px-6 py-2.5 rounded-full bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-xs border border-zinc-700 flex items-center gap-2 transition-all disabled:opacity-50"
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
            <div className="flex items-center gap-2 mb-6">
              <Calendar className="w-6 h-6 text-indigo-400" />
              <h2 className="text-2xl font-black text-white">Coming Soon / Anticipated Releases ({filterAnimeList(upcoming).length})</h2>
            </div>

            {filterAnimeList(upcoming).length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-zinc-500">
                <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                <p className="text-sm mt-3">Loading upcoming releases...</p>
              </div>
            ) : (
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
            )}
          </div>
        ) : (
          /* Normal Netflix Browsing Rows */
          <>
            {/* Top Featured Hero Banner */}
            {activeTab === 'home' && featuredAnime && (
              <HeroBanner
                anime={featuredAnime}
                currentLang={currentLang}
                t={t}
                onPlay={handlePlay}
                onDownload={handleOpenBatchDownload}
                onMoreInfo={setSelectedAnime}
              />
            )}

            {/* Animata Infinite Marquee Highlights Bar */}
            {activeTab === 'home' && (
              <MarqueeTicker 
                currentLang={currentLang}
                isContainer={serverInfo.isContainer}
              />
            )}

            {/* Loading Indicator */}
            {isLoading && (
              <div className="h-96 flex items-center justify-center">
                <Loader2 className="w-12 h-12 text-[#E50914] animate-spin" />
              </div>
            )}

            {/* Horizontal Carousels & Bento Dashboard */}
            {!isLoading && (
              <div className={`space-y-6 ${activeTab === 'home' ? 'relative z-20 -mt-8 md:-mt-12' : 'pt-24'}`}>
                {/* Animata Architecture & System Bento Dashboard */}
                {activeTab === 'home' && (
                  <BentoGrid
                    isContainer={serverInfo.isContainer}
                    containerType={serverInfo.platform === 'linux' ? 'Linux Alpine / Synology NAS' : 'Windows Host'}
                    onOpenArchitectureSettings={() => handleOpenSettings('architecture')}
                    currentLang={currentLang}
                    trendingCount={filteredTrending.length}
                    activeDownloadsCount={downloadTasks.length}
                  />
                )}

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
                    onMoreInfo={setSelectedAnime}
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
                    onMoreInfo={setSelectedAnime}
                    favoriteIds={favoriteIds}
                    onToggleFavorite={handleToggleFavorite}
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
                    onMoreInfo={setSelectedAnime}
                    favoriteIds={favoriteIds}
                    onToggleFavorite={handleToggleFavorite}
                  />
                )}

                {/* 2. Trending Now */}
                {(activeTab === 'home' || activeTab === 'trending') && (
                  <AnimeCarousel
                    title={t('trendingNow')}
                    subtitle={t('trendingNowSub')}
                    icon={Flame}
                    animes={filteredTrending}
                    currentLang={currentLang}
                    onPlay={handlePlay}
                    onDownload={handleOpenBatchDownload}
                    onMoreInfo={setSelectedAnime}
                    favoriteIds={favoriteIds}
                    onToggleFavorite={handleToggleFavorite}
                  />
                )}

                {/* 3. Top Rated Anime */}
                {(activeTab === 'home' || activeTab === 'top-rated') && (
                  <AnimeCarousel
                    title={t('highScoreClassics')}
                    subtitle={t('highScoreClassicsSub')}
                    icon={Trophy}
                    animes={filteredTopRated}
                    currentLang={currentLang}
                    onPlay={handlePlay}
                    onDownload={handleOpenBatchDownload}
                    onMoreInfo={setSelectedAnime}
                    favoriteIds={favoriteIds}
                    onToggleFavorite={handleToggleFavorite}
                  />
                )}

                {/* 4. Popular This Season */}
                {activeTab === 'home' && (
                  <AnimeCarousel
                    title={t('allTimePopular')}
                    subtitle={t('allTimePopularSub')}
                    icon={Star}
                    animes={filteredPopular}
                    currentLang={currentLang}
                    onPlay={handlePlay}
                    onDownload={handleOpenBatchDownload}
                    onMoreInfo={setSelectedAnime}
                    favoriteIds={favoriteIds}
                    onToggleFavorite={handleToggleFavorite}
                  />
                )}

                {/* 5. Coming Soon & Anticipated Releases */}
                {activeTab === 'home' && upcoming.length > 0 && (
                  <AnimeCarousel
                    title={t('upcoming')}
                    subtitle={t('unreleasedNotice')}
                    icon={Calendar}
                    animes={filteredUpcoming}
                    currentLang={currentLang}
                    onPlay={handlePlay}
                    onDownload={handleOpenBatchDownload}
                    onMoreInfo={setSelectedAnime}
                    favoriteIds={favoriteIds}
                    onToggleFavorite={handleToggleFavorite}
                  />
                )}

                {/* 5. Action & Adventure */}
                {(activeTab === 'home' || activeTab === 'Action') && (
                  <AnimeCarousel
                    title={t('actionCarousel')}
                    icon={Swords}
                    animes={filteredAction}
                    currentLang={currentLang}
                    onPlay={handlePlay}
                    onDownload={handleOpenBatchDownload}
                    onMoreInfo={setSelectedAnime}
                    favoriteIds={favoriteIds}
                    onToggleFavorite={handleToggleFavorite}
                  />
                )}

                {/* 6. Sci-Fi & Fantasy */}
                {(activeTab === 'home' || activeTab === 'Fantasy') && (
                  <AnimeCarousel
                    title={t('fantasyCarousel')}
                    icon={Sparkles}
                    animes={filteredFantasy}
                    currentLang={currentLang}
                    onPlay={handlePlay}
                    onDownload={handleOpenBatchDownload}
                    onMoreInfo={setSelectedAnime}
                    favoriteIds={favoriteIds}
                    onToggleFavorite={handleToggleFavorite}
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
