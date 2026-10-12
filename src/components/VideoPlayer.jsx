import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import { 
  X, Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX, 
  Maximize, Minimize, SkipBack, SkipForward, MonitorPlay, 
  Settings, Loader2, Copy, Check, Link2, ExternalLink, SlidersHorizontal,
  Subtitles, Upload, FileUp, Tv, Smartphone, Zap, Sparkles,
  MoreVertical, Film, AlertTriangle, Radio, ChevronDown
} from 'lucide-react';
import { getPlatformInfo, getExternalPlayerLinks } from '../utils/platform.js';
import { toCachedImageUrl } from '../utils/image.js';


const isTradZh = (lang = '') => {
  if (/\bdutch\b/i.test(lang)) return false;
  return /(繁|繁體|繁体|traditional|\b(cht|tc|tw|hk|zh-tw|zh-hk)\b)/i.test(lang);
};

const isSimpZh = (lang = '') => {
  return /(简|簡|简体|簡體|simplified|\b(chs|sc|cn|zh-cn|zh-sg)\b)/i.test(lang);
};

const isJapanese = (lang = '') => {
  return /(japanese|japan|\b(ja|jp|jpn)\b|日本語)/i.test(lang);
};

// Client-side ASS/SSA to WebVTT converter
function convertAssToVtt(assContent) {
  const lines = (assContent || '').split(/\r?\n/);
  const cues = [];
  let inEvents = false;
  let formatKeys = ['Start', 'End', 'Text'];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[Events]')) {
      inEvents = true;
      continue;
    }
    if (inEvents && trimmed.startsWith('Format:')) {
      formatKeys = trimmed.replace(/^Format:\s*/, '').split(',').map(k => k.trim());
      continue;
    }
    if (inEvents && (trimmed.startsWith('Dialogue:') || trimmed.startsWith('Comment:'))) {
      if (trimmed.startsWith('Comment:')) continue;
      const rawValues = trimmed.replace(/^Dialogue:\s*/, '');
      const commaLimit = formatKeys.length - 1;
      let parts = [];
      let cur = '';
      for (let i = 0; i < rawValues.length; i++) {
        if (rawValues[i] === ',' && parts.length < commaLimit) {
          parts.push(cur.trim());
          cur = '';
        } else {
          cur += rawValues[i];
        }
      }
      parts.push(cur.trim());

      const startIdx = formatKeys.indexOf('Start');
      const endIdx = formatKeys.indexOf('End');
      const textIdx = formatKeys.indexOf('Text') !== -1 ? formatKeys.indexOf('Text') : parts.length - 1;

      if (startIdx !== -1 && endIdx !== -1 && parts[startIdx] && parts[endIdx]) {
        const toVttTime = (t) => {
          const p = t.split(':');
          if (p.length === 3) {
            const h = p[0].padStart(2, '0');
            const m = p[1].padStart(2, '0');
            const secParts = p[2].split('.');
            const s = secParts[0].padStart(2, '0');
            const ms = (secParts[1] || '0').padEnd(3, '0').slice(0, 3);
            return `${h}:${m}:${s}.${ms}`;
          }
          return t;
        };

        const cleanText = (parts[textIdx] || '')
          .replace(/\{[^\}]*\}/g, '') // remove ASS style tags {\...}
          .replace(/\\N/gi, '\n')
          .replace(/\\n/gi, '\n')
          .replace(/\\h/gi, ' ')
          .trim();

        if (cleanText) {
          cues.push(`${toVttTime(parts[startIdx])} --> ${toVttTime(parts[endIdx])}\n${cleanText}`);
        }
      }
    }
  }

  return 'WEBVTT\n\n' + cues.map((c, i) => `${i + 1}\n${c}`).join('\n\n');
}

