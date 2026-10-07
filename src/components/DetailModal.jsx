// src/components/DetailModal.jsx - Enhanced Anime Details with PV/OP/ED Archive, BT Magnets & Chinese Metadata
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  X, Play, Download, Star, Tv, MonitorPlay, Heart, 
  RefreshCw, Clock, Sparkles, Calendar, Music, Video, 
  Maximize2, Volume2, Film, AlertCircle, Copy, Check, ExternalLink,
  Users, HardDrive, Radio, Languages, Compass, Search, Zap
} from 'lucide-react';

export default function DetailModal({ 
  anime, 
  onClose, 
  onPlay, 
  onOpenBatchDownload, 
  onPlayMpv, 
  isFavorite = false, 
  onToggleFavorite, 
  onSelectAnime,
  currentLang = 'zh-TW',
  hideR18 = true,
  gpuSettings,
  onUpdateGpuSettings,
  t = (k) => k
}) {
  const [audioMode, setAudioMode] = useState('sub');
  const [uploadedEpisodes, setUploadedEpisodes] = useState([]);
  const [isSyncingEpisodes, setIsSyncingEpisodes] = useState(false);
  const [similarAnime, setSimilarAnime] = useState([]);
  const [lastRefreshed, setLastRefreshed] = useState(null);

  // Content Tabs: 'episodes' | 'trailers' | 'themes' | 'torrents'
  const [activeTab, setActiveTab] = useState('episodes');

  // Media Videos (PV, OP, ED)
  const [mediaVideos, setMediaVideos] = useState({ trailers: [], themes: { op: [], ed: [] } });
  const [isLoadingMedia, setIsLoadingMedia] = useState(false);

  // Chinese Metadata & Synopsis
  const [chineseInfo, setChineseInfo] = useState(null);
  const [isLoadingChinese, setIsLoadingChinese] = useState(false);
  const [synopsisLang, setSynopsisLang] = useState('zh'); // 'zh' (Traditional Chinese) | 'orig' (Original English)

  // BitTorrent / Magnet Resources
  const [allTorrents, setAllTorrents] = useState([]);
  const [isLoadingTorrents, setIsLoadingTorrents] = useState(false);
  const [torrentFilter, setTorrentFilter] = useState('all');
  const [copiedMagnetId, setCopiedMagnetId] = useState(null);
  const [customTorrentQuery, setCustomTorrentQuery] = useState('');

  // Dynamic Top Player Media State: null or { type: 'trailer' | 'theme' | 'episode', id, url, title, tag, episode }
  const [activeMedia, setActiveMedia] = useState(null);
  const playerContainerRef = useRef(null);

  if (!anime) return null;

  const title = anime.title?.english || anime.title?.romaji || anime.title?.native || 'Anime Details';
  const nativeTitle = anime.title?.native;
  const backdrop = anime.bannerImage || anime.coverImage?.extraLarge;
  const poster = anime.coverImage?.extraLarge || anime.coverImage?.large;
  const synopsis = anime.description?.replace(/<[^>]*>/g, '') || 'No synopsis provided.';
  
  const totalScheduled = anime.episodes || 12;
  const nextAiring = anime.nextAiringEpisode;
  const isUnreleased = anime.status === 'NOT_YET_RELEASED';

  // 1. Fetch live uploaded episodes
  const loadEpisodes = async (forceRefresh = false) => {
    setIsSyncingEpisodes(true);
    try {
      if (isUnreleased) {
        // Unreleased anime has not aired
        setUploadedEpisodes([]);
        return;
      }

      // If next airing episode is known (e.g. Episode 2 airing soon), max aired episode is episode - 1 (e.g. 1)
      const maxAiredCap = (nextAiring?.episode && nextAiring.episode > 1) 
        ? (nextAiring.episode - 1) 
        : undefined;

      const candidates = [
        anime.title?.romaji,
        anime.title?.english,
        anime.title?.native,
        chineseInfo?.titleZh,
        anime.titleZhTW,
        anime.titleZhCN
      ].filter(Boolean);

      const params = new URLSearchParams();
      if (forceRefresh) params.set('refresh', 'true');
      if (candidates.length > 0) params.set('candidates', JSON.stringify(candidates));
      if (maxAiredCap) params.set('maxAiredCap', String(maxAiredCap));

      const url = `/api/anime/${encodeURIComponent(title)}/episodes?${params.toString()}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.success && Array.isArray(data.uploadedEpisodes) && data.uploadedEpisodes.length > 0) {
        const validatedEpisodes = maxAiredCap 
          ? data.uploadedEpisodes.filter(ep => ep <= maxAiredCap)
          : data.uploadedEpisodes;
        setUploadedEpisodes(validatedEpisodes);
        setLastRefreshed(new Date());
      } else {
        // Fallback for airing titles: calculate based on next airing episode if known
        if (maxAiredCap && maxAiredCap >= 1) {
          setUploadedEpisodes(Array.from({ length: maxAiredCap }, (_, i) => i + 1));
        } else {
          setUploadedEpisodes([]);
        }
      }
    } catch (err) {
      console.warn('Episode sync error:', err);
      setUploadedEpisodes([]);
    } finally {
      setIsSyncingEpisodes(false);
    }
  };

  // 2. Fetch Media Videos (PV, OP, ED)
  const loadMediaVideos = async () => {
    setIsLoadingMedia(true);
    try {
      const romaji = anime.title?.romaji || '';
      const english = anime.title?.english || '';
      const res = await fetch(`/api/anime/${anime.id}/media-videos?romaji=${encodeURIComponent(romaji)}&english=${encodeURIComponent(english)}`);
      const data = await res.json();
      if (data.success) {
        setMediaVideos({
          trailers: data.trailers || [],
          themes: data.themes || { op: [], ed: [] }
        });
      }
    } catch (err) {
      console.warn('Failed to load media videos:', err);
    } finally {
      setIsLoadingMedia(false);
    }
  };

  useEffect(() => {
    loadEpisodes(false);
    loadMediaVideos();
    setActiveMedia(null); // Reset player when changing anime

    // 3. Load "More Like This" recommendations
    async function loadSimilar() {
      try {
        const res = await fetch('/api/recommendations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ favoriteIds: [anime.id], limit: 6 })
        });
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          const filtered = data.data.filter(a => a.id !== anime.id && (!hideR18 || (!a.isAdult && !a.genres?.includes('Hentai'))));
          setSimilarAnime(filtered.slice(0, 6));
        }
      } catch {}
    }

    loadSimilar();
  }, [anime, hideR18]);

  // 3. Fetch Chinese metadata & translation
  useEffect(() => {
    let isCancelled = false;
    if (!anime?.id) return;

    setIsLoadingChinese(true);
    const romaji = anime.title?.romaji || '';
    const native = anime.title?.native || '';
    const english = anime.title?.english || '';
    const desc = synopsis || '';
    const targetLang = currentLang === 'zh-CN' ? 'zh-CN' : 'zh-TW';

    fetch(`/api/anime/${anime.id}/chinese-info?romaji=${encodeURIComponent(romaji)}&native=${encodeURIComponent(native)}&english=${encodeURIComponent(english)}&description=${encodeURIComponent(desc)}&lang=${targetLang}`)
      .then(r => r.json())
      .then(d => {
        if (!isCancelled && d.success) {
          setChineseInfo(d);
        }
      })
      .catch(e => console.warn('Chinese info fetch error:', e))
      .finally(() => {
        if (!isCancelled) setIsLoadingChinese(false);
      });

    return () => { isCancelled = true; };
  }, [anime, currentLang, synopsis]);

  // 4. Fetch BitTorrent / Magnet releases across all alias candidates
  const loadTorrents = async (force = false, explicitQuery = null) => {
    if (!anime) return;
    setIsLoadingTorrents(true);
    try {
      let q = explicitQuery;
      if (!q) {
        const candidates = [
          chineseInfo?.titleZh,
          anime.titleZhTW,
          anime.titleZhCN,
          anime.titleZh,
          anime.title?.native,
          anime.title?.romaji,
          anime.title?.english,
          title
        ].filter(Boolean);
        q = Array.from(new Set(candidates)).join('||');
      }
      const res = await fetch(`/api/torrents?q=${encodeURIComponent(q)}&lang=all&hideR18=${hideR18}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.items)) {
        setAllTorrents(data.items);
      }
    } catch (err) {
      console.warn('Torrents fetch error:', err);
    } finally {
      setIsLoadingTorrents(false);
    }
  };

  const handleCustomTorrentSearch = (e) => {
    if (e) e.preventDefault();
    if (!customTorrentQuery.trim()) {
      loadTorrents(true);
    } else {
      loadTorrents(true, customTorrentQuery.trim());
    }
  };

  useEffect(() => {
    loadTorrents();
  }, [chineseInfo, anime]);

  const filteredTorrents = useMemo(() => {
    if (torrentFilter === 'zh-TW') {
      return allTorrents.filter(r => r.lang === 'zh-TW' || /(繁體|繁体|CHT|BIG5|繁中|HK|TW|簡繁|简繁|雙語|双语)/i.test(r.title));
    }
    if (torrentFilter === 'zh-CN') {
      return allTorrents.filter(r => r.lang === 'zh-CN' || /(簡體|简体|CHS|GB|简中|CN|簡繁|简繁|雙語|双语)/i.test(r.title));
    }
    if (torrentFilter === 'en') {
      return allTorrents.filter(r => r.lang === 'en' || /(English|Eng\s*Sub|\[ENG\]|SubsPlease|Erai-raws|HorribleSubs|Judas|ASW|SubsPlus|ToonsHub|Ironclad|DKB)/i.test(r.title));
    }
    if (torrentFilter === 'raw') {
      return allTorrents.filter(r => r.lang === 'raw' || /(RAW|Raws|Non-Sub|NC-RAW|WEB-DL|AMZN|HIDIVE|U-NEXT|ABEMA|B-Global|CR|Crunchyroll|UNCENSORED|Uncensored)/i.test(r.title));
    }
    return allTorrents;
  }, [allTorrents, torrentFilter]);

  const torrentCounts = useMemo(() => {
    return {
      all: allTorrents.length,
      tw: allTorrents.filter(r => r.lang === 'zh-TW' || /(繁體|繁体|CHT|BIG5|繁中|HK|TW|簡繁|简繁|雙語|双语)/i.test(r.title)).length,
      cn: allTorrents.filter(r => r.lang === 'zh-CN' || /(簡體|简体|CHS|GB|简中|CN|簡繁|简繁|雙語|双语)/i.test(r.title)).length,
      raw: allTorrents.filter(r => r.lang === 'raw' || /(RAW|Raws|Non-Sub|NC-RAW|WEB-DL|AMZN|HIDIVE|U-NEXT|ABEMA|B-Global|CR|Crunchyroll|UNCENSORED|Uncensored)/i.test(r.title)).length,
      en: allTorrents.filter(r => r.lang === 'en' || /(English|Eng\s*Sub|\[ENG\]|SubsPlease|Erai-raws|HorribleSubs|Judas|ASW|SubsPlus|ToonsHub|Ironclad|DKB)/i.test(r.title)).length,
    };
  }, [allTorrents]);

  const handleCopyMagnet = (item) => {
    if (!item?.magnet) return;
    navigator.clipboard.writeText(item.magnet).then(() => {
      setCopiedMagnetId(item.id);
      setTimeout(() => setCopiedMagnetId(null), 2500);
    }).catch(err => console.error('Failed to copy magnet:', err));
  };

  const handleOpenInClient = async (item) => {
    if (!item?.magnet) return;
    try {
      await fetch('/api/torrents/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ magnetUrl: item.magnet })
      });
    } catch (err) {
      console.error('Failed to launch magnet client:', err);
    }
  };

  const [episodeChunk, setEpisodeChunk] = useState(0);
  const CHUNK_SIZE = 50;

  const releasedSet = new Set(uploadedEpisodes);
  const maxEpisodeToShow = Math.max(
    totalScheduled, 
    uploadedEpisodes.length > 0 ? Math.max(...uploadedEpisodes) : 1
  );
  
  const episodesList = useMemo(() => {
    return Array.from({ length: maxEpisodeToShow }, (_, i) => i + 1);
  }, [maxEpisodeToShow]);

  const totalChunks = Math.ceil(maxEpisodeToShow / CHUNK_SIZE);

  const displayedEpisodes = useMemo(() => {
    if (totalChunks <= 1 || episodeChunk === -1) {
      return episodesList;
    }
    const start = episodeChunk * CHUNK_SIZE;
    return episodesList.slice(start, start + CHUNK_SIZE);
  }, [episodesList, totalChunks, episodeChunk]);

  const formatTimeUntilAiring = (secs) => {
    if (!secs) return 'Soon';
    const days = Math.floor(secs / 86400);
    const hours = Math.floor((secs % 86400) / 3600);
    if (days > 0) return `${days}d ${hours}h`;
    return `${hours}h`;
  };

  const handleTogglePlayerFullscreen = () => {
    if (playerContainerRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else {
        playerContainerRef.current.requestFullscreen().catch(() => {});
      }
    }
  };

  const primaryTrailer = mediaVideos.trailers[0] || null;
  const totalThemesCount = (mediaVideos.themes.op?.length || 0) + (mediaVideos.themes.ed?.length || 0);

  return (
    <div 
      className={`fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto ${
        gpuSettings?.enableBackdropBlur ? 'bg-black/85 backdrop-blur-sm' : 'bg-black/92'
      }`}
      onClick={onClose}
    >
      {/* Modal Container */}
      <div 
        className="relative w-full max-w-4xl bg-[#141418] rounded-2xl overflow-hidden shadow-2xl border border-zinc-800 my-auto text-zinc-100 animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Global Modal Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-40 w-9 h-9 rounded-full bg-black/75 hover:bg-black text-white flex items-center justify-center transition-transform hover:scale-110 border border-zinc-700 shadow-xl"
          title="Close Modal (Esc)"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Dynamic Top Container: Video Player OR Backdrop Banner */}
        <div 
          ref={playerContainerRef}
          className="relative h-64 sm:h-80 md:h-96 w-full bg-black overflow-hidden select-none"
        >
          {activeMedia ? (
            /* Active Dynamic Video Player */
            <div className="relative w-full h-full flex items-center justify-center bg-black">
              {/* 1. YouTube Trailer / PV */}
              {activeMedia.type === 'trailer' && (
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${activeMedia.id}?autoplay=1&rel=0&modestbranding=1`}
                  title={activeMedia.title || "Trailer"}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="w-full h-full border-0"
                />
              )}

              {/* 2. AnimeThemes OP / ED Video (WebM) */}
              {activeMedia.type === 'theme' && (
                <video
                  src={activeMedia.url}
                  controls
                  autoPlay
                  playsInline
                  disableRemotePlayback
                  className="w-full h-full object-contain bg-black [transform:translateZ(0)]"
                />
              )}

              {/* Video Overlay Badges & Controls */}
              <div className="absolute top-3 left-3 z-30 flex items-center gap-2 pointer-events-auto">
                <div className={`${
                  gpuSettings?.enableBackdropBlur ? 'bg-black/80 backdrop-blur-md' : 'bg-zinc-900/95'
                } px-3 py-1 rounded-full border border-zinc-700 text-xs font-bold text-white flex items-center gap-2 shadow-lg`}>
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-zinc-400 uppercase text-[10px] tracking-wider">{activeMedia.tag || activeMedia.type}:</span>
                  <span className="truncate max-w-[160px] sm:max-w-xs">{activeMedia.title}</span>
                </div>

                {/* In-player iGPU / AI Upscale mode switcher */}
                <button
                  type="button"
                  onClick={() => onUpdateGpuSettings?.({ enableUpscale: !gpuSettings?.enableUpscale })}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border transition-all shadow-md ${
                    gpuSettings?.enableUpscale
                      ? 'bg-amber-600/30 text-amber-300 border-amber-500/50 hover:bg-amber-600/40'
                      : 'bg-emerald-600/30 text-emerald-300 border-emerald-500/50 hover:bg-emerald-600/40'
                  }`}
                  title={gpuSettings?.enableUpscale ? 'AI 升頻中 (點擊切換為 iGPU 省電模式)' : 'iGPU 省電模式 (點擊開啟 AI 升頻)'}
                >
                  {gpuSettings?.enableUpscale ? <Sparkles className="w-3.5 h-3.5 text-amber-400" /> : <Zap className="w-3.5 h-3.5 text-emerald-400" />}
                  <span className="hidden sm:inline">{gpuSettings?.enableUpscale ? 'AI 升頻 (3D)' : '⚡ iGPU 省電'}</span>
                </button>
              </div>

              {/* Player Top Right Controls */}
              <div className="absolute top-3 right-14 z-30 flex items-center gap-2">
                <button
                  onClick={handleTogglePlayerFullscreen}
                  className="w-8 h-8 rounded-full bg-black/80 hover:bg-zinc-800 text-white flex items-center justify-center transition-transform hover:scale-105 border border-zinc-700 shadow-md"
                  title="Toggle Fullscreen"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setActiveMedia(null)}
                  className="w-8 h-8 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center transition-transform hover:scale-105 shadow-md font-bold"
                  title="Close Video Preview"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            /* Idle Backdrop Image Banner */
            <>
              <img
                src={backdrop}
                alt={title}
                className="w-full h-full object-cover object-center"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#141418] via-[#141418]/60 to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-r from-[#141418] via-transparent to-transparent" />

              {/* Action Buttons over Backdrop */}
              <div className="absolute bottom-6 left-6 right-6 flex flex-wrap items-end justify-between gap-4">
                <div className="max-w-xl">
                  {(() => {
                    if (currentLang === 'ja') {
                      const jaTitle = anime.title?.native || anime.title?.romaji || anime.title?.english || 'Anime';
                      const romajiOrEn = anime.title?.romaji && anime.title?.romaji !== jaTitle ? anime.title.romaji : (anime.title?.english && anime.title.english !== jaTitle ? anime.title.english : null);
                      return (
                        <>
                          <h2 className="text-2xl sm:text-4xl font-black text-white drop-shadow-md leading-tight">
                            {jaTitle}
                          </h2>
                          {romajiOrEn && (
                            <p className="text-xs sm:text-sm text-zinc-400 font-medium mt-1 drop-shadow">
                              {romajiOrEn}
                            </p>
                          )}
                        </>
                      );
                    }

                    const precomputedZh = currentLang === 'zh-CN'
                      ? (anime.titleZhCN || anime.titleZh)
                      : (anime.titleZhTW || anime.titleZh);
                    const activeZhTitle = (currentLang === 'zh-TW' || currentLang === 'zh-CN')
                      ? (chineseInfo?.titleZh || precomputedZh)
                      : null;

                    if (activeZhTitle) {
                      return (
                        <>
                          <h2 className="text-2xl sm:text-4xl font-black text-white drop-shadow-md leading-tight">
                            {activeZhTitle}
                          </h2>
                          <p className="text-xs sm:text-sm text-zinc-300 font-medium mt-1 drop-shadow flex items-center gap-2">
                            <span>{title}</span>
                            {nativeTitle && nativeTitle !== title && (
                              <span className="text-zinc-500">/ {nativeTitle}</span>
                            )}
                          </p>
                        </>
                      );
                    }

                    return (
                      <>
                        {nativeTitle && (
                          <p className="text-xs sm:text-sm text-zinc-400 font-medium mb-1 drop-shadow">
                            {nativeTitle}
                          </p>
                        )}
                        <h2 className="text-2xl sm:text-4xl font-black text-white drop-shadow-md leading-tight">
                          {title}
                        </h2>
                      </>
                    );
                  })()}
                </div>

                {/* Primary Action Buttons */}
                <div className="flex flex-wrap items-center gap-2.5">
                  {/* Play Button or Trailer Button for Unreleased */}
                  {uploadedEpisodes.length > 0 ? (
                    <button
                      onClick={() => onPlay(
                        chineseInfo?.titleZh 
                          ? { ...anime, titleZh: chineseInfo.titleZh, titleZhTW: chineseInfo.titleZh, titleZhCN: chineseInfo.titleZh } 
                          : anime, 
                        uploadedEpisodes[0] || 1, 
                        audioMode
                      )}
                      className="flex items-center gap-2 bg-white hover:bg-zinc-200 text-black font-bold px-5 py-2.5 rounded-lg shadow-lg transition-transform hover:scale-105"
                    >
                      <Play className="w-4 h-4 fill-black" />
                      <span>{t('play')} {currentLang === 'en' ? `Ep ${uploadedEpisodes[0] || 1}` : currentLang === 'ja' ? `第 ${uploadedEpisodes[0] || 1} 話` : `第 ${uploadedEpisodes[0] || 1} 集`}</span>
                    </button>
                  ) : primaryTrailer ? (
                    <button
                      onClick={() => setActiveMedia({
                        type: 'trailer',
                        id: primaryTrailer.id,
                        title: primaryTrailer.title,
                        tag: 'PV'
                      })}
                      className="flex items-center gap-2 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-bold px-5 py-2.5 rounded-lg shadow-lg shadow-red-600/30 transition-transform hover:scale-105 text-xs sm:text-sm"
                      title="Play official Promotional Video / Trailer"
                    >
                      <Film className="w-4 h-4" />
                      <span>{t('trailersTab')}</span>
                    </button>
                  ) : (
                    <button
                      disabled
                      className="flex items-center gap-2 bg-zinc-800 text-zinc-400 font-bold px-5 py-2.5 rounded-lg opacity-75 cursor-not-allowed text-xs sm:text-sm border border-zinc-700"
                    >
                      <Calendar className="w-4 h-4 text-indigo-400" />
                      <span>{t('statusUpcoming')}</span>
                    </button>
                  )}

                  {/* Favorite Button */}
                  <button
                    onClick={() => onToggleFavorite && onToggleFavorite(anime)}
                    className={`p-2.5 rounded-lg border transition-all ${
                      isFavorite 
                        ? 'bg-red-600/20 text-red-500 border-red-500/50 hover:bg-red-600/30' 
                        : 'bg-zinc-800/80 text-zinc-300 border-zinc-700 hover:text-white hover:bg-zinc-700'
                    }`}
                    title={isFavorite ? t('removeFromFavorites') : t('addToFavorites')}
                  >
                    <Heart className={`w-5 h-5 ${isFavorite ? 'fill-red-500' : ''}`} />
                  </button>

                  {/* Batch Download */}
                  {uploadedEpisodes.length > 0 && (
                    <button
                      onClick={() => onOpenBatchDownload(anime, audioMode)}
                      className="flex items-center gap-2 font-bold px-4 py-2.5 rounded-lg shadow-lg transition-transform text-xs sm:text-sm bg-[#E50914] hover:bg-[#B81D24] text-white shadow-red-600/30 hover:scale-105"
                    >
                      <Download className="w-4 h-4" />
                      <span>{t('batchDownload')}</span>
                    </button>
                  )}

                  {/* Launch MPV */}
                  {uploadedEpisodes.length > 0 && (
                    <button
                      onClick={() => onPlayMpv(anime, uploadedEpisodes[0] || 1, audioMode)}
                      className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium px-3.5 py-2.5 rounded-lg border border-zinc-700 transition-transform hover:scale-105 text-xs sm:text-sm"
                      title={t('playExternalMpv')}
                    >
                      <MonitorPlay className="w-4 h-4 text-emerald-400" />
                      <span className="hidden sm:inline">MPV</span>
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Details & Metadata Section */}
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Left 2 Cols: Details & Synopsis */}
            <div className="md:col-span-2 space-y-4">
              <div className="flex flex-wrap items-center gap-3 text-xs font-semibold">
                {anime.averageScore && (
                  <span className="text-emerald-400 flex items-center gap-1 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30">
                    <Star className="w-3.5 h-3.5 fill-emerald-400" />
                    {anime.averageScore}% Match
                  </span>
                )}
                {anime.seasonYear && <span className="text-zinc-400">{anime.seasonYear}</span>}
                {anime.startDate?.year && (
                  <span className="text-indigo-400 flex items-center gap-1 bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-500/30">
                    <Calendar className="w-3.5 h-3.5" />
                    Premieres {anime.startDate.year}{anime.startDate.month ? `-${String(anime.startDate.month).padStart(2, '0')}` : ''}
                  </span>
                )}
                <span className="text-zinc-500">•</span>
                <span className="text-zinc-300 font-medium">
                  {uploadedEpisodes.length > 0 
                    ? `${uploadedEpisodes.length} Released / ${totalScheduled} Planned` 
                    : isUnreleased 
                    ? `0 Released / ${totalScheduled} Planned` 
                    : `${totalScheduled} Episodes`}
                </span>
                {anime.status && (
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                    anime.status === 'RELEASING' 
                      ? 'bg-amber-950/80 text-amber-400 border border-amber-600/30' 
                      : anime.status === 'NOT_YET_RELEASED'
                      ? 'bg-indigo-950/80 text-indigo-400 border border-indigo-600/30'
                      : 'bg-zinc-800 text-zinc-300'
                  }`}>
                    {anime.status === 'NOT_YET_RELEASED' ? 'COMING SOON' : anime.status}
                  </span>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                    {t('overview') || 'Overview'}:
                  </span>
                  {chineseInfo?.summaryZh && (
                    <div className="flex items-center gap-1 bg-zinc-900/90 rounded-lg p-0.5 border border-zinc-800 text-[11px]">
                      <button
                        onClick={() => setSynopsisLang('zh')}
                        className={`px-2 py-0.5 rounded font-bold transition-colors ${
                          synopsisLang === 'zh' ? 'bg-[#E50914] text-white shadow' : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        繁體中文
                      </button>
                      <button
                        onClick={() => setSynopsisLang('orig')}
                        className={`px-2 py-0.5 rounded font-bold transition-colors ${
                          synopsisLang === 'orig' ? 'bg-[#E50914] text-white shadow' : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        English
                      </button>
                    </div>
                  )}
                </div>

                <p className="text-sm text-zinc-300 leading-relaxed max-w-2xl line-clamp-4">
                  {synopsisLang === 'zh' && chineseInfo?.summaryZh ? chineseInfo.summaryZh : synopsis}
                </p>
                {isLoadingChinese && !chineseInfo?.summaryZh && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-400">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    <span>{t('loadingChineseMeta')}</span>
                  </div>
                )}
              </div>

              {/* Audio Mode Toggle */}
              <div className="pt-2 flex items-center gap-4">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Audio Mode:</span>
                <div className="inline-flex rounded-lg p-0.5 bg-zinc-900 border border-zinc-800">
                  <button
                    onClick={() => setAudioMode('sub')}
                    className={`px-3 py-1 rounded text-xs font-bold transition-colors ${
                      audioMode === 'sub' ? 'bg-[#E50914] text-white shadow' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    SUB (Japanese)
                  </button>
                  <button
                    onClick={() => setAudioMode('dub')}
                    className={`px-3 py-1 rounded text-xs font-bold transition-colors ${
                      audioMode === 'dub' ? 'bg-[#E50914] text-white shadow' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    DUB (English)
                  </button>
                </div>
              </div>
            </div>

            {/* Right Col: Poster & Attributes */}
            <div className="space-y-3 border-t md:border-t-0 md:border-l border-zinc-800 pt-4 md:pt-0 md:pl-6 text-xs text-zinc-400">
              {anime.genres && (
                <div>
                  <span className="text-zinc-500 block mb-1 font-semibold uppercase text-[10px]">Genres:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {anime.genres.map(g => (
                      <span key={g} className="bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded-full text-[11px]">
                        {g}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {anime.duration && (
                <div>
                  <span className="text-zinc-500 font-semibold uppercase text-[10px]">Duration:</span>
                  <span className="text-zinc-300 ml-1.5">{anime.duration} mins / ep</span>
                </div>
              )}
              {nextAiring && (
                <div className="bg-amber-950/30 border border-amber-600/30 p-2.5 rounded-lg text-amber-300">
                  <span className="block font-bold text-[11px] mb-0.5 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    Episode {nextAiring.episode} Airing Soon
                  </span>
                  <span className="text-[10px] text-zinc-300">
                    Airs in {formatTimeUntilAiring(nextAiring.timeUntilAiring)}
                  </span>
                </div>
              )}
              {isUnreleased && (
                <div className="bg-indigo-950/30 border border-indigo-600/30 p-2.5 rounded-lg text-indigo-300">
                  <span className="block font-bold text-[11px] mb-0.5 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    Upcoming Anime Release
                  </span>
                  <span className="text-[10px] text-zinc-300">
                    {anime.startDate?.year 
                      ? `Expected Premiere: ${anime.startDate.year}${anime.startDate.month ? '/' + anime.startDate.month : ''}`
                      : 'Broadcast date to be announced'}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Navigation Tabs Bar for Content Archive */}
          <div className="mt-8 pt-4 border-t border-zinc-800 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 bg-zinc-900/90 p-1 rounded-xl border border-zinc-800 flex-wrap">
              <button
                onClick={() => setActiveTab('episodes')}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'episodes'
                    ? 'bg-[#E50914] text-white shadow-md'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Tv className="w-3.5 h-3.5" />
                <span>{t('episodesTab')} ({uploadedEpisodes.length})</span>
              </button>

              <button
                onClick={() => setActiveTab('trailers')}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'trailers'
                    ? 'bg-rose-600 text-white shadow-md'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Film className="w-3.5 h-3.5" />
                <span>{t('trailersTab')} ({mediaVideos.trailers.length})</span>
              </button>

              <button
                onClick={() => setActiveTab('themes')}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'themes'
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Music className="w-3.5 h-3.5" />
                <span>{t('themesTab')} ({totalThemesCount})</span>
              </button>

              <button
                onClick={() => {
                  setActiveTab('torrents');
                  if (allTorrents.length === 0 && !isLoadingTorrents) {
                    loadTorrents(true);
                  }
                }}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'torrents'
                    ? 'bg-amber-600 text-white shadow-md'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Radio className="w-3.5 h-3.5 text-amber-400" />
                <span>{t('btTab')} ({torrentCounts.all})</span>
              </button>
            </div>

            {/* Actions aligned to right */}
            {activeTab === 'torrents' && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => loadTorrents()}
                  disabled={isLoadingTorrents}
                  className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white px-2.5 py-1 rounded bg-zinc-800/80 hover:bg-zinc-700 transition-colors"
                  title="Refresh BitTorrent search results"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${isLoadingTorrents ? 'animate-spin' : ''}`} />
                  <span>{isLoadingTorrents ? 'Searching...' : 'Refresh'}</span>
                </button>
              </div>
            )}

            {/* Actions aligned to right */}
            {activeTab === 'episodes' && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => loadEpisodes(true)}
                  disabled={isSyncingEpisodes}
                  className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white px-2.5 py-1 rounded bg-zinc-800/80 hover:bg-zinc-700 transition-colors"
                  title="Check for newly released episodes now"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${isSyncingEpisodes ? 'animate-spin' : ''}`} />
                  <span>{isSyncingEpisodes ? 'Checking...' : 'Refresh'}</span>
                </button>

                {uploadedEpisodes.length > 0 && (
                  <button
                    onClick={() => onOpenBatchDownload(anime, audioMode)}
                    className="text-xs text-[#E50914] hover:underline font-semibold flex items-center gap-1 ml-2"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download All ({uploadedEpisodes.length})</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* TAB 1: EPISODES VIEW */}
          {activeTab === 'episodes' && (
            <div className="mt-4">
              {isUnreleased && uploadedEpisodes.length === 0 ? (
                <div className="py-8 px-4 flex flex-col items-center justify-center text-center bg-zinc-900/40 rounded-xl border border-zinc-800/80">
                  <Calendar className="w-10 h-10 text-indigo-400 mb-2" />
                  <p className="text-sm font-bold text-zinc-200">Broadcast Not Started Yet</p>
                  <p className="text-xs text-zinc-400 max-w-sm mt-1">
                    No full episodes have released yet. You can preview the official Promotional Video (PV) above!
                  </p>
                  {primaryTrailer && (
                    <button
                      onClick={() => setActiveMedia({
                        type: 'trailer',
                        id: primaryTrailer.id,
                        title: primaryTrailer.title,
                        tag: 'PV'
                      })}
                      className="mt-3 flex items-center gap-1.5 bg-rose-600 hover:bg-rose-500 text-white font-bold px-4 py-1.5 rounded-lg text-xs shadow-md"
                    >
                      <Film className="w-3.5 h-3.5" />
                      <span>Watch Official Teaser / PV</span>
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  {/* Episode Range Tabs (for long anime like Naruto, One Piece) */}
                  {totalChunks > 1 && (
                    <div className="flex items-center gap-1.5 mb-3 overflow-x-auto pb-1 custom-scrollbar">
                      {Array.from({ length: totalChunks }, (_, idx) => {
                        const fromEp = idx * CHUNK_SIZE + 1;
                        const toEp = Math.min((idx + 1) * CHUNK_SIZE, maxEpisodeToShow);
                        return (
                          <button
                            key={idx}
                            onClick={() => setEpisodeChunk(idx)}
                            className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors whitespace-nowrap ${
                              episodeChunk === idx
                                ? 'bg-[#E50914] text-white shadow'
                                : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300'
                            }`}
                          >
                            {fromEp}-{toEp}
                          </button>
                        );
                      })}
                      <button
                        onClick={() => setEpisodeChunk(-1)}
                        className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors whitespace-nowrap ${
                          episodeChunk === -1
                            ? 'bg-[#E50914] text-white shadow'
                            : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300'
                        }`}
                      >
                        {currentLang === 'en' ? `All (${maxEpisodeToShow})` : currentLang === 'ja' ? `全エピソード (${maxEpisodeToShow})` : `全部 (${maxEpisodeToShow})`}
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5 max-h-72 overflow-y-auto custom-scrollbar pr-2">
                    {displayedEpisodes.map((ep) => {
                    const isReleased = releasedSet.has(ep);
                    return (
                      <div
                        key={ep}
                        className={`group/ep relative border rounded-xl p-2.5 flex items-center justify-between transition-all ${
                          isReleased
                            ? 'bg-zinc-900/90 hover:bg-zinc-800 border-zinc-800 hover:border-zinc-700 cursor-pointer shadow-sm hover:scale-[1.02]'
                            : 'bg-zinc-950/60 border-zinc-900/60 opacity-60 cursor-not-allowed'
                        }`}
                        onClick={() => {
                          if (isReleased) {
                            onPlay(
                              chineseInfo?.titleZh 
                                ? { ...anime, titleZh: chineseInfo.titleZh, titleZhTW: chineseInfo.titleZh, titleZhCN: chineseInfo.titleZh } 
                                : anime, 
                              ep, 
                              audioMode
                            );
                          }
                        }}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 transition-colors ${
                            isReleased 
                              ? 'bg-zinc-800 group-hover/ep:bg-[#E50914] text-white' 
                              : 'bg-zinc-900 text-zinc-500'
                          }`}>
                            {ep}
                          </div>
                          <div className="truncate">
                            <span className={`text-xs font-semibold block truncate ${
                              isReleased ? 'text-zinc-200 group-hover/ep:text-white' : 'text-zinc-500'
                            }`}>
                              {currentLang === 'en' ? `Ep ${ep}` : currentLang === 'ja' ? `第 ${ep} 話` : `第 ${ep} 集`}
                            </span>
                            {!isReleased && (
                              <span className="text-[10px] text-amber-500 font-medium block">
                                {currentLang === 'en' ? 'Airing Soon' : currentLang === 'ja' ? '近日公開' : '即將開播'}
                              </span>
                            )}
                          </div>
                        </div>

                        {isReleased && (
                          <div className="flex items-center gap-1 opacity-0 group-hover/ep:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenBatchDownload(anime, audioMode, `${ep}`);
                              }}
                              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-700"
                              title={`Download Episode ${ep}`}
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: TRAILERS & PV VIEW */}
          {activeTab === 'trailers' && (
            <div className="mt-4">
              {mediaVideos.trailers.length === 0 ? (
                <div className="py-8 text-center bg-zinc-900/40 rounded-xl border border-zinc-800 text-zinc-400 text-xs">
                  <Film className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                  <p>No official trailers currently cataloged for this title.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {mediaVideos.trailers.map((tr) => (
                    <div
                      key={tr.id}
                      onClick={() => setActiveMedia({
                        type: 'trailer',
                        id: tr.id,
                        title: tr.title,
                        tag: 'PV'
                      })}
                      className="group/pv cursor-pointer bg-zinc-900/80 hover:bg-zinc-800/90 rounded-xl overflow-hidden border border-zinc-800 hover:border-rose-500/50 transition-all shadow-md hover:scale-[1.02]"
                    >
                      <div className="aspect-video relative overflow-hidden bg-black">
                        {tr.thumbnail ? (
                          <img
                            src={tr.thumbnail}
                            alt={tr.title}
                            className="w-full h-full object-cover group-hover/pv:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-zinc-950">
                            <Film className="w-8 h-8 text-zinc-600" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/40 group-hover/pv:bg-black/20 flex items-center justify-center transition-colors">
                          <div className="w-10 h-10 rounded-full bg-red-600/90 group-hover/pv:bg-red-500 text-white flex items-center justify-center shadow-lg transition-transform group-hover/pv:scale-110">
                            <Play className="w-5 h-5 fill-white ml-0.5" />
                          </div>
                        </div>
                        <span className="absolute bottom-1.5 right-1.5 bg-black/80 text-[10px] text-white px-1.5 py-0.5 rounded font-bold">
                          YouTube PV
                        </span>
                      </div>
                      <div className="p-3">
                        <h4 className="text-xs font-bold text-white group-hover/pv:text-rose-400 truncate">
                          {tr.title}
                        </h4>
                        <p className="text-[10px] text-zinc-400 mt-0.5">
                          Click to play teaser video above
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: THEMES (OP & ED) VIEW */}
          {activeTab === 'themes' && (
            <div className="mt-4 space-y-4">
              {totalThemesCount === 0 ? (
                <div className="py-8 text-center bg-zinc-900/40 rounded-xl border border-zinc-800 text-zinc-400 text-xs">
                  <Music className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                  <p>Opening and ending theme videos have not been archived for this title yet.</p>
                </div>
              ) : (
                <>
                  {/* Openings (OP) */}
                  {mediaVideos.themes.op.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-purple-400 flex items-center gap-1.5 mb-2.5">
                        <Music className="w-3.5 h-3.5" />
                        <span>Opening Themes ({mediaVideos.themes.op.length})</span>
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                        {mediaVideos.themes.op.map((op) => (
                          <div
                            key={op.id || op.tag}
                            onClick={() => setActiveMedia({
                              type: 'theme',
                              url: op.videoUrl,
                              title: op.title,
                              tag: op.tag
                            })}
                            className="group/theme cursor-pointer bg-zinc-900/80 hover:bg-zinc-800 rounded-xl p-3 border border-zinc-800 hover:border-purple-500/50 transition-all flex items-center justify-between"
                          >
                            <div className="min-w-0 pr-2">
                              <span className="text-[10px] font-black text-purple-400 bg-purple-950/80 px-2 py-0.5 rounded border border-purple-500/30">
                                {op.tag}
                              </span>
                              <p className="text-xs font-bold text-white truncate mt-1 group-hover/theme:text-purple-300">
                                "{op.title}"
                              </p>
                              {op.artist && (
                                <p className="text-[10px] text-zinc-400 truncate mt-0.5">
                                  {op.artist}
                                </p>
                              )}
                            </div>
                            <div className="w-8 h-8 rounded-full bg-purple-600/20 group-hover/theme:bg-purple-600 text-purple-400 group-hover/theme:text-white flex items-center justify-center shrink-0 transition-colors">
                              <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Endings (ED) */}
                  {mediaVideos.themes.ed.length > 0 && (
                    <div className="pt-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-pink-400 flex items-center gap-1.5 mb-2.5">
                        <Music className="w-3.5 h-3.5" />
                        <span>Ending Themes ({mediaVideos.themes.ed.length})</span>
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                        {mediaVideos.themes.ed.map((ed) => (
                          <div
                            key={ed.id || ed.tag}
                            onClick={() => setActiveMedia({
                              type: 'theme',
                              url: ed.videoUrl,
                              title: ed.title,
                              tag: ed.tag
                            })}
                            className="group/theme cursor-pointer bg-zinc-900/80 hover:bg-zinc-800 rounded-xl p-3 border border-zinc-800 hover:border-pink-500/50 transition-all flex items-center justify-between"
                          >
                            <div className="min-w-0 pr-2">
                              <span className="text-[10px] font-black text-pink-400 bg-pink-950/80 px-2 py-0.5 rounded border border-pink-500/30">
                                {ed.tag}
                              </span>
                              <p className="text-xs font-bold text-white truncate mt-1 group-hover/theme:text-pink-300">
                                "{ed.title}"
                              </p>
                              {ed.artist && (
                                <p className="text-[10px] text-zinc-400 truncate mt-0.5">
                                  {ed.artist}
                                </p>
                              )}
                            </div>
                            <div className="w-8 h-8 rounded-full bg-pink-600/20 group-hover/theme:bg-pink-600 text-pink-400 group-hover/theme:text-white flex items-center justify-center shrink-0 transition-colors">
                              <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* TAB 4: BITTORRENT & MAGNETS VIEW */}
          {activeTab === 'torrents' && (
            <div className="mt-4 space-y-3">
              {/* Torrent Search Bar & Refresh */}
              <div className="flex items-center justify-between flex-wrap gap-2.5 bg-zinc-900/80 p-3 rounded-xl border border-zinc-800">
                <form onSubmit={handleCustomTorrentSearch} className="flex items-center gap-2 flex-1 min-w-[260px]">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={customTorrentQuery}
                      onChange={(e) => setCustomTorrentQuery(e.target.value)}
                      placeholder={t('searchTorrentPlaceholder')}
                      className="w-full bg-black/60 border border-zinc-700/80 rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
                    />
                    {customTorrentQuery && (
                      <button
                        type="button"
                        onClick={() => { setCustomTorrentQuery(''); loadTorrents(true); }}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-black font-bold text-xs rounded-xl transition-all shadow-md flex items-center gap-1.5 shrink-0"
                  >
                    <Search className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span>{t('searchTorrentBtn')}</span>
                  </button>
                </form>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => loadTorrents(true, customTorrentQuery || null)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-xl text-xs font-semibold border border-zinc-700 transition-colors"
                    title="Refresh torrents"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingTorrents ? 'animate-spin text-amber-400' : ''}`} />
                    <span>Refresh</span>
                  </button>
                </div>
              </div>

              {/* Filter Pills */}
              <div className="flex items-center justify-between flex-wrap gap-2 bg-zinc-900/60 p-2.5 rounded-xl border border-zinc-800">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider mr-1">
                    {t('subtitles')}:
                  </span>
                  {[
                    { id: 'all', label: t('allTorrents'), count: torrentCounts.all },
                    { id: 'zh-TW', label: t('filterTW'), count: torrentCounts.tw },
                    { id: 'zh-CN', label: t('filterCN'), count: torrentCounts.cn },
                    { id: 'raw', label: t('filterRAW'), count: torrentCounts.raw },
                    { id: 'en', label: t('filterEN'), count: torrentCounts.en }
                  ].map((flt) => (
                    <button
                      key={flt.id}
                      onClick={() => setTorrentFilter(flt.id)}
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${
                        torrentFilter === flt.id
                          ? 'bg-amber-500 text-black font-bold shadow-md shadow-amber-500/20'
                          : 'bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700 hover:text-white'
                      }`}
                    >
                      <span>{flt.label}</span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                        torrentFilter === flt.id ? 'bg-black/30 text-black font-bold' : 'bg-zinc-700 text-zinc-300'
                      }`}>
                        {flt.count}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="text-[11px] text-zinc-400 font-mono">
                  DMHY (動漫花園) & Nyaa
                </div>
              </div>

              {/* Loading State */}
              {isLoadingTorrents ? (
                <div className="py-12 flex flex-col items-center justify-center text-center bg-zinc-900/40 rounded-xl border border-zinc-800 text-zinc-400 text-xs">
                  <RefreshCw className="w-8 h-8 text-amber-400 animate-spin mb-3" />
                  <p className="font-semibold text-zinc-300">{t('loadingTorrents')}</p>
                </div>
              ) : filteredTorrents.length === 0 ? (
                <div className="py-12 text-center bg-zinc-900/40 rounded-xl border border-zinc-800 text-zinc-400 text-xs">
                  <AlertCircle className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                  <p className="font-semibold text-zinc-300">
                    {torrentCounts.all > 0 
                      ? `此分類目前無資源（其他分類共有 ${torrentCounts.all} 個種子）`
                      : t('noTorrentsFound')}
                  </p>
                  {torrentCounts.all > 0 && (
                    <button
                      onClick={() => setTorrentFilter('all')}
                      className="mt-3 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-lg text-xs transition-colors"
                    >
                      查看全部資源 ({torrentCounts.all})
                    </button>
                  )}
                  {torrentCounts.all === 0 && (
                    <p className="text-[11px] text-zinc-500 mt-1">Try checking back later for upcoming fansub releases.</p>
                  )}
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto custom-scrollbar pr-1">
                  {filteredTorrents.map((tItem) => {
                    const isCopied = copiedMagnetId === tItem.id;
                    const isTw = tItem.lang === 'zh-TW' || /(繁體|繁体|CHT|BIG5|繁中|HK|TW)/i.test(tItem.title);
                    const isCn = tItem.lang === 'zh-CN' || /(簡體|简体|CHS|GB|简中|CN)/i.test(tItem.title);
                    
                    return (
                      <div
                        key={tItem.id}
                        className="p-3 bg-zinc-900/80 hover:bg-zinc-800/90 rounded-xl border border-zinc-800 hover:border-amber-500/40 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm group/tor"
                      >
                        <div className="min-w-0 flex-1 space-y-1.5">
                          {/* Badges Row */}
                          <div className="flex items-center gap-2 flex-wrap text-[10px] font-bold">
                            <span className="px-2 py-0.5 rounded bg-zinc-800 text-amber-400 border border-amber-500/30">
                              {tItem.fansub || 'Fansub'}
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                              {tItem.resolution}
                            </span>
                            {isTw && (
                              <span className="px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-500/30">
                                繁中 TW/HK
                              </span>
                            )}
                            {isCn && !isTw && (
                              <span className="px-2 py-0.5 rounded bg-cyan-950/80 text-cyan-400 border border-cyan-500/30">
                                簡中 CHS
                              </span>
                            )}
                            {tItem.size && tItem.size !== 'Unknown' && (
                              <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                                💾 {tItem.size}
                              </span>
                            )}
                            {tItem.seeders !== null && tItem.seeders !== undefined && (
                              <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-emerald-400 flex items-center gap-0.5">
                                <Users className="w-3 h-3" />
                                {tItem.seeders} seeds
                              </span>
                            )}
                            <span className="text-zinc-500 font-normal">
                              {tItem.source} • {tItem.pubDate}
                            </span>
                          </div>

                          {/* Full Title */}
                          <p className="text-xs font-medium text-zinc-200 group-hover/tor:text-white line-clamp-2 leading-relaxed">
                            {tItem.title}
                          </p>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                          <button
                            onClick={() => handleCopyMagnet(tItem)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                              isCopied
                                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white border border-zinc-700'
                            }`}
                            title="Copy Magnet link to clipboard"
                          >
                            {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                            <span>{isCopied ? t('copied') : t('copyMagnet')}</span>
                          </button>

                          <button
                            onClick={() => handleOpenInClient(tItem)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white shadow-md shadow-amber-600/20 transition-all hover:scale-105"
                            title="Launch in default BitTorrent client (qBittorrent, etc.)"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>{t('openInClient')}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* More Like This (Personalized Recommendations) Section */}
          {similarAnime.length > 0 && (
            <div className="mt-8 pt-6 border-t border-zinc-800">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <h3 className="text-base font-bold text-white">{t('similarRecommendations')}</h3>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                {similarAnime.map((sim) => {
                  const simTitle = sim.title?.english || sim.title?.romaji || 'Anime';
                  const simCover = sim.coverImage?.large || sim.coverImage?.medium;
                  return (
                    <div
                      key={sim.id}
                      onClick={() => onSelectAnime && onSelectAnime(sim)}
                      className="group/sim cursor-pointer bg-zinc-900/80 rounded-xl overflow-hidden border border-zinc-800/80 hover:border-zinc-700 transition-all hover:scale-105"
                    >
                      <div className="aspect-[2/3] relative overflow-hidden bg-zinc-950">
                        {simCover && (
                          <img
                            src={simCover}
                            alt={simTitle}
                            className="w-full h-full object-cover group-hover/sim:scale-110 transition-transform duration-300"
                          />
                        )}
                        {sim.averageScore && (
                          <div className="absolute top-1.5 right-1.5 bg-black/80 px-1.5 py-0.5 rounded text-[10px] font-bold text-emerald-400 flex items-center gap-0.5">
                            <Star className="w-2.5 h-2.5 fill-emerald-400" />
                            {sim.averageScore}%
                          </div>
                        )}
                      </div>
                      <div className="p-2">
                        <h4 className="text-xs font-semibold text-zinc-200 truncate group-hover/sim:text-white">
                          {simTitle}
                        </h4>
                        <p className="text-[10px] text-zinc-500 mt-0.5">
                          {sim.genres?.[0] || 'Anime'}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
