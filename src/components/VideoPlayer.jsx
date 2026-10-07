import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { 
  X, Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX, 
  Maximize, Minimize, SkipBack, SkipForward, MonitorPlay, 
  Settings, Loader2, Copy, Check, Link2, ExternalLink, SlidersHorizontal,
  Subtitles, Upload, FileUp, Tv, Smartphone, Zap, Sparkles
} from 'lucide-react';
import { getPlatformInfo, getExternalPlayerLinks } from '../utils/platform.js';


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

export default function VideoPlayer({ 
  anime, 
  episode = 1, 
  audioMode = 'sub',
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

  // In-Player Episode Drawer state
  const [showEpisodeDrawer, setShowEpisodeDrawer] = useState(false);
  const [episodeDrawerChunk, setEpisodeDrawerChunk] = useState(0);
  const [uploadedEpisodes, setUploadedEpisodes] = useState([]);

  // Auto-play next episode countdown
  const [autoPlayCountdown, setAutoPlayCountdown] = useState(null);
  const countdownTimerRef = useRef(null);

  // Resume playback timestamp
  const [resumedTime, setResumedTime] = useState(null);
  const [showResumeNotice, setShowResumeNotice] = useState(false);

  // Dynamic Chinese title resolution
  const [chineseInfo, setChineseInfo] = useState(null);

  // Platform & External Players Detection
  const platform = getPlatformInfo();
  const [showExternalMenu, setShowExternalMenu] = useState(false);
  const externalMenuRef = useRef(null);

  // Debug overlay & hidden options
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [showHiddenOptions, setShowHiddenOptions] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [debugStats, setDebugStats] = useState({});
  const debugIntervalRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (externalMenuRef.current && !externalMenuRef.current.contains(e.target)) {
        setShowExternalMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
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
      setDebugStats({
        currentTime: video ? video.currentTime.toFixed(2) : '—',
        duration: video ? video.duration?.toFixed(2) : '—',
        buffered: video && video.buffered.length > 0
          ? `${video.buffered.start(0).toFixed(1)}s – ${video.buffered.end(video.buffered.length - 1).toFixed(1)}s`
          : '—',
        readyState: video ? ['HAVE_NOTHING','HAVE_METADATA','HAVE_CURRENT_DATA','HAVE_FUTURE_DATA','HAVE_ENOUGH_DATA'][video.readyState] : '—',
        networkState: video ? ['EMPTY','IDLE','LOADING','NO_SOURCE'][video.networkState] : '—',
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

    async function loadStream() {
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
            maxAiredCap
          })
        }).then(r => r.json());

        // Concurrently query local subtitles on user's machine (e.g. downloads folder)
        const localSubsPromise = fetch(`/api/subtitles/local?animeTitle=${encodeURIComponent(displayTitle || rawTitle)}&episode=${episode}`)
          .then(r => r.json())
          .catch(() => ({ success: false, subtitles: [] }));

        const [streamRes, localSubsRes] = await Promise.all([streamPromise, localSubsPromise]);

        if (!isCancelled) {
          if (streamRes.success && (streamRes.data.proxiedStreamUrl || streamRes.data.streamUrl)) {
            const raw = streamRes.data.streamUrl;
            const proxied = streamRes.data.proxiedStreamUrl || toPlayableUrl(raw, streamRes.data.referer);
            const refHeader = streamRes.data.referer || 'https://zokoanime.video/';

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
            setErrorMessage(streamRes.error || 'Unable to resolve anime stream for this episode.');
          }
        }
      } catch (err) {
        console.error('Failed to load stream:', err);
        if (!isCancelled) {
          setErrorMessage(err.message || 'Network error fetching video stream.');
        }
      } finally {
        if (!isCancelled) setIsBuffering(false);
      }
    }

    loadStream();
    return () => { isCancelled = true; };
  }, [anime, episode, audioMode, displayTitle, rawTitle, currentLang]);

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
    const video = videoRef.current;
    if (!video) return;
    const cur = video.currentTime;
    setCurrentTime(cur);
    setDuration(video.duration || 0);
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

  // Setup HLS or Native Video
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;

    const playable = toPlayableUrl(streamUrl, referer);

    if (Hls.isSupported() && (playable.includes('.m3u8') || playable.includes('/api/proxy'))) {
      if (hlsRef.current) hlsRef.current.destroy();

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        progressive: true,
        backBufferLength: 90,
        maxBufferLength: 60,
        maxMaxBufferLength: 600,
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

      hls.on(Hls.Events.ERROR, (event, data) => {
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
  }, [streamUrl]);

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

  // Controls Visibility Timeout
  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying && !showLinkModal && !showQualityMenu) {
        setShowControls(false);
      }
    }, 3000);
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT') return;
      const video = videoRef.current;
      if (!video) return;

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          video.currentTime = Math.min(video.duration, video.currentTime + 5);
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

  const formatTime = (secs) => {
    if (isNaN(secs)) return '00:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div 
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenuPos({ x: e.clientX, y: e.clientY });
        setShowContextMenu(true);
      }}
      className="fixed inset-0 z-50 bg-black flex items-center justify-center select-none overflow-hidden"
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        crossOrigin="anonymous"
        playsInline
        preload="auto"
        disableRemotePlayback
        className="w-full h-full object-contain cursor-pointer [transform:translateZ(0)]"
        onClick={togglePlay}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleVideoEnded}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => { setIsBuffering(false); setIsPlaying(true); }}
        onPause={() => setIsPlaying(false)}
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
        <div className="absolute top-20 left-4 z-[90] bg-black/85 text-green-400 font-mono text-[11px] p-3 rounded-xl border border-green-500/30 backdrop-blur-md max-w-xs w-72 shadow-2xl pointer-events-none">
          <div className="text-green-300 font-bold text-xs mb-2 border-b border-green-500/30 pb-1 flex items-center gap-1.5">
            🔬 AniFlix Debug
            <span className="ml-auto text-[10px] text-green-600 font-normal">右鍵關閉</span>
          </div>
          <div className="space-y-0.5 text-[10.5px]">
            {Object.entries({
              '⏱ 時間': `${debugStats.currentTime}s / ${debugStats.duration}s`,
              '📦 緩衝': debugStats.buffered,
              '🎬 就緒': debugStats.readyState,
              '🌐 網路': debugStats.networkState,
              '🔊 音量': debugStats.volume,
              '⏩ 速率': `×${debugStats.playbackRate}`,
              '📡 HLS層': `Level ${debugStats.hlsLevel}`,
              '📶 頻寬': debugStats.hlsBandwidth,
              '⏳ 延遲': debugStats.hlsLatency,
              '💬 字幕': `${debugStats.subtitles} tracks | ${debugStats.selectedSub}`,
              '🎮 GPU': `${debugStats.gpuProfile} · 升頻:${debugStats.upscale}`,
              '🎵 聲軌': debugStats.audioMode,
              '📺 集數': `Ep ${debugStats.episode}`,
              '🔗 串流': debugStats.streamUrl,
            }).map(([k, v]) => (
              <div key={k} className="flex gap-1.5">
                <span className="text-green-600 shrink-0 w-20">{k}</span>
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
            <label className="text-[11px] font-bold text-zinc-400 mb-1 block">播放速率 Playback Rate</label>
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
            <label className="text-[11px] font-bold text-zinc-400 mb-1 block">精準跳轉 Precision Seek</label>
            <div className="flex gap-2">
              {[-30, -10, -5, 5, 10, 30].map(sec => (
                <button
                  key={sec}
                  onClick={() => { if (videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime + sec); }}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition-colors ${sec < 0 ? 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-blue-600/20 hover:border-blue-500/50' : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-amber-600/20 hover:border-amber-500/50'}`}
                >
                  {sec > 0 ? `+${sec}s` : `${sec}s`}
                </button>
              ))}
            </div>
          </div>

          {/* Volume fine control */}
          <div className="mb-3">
            <label className="text-[11px] font-bold text-zinc-400 mb-1.5 block">音量 Volume (精準)</label>
            <div className="flex items-center gap-2">
              <input
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
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center p-6 bg-black/90 text-center">
          <div className="w-12 h-12 rounded-full bg-red-600/20 text-[#E50914] flex items-center justify-center mb-3">
            <X className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">Stream Playback Issue</h3>
          <p className="text-sm text-zinc-400 max-w-md mb-6">{errorMessage}</p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onLaunchMpv(anime, episode, audioMode, rawStreamUrl || streamUrl)}
              className="flex items-center gap-2 bg-[#E50914] hover:bg-red-700 text-white font-bold px-4 py-2 rounded-lg text-xs transition-colors shadow-lg shadow-red-600/20"
            >
              <MonitorPlay className="w-4 h-4" />
              <span>Play with External MPV</span>
            </button>
            <button
              onClick={() => setShowLinkModal(true)}
              className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold px-4 py-2 rounded-lg text-xs transition-colors border border-zinc-700"
            >
              <Link2 className="w-4 h-4" />
              <span>Inspect M3U8 Link</span>
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold rounded-lg text-xs transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Center Buffering Spinner */}
      {isBuffering && !errorMessage && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className={`flex flex-col items-center gap-3 ${
            gpuSettings?.enableBackdropBlur ? 'bg-black/40 backdrop-blur-sm' : 'bg-zinc-900/90'
          } p-4 rounded-2xl`}>
            <Loader2 className="w-12 h-12 text-[#E50914] animate-spin drop-shadow-xl" />
            <span className="text-xs font-semibold text-zinc-300 tracking-wider uppercase">Loading HLS Stream...</span>
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
                <label className="text-xs font-semibold text-zinc-300 block mb-1.5">
                  Stream URL (.m3u8)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
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
        <div className="p-4 sm:p-6 bg-gradient-to-b from-black/90 via-black/40 to-transparent flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-white/20 text-white transition-colors"
              title={`${t('close')} (Esc)`}
            >
              <X className="w-6 h-6" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white drop-shadow truncate max-w-md sm:max-w-xl">
                  {displayTitle}
                </h2>
                {subTitle && subTitle !== displayTitle && (
                  <span className="hidden md:inline text-xs text-zinc-400 font-normal truncate max-w-xs">
                    ({subTitle})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-300">
                <span className="font-semibold text-zinc-200">
                  {t('episodeLabel', 'Episode {ep}').replace('{ep}', episode)}
                </span>
                <span>•</span>
                <span className="bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
                  {audioMode === 'sub' 
                    ? (t('audioSubLabel') || 'SUB') 
                    : (t('audioDubLabel') || 'DUB')}
                </span>
                {rawStreamUrl && (
                  <>
                    <span>•</span>
                    <span className="text-emerald-400 font-mono text-[11px] flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      HLS m3u8
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Quick iGPU Low-Power / AI Upscale mode switcher */}
            <button
              onClick={() => onUpdateGpuSettings?.({ enableUpscale: !gpuSettings?.enableUpscale })}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all border shadow-lg ${
                gpuSettings?.enableUpscale
                  ? 'bg-amber-600/30 text-amber-300 border-amber-500/50 hover:bg-amber-600/40'
                  : 'bg-emerald-600/30 text-emerald-300 border-emerald-500/50 hover:bg-emerald-600/40'
              }`}
              title={gpuSettings?.enableUpscale ? 'AI 升頻中 (點擊切換為 iGPU 省電模式)' : 'iGPU 省電模式 (點擊開啟 AI 升頻)'}
            >
              {gpuSettings?.enableUpscale ? <Sparkles className="w-3.5 h-3.5 text-amber-400" /> : <Zap className="w-3.5 h-3.5 text-emerald-400" />}
              <span>{gpuSettings?.enableUpscale ? 'AI 升頻' : '⚡ iGPU 模式'}</span>
            </button>

            {/* Copy M3U8 Link Button */}
            <button
              onClick={handleCopyLink}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all border shadow-lg ${
                copiedLink 
                  ? 'bg-emerald-600/30 text-emerald-400 border-emerald-500/50' 
                  : 'bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 hover:text-white border-zinc-700'
              }`}
              title={t('copyM3u8')}
            >
              {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedLink ? (t('copiedM3u8') || 'Copied M3U8') : (t('copyM3u8') || 'Copy M3U8')}</span>
            </button>

            {/* Inspect / Change Stream Link */}
            <button
              onClick={() => setShowLinkModal(true)}
              className="p-2 rounded-full bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700 transition-colors"
              title={t('inspectStream')}
            >
              <Link2 className="w-4 h-4" />
            </button>

            {/* External Players Dropdown / Launch */}
            <div className="relative" ref={externalMenuRef}>
              <button
                onClick={() => setShowExternalMenu(!showExternalMenu)}
                className="flex items-center gap-1.5 bg-zinc-800/90 hover:bg-zinc-700 text-sky-400 hover:text-sky-300 px-3 py-1.5 rounded-full border border-zinc-700 text-xs font-bold transition-all shadow-lg"
                title={platform.isMobile ? "Open in Mobile Player (VLC / Infuse)" : "External Players"}
              >
                {platform.isMobile ? <Smartphone className="w-3.5 h-3.5" /> : <ExternalLink className="w-3.5 h-3.5" />}
                <span>{platform.isMobile ? (platform.isIOS || platform.isIPad ? 'Infuse / VLC' : 'VLC / App') : 'External Player'}</span>
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

            {/* Open in MPV Button (Available on local desktop) */}
            {platform.supportsLocalMpv && (
              <button
                onClick={() => onLaunchMpv(anime, episode, audioMode, rawStreamUrl || streamUrl)}
                className="flex items-center gap-2 bg-zinc-800/90 hover:bg-zinc-700 text-emerald-400 hover:text-emerald-300 px-3.5 py-1.5 rounded-full border border-zinc-700 text-xs font-bold transition-all shadow-lg hover:scale-105"
                title={t('playInMpv')}
              >
                <MonitorPlay className="w-4 h-4" />
                <span>{t('playInMpv') || 'Play in MPV'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Center Clickable Trigger */}
        <div className="flex-1 flex items-center justify-center" onClick={togglePlay} />

        {/* Bottom Control Bar */}
        <div className="p-4 sm:p-6 bg-gradient-to-t from-black/95 via-black/60 to-transparent">
          {/* Seekbar */}
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs text-zinc-300 font-mono w-12 text-right">
              {formatTime(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={duration || 100}
              value={currentTime}
              onChange={handleSeek}
              className="flex-1 h-1.5 bg-zinc-700 accent-[#E50914] rounded-lg cursor-pointer"
            />
            <span className="text-xs text-zinc-300 font-mono w-12">
              {formatTime(duration)}
            </span>
          </div>

          {/* Action Row */}
          <div className="flex items-center justify-between">
            {/* Left Playback Controls */}
            <div className="flex items-center gap-4">
              <button
                onClick={togglePlay}
                className="p-2 rounded-full hover:bg-white/20 text-white transition-colors"
                title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              >
                {isPlaying ? <Pause className="w-6 h-6 fill-white" /> : <Play className="w-6 h-6 fill-white ml-0.5" />}
              </button>

              <button
                onClick={() => {
                  if (videoRef.current) videoRef.current.currentTime -= 10;
                }}
                className="p-2 rounded-full hover:bg-white/20 text-zinc-300 hover:text-white transition-colors"
                title="Rewind 10s"
              >
                <RotateCcw className="w-5 h-5" />
              </button>

              <button
                onClick={() => {
                  if (videoRef.current) videoRef.current.currentTime += 10;
                }}
                className="p-2 rounded-full hover:bg-white/20 text-zinc-300 hover:text-white transition-colors"
                title="Fast Forward 10s"
              >
                <RotateCw className="w-5 h-5" />
              </button>

              {/* Volume Slider */}
              <div className="flex items-center gap-2 group/vol">
                <button
                  onClick={toggleMute}
                  className="p-2 rounded-full hover:bg-white/20 text-white transition-colors"
                  title="Mute (M)"
                >
                  {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                </button>
                <input
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
            <div className="flex items-center gap-3 relative">
              {/* Quality Selector */}
              {availableQualities.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => { setShowQualityMenu(!showQualityMenu); setShowSubtitlesMenu(false); }}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs font-bold border border-zinc-700 transition-colors"
                    title={t('streamQuality')}
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
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
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border transition-colors ${
                    selectedSubIndex !== -1
                      ? 'bg-red-600/30 text-white border-red-500/50'
                      : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white border-zinc-700'
                  }`}
                  title={t('selectSubtitleTrack')}
                >
                  <Subtitles className="w-3.5 h-3.5" />
                  <span>
                    {selectedSubIndex === -1 
                      ? (currentLang === 'en' ? 'Subs: Off' : currentLang === 'ja' ? '字幕: オフ' : '字幕: 關') 
                      : (currentLang === 'en' ? 'Subs: On' : currentLang === 'ja' ? '字幕: オン' : '字幕: 開')}
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
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border transition-colors ${
                  showEpisodeDrawer
                    ? 'bg-[#E50914] text-white border-red-500 shadow-md'
                    : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white border-zinc-700'
                }`}
                title={t('episodesTab') || 'Episodes'}
              >
                <Tv className="w-3.5 h-3.5" />
                <span>{currentLang === 'en' ? `Ep ${episode}` : currentLang === 'ja' ? `第 ${episode} 話` : `第 ${episode} 集`}</span>
              </button>

              {/* Prev / Next Episode */}
              <button
                onClick={onPrevEpisode}
                disabled={episode <= 1}
                className="p-2 rounded-full hover:bg-white/20 disabled:opacity-30 text-white transition-colors"
                title={t('prevEpisode') || 'Previous Episode'}
              >
                <SkipBack className="w-5 h-5" />
              </button>

              <button
                onClick={onNextEpisode}
                className="p-2 rounded-full hover:bg-white/20 text-white transition-colors"
                title={t('nextEpisode') || 'Next Episode'}
              >
                <SkipForward className="w-5 h-5" />
              </button>

              {/* Fullscreen Toggle */}
              <button
                onClick={toggleFullscreen}
                className="p-2 rounded-full hover:bg-white/20 text-white transition-colors"
                title="Fullscreen (F)"
              >
                {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