// Format seconds into mm:ss or hh:mm:ss
function formatTime(seconds) {
  if (seconds === null || seconds === undefined || isNaN(seconds) || !isFinite(seconds)) {
    return '00:00';
  }
  const total = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export default function VideoPlayer({ 
  anime, 
  episode = 1, 
  audioMode = 'sub',
  directStreamUrl = '',
  onClose, 
  onNextEpisode, 
  onPrevEpisode,
  onSelectEpisode,
  totalEpisodes,
  onLaunchMpv,
  currentLang = 'zh-TW',
  gpuSettings,
  onUpdateGpuSettings,
  t = (k) => k
}) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const hlsRef = useRef(null);
  const controlsTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);
  const subMenuRef = useRef(null);

  const [streamUrl, setStreamUrl] = useState('');
  const [rawStreamUrl, setRawStreamUrl] = useState('');
  const [referer, setReferer] = useState('https://zokoanime.video/');
  const [subtitles, setSubtitles] = useState([]);
  const [selectedSubIndex, setSelectedSubIndex] = useState(0);
  const [showSubtitlesMenu, setShowSubtitlesMenu] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);

  // M3U8 link & quality features
  const [copiedLink, setCopiedLink] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [customInputUrl, setCustomInputUrl] = useState('');
  const [availableQualities, setAvailableQualities] = useState([]);
  const [currentQualityIndex, setCurrentQualityIndex] = useState(-1); // -1 = Auto
  const [showQualityMenu, setShowQualityMenu] = useState(false);

  // Stream Source Switcher state (HiAnime, Anime1.me, FramexTV)
  const [activeSource, setActiveSource] = useState('auto');
  const [availableSources, setAvailableSources] = useState([]);
  const [showSourceMenu, setShowSourceMenu] = useState(false);
  const [isEmbedSource, setIsEmbedSource] = useState(false);
  const [isMp4, setIsMp4] = useState(false);
  const sourceMenuRef = useRef(null);

  // In-Player Episode Drawer state
  const [showEpisodeDrawer, setShowEpisodeDrawer] = useState(false);
  const [episodeDrawerChunk, setEpisodeDrawerChunk] = useState(0);
  const [uploadedEpisodes, setUploadedEpisodes] = useState([]);

  // Auto-play next episode countdown
  const [autoPlayCountdown, setAutoPlayCountdown] = useState(null);
  const countdownTimerRef = useRef(null);

  // Official Trailer PV mode
  const [isPlayingTrailer, setIsPlayingTrailer] = useState(false);

  // Resume playback timestamp
  const [resumedTime, setResumedTime] = useState(null);
  const [showResumeNotice, setShowResumeNotice] = useState(false);

  // Dynamic Chinese title resolution
  const [chineseInfo, setChineseInfo] = useState(null);

  // Platform & External Players Detection
  const platform = getPlatformInfo();
  const [showExternalMenu, setShowExternalMenu] = useState(false);
  const externalMenuRef = useRef(null);

  // Screen Size & Orientation Auto-Detection
  const [screenInfo, setScreenInfo] = useState(() => {
    if (typeof window === 'undefined') return { width: 1920, height: 1080, isLandscape: true, isMobile: false, isSmallScreen: false };
    const w = window.innerWidth;
    const h = window.innerHeight;
    const mobileUA = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    return {
      width: w,
      height: h,
      isLandscape: w > h,
      isMobile: mobileUA || w < 768,
      isSmallScreen: w < 640
    };
  });

  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const mobileUA = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      setScreenInfo({
        width: w,
        height: h,
        isLandscape: w > h,
        isMobile: mobileUA || w < 768,
        isSmallScreen: w < 640
      });
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  // Debug overlay & hidden options
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [showHiddenOptions, setShowHiddenOptions] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [debugStats, setDebugStats] = useState({});
  const debugIntervalRef = useRef(null);

  const getClampedMenuPos = (rawX, rawY) => {
    const menuWidth = 220;
    const menuHeight = 320;
    const winW = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const winH = typeof window !== 'undefined' ? window.innerHeight : 1080;
    const x = Math.min(Math.max(12, rawX), winW - menuWidth - 12);
    const y = (rawY + menuHeight + 12 > winH)
      ? Math.max(12, rawY - menuHeight - 8)
      : Math.min(rawY, winH - menuHeight - 12);
    return { x, y };
  };

  // Touch screen gestures & Double-Tap ripple state
  const [seekRipple, setSeekRipple] = useState(null); // { type, text, side }
  const seekRippleTimeoutRef = useRef(null);
  const durationRef = useRef(duration);
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);
  const lastTapTimeRef = useRef(0);
  const singleTapTimerRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const showControlsRef = useRef(showControls);
  useEffect(() => {
    showControlsRef.current = showControls;
  }, [showControls]);
  const touchStartedControlsVisibleRef = useRef(false);
  const touchStartedOnInteractiveRef = useRef(false);
  const lastTouchTimeRef = useRef(0);

  // Interactive scrubber with thumbnail preview & buffer tracking
  const seekbarRef = useRef(null);
  const previewVideoRef = useRef(null);
  const previewHlsRef = useRef(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const pendingPreviewSeekRef = useRef(null);
  const [videoFit, setVideoFit] = useState('contain'); // 'contain' | 'cover' | 'fill'
  const [hoverTime, setHoverTime] = useState(null);
  const [hoverPercent, setHoverPercent] = useState(0);
  const [hoverPixelX, setHoverPixelX] = useState(0);
  const [isHoveringSeekbar, setIsHoveringSeekbar] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const isScrubbingRef = useRef(false);
  useEffect(() => {
    isScrubbingRef.current = isScrubbing;
  }, [isScrubbing]);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const lastScrubPreviewTimeRef = useRef(0);
  const lastMainSeekTimeRef = useRef(0);
  const scrubThrottleTimerRef = useRef(null);

  // Reliably extract preview poster artwork (supports banner, image, or AniList coverImage object)
  const previewPosterUrl = useMemo(() => {
    let raw = '';
    if (typeof anime?.bannerImage === 'string' && anime.bannerImage) raw = anime.bannerImage;
    else if (typeof anime?.image === 'string' && anime.image) raw = anime.image;
    else if (typeof anime?.coverImage === 'string' && anime.coverImage) raw = anime.coverImage;
    else if (anime?.coverImage?.extraLarge) raw = anime.coverImage.extraLarge;
    else if (anime?.coverImage?.large) raw = anime.coverImage.large;
    else if (anime?.coverImage?.medium) raw = anime.coverImage.medium;
    return toCachedImageUrl(raw);
  }, [anime]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (externalMenuRef.current && !externalMenuRef.current.contains(e.target)) {
        setShowExternalMenu(false);
      }
      if (sourceMenuRef.current && !sourceMenuRef.current.contains(e.target)) {
        setShowSourceMenu(false);
      }
      if (subMenuRef.current && !subMenuRef.current.contains(e.target)) {
        setShowSubtitlesMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, []);

  // Debug stats polling (only when panel is open)
  useEffect(() => {
    if (!showDebugPanel) {
      clearInterval(debugIntervalRef.current);
      return;
    }
    const updateStats = () => {
      const video = videoRef.current;
      const hls = hlsRef.current;

      // Stream native resolution
      const streamRes = (video && video.videoWidth && video.videoHeight)
        ? `${video.videoWidth} × ${video.videoHeight}`
        : (hls && hls.levels && hls.currentLevel >= 0 && hls.levels[hls.currentLevel])
        ? `${hls.levels[hls.currentLevel].width || 0} × ${hls.levels[hls.currentLevel].height || 0}`
        : '—';

      // Rendered / viewport resolution
      const renderRes = video
        ? `${Math.round(video.clientWidth)} × ${Math.round(video.clientHeight)}`
        : '—';

      // Windowed / screen resolution & DPR
      const windowRes = typeof window !== 'undefined'
        ? `${window.innerWidth} × ${window.innerHeight} (DPR ${window.devicePixelRatio || 1})`
        : '—';

      // Frame Drop & Playback Quality
      let frameStats = '0 / 0 (0.00%)';
      if (video && typeof video.getVideoPlaybackQuality === 'function') {
        const q = video.getVideoPlaybackQuality();
        const total = q.totalVideoFrames || 0;
        const dropped = q.droppedVideoFrames || 0;
        const rate = total > 0 ? ((dropped / total) * 100).toFixed(2) : '0.00';
        frameStats = `${dropped} / ${total} (${rate}%)`;
      }

      // Audio Sampling Rate & Channel Configuration
      let audioHz = '48,000 Hz';
      try {
        const audioCtx = window._aniAudioCtx || (window._aniAudioCtx = new (window.AudioContext || window.webkitAudioContext)());
        if (audioCtx && audioCtx.sampleRate) {
          audioHz = `${audioCtx.sampleRate.toLocaleString()} Hz`;
        }
      } catch {}

      const activeAudioTrack = (hls && hls.audioTracks && hls.audioTracks.length > 0)
        ? hls.audioTracks[hls.audioTrack >= 0 ? hls.audioTrack : 0]
        : null;
      const audioTrackInfo = activeAudioTrack
        ? `${activeAudioTrack.name || activeAudioTrack.lang || '立體聲'} · ${audioHz}`
        : `立體聲 (2ch) · ${audioHz}`;

      // Video Codec Info
      const activeLvl = (hls && hls.levels && hls.currentLevel >= 0) ? hls.levels[hls.currentLevel] : null;
      const videoCodec = activeLvl?.videoCodec 
        ? activeLvl.videoCodec.split('.')[0].toUpperCase() + ` (${activeLvl.videoCodec})`
        : (activeLvl?.codecSet || 'H.264 / AVC');

      setDebugStats({
        currentTime: video ? video.currentTime.toFixed(2) : '—',
        duration: video ? video.duration?.toFixed(2) : '—',
        buffered: video && video.buffered.length > 0
          ? `${video.buffered.start(0).toFixed(1)}s – ${video.buffered.end(video.buffered.length - 1).toFixed(1)}s`
          : '—',
        readyState: video ? ['HAVE_NOTHING','HAVE_METADATA','HAVE_CURRENT_DATA','HAVE_FUTURE_DATA','HAVE_ENOUGH_DATA'][video.readyState] : '—',
        networkState: video ? ['EMPTY','IDLE','LOADING','NO_SOURCE'][video.networkState] : '—',
        streamRes,
        renderRes,
        windowRes,
        frameStats,
        audioTrackInfo,
        videoCodec,
        playbackRate: video ? video.playbackRate : '—',
        volume: video ? (video.muted ? 'MUTED' : `${Math.round(video.volume * 100)}%`) : '—',
        hlsLevel: hls ? hls.currentLevel : '—',
        hlsBandwidth: hls ? `${Math.round((hls.bandwidthEstimate || 0) / 1000)} kbps` : '—',
        hlsLatency: hls ? `${(hls.latency || 0).toFixed(2)}s` : '—',
        subtitles: subtitles.length,
        selectedSub: selectedSubIndex === -1 ? 'Off' : subtitles[selectedSubIndex]?.lang || '—',
        streamUrl: rawStreamUrl ? rawStreamUrl.slice(0, 60) + '…' : streamUrl ? streamUrl.slice(0, 60) + '…' : '—',
        gpuProfile: gpuSettings?.gpuProfile || '—',
        upscale: gpuSettings?.enableUpscale ? 'ON' : 'OFF',
        audioMode,
        episode,
      });
    };
    updateStats();
    debugIntervalRef.current = setInterval(updateStats, 800);
    return () => clearInterval(debugIntervalRef.current);
  }, [showDebugPanel, subtitles, selectedSubIndex, rawStreamUrl, streamUrl, gpuSettings, audioMode, episode]);

  // Close context menu on click elsewhere
  useEffect(() => {
    const handler = () => setShowContextMenu(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);


  useEffect(() => {
    if (!anime?.id || anime.titleZhTW || anime.titleZhCN || anime.titleZh) return;
    let cancelled = false;
    const romaji = anime.title?.romaji || '';
    const native = anime.title?.native || '';
    const english = anime.title?.english || '';
    const targetLang = currentLang === 'zh-CN' ? 'zh-CN' : 'zh-TW';

    fetch(`/api/anime/${anime.id}/chinese-info?romaji=${encodeURIComponent(romaji)}&native=${encodeURIComponent(native)}&english=${encodeURIComponent(english)}&lang=${targetLang}`)
      .then(r => r.json())
      .then(d => {
        if (!cancelled && d.success) {
          setChineseInfo(d);
        }
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [anime, currentLang]);

  const rawTitle = anime?.title?.english || anime?.title?.romaji || anime?.title?.native || 'Anime';
  
  // Localized title (prioritizes Traditional or Simplified Chinese when active, or Japanese if ja)
  const displayTitle = (
    currentLang === 'ja'
      ? (anime?.title?.native || anime?.title?.romaji || anime?.title?.english)
      : currentLang === 'zh-CN'
      ? (anime?.titleZhCN || chineseInfo?.titleZh || anime?.titleZh || anime?.titleZhTW || chineseInfo?.titleZhTW)
      : currentLang === 'zh-TW'
      ? (anime?.titleZhTW || chineseInfo?.titleZh || anime?.titleZh || anime?.titleZhCN || chineseInfo?.titleZhCN)
      : (anime?.title?.english || anime?.title?.romaji || anime?.title?.native)
  ) || rawTitle;

  const subTitle = (currentLang === 'ja')
    ? (anime?.title?.romaji && anime?.title?.romaji !== displayTitle ? anime?.title?.romaji : anime?.title?.english || '')
    : (currentLang === 'zh-TW' || currentLang === 'zh-CN')
    ? (anime?.title?.english || anime?.title?.romaji || (displayTitle !== anime?.title?.native ? anime?.title?.native : ''))
    : (anime?.titleZhTW || chineseInfo?.titleZh || anime?.title?.romaji || '');

  const progressKey = `aniflix_progress_${anime?.id || rawTitle}_${episode}`;

  // Helper to ensure any external stream URL routes via backend proxy
  const toPlayableUrl = (url, ref = referer) => {
    if (!url) return '';
    if (url.startsWith('/api/proxy')) return url;
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return `/api/proxy?url=${encodeURIComponent(url)}&referer=${encodeURIComponent(ref || 'https://zokoanime.video/')}`;
    }
    return url;
  };

  // Fetch Stream & Local Subtitles concurrently
  useEffect(() => {
    let isCancelled = false;
    setIsBuffering(true);
    setErrorMessage('');
    setAvailableQualities([]);
    setCurrentQualityIndex(-1);
    setIsMp4(false);
    setIsEmbedSource(false);

    async function loadStream() {
      if (directStreamUrl) {
        setStreamUrl(directStreamUrl);
        setRawStreamUrl(directStreamUrl);
        setIsBuffering(false);
        return;
      }

      // Check if anime is unreleased beforehand
      if (anime?.status === 'NOT_YET_RELEASED' || anime?.episodes === 0) {
        setIsBuffering(false);
        setErrorMessage(`《${displayTitle}》本季尚未正式開播 (Coming Soon)。您可以搶先欣賞官方宣傳預告片 (PV)！`);
        return;
      }

      const timeoutId = setTimeout(() => {
        if (!isCancelled && !streamUrl) {
          setIsBuffering(false);
          setErrorMessage(prev => prev || '串流載入逾時。您可以嘗試重新整理、欣賞官方預告片或使用外部 MPV 播放器。');
        }
      }, 10000);

      try {
        const candidateTitles = [
          anime?.title?.romaji,
          anime?.title?.english,
          anime?.title?.native,
          anime?.titleZhTW,
          anime?.titleZhCN,
          chineseInfo?.titleZh
        ].filter(Boolean);

        const maxAiredCap = (anime?.nextAiringEpisode?.episode && anime.nextAiringEpisode.episode > 1)
          ? (anime.nextAiringEpisode.episode - 1)
          : undefined;

        const streamPromise = fetch('/api/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            animeTitle: rawTitle,
            episode,
            mode: audioMode,
            candidates: candidateTitles,
            maxAiredCap,
            source: activeSource
          })
        }).then(r => r.json());

        // Concurrently query local subtitles on user's machine (e.g. downloads folder)
        const localSubsPromise = fetch(`/api/subtitles/local?animeTitle=${encodeURIComponent(displayTitle || rawTitle)}&episode=${episode}`)
          .then(r => r.json())
          .catch(() => ({ success: false, subtitles: [] }));

        const [streamRes, localSubsRes] = await Promise.all([streamPromise, localSubsPromise]);
        clearTimeout(timeoutId);

        if (!isCancelled) {
          const hasValidStream = streamRes.success && streamRes.data && (streamRes.data.proxiedStreamUrl || streamRes.data.streamUrl);
          if (hasValidStream) {
            const raw = streamRes.data.streamUrl;
            const proxied = streamRes.data.proxiedStreamUrl || toPlayableUrl(raw, streamRes.data.referer);
            const refHeader = streamRes.data.referer || 'https://zokoanime.video/';

            if (streamRes.data.availableSources) {
              setAvailableSources(streamRes.data.availableSources);
            }
            if (streamRes.data.activeSource && streamRes.data.activeSource !== activeSource) {
              setActiveSource(streamRes.data.activeSource);
            }
            setIsEmbedSource(Boolean(streamRes.data.isEmbed));
            setIsMp4(Boolean(streamRes.data.isMp4));

            setRawStreamUrl(raw);
            setStreamUrl(proxied);
            setReferer(refHeader);
            setCustomInputUrl(raw);

            const remoteSubs = streamRes.data.proxiedSubtitles || (streamRes.data.subtitles || []).map(s => ({
              ...s,
              url: toPlayableUrl(s.url, refHeader)
            }));

            const localSubs = (localSubsRes.success && Array.isArray(localSubsRes.subtitles))
              ? localSubsRes.subtitles
              : [];

            let combinedSubs = [...localSubs, ...remoteSubs];

            // Detect existing subtitle languages
            const hasTw = combinedSubs.some(s => isTradZh(s.lang));
            const hasCn = combinedSubs.some(s => isSimpZh(s.lang));
            const hasJa = combinedSubs.some(s => isJapanese(s.lang));

            // Find base English or primary remote subtitle track to translate if needed
            const enSub = remoteSubs.find(s => /(eng|english|\ben\b)/i.test(s.lang)) || remoteSubs[0];

            if (enSub && enSub.url) {
              const aiTracks = [];
              if (!hasTw) {
                aiTracks.push({
                  lang: '繁體中文 (AI 翻譯)',
                  url: `/api/subtitles/translate?url=${encodeURIComponent(enSub.url)}&targetLang=zh-TW`,
                  isAi: true
                });
              }
              if (!hasCn) {
                aiTracks.push({
                  lang: '简体中文 (AI 翻译)',
                  url: `/api/subtitles/translate?url=${encodeURIComponent(enSub.url)}&targetLang=zh-CN`,
                  isAi: true
                });
              }
              if (!hasJa) {
                aiTracks.push({
                  lang: '日本語 (AI 翻訳)',
                  url: `/api/subtitles/translate?url=${encodeURIComponent(enSub.url)}&targetLang=ja`,
                  isAi: true
                });
              }
              combinedSubs = [...localSubs, ...aiTracks, ...remoteSubs];
            }

            setSubtitles(combinedSubs);

            // Auto-select preferred subtitle track based on active language
            if (currentLang === 'zh-TW') {
              const twIdx = combinedSubs.findIndex(s => isTradZh(s.lang) && !s.isAi);
              if (twIdx !== -1) {
                setSelectedSubIndex(twIdx);
              } else if (localSubs.length > 0) {
                setSelectedSubIndex(0);
              } else {
                const aiTwIdx = combinedSubs.findIndex(s => s.lang?.includes('繁體中文 (AI 翻譯)'));
                if (aiTwIdx !== -1) {
                  setSelectedSubIndex(aiTwIdx);
                } else {
                  const cnIdx = combinedSubs.findIndex(s => isSimpZh(s.lang));
                  setSelectedSubIndex(cnIdx !== -1 ? cnIdx : (combinedSubs.length > 0 ? 0 : -1));
                }
              }
            } else if (currentLang === 'zh-CN') {
              const cnIdx = combinedSubs.findIndex(s => isSimpZh(s.lang) && !s.isAi);
              if (cnIdx !== -1) {
                setSelectedSubIndex(cnIdx);
              } else if (localSubs.length > 0) {
                setSelectedSubIndex(0);
              } else {
                const aiCnIdx = combinedSubs.findIndex(s => s.lang?.includes('简体中文 (AI 翻译)'));
                if (aiCnIdx !== -1) {
                  setSelectedSubIndex(aiCnIdx);
                } else {
                  const twIdx = combinedSubs.findIndex(s => isTradZh(s.lang));
                  setSelectedSubIndex(twIdx !== -1 ? twIdx : (combinedSubs.length > 0 ? 0 : -1));
                }
              }
            } else if (currentLang === 'ja') {
              const jaIdx = combinedSubs.findIndex(s => isJapanese(s.lang) && !s.isAi);
              if (jaIdx !== -1) {
                setSelectedSubIndex(jaIdx);
              } else if (localSubs.length > 0) {
                setSelectedSubIndex(0);
              } else {
                const aiJaIdx = combinedSubs.findIndex(s => s.lang?.includes('日本語 (AI 翻訳)'));
                if (aiJaIdx !== -1) {
                  setSelectedSubIndex(aiJaIdx);
                } else {
                  setSelectedSubIndex(combinedSubs.length > 0 ? 0 : -1);
                }
              }
            } else {
              const enIdx = combinedSubs.findIndex(s => /(eng|english|\ben\b)/i.test(s.lang) && !s.isAi);
              if (enIdx !== -1) {
                setSelectedSubIndex(enIdx);
              } else if (localSubs.length > 0) {
                setSelectedSubIndex(0);
              } else {
                setSelectedSubIndex(combinedSubs.length > 0 ? 0 : -1);
              }
            }
          } else {
            const rawErr = streamRes.error || streamRes.data?.error || '';
            const isAiredErr = rawErr.includes('not officially aired');
            const friendlyErr = isAiredErr
              ? `《${displayTitle}》第 ${episode} 集目前尚未正式播映 (未發行)。`
              : (rawErr || '來源端查無此集數之串流資源，您可以嘗試其他集數或欣賞官方預告片。');
            setErrorMessage(friendlyErr);
          }
        }
      } catch (err) {
        console.error('Failed to load stream:', err);
        if (!isCancelled) {
          setErrorMessage(err.message || '網路連線異常，無法取得串流位址。');
        }
      } finally {
        if (!isCancelled) setIsBuffering(false);
      }
    }

    loadStream();
    return () => { isCancelled = true; };
  }, [anime, episode, audioMode, displayTitle, rawTitle, currentLang, directStreamUrl, activeSource]);

  // Load live uploaded episodes list
  useEffect(() => {
    let active = true;
    async function loadEpisodes() {
      try {
        const candidateTitles = [
          anime?.title?.romaji,
          anime?.title?.english,
          anime?.title?.native,
          anime?.titleZhTW,
          anime?.titleZhCN,
          chineseInfo?.titleZh
        ].filter(Boolean);

        const maxAiredCap = (anime?.nextAiringEpisode?.episode && anime.nextAiringEpisode.episode > 1)
          ? (anime.nextAiringEpisode.episode - 1)
          : undefined;

        const params = new URLSearchParams();
        if (candidateTitles.length > 0) params.set('candidates', JSON.stringify(candidateTitles));
        if (maxAiredCap) params.set('maxAiredCap', String(maxAiredCap));

        const res = await fetch(`/api/anime/${encodeURIComponent(rawTitle)}/episodes?${params.toString()}`);
        const data = await res.json();
        if (active && data.success && Array.isArray(data.uploadedEpisodes)) {
          const filtered = maxAiredCap ? data.uploadedEpisodes.filter(e => e <= maxAiredCap) : data.uploadedEpisodes;
          setUploadedEpisodes(filtered);
        }
      } catch {}
    }
    loadEpisodes();
    return () => { active = false; };
  }, [rawTitle, anime, chineseInfo]);

  const maxEp = Math.max(
    totalEpisodes || anime?.episodes || 12,
    uploadedEpisodes.length > 0 ? Math.max(...uploadedEpisodes) : 1
  );

  const EP_CHUNK_SIZE = 50;
  const totalEpChunks = Math.ceil(maxEp / EP_CHUNK_SIZE);
  const allEpisodes = Array.from({ length: maxEp }, (_, i) => i + 1);

  // Sync initial drawer chunk to current episode
  useEffect(() => {
    const chunkIdx = Math.floor((episode - 1) / EP_CHUNK_SIZE);
    setEpisodeDrawerChunk(chunkIdx);
  }, [episode]);

  // Auto-play next episode countdown
  const handleVideoEnded = () => {
    if (onNextEpisode && episode < maxEp) {
      setAutoPlayCountdown(5);
    }
  };

  useEffect(() => {
    if (autoPlayCountdown === null) return;
    if (autoPlayCountdown > 0) {
      countdownTimerRef.current = setTimeout(() => {
        setAutoPlayCountdown(c => (c !== null ? c - 1 : null));
      }, 1000);
      return () => clearTimeout(countdownTimerRef.current);
    } else if (autoPlayCountdown === 0) {
      setAutoPlayCountdown(null);
      if (onNextEpisode) onNextEpisode();
    }
  }, [autoPlayCountdown, onNextEpisode]);

  const cancelAutoPlay = () => {
    if (countdownTimerRef.current) clearTimeout(countdownTimerRef.current);
    setAutoPlayCountdown(null);
  };

  // Resume progress logic
  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    setDuration(video.duration || 0);
    try {
      const saved = localStorage.getItem(progressKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.time && parsed.time > 10 && parsed.time < (video.duration || 1000) - 20) {
          video.currentTime = parsed.time;
          setCurrentTime(parsed.time);
          setResumedTime(parsed.time);
          setShowResumeNotice(true);
          setTimeout(() => setShowResumeNotice(false), 6000);
        }
      }
    } catch {}
  };

  const handleTimeUpdate = () => {
    if (isScrubbingRef.current) return;
    const video = videoRef.current;
    if (!video) return;
    const cur = video.currentTime;
    setCurrentTime(cur);
    setDuration(video.duration || 0);

    // Track buffered range for seekbar
    if (video.buffered && video.buffered.length > 0) {
      try {
        for (let i = 0; i < video.buffered.length; i++) {
          if (video.buffered.start(i) <= cur && video.buffered.end(i) >= cur) {
            setBufferedEnd(video.buffered.end(i));
            break;
          }
        }
      } catch {}
    }

    if (cur > 5) {
      try {
        localStorage.setItem(progressKey, JSON.stringify({
          time: cur,
          duration: video.duration || 0,
          updatedAt: Date.now()
        }));
      } catch {}
    }
  };

  const handleRestartFromBeginning = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      setCurrentTime(0);
      setShowResumeNotice(false);
    }
  };

  // Setup HLS or Native Video (Supporting HLS .m3u8 & direct .mp4 streams)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl || isEmbedSource) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      return;
    }

    const playable = toPlayableUrl(streamUrl, referer);
    const isDirectMp4 = isMp4 ||
                        (rawStreamUrl && (rawStreamUrl.includes('.mp4') || rawStreamUrl.includes('api?c='))) ||
                        (streamUrl && (streamUrl.includes('.mp4') || streamUrl.includes('api?c=')));

    if (isDirectMp4) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.src = playable;
      setIsBuffering(false);
      video.play().catch(() => setIsPlaying(false));
    } else if (Hls.isSupported() && (playable.includes('.m3u8') || playable.includes('/api/proxy'))) {
      if (hlsRef.current) hlsRef.current.destroy();

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        progressive: true,
        backBufferLength: 300,
        maxBufferLength: 120,
        maxMaxBufferLength: 600,
        maxBufferSize: 128 * 1024 * 1024,
        enableSoftwareAES: false,
      });
      hlsRef.current = hls;

      hls.loadSource(playable);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        setIsBuffering(false);
        if (data.levels && data.levels.length > 0) {
          setAvailableQualities(data.levels.map((lvl, index) => ({
            id: index,
            height: lvl.height || 0,
            name: lvl.height ? `${lvl.height}p` : `Level ${index + 1}`
          })));
        }
        video.play().catch(() => setIsPlaying(false));
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
        setCurrentQualityIndex(data.level);
      });

      hls.on(Hls.Events.BUFFER_STALLED, () => setIsBuffering(true));
      hls.on(Hls.Events.BUFFER_APPENDED, () => setIsBuffering(false));
      hls.on(Hls.Events.FRAG_BUFFERED, () => setIsBuffering(false));
      hls.on(Hls.Events.FRAG_LOADED, () => setIsBuffering(false));

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.details === 'bufferStalledError') {
          setIsBuffering(true);
          return;
        }
        if (data.details === 'bufferSeekOverHole') {
          return;
        }
        if (!data.fatal && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          return;
        }
        console.warn('[HLS Error Event]', data.type, data.details, data.fatal);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.log('[HLS] Attempting network error recovery...');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log('[HLS] Attempting media error recovery...');
              hls.recoverMediaError();
              break;
            default:
              console.error('[HLS] Fatal unrecoverable error:', data);
              hls.destroy();
              setIsBuffering(false);
              setErrorMessage(`Playback error: ${data.details || 'stream failure'}. You can try opening with MPV.`);
              break;
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS support
      video.src = playable;
      video.play().catch(() => setIsPlaying(false));
    } else {
      video.src = playable;
      video.play().catch(() => setIsPlaying(false));
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [streamUrl, rawStreamUrl]);

  // Setup Preview HLS instance for hover thumbnail seekbar
  useEffect(() => {
    const previewVideo = previewVideoRef.current;
    if (!previewVideo || !streamUrl || isEmbedSource) {
      if (previewHlsRef.current) {
        previewHlsRef.current.destroy();
        previewHlsRef.current = null;
      }
      return;
    }

    previewVideo.muted = true;
    previewVideo.defaultMuted = true;
    previewVideo.playsInline = true;
    try {
      previewVideo.setAttribute('playsinline', '');
      previewVideo.setAttribute('webkit-playsinline', '');
    } catch {}

    setPreviewReady(false);
    setIsPreviewLoading(false);
    pendingPreviewSeekRef.current = null;
    const playable = toPlayableUrl(streamUrl, referer);
    const isDirectMp4 = isMp4 ||
                        (rawStreamUrl && (rawStreamUrl.includes('.mp4') || rawStreamUrl.includes('api?c='))) ||
                        (streamUrl && (streamUrl.includes('.mp4') || streamUrl.includes('api?c=')));

    if (isDirectMp4) {
      if (previewHlsRef.current) {
        previewHlsRef.current.destroy();
        previewHlsRef.current = null;
      }
      previewVideo.src = playable;
      try { previewVideo.load(); } catch {}
    } else if (Hls.isSupported() && (playable.includes('.m3u8') || playable.includes('/api/proxy'))) {
      if (previewHlsRef.current) previewHlsRef.current.destroy();

      const previewHls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        autoStartLoad: true,
        maxBufferLength: 6,
        maxMaxBufferLength: 12,
        enableSoftwareAES: false,
      });
      previewHlsRef.current = previewHls;

      previewHls.loadSource(playable);
      previewHls.attachMedia(previewVideo);

      previewHls.on(Hls.Events.MANIFEST_PARSED, (e, data) => {
        if (data.levels && data.levels.length > 0) {
          // Select lowest video resolution level for fast thumbnail rendering
          const videoLevels = data.levels
            .map((lvl, idx) => ({ lvl, idx }))
            .filter(item => (item.lvl.height || 0) > 0);
          const candidates = videoLevels.length > 0 ? videoLevels : data.levels.map((lvl, idx) => ({ lvl, idx }));
          let lowestIndex = candidates[0].idx;
          let lowestScore = Infinity;
          candidates.forEach(({ lvl, idx }) => {
            const score = (lvl.height || 0) * 1000000 + (lvl.bitrate || 0);
            if (score < lowestScore) {
              lowestScore = score;
              lowestIndex = idx;
            }
          });
          previewHls.currentLevel = lowestIndex;
        }
      });

      previewHls.on(Hls.Events.ERROR, (e, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            previewHls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            previewHls.recoverMediaError();
          }
        }
      });
    } else {
      previewVideo.src = playable;
    }

    return () => {
      if (previewHlsRef.current) {
        previewHlsRef.current.destroy();
        previewHlsRef.current = null;
      }
    };
  }, [streamUrl, referer]);

  // Keep preview video in sync with real stream playback position when idle
  useEffect(() => {
    if (videoRef.current && previewVideoRef.current && !isHoveringSeekbar && !isScrubbing) {
      try {
        if (Math.abs(previewVideoRef.current.currentTime - currentTime) > 5) {
          previewVideoRef.current.currentTime = currentTime;
        }
      } catch {}
    }
  }, [currentTime, isHoveringSeekbar, isScrubbing]);

  // Synchronize active subtitle track on video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !video.textTracks) return;

    const syncTracks = () => {
      for (let i = 0; i < video.textTracks.length; i++) {
        video.textTracks[i].mode = (i === selectedSubIndex) ? 'showing' : 'disabled';
      }
    };

    syncTracks();
    const t = setTimeout(syncTracks, 400);
    return () => clearTimeout(t);
  }, [selectedSubIndex, subtitles]);

  // Handle local subtitle file import (.vtt / .srt / .ass / .ssa)
  const handleImportSubtitle = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      let content = event.target.result;
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.srt')) {
        content = 'WEBVTT\n\n' + content
          .replace(/\r\n|\r/g, '\n')
          .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
      } else if (lower.endsWith('.ass') || lower.endsWith('.ssa')) {
        content = convertAssToVtt(content);
      }
      const blob = new Blob([content], { type: 'text/vtt;charset=utf-8' });
      const objectUrl = URL.createObjectURL(blob);
      const isTw = isTradZh(file.name);
      const isCn = isSimpZh(file.name);
      const cleanName = file.name.replace(/\.[^/.]+$/, '');
      let tag = `[本地字幕] ${cleanName}`;
      if (isTw) tag = `[本地繁中] ${cleanName}`;
      else if (isCn) tag = `[本地簡中] ${cleanName}`;

      const newTrack = {
        lang: tag,
        url: objectUrl,
        default: true
      };
      setSubtitles(prev => [newTrack, ...prev]);
      setSelectedSubIndex(0);
      setShowSubtitlesMenu(false);
    };
    reader.readAsText(file);
  };

  // Handle Quality Selection
  const handleSelectQuality = (levelIndex) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = levelIndex;
      setCurrentQualityIndex(levelIndex);
      setShowQualityMenu(false);
    }
  };

  // Handle Copying M3U8 Stream URL
  const handleCopyLink = () => {
    const linkToCopy = rawStreamUrl || streamUrl;
    if (linkToCopy) {
      navigator.clipboard.writeText(linkToCopy).then(() => {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2200);
      }).catch(err => {
        console.error('Failed to copy link:', err);
      });
    }
  };

  // Handle Custom M3U8 Link Playback
  const handleApplyCustomLink = (e) => {
    e.preventDefault();
    if (!customInputUrl.trim()) return;
    setErrorMessage('');
    setIsBuffering(true);
    const proxied = toPlayableUrl(customInputUrl.trim(), referer);
    setRawStreamUrl(customInputUrl.trim());
    setStreamUrl(proxied);
    setShowLinkModal(false);
  };

  // Controls Visibility Timeout (10 seconds when playing, 30 seconds when paused)
  const resetControlsTimeout = useCallback((customTimeoutMs) => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = null;
    }

    const video = videoRef.current;
    const isCurrentlyPlaying = video ? !video.paused : isPlaying;
    const timeoutMs = customTimeoutMs !== undefined 
      ? customTimeoutMs 
      : (isCurrentlyPlaying ? 10000 : 30000);

    controlsTimeoutRef.current = setTimeout(() => {
      // Do not hide if interactive menus, drawers, or scrubbers are active
      if (
        !showLinkModal &&
        !showQualityMenu &&
        !showSourceMenu &&
        !showContextMenu &&
        !showSubtitlesMenu &&
        !showEpisodeDrawer &&
        !showExternalMenu &&
        !showDebugPanel &&
        !showHiddenOptions &&
        !isScrubbing
      ) {
        setShowControls(false);
      }
    }, timeoutMs);
  }, [
    isPlaying,
    showLinkModal,
    showQualityMenu,
    showSourceMenu,
    showContextMenu,
    showSubtitlesMenu,
    showEpisodeDrawer,
    showExternalMenu,
    showDebugPanel,
    showHiddenOptions,
    isScrubbing
  ]);

  const handleMouseMove = () => {
    resetControlsTimeout();
  };

  // Automatically adjust timeout whenever playback state toggles (10s on play, 30s on pause)
  useEffect(() => {
    resetControlsTimeout();
    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
        controlsTimeoutRef.current = null;
      }
    };
  }, [isPlaying, resetControlsTimeout]);

  // Synchronous relative seek with instant scrubber bar & knob follow
  const seekRelative = (seconds) => {
    const video = videoRef.current;
    if (!video) return;
    const maxDur = durationRef.current || video.duration || 0;
    const current = video.currentTime;
    const target = Math.max(0, maxDur > 0 ? Math.min(maxDur, current + seconds) : Math.max(0, current + seconds));
    
    video.currentTime = target;
    setCurrentTime(target);
    handleMouseMove();

    const sign = seconds > 0 ? `+${seconds}s` : `${seconds}s`;
    setSeekRipple({
      type: seconds < 0 ? 'rewind' : 'forward',
      text: sign,
      side: seconds < 0 ? 'left' : 'right'
    });
    if (seekRippleTimeoutRef.current) clearTimeout(seekRippleTimeoutRef.current);
    seekRippleTimeoutRef.current = setTimeout(() => {
      setSeekRipple(null);
    }, 700);
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const video = videoRef.current;
      if (!video) return;

      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seekRelative(e.shiftKey ? -10 : -5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekRelative(e.shiftKey ? 10 : 5);
          break;
        case 'j':
        case 'J':
          e.preventDefault();
          seekRelative(-10);
          break;
        case 'l':
        case 'L':
          e.preventDefault();
          seekRelative(10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setVolume(v => Math.min(1, v + 0.1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume(v => Math.max(0, v - 0.1));
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case 'Escape':
          if (showEpisodeDrawer) {
            setShowEpisodeDrawer(false);
          } else if (showLinkModal) {
            setShowLinkModal(false);
          } else if (showQualityMenu) {
            setShowQualityMenu(false);
          } else if (showSubtitlesMenu) {
            setShowSubtitlesMenu(false);
          } else if (!isFullscreen) {
            onClose();
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, isFullscreen, showLinkModal, showQualityMenu, showSubtitlesMenu, showEpisodeDrawer]);

  // Player Actions
  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const handleSeek = (e) => {
    const video = videoRef.current;
    if (!video) return;
    const time = parseFloat(e.target.value);
    video.currentTime = time;
    setCurrentTime(time);
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const toggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const handleVideoClick = (e) => {
    // If a touch tap occurred within 650ms, ignore synthetic browser click
    // so tapping to show controls on touch monitor does not accidentally toggle playback
    if (Date.now() - lastTouchTimeRef.current < 650) {
      return;
    }
    togglePlay();
  };

  // Touch Gestures: Single Tap (Controls), Double Tap (Seek Left/Right, Play/Pause), Long Press (Menu)
  const handleTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    lastTouchTimeRef.current = Date.now();

    // Check if touch target is inside interactive controls (buttons, inputs, sliders, drawers, menus)
    const isInteractive = !!e.target?.closest?.('button, input, select, a, [role="button"], [role="slider"], .interactive-control, .interactive');
    touchStartedOnInteractiveRef.current = isInteractive;
    touchStartedControlsVisibleRef.current = showControlsRef.current;

    if (isInteractive) {
      // User tapped or dragged an interactive button/slider.
      // Reset the 10s/30s inactivity timer so controls stay visible while interacting!
      handleMouseMove();
      return;
    }

    const touch = e.touches[0];
    const touchX = touch.clientX;
    const touchY = touch.clientY;

    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      setContextMenuPos(getClampedMenuPos(touchX, touchY));
      setShowContextMenu(true);
    }, 550);
  };

  const handleTouchMove = () => {
    lastTouchTimeRef.current = Date.now();
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleTouchEnd = (e) => {
    lastTouchTimeRef.current = Date.now();
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (touchStartedOnInteractiveRef.current) {
      // User tapped or dragged an interactive button/slider.
      // Keep controls visible for 10s/30s, do not toggle or hide controls!
      handleMouseMove();
      return;
    }

    const now = Date.now();
    const timeDiff = now - lastTapTimeRef.current;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const touch = e.changedTouches?.[0];
    if (!touch) return;
    const x = touch.clientX - rect.left;
    const widthRatio = x / rect.width;

    if (timeDiff < 300) {
      // Double tap! Cancel single tap controls timer
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }

      if (widthRatio < 0.35) {
        // Double tap left: Seek backward 10s
        seekRelative(-10);
      } else if (widthRatio > 0.65) {
        // Double tap right: Seek forward 10s
        seekRelative(10);
      } else {
        // Double tap center: Toggle play/pause
        togglePlay();
        setSeekRipple({ type: isPlaying ? 'pause' : 'play', text: isPlaying ? '暫停' : '播放', side: 'center' });
        if (seekRippleTimeoutRef.current) clearTimeout(seekRippleTimeoutRef.current);
        seekRippleTimeoutRef.current = setTimeout(() => setSeekRipple(null), 700);
      }
      handleMouseMove();
      lastTapTimeRef.current = 0;
    } else {
      // Single tap: wait 260ms to verify it's not the first tap of a double tap
      lastTapTimeRef.current = now;
      const wasVisible = touchStartedControlsVisibleRef.current;

      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
      singleTapTimerRef.current = setTimeout(() => {
        if (!wasVisible) {
          // Controls were HIDDEN when tapped -> SHOW THEM and start full 10s (play) / 30s (pause) timer!
          resetControlsTimeout();
        } else {
          // Controls were ALREADY VISIBLE and user tapped the empty video background -> HIDE controls immediately
          setShowControls(false);
          if (controlsTimeoutRef.current) {
            clearTimeout(controlsTimeoutRef.current);
            controlsTimeoutRef.current = null;
          }
        }
        singleTapTimerRef.current = null;
      }, 260);
    }
  };


  // Interactive Scrubber & Thumbnail Preview handlers
  const seekPreviewVideo = (targetTime) => {
    const pv = previewVideoRef.current;
    if (!pv || !isFinite(targetTime) || duration <= 0) return;

    if (pv.seeking) {
      pendingPreviewSeekRef.current = targetTime;
      return;
    }

    try {
      setIsPreviewLoading(true);
      if (typeof pv.fastSeek === 'function') {
        pv.fastSeek(targetTime);
      } else {
        pv.currentTime = targetTime;
      }
    } catch {
      setIsPreviewLoading(false);
    }
  };

  const handlePreviewSeeked = () => {
    setPreviewReady(true);
    setIsPreviewLoading(false);
    if (pendingPreviewSeekRef.current !== null) {
      const nextTime = pendingPreviewSeekRef.current;
      pendingPreviewSeekRef.current = null;
      seekPreviewVideo(nextTime);
    }
  };

  const updateScrubberHover = (clientX) => {
    if (!seekbarRef.current || !duration) return;
    const rect = seekbarRef.current.getBoundingClientRect();
    const clampedX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percent = (clampedX / rect.width) * 100;
    const targetTime = (clampedX / rect.width) * duration;

    setHoverPercent(percent);
    setHoverPixelX(clampedX);
    setHoverTime(targetTime);

    // Throttle preview thumbnail seeking to ~75ms to avoid decoding thrash
    const now = Date.now();
    if (now - lastScrubPreviewTimeRef.current > 75) {
      lastScrubPreviewTimeRef.current = now;
      seekPreviewVideo(targetTime);
    } else {
      if (scrubThrottleTimerRef.current) clearTimeout(scrubThrottleTimerRef.current);
      scrubThrottleTimerRef.current = setTimeout(() => {
        seekPreviewVideo(targetTime);
      }, 75);
    }
  };

  const applyScrubTime = (clientX, isFinal = false) => {
    if (!seekbarRef.current || !duration) return;
    const rect = seekbarRef.current.getBoundingClientRect();
    const clampedX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const targetTime = (clampedX / rect.width) * duration;

    // Immediately update UI seekbar position & hover tooltip for instant 60fps knob follow
    setCurrentTime(targetTime);
    updateScrubberHover(clientX);

    const video = videoRef.current;
    if (!video) return;

    if (isFinal) {
      // Seek main video stream ONLY upon release to prevent mobile decoder thrash and stutter
      try {
        video.currentTime = targetTime;
      } catch {}
    }
  };

  const handleSeekbarMouseMove = (e) => {
    setIsHoveringSeekbar(true);
    updateScrubberHover(e.clientX);
  };

  const handleSeekbarMouseLeave = () => {
    if (!isScrubbing) {
      setIsHoveringSeekbar(false);
      setHoverTime(null);
    }
  };

  const handleSeekbarMouseDown = (e) => {
    setIsScrubbing(true);
    setIsHoveringSeekbar(true);
    applyScrubTime(e.clientX, false);
  };

  const handleSeekbarTouchStart = (e) => {
    e.stopPropagation();
    setIsScrubbing(true);
    setIsHoveringSeekbar(true);
    if (e.touches && e.touches[0]) {
      applyScrubTime(e.touches[0].clientX, false);
    }
  };

  const handleSeekbarTouchMove = (e) => {
    e.stopPropagation();
    if (e.touches && e.touches[0]) {
      applyScrubTime(e.touches[0].clientX, false);
    }
  };

  const handleSeekbarTouchEnd = (e) => {
    e.stopPropagation();
    if (e.changedTouches && e.changedTouches[0]) {
      applyScrubTime(e.changedTouches[0].clientX, true);
    }
    setIsScrubbing(false);
    setIsHoveringSeekbar(false);
    setHoverTime(null);
  };

  // Global window listeners for drag scrubbing (mouse and touch)
  useEffect(() => {
    if (!isScrubbing) return;

    const onPointerMove = (e) => {
      const clientX = e.touches ? e.touches[0]?.clientX : e.clientX;
      if (clientX !== undefined) {
        applyScrubTime(clientX, false);
      }
    };

    const onPointerUp = (e) => {
      const clientX = e.changedTouches ? e.changedTouches[0]?.clientX : e.clientX;
      if (clientX !== undefined) {
        applyScrubTime(clientX, true);
      }
      setIsScrubbing(false);
      setIsHoveringSeekbar(false);
      setHoverTime(null);
    };

    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);
    window.addEventListener('touchmove', onPointerMove, { passive: true });
    window.addEventListener('touchend', onPointerUp, { passive: true });
    window.addEventListener('touchcancel', onPointerUp, { passive: true });

    return () => {
      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('mouseup', onPointerUp);
      window.removeEventListener('touchmove', onPointerMove);
      window.removeEventListener('touchend', onPointerUp);
      window.removeEventListener('touchcancel', onPointerUp);
    };
  }, [isScrubbing, duration]);

  const hasTrailer = Boolean(anime?.trailer?.id && (anime.trailer?.site === 'youtube' || !anime.trailer?.site));
  const isUnreleased = Boolean(
    anime?.status === 'NOT_YET_RELEASED' || 
    anime?.episodes === 0 || 
    (anime?.nextAiringEpisode?.episode && Number(episode) >= anime.nextAiringEpisode.episode) ||
    errorMessage?.toLowerCase().includes('not officially aired') ||
    errorMessage?.includes('尚未正式開播')
  );

  return (
    <div 
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenuPos(getClampedMenuPos(e.clientX, e.clientY));
        setShowContextMenu(true);
      }}
      className="fixed inset-0 z-50 bg-black flex items-center justify-center select-none overflow-hidden touch-manipulation w-full h-[100dvh]"
    >
      {/* ─── Official Trailer (PV) Playback Mode ─── */}
      {isPlayingTrailer && hasTrailer && (
        <div className="absolute inset-0 z-50 flex flex-col bg-black">
          <div className="absolute top-4 left-4 right-4 z-50 flex items-center justify-between bg-black/80 backdrop-blur-md px-4 py-2.5 rounded-2xl border border-white/10 shadow-2xl">
            <div className="flex items-center gap-2.5 text-xs font-bold text-white">
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
              </span>
              <span>官方宣傳預告片 (Official Trailer PV) • {displayTitle}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsPlayingTrailer(false)}
                className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold border border-zinc-700 cursor-pointer"
              >
                返回播放器
              </button>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <iframe
            src={`https://www.youtube.com/embed/${anime.trailer.id}?autoplay=1&rel=0`}
            title={`${displayTitle} Official Trailer`}
            className="w-full h-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
      )}

      {/* Video Element or Embed Iframe */}
      {isEmbedSource && (rawStreamUrl || streamUrl) ? (
        <div className="absolute inset-0 z-20 flex flex-col bg-black">
          {/* Floating Exit & Source Switcher Bar for Embed mode */}
          <div className="absolute top-3 left-3 right-3 z-30 flex items-center justify-between pointer-events-auto bg-black/75 backdrop-blur-md px-3.5 py-2.5 rounded-2xl border border-white/10 shadow-2xl">
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-xl bg-zinc-800/90 hover:bg-zinc-700 text-white transition-colors cursor-pointer"
                title="關閉播放器"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-bold text-white truncate max-w-[180px] sm:max-w-xs">
                  {displayTitle} · 第 {episode} 集
                </span>
                <span className="text-[10px] text-amber-300 font-medium flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                  FramexTV 獨立內嵌播放模式
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowSourceMenu(!showSourceMenu)}
                  className="flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl border border-zinc-700 cursor-pointer transition-colors"
                >
                  <Radio className="w-3.5 h-3.5 text-amber-400" />
                  <span>切換線路</span>
                  <ChevronDown className="w-3 h-3 text-zinc-400" />
                </button>
                {showSourceMenu && (
                  <div className="absolute right-0 top-full mt-2 w-48 bg-[#1f1f1f] border border-zinc-700 rounded-xl shadow-2xl overflow-hidden z-50 py-1 backdrop-blur-xl animate-in fade-in zoom-in-95">
                    <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-800 flex items-center justify-between">
                      <span>選擇播放線路</span>
                    </div>
                    {[
                      { id: 'auto', label: '自動線路 (推薦)', badge: 'Auto' },
                      { id: 'anime1', label: 'Anime1.me (1080p MP4)', badge: '繁中' },
                      { id: 'framextv', label: 'FramexTV (HD 內嵌)', badge: '備用' },
                      { id: 'hianime', label: 'HiAnime (國際 HLS)', badge: '多語' },
                    ].map(s => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setActiveSource(s.id);
                          setShowSourceMenu(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between cursor-pointer transition-colors ${
                          activeSource === s.id ? 'bg-[#E50914]/20 text-[#E50914] font-bold' : 'text-zinc-300 hover:bg-zinc-800'
                        }`}
                      >
                        <span className="truncate">{s.label}</span>
                        {s.badge && <span className="text-[9px] px-1 py-0.5 bg-zinc-800 text-zinc-400 rounded border border-zinc-700">{s.badge}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <iframe
            src={rawStreamUrl || streamUrl}
            title={`${displayTitle} Ep ${episode}`}
            className="w-full h-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
      ) : (
        <video
          ref={videoRef}
          crossOrigin="anonymous"
          playsInline
          preload="auto"
          disableRemotePlayback
          className={`w-full h-full ${videoFit === 'cover' ? 'object-cover' : videoFit === 'fill' ? 'object-fill' : 'object-contain'} cursor-pointer [transform:translateZ(0)]`}
          onClick={handleVideoClick}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleVideoEnded}
          onWaiting={() => setIsBuffering(true)}
          onPlaying={() => { 
            setIsBuffering(false); 
            setIsPlaying(true); 
            resetControlsTimeout(10000); 
          }}
          onPause={() => { 
            setIsPlaying(false); 
            setIsBuffering(false); 
            resetControlsTimeout(30000); 
          }}
          onCanPlay={() => setIsBuffering(false)}
          onCanPlayThrough={() => setIsBuffering(false)}
          onSeeked={() => setIsBuffering(false)}
          onLoadedData={() => setIsBuffering(false)}
        >
          {subtitles.map((sub, idx) => (
            <track
              key={`${idx}_${sub.url}`}
              kind="subtitles"
              label={sub.lang}
              src={sub.url}
              srcLang={sub.lang.includes('繁體') || sub.lang.includes('TW') ? 'zh-TW' : sub.lang.includes('简') ? 'zh-CN' : sub.lang.includes('日本') || sub.lang.includes('ja') ? 'ja' : 'en'}
              default={idx === selectedSubIndex}
            />
          ))}
        </video>
      )}

      {/* Touch Double-Tap Seek Ripple Overlay */}
      {seekRipple && (
        <div className={`absolute z-40 pointer-events-none flex items-center justify-center animate-in fade-in zoom-in-75 duration-200 ${
          seekRipple.side === 'left' 
            ? 'left-10 top-1/2 -translate-y-1/2' 
            : seekRipple.side === 'right' 
            ? 'right-10 top-1/2 -translate-y-1/2' 
            : 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2'
        }`}>
          <div className="bg-black/85 border border-white/20 px-6 py-4 rounded-3xl backdrop-blur-xl flex flex-col items-center gap-1 shadow-2xl">
            <span className="text-3xl font-black text-white">
              {seekRipple.type === 'rewind' ? '⏪' : seekRipple.type === 'forward' ? '⏩' : seekRipple.type === 'pause' ? '⏸' : '▶️'}
            </span>
            <span className="text-xs font-mono font-bold text-red-400 tracking-wider">
              {seekRipple.text}
            </span>
          </div>
        </div>
      )}

      {/* ─── Right-Click Context Menu ─────────────────────────── */}
      {showContextMenu && (
        <div
          style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
          className="fixed z-[99] bg-[#1a1a1e]/98 border border-zinc-700 rounded-2xl shadow-2xl p-1.5 min-w-[210px] backdrop-blur-xl animate-in fade-in zoom-in-95"
          onClick={e => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500 border-b border-zinc-800 mb-1">
            AniFlix Player
          </div>
          <button
            onClick={() => { setShowDebugPanel(v => !v); setShowContextMenu(false); }}
            className="w-full text-left px-3 py-2 rounded-xl text-xs text-zinc-200 hover:bg-white/[0.08] hover:text-white flex items-center gap-2 transition-colors"
          >
            <span className="text-emerald-400">🔬</span>
            {showDebugPanel ? '關閉除錯資訊' : '顯示除錯資訊 (Debug)'}
          </button>
          <button
            onClick={() => { setShowHiddenOptions(v => !v); setShowContextMenu(false); }}
            className="w-full text-left px-3 py-2 rounded-xl text-xs text-zinc-200 hover:bg-white/[0.08] hover:text-white flex items-center gap-2 transition-colors"
          >
            <span className="text-purple-400">⚙️</span>
            進階隱藏選項
          </button>
          <div className="border-t border-zinc-800 my-1" />
          <button
            onClick={() => { togglePlay(); setShowContextMenu(false); }}
            className="w-full text-left px-3 py-2 rounded-xl text-xs text-zinc-200 hover:bg-white/[0.08] hover:text-white flex items-center gap-2 transition-colors"
          >
            <span>{isPlaying ? '⏸' : '▶️'}</span>
            {isPlaying ? '暫停' : '播放'}
          </button>
          <button
            onClick={() => { toggleMute(); setShowContextMenu(false); }}
            className="w-full text-left px-3 py-2 rounded-xl text-xs text-zinc-200 hover:bg-white/[0.08] hover:text-white flex items-center gap-2 transition-colors"
          >
            <span>{isMuted ? '🔇' : '🔊'}</span>
            {isMuted ? '取消靜音' : '靜音'}
          </button>
          <button
            onClick={() => { handleCopyLink(); setShowContextMenu(false); }}
            className="w-full text-left px-3 py-2 rounded-xl text-xs text-zinc-200 hover:bg-white/[0.08] hover:text-white flex items-center gap-2 transition-colors"
          >
            <span>📋</span>
            複製串流連結
          </button>
          <button
            onClick={() => { setShowLinkModal(true); setShowContextMenu(false); }}
            className="w-full text-left px-3 py-2 rounded-xl text-xs text-zinc-200 hover:bg-white/[0.08] hover:text-white flex items-center gap-2 transition-colors"
          >
            <span>🔗</span>
            檢查 M3U8 連結
          </button>
          <div className="border-t border-zinc-800 my-1" />
          <button
            onClick={() => { toggleFullscreen(); setShowContextMenu(false); }}
            className="w-full text-left px-3 py-2 rounded-xl text-xs text-zinc-200 hover:bg-white/[0.08] hover:text-white flex items-center gap-2 transition-colors"
          >
            <span>{isFullscreen ? '⛶' : '⛶'}</span>
            {isFullscreen ? '離開全螢幕' : '全螢幕'}
          </button>
          <button
            onClick={() => { onClose(); setShowContextMenu(false); }}
            className="w-full text-left px-3 py-2 rounded-xl text-xs text-red-400 hover:bg-red-600/10 hover:text-red-300 flex items-center gap-2 transition-colors"
          >
            <span>✕</span>
            關閉播放器
          </button>
        </div>
      )}

      {/* ─── Debug Info Panel (top-left corner) ──────────────── */}
      {showDebugPanel && (
        <div className="absolute top-20 left-4 z-[90] bg-black/90 text-green-400 font-mono text-[11px] p-3 rounded-xl border border-green-500/40 backdrop-blur-md max-w-sm w-80 shadow-2xl pointer-events-none ring-1 ring-white/10">
          <div className="text-green-300 font-bold text-xs mb-2 border-b border-green-500/30 pb-1 flex items-center gap-1.5">
            🔬 AniFlix Debug (Stats for nerds)
            <span className="ml-auto text-[10px] text-green-600 font-normal">右鍵關閉</span>
          </div>
          <div className="space-y-0.5 text-[10px]">
            {Object.entries({
              '⏱ 時間': `${debugStats.currentTime}s / ${debugStats.duration}s`,
              '📦 緩衝': debugStats.buffered,
              '🎬 就緒': debugStats.readyState,
              '🌐 網路': debugStats.networkState,
              '🎞 原生解析度': debugStats.streamRes,
              '🖥 渲染解析度': debugStats.renderRes,
              '🪟 視窗解析度': debugStats.windowRes,
              '📉 掉幀品質': debugStats.frameStats,
              '🎵 音訊採樣': debugStats.audioTrackInfo,
              '🎥 視訊編碼': debugStats.videoCodec,
              '🔊 音量': debugStats.volume,
              '⏩ 速率': `×${debugStats.playbackRate}`,
              '📡 HLS層': `Level ${debugStats.hlsLevel}`,
              '📶 頻寬': debugStats.hlsBandwidth,
              '⏳ 延遲': debugStats.hlsLatency,
              '💬 字幕': `${debugStats.subtitles} tracks | ${debugStats.selectedSub}`,
              '🎮 GPU': `${debugStats.gpuProfile} · 升頻:${debugStats.upscale}`,
              '📺 集數': `Ep ${debugStats.episode}`,
              '🔗 串流': debugStats.streamUrl,
            }).map(([k, v]) => (
              <div key={k} className="flex gap-1.5 items-baseline">
                <span className="text-green-600 shrink-0 w-22">{k}</span>
                <span className="text-green-300 break-all">{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Hidden Options Panel ─────────────────────────────── */}
      {showHiddenOptions && (
        <div
          className="absolute top-20 right-4 z-[90] bg-[#111115]/95 border border-zinc-700 rounded-2xl shadow-2xl p-4 w-72 backdrop-blur-xl animate-in fade-in slide-in-from-right-2"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-3 border-b border-zinc-800 pb-2">
            <span className="text-xs font-bold text-white">⚙️ 進階隱藏選項</span>
            <button onClick={() => setShowHiddenOptions(false)} className="text-zinc-500 hover:text-white p-1 rounded-lg hover:bg-zinc-800">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Playback rate */}
          <div className="mb-3">
            <span className="text-[11px] font-bold text-zinc-400 mb-1 block">播放速率 Playback Rate</span>
            <div className="flex flex-wrap gap-1.5">
              {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(rate => (
                <button
                  key={rate}
                  onClick={() => { if (videoRef.current) videoRef.current.playbackRate = rate; }}
                  className="px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors bg-zinc-800 text-zinc-300 hover:bg-red-600/30 hover:text-white border-zinc-700 hover:border-red-500/50"
                >
                  ×{rate}
                </button>
              ))}
            </div>
          </div>

          {/* Seek precision */}
          <div className="mb-3">
            <span className="text-[11px] font-bold text-zinc-400 mb-1 block">精準跳轉 Precision Seek</span>
            <div className="flex gap-2">
              {[-30, -10, -5, 5, 10, 30].map(sec => (
                <button
                  key={sec}
                  onClick={() => seekRelative(sec)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition-colors ${sec < 0 ? 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-blue-600/20 hover:border-blue-500/50' : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-amber-600/20 hover:border-amber-500/50'}`}
                >
                  {sec > 0 ? `+${sec}s` : `${sec}s`}
                </button>
              ))}
            </div>
          </div>

          {/* Volume fine control */}
          <div className="mb-3">
            <label htmlFor="player-volume-fine-input" className="text-[11px] font-bold text-zinc-400 mb-1.5 block">音量 Volume (精準)</label>
            <div className="flex items-center gap-2">
              <input
                id="player-volume-fine-input"
                name="volumeFine"
                aria-label="音量 Volume (精準)"
                type="range" min={0} max={1} step={0.01}
                defaultValue={volume}
                onChange={e => {
                  const v = parseFloat(e.target.value);
                  setVolume(v);
                  if (videoRef.current) videoRef.current.volume = v;
                }}
                className="flex-1 h-1.5 accent-red-500"
              />
              <span className="text-xs font-mono text-zinc-300 w-9 text-right">{Math.round(volume * 100)}%</span>
            </div>
          </div>

          {/* Loop toggle */}
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] font-bold text-zinc-400">單集循環 Loop</span>
            <button
              onClick={() => { if (videoRef.current) videoRef.current.loop = !videoRef.current.loop; }}
              className="px-3 py-1 rounded-lg text-xs font-bold border border-zinc-700 bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700 transition-colors"
            >
              {videoRef.current?.loop ? '✅ 開啟' : '⬜ 關閉'}
            </button>
          </div>

          {/* AI Upscale / Auto-Scale toggle */}
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] font-bold text-zinc-400">AI 升頻 (Auto-Scale)</span>
            <button
              onClick={() => onUpdateGpuSettings?.({ enableUpscale: !gpuSettings?.enableUpscale })}
              className={`px-3 py-1 rounded-lg text-xs font-bold border transition-colors flex items-center gap-1.5 ${
                gpuSettings?.enableUpscale 
                  ? 'border-amber-500/50 bg-amber-600/30 text-amber-300' 
                  : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:text-white'
              }`}
            >
              {gpuSettings?.enableUpscale ? <Sparkles className="w-3.5 h-3.5 text-amber-400" /> : <Zap className="w-3.5 h-3.5 text-emerald-400" />}
              <span>{gpuSettings?.enableUpscale ? '✨ AI 升頻已啟用' : '⚡ 自動 / iGPU 省電'}</span>
            </button>
          </div>

          {/* Video Fit / Aspect Ratio toggle */}
          <div className="mb-3">
            <span className="text-[11px] font-bold text-zinc-400 mb-1.5 block">畫面比例 Aspect Ratio</span>
            <div className="grid grid-cols-3 gap-1">
              {[
                { id: 'contain', label: '原比例 Fit' },
                { id: 'cover', label: '填滿 Cover' },
                { id: 'fill', label: '延展 Stretch' },
              ].map(mode => (
                <button
                  key={mode.id}
                  onClick={() => setVideoFit(mode.id)}
                  className={`py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                    videoFit === mode.id
                      ? 'bg-[#E50914] text-white border-red-500 shadow-md'
                      : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:text-white hover:bg-zinc-700'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          {/* Screenshot */}
          <div>
            <button
              onClick={() => {
                const video = videoRef.current;
                if (!video) return;
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                canvas.getContext('2d').drawImage(video, 0, 0);
                const a = document.createElement('a');
                a.download = `aniflix-ep${episode}-${Math.floor(video.currentTime)}s.png`;
                a.href = canvas.toDataURL('image/png');
                a.click();
              }}
              className="w-full py-1.5 rounded-xl text-xs font-bold bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors"
            >
              📸 截圖 Screenshot
            </button>
          </div>
        </div>
      )}


      {/* Resume Playback Toast */}
      {showResumeNotice && (
        <div className={`absolute top-20 left-1/2 -translate-x-1/2 z-40 bg-zinc-900/95 border border-zinc-700/80 rounded-xl px-4 py-2.5 shadow-2xl ${
          gpuSettings?.enableBackdropBlur ? 'backdrop-blur-md' : ''
        } flex items-center gap-3 animate-in fade-in slide-in-from-top-2`}>
          <span className="text-xs text-zinc-200">
            {t('resumedFrom')} <span className="font-mono font-bold text-[#E50914]">{formatTime(resumedTime)}</span>
          </span>
          <button
            onClick={handleRestartFromBeginning}
            className="text-xs text-zinc-400 hover:text-white underline font-semibold transition-colors"
          >
            {t('startFromBeginning')}
          </button>
          <button
            onClick={() => setShowResumeNotice(false)}
            className="text-zinc-500 hover:text-zinc-300 ml-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Auto-Play Next Episode Countdown Banner */}
      {autoPlayCountdown !== null && (
        <div className={`absolute inset-0 z-50 flex items-center justify-center ${
          gpuSettings?.enableBackdropBlur ? 'bg-black/80 backdrop-blur-sm' : 'bg-black/90'
        } animate-in fade-in duration-200`}>
          <div className="bg-[#18181c] border border-zinc-700 rounded-2xl p-6 max-w-sm w-full mx-4 text-center shadow-2xl">
            <div className="w-14 h-14 mx-auto rounded-full bg-[#E50914]/20 text-[#E50914] flex items-center justify-center mb-3">
              <Play className="w-7 h-7 fill-[#E50914] ml-0.5" />
            </div>
            <h3 className="text-base font-bold text-white mb-1">
              {t('nextEpSoon')}
            </h3>
            <p className="text-xs text-zinc-400 mb-4">
              {t('episodeLabel', 'Episode {ep}').replace('{ep}', episode + 1)} - <span className="text-red-500 font-bold text-sm font-mono">{autoPlayCountdown}</span>s
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => {
                  cancelAutoPlay();
                  if (onNextEpisode) onNextEpisode();
                }}
                className="bg-[#E50914] hover:bg-red-700 text-white font-bold px-5 py-2 rounded-lg text-xs transition-colors shadow-lg shadow-red-600/30"
              >
                {t('playNow')}
              </button>
              <button
                onClick={cancelAutoPlay}
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold px-4 py-2 rounded-lg text-xs transition-colors border border-zinc-700"
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* In-Player Episode Selector Drawer */}
      {showEpisodeDrawer && (
        <div 
          className="absolute top-0 right-0 bottom-0 w-80 sm:w-96 bg-[#141418]/95 backdrop-blur-xl border-l border-zinc-800 z-50 flex flex-col shadow-2xl animate-in slide-in-from-right duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Drawer Header */}
          <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Tv className="w-4 h-4 text-[#E50914]" />
              <h3 className="text-sm font-bold text-white">{t('episodesTab') || 'Episodes'}</h3>
              <span className="text-[11px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded font-mono">
                {maxEp}
              </span>
            </div>
            <button
              onClick={() => setShowEpisodeDrawer(false)}
              className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Range Tabs if long anime */}
          {totalEpChunks > 1 && (
            <div className="p-2 border-b border-zinc-800/80 flex items-center gap-1.5 overflow-x-auto custom-scrollbar">
              {Array.from({ length: totalEpChunks }, (_, idx) => {
                const fromEp = idx * EP_CHUNK_SIZE + 1;
                const toEp = Math.min((idx + 1) * EP_CHUNK_SIZE, maxEp);
                return (
                  <button
                    key={idx}
                    onClick={() => setEpisodeDrawerChunk(idx)}
                    className={`px-2.5 py-1 rounded text-xs font-bold whitespace-nowrap transition-colors ${
                      episodeDrawerChunk === idx 
                        ? 'bg-[#E50914] text-white shadow' 
                        : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {fromEp}-{toEp}
                  </button>
                );
              })}
            </div>
          )}

          {/* Episode Grid */}
          <div className="flex-1 p-3 overflow-y-auto custom-scrollbar grid grid-cols-4 gap-2 content-start">
            {(totalEpChunks > 1
              ? allEpisodes.slice(episodeDrawerChunk * EP_CHUNK_SIZE, (episodeDrawerChunk + 1) * EP_CHUNK_SIZE)
              : allEpisodes
            ).map((ep) => {
              const isCurrent = ep === episode;
              const isUploaded = uploadedEpisodes.length === 0 || uploadedEpisodes.includes(ep);
              return (
                <button
                  key={ep}
                  onClick={() => {
                    if (onSelectEpisode) {
                      onSelectEpisode(ep);
                    }
                    setShowEpisodeDrawer(false);
                  }}
                  className={`py-2 px-1 rounded-lg text-xs font-bold flex flex-col items-center justify-center transition-all ${
                    isCurrent
                      ? 'bg-[#E50914] text-white shadow-lg ring-2 ring-red-400/50 scale-105'
                      : isUploaded
                        ? 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-200 hover:scale-102'
                        : 'bg-zinc-900/60 text-zinc-500 hover:bg-zinc-800/60'
                  }`}
                >
                  <span>{currentLang === 'en' ? `Ep ${ep}` : currentLang === 'ja' ? `第 ${ep} 話` : `第 ${ep} 集`}</span>
                  {isCurrent && (
                    <span className="text-[9px] uppercase tracking-wider text-white/90 font-medium">{t('playingNow') || 'Playing'}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Error Message Overlay */}
      {errorMessage && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center p-6 bg-black/95 text-center pointer-events-auto">
          <div className="w-14 h-14 rounded-2xl bg-red-600/20 text-[#E50914] flex items-center justify-center mb-4 border border-red-600/30 shadow-lg shadow-red-600/10">
            {isUnreleased ? <Sparkles className="w-7 h-7 text-amber-400" /> : <AlertTriangle className="w-7 h-7" />}
          </div>
          <h3 className="text-xl font-black text-white mb-2">
            {isUnreleased ? '🎬 本季尚未正式開播 (Coming Soon)' : '⚠️ 串流資源連線提示 (Playback Notice)'}
          </h3>
          <p className="text-sm text-zinc-300 max-w-lg mb-6 leading-relaxed bg-zinc-900/80 p-3.5 rounded-xl border border-zinc-800">
            {errorMessage}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            {/* If trailer is available, prominent button to watch trailer */}
            {hasTrailer && (
              <button
                type="button"
                onClick={() => { setErrorMessage(''); setIsPlayingTrailer(true); }}
                className="flex items-center gap-2 bg-[#E50914] hover:bg-red-700 text-white font-bold px-5 py-2.5 rounded-xl text-xs transition-all shadow-xl shadow-red-600/30 motion-safe:active:scale-[0.96] cursor-pointer"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>搶先欣賞官方宣傳 PV (Watch Trailer)</span>
              </button>
            )}

            {/* External MPV */}
            <button
              type="button"
              onClick={() => onLaunchMpv(anime, episode, audioMode, rawStreamUrl || streamUrl)}
              className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold px-4 py-2.5 rounded-xl text-xs transition-colors border border-zinc-700 cursor-pointer"
            >
              <MonitorPlay className="w-4 h-4 text-purple-400" />
              <span>外部 MPV 播放</span>
            </button>

            {/* Inspect / Custom M3U8 Link */}
            <button
              type="button"
              onClick={() => setShowLinkModal(true)}
              className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold px-4 py-2.5 rounded-xl text-xs transition-colors border border-zinc-700 cursor-pointer"
            >
              <Link2 className="w-4 h-4 text-sky-400" />
              <span>自訂 / 檢查 M3U8 連結</span>
            </button>

            {/* Close / Return */}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold rounded-xl text-xs transition-colors cursor-pointer"
            >
              關閉播放器 (返回首頁)
            </button>
          </div>
        </div>
      )}

      {/* Center Buffering Spinner */}
      {isBuffering && !errorMessage && (isPlaying || !videoRef.current || (videoRef.current && videoRef.current.readyState < 2 && currentTime === 0)) && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
          <div className={`flex flex-col items-center gap-3 ${
            gpuSettings?.enableBackdropBlur ? 'bg-black/40 backdrop-blur-sm' : 'bg-zinc-900/90'
          } p-4 rounded-2xl ring-1 ring-white/10 shadow-2xl`}>
            <Loader2 className="w-10 h-10 text-[#E50914] animate-spin drop-shadow-xl" />
            <span className="text-xs font-semibold text-zinc-300 tracking-wider uppercase">
              {currentTime > 0 || (videoRef.current && videoRef.current.readyState >= 2)
                ? 'Buffering...'
                : 'Loading HLS Stream...'}
            </span>
          </div>
        </div>
      )}

      {/* Custom M3U8 Link Modal */}
      {showLinkModal && (
        <div className={`absolute inset-0 z-50 flex items-center justify-center p-4 ${
          gpuSettings?.enableBackdropBlur ? 'bg-black/80 backdrop-blur-sm' : 'bg-black/90'
        }`}>
          <div className="bg-[#1f1f1f] border border-zinc-700 rounded-2xl p-6 max-w-lg w-full shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Link2 className="w-5 h-5 text-[#E50914]" />
                <h3 className="text-base font-bold text-white">Direct Stream Link (.m3u8)</h3>
              </div>
              <button 
                onClick={() => setShowLinkModal(false)}
                className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
              This is the decrypted master HLS (<span className="text-emerald-400 font-mono">.m3u8</span>) playlist link extracted for this episode. You can copy it or paste an alternative stream link below.
            </p>

            <form onSubmit={handleApplyCustomLink} className="space-y-4">
              <div>
                <label htmlFor="player-custom-stream-url" className="text-xs font-semibold text-zinc-300 block mb-1.5">
                  Stream URL (.m3u8)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="player-custom-stream-url"
                    name="customStreamUrl"
                    aria-label="Stream URL (.m3u8)"
                    type="text"
                    autoComplete="off"
                    value={customInputUrl}
                    onChange={(e) => setCustomInputUrl(e.target.value)}
                    placeholder="https://.../master.m3u8"
                    className="flex-1 bg-black/60 border border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono text-zinc-200 focus:outline-none focus:border-[#E50914]"
                  />
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-bold text-white transition-colors border border-zinc-700"
                    title="Copy stream link"
                  >
                    {copiedLink ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    <span>{copiedLink ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowLinkModal(false)}
                  className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-bold text-zinc-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#E50914] hover:bg-red-700 text-xs font-bold text-white transition-colors"
                >
                  Play Stream
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Netflix Controls Overlay */}
      <div className={`absolute inset-0 flex flex-col justify-between transition-opacity duration-300 ${
        showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}>
        {/* Top Header Bar */}
        <div 
          style={{
            paddingTop: 'max(0.75rem, env(safe-area-inset-top, 12px))',
            paddingLeft: 'max(0.75rem, env(safe-area-inset-left, 12px))',
            paddingRight: 'max(0.75rem, env(safe-area-inset-right, 12px))'
          }}
          className="p-2 sm:p-6 bg-gradient-to-b from-black/90 via-black/40 to-transparent flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <button
              onClick={onClose}
              className="p-1.5 sm:p-2 rounded-full hover:bg-white/20 text-white transition-colors shrink-0"
              title={`${t('close')} (Esc)`}
            >
              <X className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base md:text-lg font-bold text-white drop-shadow truncate">
                  {displayTitle}
                </h2>
                {subTitle && subTitle !== displayTitle && (
                  <span className="hidden md:inline text-xs text-zinc-400 font-normal truncate max-w-xs">
                    ({subTitle})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs text-zinc-300">
                <span className="font-semibold text-zinc-200">
                  {t('episodeLabel', 'Episode {ep}').replace('{ep}', episode)}
                </span>
                <span>•</span>
                <span className="bg-zinc-800 text-zinc-300 px-1 sm:px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-bold uppercase tracking-wider">
                  {audioMode === 'sub' 
                    ? (t('audioSubLabel') || 'SUB') 
                    : (t('audioDubLabel') || 'DUB')}
                </span>
                {rawStreamUrl && (
                  <>
                    <span>•</span>
                    <span className="text-emerald-400 font-mono text-[10px] sm:text-[11px] flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      HLS
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            {/* Copy M3U8 Link Button */}
            <button
              onClick={handleCopyLink}
              className={`flex items-center gap-1.5 p-1.5 sm:px-3 sm:py-1.5 rounded-full text-xs font-bold transition-all border shadow-lg shrink-0 ${
                copiedLink 
                  ? 'bg-emerald-600/30 text-emerald-400 border-emerald-500/50' 
                  : 'bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 hover:text-white border-zinc-700'
              }`}
              title={t('copyM3u8')}
            >
              {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{copiedLink ? (t('copiedM3u8') || 'Copied M3U8') : (t('copyM3u8') || 'Copy M3U8')}</span>
            </button>

            {/* Inspect / Change Stream Link */}
            <button
              onClick={() => setShowLinkModal(true)}
              className="p-1.5 sm:p-2 rounded-full bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700 transition-colors shrink-0"
              title={t('inspectStream')}
            >
              <Link2 className="w-4 h-4" />
            </button>

            {/* External Players Dropdown / Launch */}
            <div className="relative shrink-0" ref={externalMenuRef}>
              <button
                onClick={() => setShowExternalMenu(!showExternalMenu)}
                className="flex items-center gap-1.5 bg-zinc-800/90 hover:bg-zinc-700 text-sky-400 hover:text-sky-300 p-1.5 sm:px-3 sm:py-1.5 rounded-full border border-zinc-700 text-xs font-bold transition-all shadow-lg"
                title={platform.isMobile ? "Open in Mobile Player (VLC / Infuse)" : "External Players"}
              >
                {platform.isMobile ? <Smartphone className="w-3.5 h-3.5" /> : <ExternalLink className="w-3.5 h-3.5" />}
                <span className="hidden md:inline">{platform.isMobile ? (platform.isIOS || platform.isIPad ? 'Infuse / VLC' : 'VLC / App') : 'External Player'}</span>
              </button>

              {showExternalMenu && (
                <div className="absolute right-0 top-full mt-2 w-64 bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-2 z-50 text-xs space-y-1">
                  <div className="px-3 py-1.5 border-b border-zinc-800 text-[11px] font-bold text-zinc-400 flex items-center justify-between">
                    <span>{platform.isMobile ? 'Mobile External Players' : 'External Media Players'}</span>
                    <span className="text-[10px] text-zinc-500 font-mono">
                      {platform.isIPad ? 'iPadOS' : platform.isIOS ? 'iOS' : platform.isAndroid ? 'Android' : 'Desktop'}
                    </span>
                  </div>
                  {getExternalPlayerLinks(rawStreamUrl || streamUrl, displayTitle).map((p) => (
                    <a
                      key={p.id}
                      href={p.scheme}
                      target={p.isDirect ? '_blank' : '_self'}
                      rel="noopener noreferrer"
                      onClick={() => setShowExternalMenu(false)}
                      className="flex items-center justify-between px-3 py-2 rounded-xl hover:bg-zinc-800 text-zinc-200 hover:text-white transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <ExternalLink className="w-3.5 h-3.5 text-sky-400" />
                        <span className="font-semibold">{p.name}</span>
                      </div>
                      <span className="text-[10px] font-mono bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-400 border border-zinc-700">
                        {p.badge}
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </div>

            {/* Mobile / Touch Options Menu button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                setContextMenuPos(getClampedMenuPos(rect.right - 220, rect.bottom + 8));
                setShowContextMenu(prev => !prev);
              }}
              className="p-2 rounded-full bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700 transition-colors shadow-lg shrink-0"
              title="播放器選項 / Player Options"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {/* Open in MPV Button (Available on local desktop) */}
            {platform.supportsLocalMpv && (
              <button
                onClick={() => onLaunchMpv(anime, episode, audioMode, rawStreamUrl || streamUrl)}
                className="flex items-center gap-2 bg-zinc-800/90 hover:bg-zinc-700 text-emerald-400 hover:text-emerald-300 px-3.5 py-1.5 rounded-full border border-zinc-700 text-xs font-bold transition-all shadow-lg hover:scale-105 shrink-0"
                title={t('playInMpv')}
              >
                <MonitorPlay className="w-4 h-4" />
                <span className="hidden sm:inline">{t('playInMpv') || 'Play in MPV'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Center Clickable Trigger */}
        <div className="flex-1 flex items-center justify-center" onClick={togglePlay} />

        {/* Bottom Control Bar */}
        <div 
          style={{
            paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 12px))',
            paddingLeft: 'max(0.75rem, env(safe-area-inset-left, 12px))',
            paddingRight: 'max(0.75rem, env(safe-area-inset-right, 12px))'
          }}
          className="p-2 sm:p-6 bg-gradient-to-t from-black/95 via-black/60 to-transparent"
        >
          {/* Interactive Custom Seekbar with Buffer & Live Thumbnail Tooltip */}
          <div className="relative mb-2 sm:mb-3 flex items-center gap-2 sm:gap-3 select-none">
            <span className="text-[11px] sm:text-xs text-zinc-300 font-mono w-10 sm:w-12 text-right shrink-0">
              {formatTime(currentTime)}
            </span>

            <div 
              ref={seekbarRef}
              onMouseMove={handleSeekbarMouseMove}
              onMouseLeave={handleSeekbarMouseLeave}
              onMouseDown={handleSeekbarMouseDown}
              onTouchStart={handleSeekbarTouchStart}
              onTouchMove={handleSeekbarTouchMove}
              onTouchEnd={handleSeekbarTouchEnd}
              className="relative flex-1 h-11 py-2 flex items-center cursor-pointer group/seek touch-none select-none"
            >
              {/* Floating Scrubber Preview Tooltip Bubble */}
              {(() => {
                const bubbleHalfWidth = screenInfo.isMobile ? 64 : 88;
                const seekbarWidth = seekbarRef.current?.clientWidth || 300;
                const clampedBubbleX = Math.max(bubbleHalfWidth, Math.min(hoverPixelX, seekbarWidth - bubbleHalfWidth));
                const arrowOffset = Math.max(-bubbleHalfWidth + 14, Math.min(hoverPixelX - clampedBubbleX, bubbleHalfWidth - 14));

                return (
                  <div 
                    style={{ 
                      left: `${clampedBubbleX}px`,
                      transform: 'translateX(-50%)'
                    }}
                    className={`absolute bottom-14 sm:bottom-11 z-50 pointer-events-none flex flex-col items-center transition-all duration-150 ${
                      (isHoveringSeekbar || isScrubbing) && hoverTime !== null
                        ? 'opacity-100 scale-100 visible'
                        : 'opacity-0 scale-95 invisible'
                    }`}
                  >
                    <div className="bg-[#121216]/95 border border-zinc-700/80 rounded-2xl shadow-2xl p-1.5 backdrop-blur-xl flex flex-col items-center ring-1 ring-white/10">
                      {/* Thumbnail Preview Card with 16:9 Aspect Ratio */}
                      <div className="w-32 sm:w-44 aspect-video bg-zinc-950 rounded-xl overflow-hidden relative border border-zinc-800 flex items-center justify-center">
                        {/* Poster / Cover Image Fallback */}
                        {previewPosterUrl && (
                          <img
                            src={previewPosterUrl}
                            alt=""
                            decoding="async"
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                            className="absolute inset-0 w-full h-full object-cover opacity-70 filter blur-[0.5px]"
                            loading="lazy"
                          />
                        )}
                        <video
                          ref={previewVideoRef}
                          muted
                          playsInline
                          preload="auto"
                          className={`w-full h-full object-contain bg-black relative z-10 transition-opacity duration-150 ${
                            previewReady ? 'opacity-100' : 'opacity-0'
                          }`}
                          onCanPlay={() => setPreviewReady(true)}
                          onLoadedData={() => setPreviewReady(true)}
                          onSeeked={handlePreviewSeeked}
                          onTimeUpdate={() => setPreviewReady(true)}
                        />
                        {/* Subtle Loading Spinner when seeking thumbnail */}
                        {isPreviewLoading && (
                          <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center z-20">
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20 pointer-events-none z-20" />
                        <span className="absolute bottom-1 right-1.5 text-[9px] font-mono font-bold bg-black/80 px-1.5 py-0.5 rounded text-zinc-200 z-30 shadow">
                          {Math.round(hoverPercent)}%
                        </span>
                      </div>

                      {/* Timestamp Tooltip */}
                      <div className="mt-1.5 px-2 py-0.5 rounded-md bg-zinc-800/90 text-white font-mono text-[11px] font-bold">
                        {formatTime(hoverTime || 0)}
                      </div>
                    </div>

                    {/* Downward Arrow pointing towards scrub pointer */}
                    <div 
                      style={{
                        transform: `translateX(${arrowOffset}px) rotate(45deg)`
                      }}
                      className="w-2.5 h-2.5 bg-[#121216] border-r border-b border-zinc-700 -mt-1.5" 
                    />
                  </div>
                );
              })()}

              {/* Track Background */}
              <div className="w-full h-1.5 group-hover/seek:h-2.5 bg-zinc-700/80 rounded-full overflow-hidden transition-all relative">
                {/* Buffered Range Bar */}
                <div 
                  style={{ width: `${duration ? (bufferedEnd / duration) * 100 : 0}%` }}
                  className="absolute top-0 bottom-0 left-0 bg-white/30 transition-all duration-200"
                />
                {/* Played Progress Bar (Instant 60fps tracking without lagging CSS transition during scrub) */}
                <div 
                  style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
                  className={`absolute top-0 bottom-0 left-0 bg-[#E50914] ${
                    isScrubbing ? 'transition-none' : 'transition-[width] duration-150'
                  }`}
                />
              </div>

              {/* Scrubber Knob Thumb */}
              <div 
                style={{ left: `${duration ? (currentTime / duration) * 100 : 0}%` }}
                className={`absolute -translate-x-1/2 w-3.5 h-3.5 group-hover/seek:w-4 group-hover/seek:h-4 bg-white rounded-full shadow-lg ring-2 ring-[#E50914] pointer-events-none ${
                  isScrubbing ? 'scale-125 transition-none' : 'transition-transform duration-150'
                }`}
              />
            </div>

            <span className="text-[11px] sm:text-xs text-zinc-300 font-mono w-10 sm:w-12 shrink-0">
              {formatTime(duration)}
            </span>
          </div>

          {/* Action Row */}
          <div className="flex items-center justify-between gap-1 sm:gap-2">
            {/* Left Playback Controls */}
            <div className="flex items-center gap-1 sm:gap-3">
              <button
                onClick={togglePlay}
                className="p-1.5 sm:p-2 rounded-full hover:bg-white/20 text-white transition-colors"
                title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              >
                {isPlaying ? <Pause className="w-5 h-5 sm:w-6 sm:h-6 fill-white" /> : <Play className="w-5 h-5 sm:w-6 sm:h-6 fill-white ml-0.5" />}
              </button>

              <button
                onClick={() => seekRelative(-10)}
                className="p-1.5 sm:p-2 rounded-full hover:bg-white/20 text-zinc-300 hover:text-white transition-colors"
                title="Rewind 10s (J / Left)"
              >
                <RotateCcw className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>

              <button
                onClick={() => seekRelative(10)}
                className="p-1.5 sm:p-2 rounded-full hover:bg-white/20 text-zinc-300 hover:text-white transition-colors"
                title="Fast Forward 10s (L / Right)"
              >
                <RotateCw className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>

              {/* Volume Slider: Hidden on mobile phones to save precious space, shown on sm+ */}
              <div className="hidden sm:flex items-center gap-2 group/vol">
                <button
                  onClick={toggleMute}
                  className="p-2 rounded-full hover:bg-white/20 text-white transition-colors"
                  title="Mute (M)"
                >
                  {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                </button>
                <input
                  id="player-volume-slider"
                  name="playerVolume"
                  aria-label="音量調整 Volume Slider"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setVolume(val);
                    if (videoRef.current) videoRef.current.volume = val;
                    if (isMuted) setIsMuted(false);
                  }}
                  className="w-16 sm:w-24 h-1 bg-zinc-700 accent-[#E50914] rounded-lg cursor-pointer"
                />
              </div>
            </div>

            {/* Right Action Controls */}
            <div className="flex items-center gap-1 sm:gap-2.5 relative">
              {/* Stream Source Switcher (Auto, Anime1, FramexTV, HiAnime) */}
              <div className="relative" ref={sourceMenuRef}>
                <button
                  onClick={() => {
                    setShowSourceMenu(!showSourceMenu);
                    setShowQualityMenu(false);
                    setShowSubtitlesMenu(false);
                  }}
                  className={`flex items-center gap-1 px-2 py-1 sm:px-2.5 sm:py-1 rounded-full text-[11px] sm:text-xs font-bold border transition-colors ${
                    activeSource !== 'auto'
                      ? 'bg-amber-600/30 text-amber-300 border-amber-500/50'
                      : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white border-zinc-700'
                  }`}
                  title="切換串流線路 / Stream Source"
                >
                  <Radio className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  <span className="hidden xs:inline">
                    {activeSource === 'anime1' ? 'Anime1' : activeSource === 'framextv' ? 'FramexTV' : activeSource === 'hianime' ? 'HiAnime' : '自動線路'}
                  </span>
                  <span className="xs:hidden">
                    {activeSource === 'anime1' ? 'A1' : activeSource === 'framextv' ? 'FX' : activeSource === 'hianime' ? 'HA' : '線路'}
                  </span>
                </button>

                {showSourceMenu && (
                  <div className="absolute bottom-9 right-0 bg-[#1f1f1f] border border-zinc-700 rounded-xl py-1.5 shadow-2xl z-50 min-w-[190px] animate-in fade-in zoom-in-95 backdrop-blur-xl">
                    <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-800/80 flex items-center justify-between">
                      <span>播放線路來源</span>
                      <span className="text-[9px] text-zinc-500 font-mono">Source</span>
                    </div>
                    {[
                      { id: 'auto', label: '自動線路 (Auto Failover)', badge: '推薦' },
                      { id: 'anime1', label: 'Anime1.me (1080p MP4)', badge: '繁中' },
                      { id: 'framextv', label: 'FramexTV (HD HLS)', badge: '備用' },
                      { id: 'hianime', label: 'HiAnime (HD HLS)', badge: '國際' },
                    ].map((src) => (
                      <button
                        key={src.id}
                        onClick={() => {
                          setActiveSource(src.id);
                          setShowSourceMenu(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center justify-between gap-2 ${
                          activeSource === src.id ? 'text-[#E50914] font-bold bg-zinc-800' : 'text-zinc-300 hover:bg-zinc-800/60'
                        }`}
                      >
                        <span className="truncate">{src.label}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                            {src.badge}
                          </span>
                          {activeSource === src.id && <Check className="w-3.5 h-3.5 text-[#E50914]" />}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Quick Aspect Ratio Toggle (Fit / Cover / Stretch) */}
              <button
                onClick={() => {
                  setVideoFit(prev => prev === 'contain' ? 'cover' : prev === 'cover' ? 'fill' : 'contain');
                }}
                className="flex items-center gap-1 px-2 py-1 sm:px-2.5 sm:py-1 rounded-full text-[11px] sm:text-xs font-bold border border-zinc-700 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors"
                title={`畫面比例: ${videoFit === 'contain' ? '原比例 (Fit)' : videoFit === 'cover' ? '填滿螢幕 (Cover)' : '延展 (Stretch)'}`}
              >
                <Film className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-zinc-400" />
                <span className="text-[10px] sm:text-xs uppercase">
                  {videoFit === 'contain' ? 'Fit' : videoFit === 'cover' ? 'Fill' : '100%'}
                </span>
              </button>

              {/* Quality Selector */}
              {availableQualities.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => { setShowQualityMenu(!showQualityMenu); setShowSubtitlesMenu(false); }}
                    className="flex items-center gap-1 px-2 py-1 sm:px-2.5 sm:py-1 rounded-full bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white text-[11px] sm:text-xs font-bold border border-zinc-700 transition-colors"
                    title={t('streamQuality')}
                  >
                    <SlidersHorizontal className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                    <span>
                      {currentQualityIndex === -1 ? 'Auto' : `${availableQualities[currentQualityIndex]?.name || 'Auto'}`}
                    </span>
                  </button>

                  {showQualityMenu && (
                    <div className="absolute bottom-9 right-0 bg-[#1f1f1f] border border-zinc-700 rounded-xl py-1 shadow-2xl z-50 min-w-[110px] animate-in fade-in zoom-in-95">
                      <button
                        onClick={() => handleSelectQuality(-1)}
                        className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center justify-between ${
                          currentQualityIndex === -1 ? 'text-[#E50914] font-bold bg-zinc-800' : 'text-zinc-300 hover:bg-zinc-800/60'
                        }`}
                      >
                        <span>Auto</span>
                        {currentQualityIndex === -1 && <Check className="w-3.5 h-3.5" />}
                      </button>
                      {availableQualities.map((q) => (
                        <button
                          key={q.id}
                          onClick={() => handleSelectQuality(q.id)}
                          className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center justify-between ${
                            currentQualityIndex === q.id ? 'text-[#E50914] font-bold bg-zinc-800' : 'text-zinc-300 hover:bg-zinc-800/60'
                          }`}
                        >
                          <span>{q.name}</span>
                          {currentQualityIndex === q.id && <Check className="w-3.5 h-3.5" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Subtitles Track Selector */}
              <div className="relative" ref={subMenuRef}>
                <button
                  onClick={() => { setShowSubtitlesMenu(!showSubtitlesMenu); setShowQualityMenu(false); }}
                  className={`flex items-center gap-1 px-2 py-1 sm:px-2.5 sm:py-1 rounded-full text-[11px] sm:text-xs font-bold border transition-colors ${
                    selectedSubIndex !== -1
                      ? 'bg-red-600/30 text-white border-red-500/50'
                      : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white border-zinc-700'
                  }`}
                  title={t('selectSubtitleTrack')}
                >
                  <Subtitles className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  <span className="hidden xs:inline">
                    {selectedSubIndex === -1 
                      ? (currentLang === 'en' ? 'Subs: Off' : currentLang === 'ja' ? '字幕: 關' : '字幕: 關') 
                      : (currentLang === 'en' ? 'Subs: On' : currentLang === 'ja' ? '字幕: 開' : '字幕: 開')}
                  </span>
                  <span className="xs:hidden">
                    {selectedSubIndex === -1 ? 'CC' : 'CC✓'}
                  </span>
                </button>

                {showSubtitlesMenu && (
                  <div className="absolute bottom-9 right-0 bg-[#1f1f1f] border border-zinc-700 rounded-xl py-1.5 shadow-2xl z-50 min-w-[220px] max-w-xs animate-in fade-in zoom-in-95">
                    <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-800/80 flex items-center justify-between">
                      <span>{t('subtitles')}</span>
                      <span className="text-[9px] text-zinc-500">{subtitles.length} tracks</span>
                    </div>

                    {/* Turn Subtitles Off */}
                    <button
                      onClick={() => { setSelectedSubIndex(-1); setShowSubtitlesMenu(false); }}
                      className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center justify-between ${
                        selectedSubIndex === -1 ? 'text-[#E50914] font-bold bg-zinc-800' : 'text-zinc-300 hover:bg-zinc-800/60'
                      }`}
                    >
                      <span>{t('offSub') || 'Off (關閉字幕)'}</span>
                      {selectedSubIndex === -1 && <Check className="w-3.5 h-3.5" />}
                    </button>

                    {/* Available Subtitle Tracks */}
                    <div className="max-h-48 overflow-y-auto custom-scrollbar">
                      {subtitles.map((s, idx) => {
                        const isTw = isTradZh(s.lang);
                        const isCn = isSimpZh(s.lang);
                        const isJa = isJapanese(s.lang);
                        const isEn = /(eng|english|\ben\b)/i.test(s.lang);
                        const isLocal = s.lang.startsWith('[本地');

                        return (
                          <button
                            key={idx}
                            onClick={() => { setSelectedSubIndex(idx); setShowSubtitlesMenu(false); }}
                            className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center justify-between gap-2 ${
                              selectedSubIndex === idx ? 'text-[#E50914] font-bold bg-zinc-800' : 'text-zinc-300 hover:bg-zinc-800/60'
                            }`}
                          >
                            <span className="truncate">
                              {s.lang}
                              {isLocal && <span className="ml-1 text-[10px] text-amber-400 font-bold">[本機]</span>}
                              {s.isAi && <span className="ml-1 text-[10px] text-purple-400 font-bold">[AI]</span>}
                              {isTw && !isLocal && !s.isAi && <span className="ml-1 text-[10px] text-emerald-400 font-bold">[繁中]</span>}
                              {isCn && !isTw && !isLocal && !s.isAi && <span className="ml-1 text-[10px] text-cyan-400 font-bold">[簡中]</span>}
                              {isJa && !isLocal && !s.isAi && <span className="ml-1 text-[10px] text-indigo-400 font-bold">[JA]</span>}
                              {isEn && !s.isAi && <span className="ml-1 text-[10px] text-zinc-500">[EN]</span>}
                            </span>
                            {selectedSubIndex === idx && <Check className="w-3.5 h-3.5 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>

                    {/* Import Subtitle Option */}
                    <div className="border-t border-zinc-800 mt-1 pt-1">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full text-left px-3 py-1.5 text-xs text-amber-400 hover:text-amber-300 hover:bg-zinc-800/60 flex items-center gap-1.5 font-semibold transition-colors"
                      >
                        <FileUp className="w-3.5 h-3.5" />
                        <span>{t('importSubtitle')}</span>
                      </button>
                      <input
                        id="player-subtitle-file-input"
                        name="subtitleFile"
                        aria-label="匯入字幕檔案"
                        ref={fileInputRef}
                        type="file"
                        accept=".vtt,.srt,.ass,.ssa"
                        onChange={handleImportSubtitle}
                        className="hidden"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* In-Player Episode Selector Button */}
              <button
                onClick={() => {
                  setShowEpisodeDrawer(!showEpisodeDrawer);
                  setShowQualityMenu(false);
                  setShowSubtitlesMenu(false);
                }}
                className={`flex items-center gap-1 px-2 py-1 sm:px-2.5 sm:py-1 rounded-full text-[11px] sm:text-xs font-bold border transition-colors ${
                  showEpisodeDrawer
                    ? 'bg-[#E50914] text-white border-red-500 shadow-md'
                    : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white border-zinc-700'
                }`}
                title={t('episodesTab') || 'Episodes'}
              >
                <Tv className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                <span>Ep {episode}</span>
              </button>

              {/* Prev / Next Episode: hidden on very narrow screens (< 380px), visible on xs+ */}
              <button
                onClick={onPrevEpisode}
                disabled={episode <= 1}
                className="hidden xs:flex p-1.5 sm:p-2 rounded-full hover:bg-white/20 disabled:opacity-30 text-white transition-colors"
                title={t('prevEpisode') || 'Previous Episode'}
              >
                <SkipBack className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>

              <button
                onClick={onNextEpisode}
                className="hidden xs:flex p-1.5 sm:p-2 rounded-full hover:bg-white/20 text-white transition-colors"
                title={t('nextEpisode') || 'Next Episode'}
              >
                <SkipForward className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>

              {/* Fullscreen Toggle */}
              <button
                onClick={toggleFullscreen}
                className="p-1.5 sm:p-2 rounded-full hover:bg-white/20 text-white transition-colors"
                title="Fullscreen (F)"
              >
                {isFullscreen ? <Minimize className="w-4 h-4 sm:w-5 sm:h-5" /> : <Maximize className="w-4 h-4 sm:w-5 sm:h-5" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
