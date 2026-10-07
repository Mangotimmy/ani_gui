// src/components/HeroBanner.jsx - Featured Anime Hero Banner with Localization & Responsive Layout
import React, { useState, useEffect } from 'react';
import { Play, Download, Info, Star } from 'lucide-react';

const GENRE_MAP = {
  'Action': { 'zh-TW': '動作', 'zh-CN': '动作', 'ja': 'アクション' },
  'Adventure': { 'zh-TW': '冒險', 'zh-CN': '冒险', 'ja': '冒険' },
  'Comedy': { 'zh-TW': '搞笑', 'zh-CN': '搞笑', 'ja': 'コメディ' },
  'Drama': { 'zh-TW': '劇情', 'zh-CN': '剧情', 'ja': 'ドラマ' },
  'Fantasy': { 'zh-TW': '奇幻', 'zh-CN': '奇幻', 'ja': 'ファンタジー' },
  'Supernatural': { 'zh-TW': '超自然', 'zh-CN': '超自然', 'ja': '超常' },
  'Mystery': { 'zh-TW': '懸疑', 'zh-CN': '悬疑', 'ja': 'ミステリー' },
  'Romance': { 'zh-TW': '戀愛', 'zh-CN': '恋爱', 'ja': '恋愛' },
  'Sci-Fi': { 'zh-TW': '科幻', 'zh-CN': '科幻', 'ja': 'SF' },
  'Slice of Life': { 'zh-TW': '日常', 'zh-CN': '日常', 'ja': '日常' },
  'Sports': { 'zh-TW': '體育', 'zh-CN': '体育', 'ja': 'スポーツ' },
  'Thriller': { 'zh-TW': '驚悚', 'zh-CN': '惊悚', 'ja': 'スリラー' },
  'Horror': { 'zh-TW': '恐怖', 'zh-CN': '恐怖', 'ja': 'ホラー' },
  'Psychological': { 'zh-TW': '心理', 'zh-CN': '心理', 'ja': 'サイコ' },
  'Mecha': { 'zh-TW': '機戰', 'zh-CN': '机战', 'ja': 'メカ' },
  'Music': { 'zh-TW': '音樂', 'zh-CN': '音乐', 'ja': '音楽' },
  'Ecchi': { 'zh-TW': '福利', 'zh-CN': '福利', 'ja': 'エッチ' },
};

export default function HeroBanner({ 
  anime, 
  onPlay, 
  onDownload, 
  onMoreInfo, 
  currentLang = 'zh-TW',
  t = (k) => k 
}) {
  const [chineseInfo, setChineseInfo] = useState(null);

  useEffect(() => {
    if (!anime?.id || (currentLang !== 'zh-TW' && currentLang !== 'zh-CN')) {
      setChineseInfo(null);
      return;
    }
    let cancelled = false;
    const romaji = anime.title?.romaji || '';
    const native = anime.title?.native || '';
    const english = anime.title?.english || '';
    const targetLang = currentLang === 'zh-CN' ? 'zh-CN' : 'zh-TW';

    fetch(`/api/anime/${anime.id}/chinese-info?romaji=${encodeURIComponent(romaji)}&native=${encodeURIComponent(native)}&english=${encodeURIComponent(english)}&description=${encodeURIComponent(anime.description || '')}&lang=${targetLang}`)
      .then(r => r.json())
      .then(d => {
        if (!cancelled && d.success) {
          setChineseInfo(d);
        }
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [anime?.id, currentLang]);

  if (!anime) return null;

  const title = (
    currentLang === 'ja'
      ? (anime.title?.native || anime.title?.romaji || anime.title?.english)
      : currentLang === 'zh-CN'
      ? (chineseInfo?.titleZh || anime.titleZhCN || anime.titleZh || anime.titleZhTW || anime.title?.native || anime.title?.english)
      : currentLang === 'zh-TW'
      ? (chineseInfo?.titleZh || anime.titleZhTW || anime.titleZh || anime.titleZhCN || anime.title?.native || anime.title?.english)
      : (anime.title?.english || anime.title?.romaji || anime.title?.native)
  ) || 'Anime';

  const backdrop = anime.bannerImage || anime.coverImage?.extraLarge || anime.coverImage?.large;
  
  const rawSynopsis = (currentLang === 'zh-TW' || currentLang === 'zh-CN')
    ? (chineseInfo?.summaryZh || anime.summaryZh || anime.description)
    : anime.description;
  const synopsis = rawSynopsis?.replace(/<[^>]*>/g, '') || (
    currentLang === 'ja' ? 'あらすじ情報はありません。' : currentLang.startsWith('zh') ? '暫無劇情簡介。' : 'No synopsis available.'
  );

  const scoreText = anime.averageScore 
    ? `${anime.averageScore}% ${currentLang === 'ja' ? '一致' : currentLang.startsWith('zh') ? '契合度' : 'Match'}` 
    : (currentLang === 'ja' ? '人気作' : currentLang.startsWith('zh') ? '熱門推薦' : 'Popular');

  const statusText = (() => {
    if (!anime.status) return '';
    if (anime.status === 'NOT_YET_RELEASED') {
      return currentLang === 'ja' ? '近日公開' : currentLang.startsWith('zh') ? '即將開播' : 'UPCOMING';
    }
    if (anime.status === 'RELEASING') {
      return currentLang === 'ja' ? '放送中' : currentLang.startsWith('zh') ? '連載中' : 'RELEASING';
    }
    if (anime.status === 'FINISHED') {
      return currentLang === 'ja' ? '完結' : currentLang.startsWith('zh') ? '已完結' : 'FINISHED';
    }
    return anime.status;
  })();

  const activeAnimeObj = chineseInfo?.titleZh 
    ? { ...anime, titleZh: chineseInfo.titleZh, titleZhTW: chineseInfo.titleZh, titleZhCN: chineseInfo.titleZh } 
    : anime;

  return (
    <div className="relative w-full h-[76vh] min-h-[580px] max-h-[820px] select-none overflow-hidden">
      {/* Background Image with Dark Vignette */}
      <div className="absolute inset-0">
        <img
          src={backdrop}
          alt={title}
          className="w-full h-full object-cover object-center"
        />
        {/* Gradients: bottom fade + left side fade */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-[#141414]/75 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#141414] via-[#141414]/70 to-transparent w-full md:w-3/4" />
      </div>

      {/* Content Overlay */}
      <div className="relative z-10 h-full flex flex-col justify-end pt-20 pb-16 sm:pb-20 md:pb-24 px-4 md:px-12 max-w-3xl">
        {/* Rating & Details Pill */}
        <div className="flex items-center gap-2.5 mb-2.5 text-xs font-semibold">
          <span className="text-emerald-400 font-bold flex items-center gap-1 bg-emerald-950/70 px-2 py-0.5 rounded border border-emerald-500/30 shadow-sm backdrop-blur-sm">
            <Star className="w-3.5 h-3.5 fill-emerald-400" />
            {scoreText}
          </span>
          {anime.seasonYear && (
            <span className="text-zinc-400 bg-zinc-900/60 px-1.5 py-0.5 rounded border border-zinc-800">
              {anime.seasonYear}
            </span>
          )}
          {anime.episodes && (
            <span className="border border-zinc-700/80 bg-zinc-900/60 text-zinc-300 px-1.5 py-0.5 rounded">
              {anime.episodes} {currentLang === 'ja' ? '話' : currentLang.startsWith('zh') ? '集' : 'Episodes'}
            </span>
          )}
          {statusText && (
            <span className="text-zinc-400 tracking-wider text-[11px] font-bold">
              {statusText}
            </span>
          )}
        </div>

        {/* Title */}
        <h1 className="text-2xl sm:text-4xl md:text-5xl font-black text-white drop-shadow-lg mb-2.5 leading-tight tracking-tight line-clamp-2">
          {title}
        </h1>

        {/* Genres */}
        {anime.genres && anime.genres.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {anime.genres.slice(0, 4).map((g) => {
              const localizedG = GENRE_MAP[g]?.[currentLang] || GENRE_MAP[g]?.['zh-TW'] || g;
              return (
                <span key={g} className="text-[11px] sm:text-xs text-zinc-300 bg-white/10 px-2 py-0.5 rounded-full backdrop-blur-sm border border-white/5">
                  {localizedG}
                </span>
              );
            })}
          </div>
        )}

        {/* Synopsis */}
        <p className="text-xs sm:text-sm text-zinc-300 line-clamp-3 mb-5 drop-shadow leading-relaxed">
          {synopsis}
        </p>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-3">
          {anime.status === 'NOT_YET_RELEASED' ? (
            <>
              {anime.trailer?.id ? (
                <button
                  onClick={() => onMoreInfo(activeAnimeObj)}
                  className="flex items-center gap-2 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-bold px-6 py-2.5 rounded-md transition-all shadow-lg shadow-red-600/30 hover:scale-105 active:scale-95"
                >
                  <Play className="w-5 h-5 fill-white" />
                  <span>{currentLang === 'ja' ? '予告編 / PV を再生' : currentLang.startsWith('zh') ? '播放預告片 / PV' : 'Play Trailer / PV'}</span>
                </button>
              ) : null}
              <button
                onClick={() => onMoreInfo(activeAnimeObj)}
                className="flex items-center gap-2 bg-zinc-700/80 hover:bg-zinc-600/80 text-white font-medium px-5 py-2.5 rounded-md transition-all backdrop-blur-sm hover:scale-105 active:scale-95"
              >
                <Info className="w-5 h-5" />
                <span>{currentLang === 'ja' ? '公開スケジュール' : currentLang.startsWith('zh') ? '開播排期與詳情' : 'Release Schedule'}</span>
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => onPlay(activeAnimeObj, 1)}
                className="flex items-center gap-2 bg-white hover:bg-zinc-200 text-black font-bold px-6 py-2.5 rounded-md transition-all shadow-lg hover:scale-105 active:scale-95"
              >
                <Play className="w-5 h-5 fill-black" />
                <span>{currentLang === 'ja' ? '第 1 話を再生' : currentLang.startsWith('zh') ? '立即播放 第 1 集' : 'Play Ep 1'}</span>
              </button>

              <button
                onClick={() => onDownload(activeAnimeObj)}
                className="flex items-center gap-2 bg-[#E50914] hover:bg-[#B81D24] text-white font-bold px-5 py-2.5 rounded-md transition-all shadow-lg shadow-red-600/30 hover:scale-105 active:scale-95"
              >
                <Download className="w-5 h-5" />
                <span>{currentLang === 'ja' ? 'ダウンロード' : t('downloads') || '下載管理'}</span>
              </button>

              <button
                onClick={() => onMoreInfo(activeAnimeObj)}
                className="flex items-center gap-2 bg-zinc-700/80 hover:bg-zinc-600/80 text-white font-medium px-4 py-2.5 rounded-md transition-all backdrop-blur-sm hover:scale-105 active:scale-95"
              >
                <Info className="w-5 h-5" />
                <span>{t('moreInfo') || '詳細情報'}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
