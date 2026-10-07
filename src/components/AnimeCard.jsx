// src/components/AnimeCard.jsx - Netflix-style Card with Favorites & Quick Actions
import React, { useState } from 'react';
import { Play, Download, Info, Star, Heart, Sparkles } from 'lucide-react';

function AnimeCard({ 
  anime, 
  onPlay, 
  onDownload, 
  onMoreInfo,
  isFavorite = false,
  onToggleFavorite,
  currentLang = 'zh-TW'
}) {
  const [isHovered, setIsHovered] = useState(false);

  const title = (
    currentLang === 'ja'
      ? (anime.title?.native || anime.title?.romaji || anime.title?.english)
      : currentLang === 'zh-CN'
      ? (anime.titleZhCN || anime.titleZh || anime.title?.native || anime.title?.english || anime.title?.romaji)
      : currentLang === 'zh-TW'
      ? (anime.titleZhTW || anime.titleZh || anime.title?.native || anime.title?.english || anime.title?.romaji)
      : (anime.title?.english || anime.title?.romaji || anime.title?.native)
  ) || 'Anime';
  const poster = anime.coverImage?.extraLarge || anime.coverImage?.large || anime.coverImage?.medium;
  const score = anime.averageScore ? `${anime.averageScore}%` : null;

  return (
    <div 
      className="relative flex-none w-[160px] sm:w-[190px] md:w-[220px] group cursor-pointer"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '190px 285px' }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Poster Image Container */}
      <div 
        onClick={() => onMoreInfo(anime)}
        className="relative aspect-[2/3] w-full rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 shadow-md card-hover-effect transition-all duration-300 group-hover:border-zinc-700"
      >
        <img
          src={poster}
          alt={title}
          loading="lazy"
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
        />

        {/* Favorite Heart Badge Top Left */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (onToggleFavorite) onToggleFavorite(anime);
          }}
          className={`absolute top-2 left-2 z-10 p-1.5 rounded-full backdrop-blur-md transition-all ${
            isFavorite
              ? 'bg-red-600/80 text-white shadow-lg shadow-red-600/30'
              : 'bg-black/60 text-zinc-300 opacity-0 group-hover:opacity-100 hover:text-white hover:bg-black/80'
          }`}
          title={isFavorite 
            ? (currentLang === 'ja' ? 'お気に入りから削除' : currentLang.startsWith('zh') ? '從收藏移除' : 'Remove from Favorites') 
            : (currentLang === 'ja' ? 'お気に入りに追加' : currentLang.startsWith('zh') ? '加入我的收藏' : 'Add to Favorites')}
        >
          <Heart className={`w-3.5 h-3.5 ${isFavorite ? 'fill-white' : ''}`} />
        </button>

        {/* Match Percentage or Rating or Upcoming Badge Top Right */}
        {anime.matchPercent ? (
          <div className="absolute top-2 right-2 flex items-center gap-1 bg-emerald-950/85 backdrop-blur-md px-1.5 py-0.5 rounded text-[10px] font-bold text-emerald-400 border border-emerald-500/30 shadow-md">
            <span>{anime.matchPercent}% {currentLang === 'ja' ? '一致' : currentLang.startsWith('zh') ? '契合度' : 'Match'}</span>
          </div>
        ) : anime.status === 'NOT_YET_RELEASED' ? (
          <div className="absolute top-2 right-2 flex items-center gap-1 bg-indigo-600/90 backdrop-blur-md px-1.5 py-0.5 rounded text-[10px] font-bold text-white shadow-md">
            <span>
              {anime.startDate?.year 
                ? `${anime.startDate.year}${anime.startDate.month ? '/' + anime.startDate.month : ''}`
                : (currentLang === 'ja' ? '近日公開' : currentLang.startsWith('zh') ? '即將上線' : 'UPCOMING')}
            </span>
          </div>
        ) : score ? (
          <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/75 backdrop-blur-md px-1.5 py-0.5 rounded text-[11px] font-bold text-amber-400 border border-amber-500/20">
            <Star className="w-3 h-3 fill-amber-400" />
            <span>{score}</span>
          </div>
        ) : null}

        {/* Bottom Title Gradient Overlay on Card */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent p-2.5 pt-6 flex flex-col justify-end">
          {anime.recommendationReason && (
            <div className="text-[10px] text-amber-300 font-semibold line-clamp-1 mb-1 flex items-center gap-1 bg-amber-950/70 px-1.5 py-0.5 rounded border border-amber-500/30 shadow-sm backdrop-blur-sm">
              <Sparkles className="w-2.5 h-2.5 text-amber-400 shrink-0" />
              <span className="truncate">{anime.recommendationReason}</span>
            </div>
          )}
          <h3 className="text-xs sm:text-sm font-bold text-white line-clamp-1 group-hover:text-red-400 transition-colors">
            {title}
          </h3>
          <div className="flex items-center justify-between text-[11px] text-zinc-400 mt-0.5">
            <span>
              {anime.status === 'NOT_YET_RELEASED' 
                ? (currentLang === 'ja' ? '近日公開' : currentLang.startsWith('zh') ? '即將上線' : 'Upcoming') 
                : (anime.episodes 
                    ? (currentLang === 'ja' ? `${anime.episodes} 話` : currentLang === 'en' ? `${anime.episodes} Ep` : `${anime.episodes} 集`) 
                    : (currentLang === 'ja' ? 'シリーズ' : currentLang === 'en' ? 'Series' : '劇集'))}
            </span>
            <span className="text-[10px] text-zinc-500">
              {(() => {
                if (!anime.season && !anime.seasonYear && !anime.startDate?.year) return '';
                const year = anime.seasonYear || anime.startDate?.year || '';
                if (!anime.season) return year;
                const seasonUpper = anime.season.toUpperCase();
                if (currentLang === 'ja') {
                  const seasonJa = seasonUpper === 'WINTER' ? '冬' : seasonUpper === 'SPRING' ? '春' : seasonUpper === 'SUMMER' ? '夏' : '秋';
                  return `${year ? year + '年 ' : ''}${seasonJa}`;
                }
                if (currentLang.startsWith('zh')) {
                  const seasonZh = seasonUpper === 'WINTER' ? '冬季' : seasonUpper === 'SPRING' ? '春季' : seasonUpper === 'SUMMER' ? '夏季' : '秋季';
                  return `${year ? year + '年' : ''}${seasonZh}`;
                }
                return `${anime.season.charAt(0)}${anime.season.slice(1).toLowerCase()} ${year}`.trim();
              })()}
            </span>
          </div>
        </div>

        {/* Quick Action Overlay on Hover */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 p-2">
          {anime.status === 'NOT_YET_RELEASED' ? (
            <>
              {anime.trailer?.id ? (
                <button
                  onClick={(e) => { e.stopPropagation(); onMoreInfo(anime); }}
                  className="px-3.5 py-1.5 rounded-full bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white flex items-center gap-1.5 shadow-lg shadow-red-600/30 transition-transform hover:scale-105 text-xs font-bold"
                  title={currentLang === 'ja' ? '予告編 / PV を再生' : currentLang.startsWith('zh') ? '觀看官方預告 / PV' : 'Watch Official PV / Trailer'}
                >
                  <Play className="w-3.5 h-3.5 fill-white" />
                  <span>{currentLang === 'ja' ? 'PV 視聴' : currentLang.startsWith('zh') ? '觀看 PV' : 'Watch PV'}</span>
                </button>
              ) : null}
              <button
                onClick={(e) => { e.stopPropagation(); onMoreInfo(anime); }}
                className="w-9 h-9 rounded-full bg-zinc-800/90 hover:bg-zinc-700 text-white flex items-center justify-center shadow-lg transition-transform hover:scale-105"
                title={currentLang === 'ja' ? '詳細・放送スケジュール' : currentLang.startsWith('zh') ? '詳細資訊與排期' : 'Details & Schedule'}
              >
                <Info className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onPlay(anime, 1); }}
                className="w-10 h-10 rounded-full bg-white hover:bg-zinc-200 text-black flex items-center justify-center shadow-lg transition-transform hover:scale-110"
                title={currentLang === 'ja' ? '第 1 話を再生' : currentLang.startsWith('zh') ? '播放第 1 集' : 'Play Episode 1'}
              >
                <Play className="w-5 h-5 fill-black ml-0.5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDownload(anime); }}
                className="w-9 h-9 rounded-full bg-[#E50914] hover:bg-[#B81D24] text-white flex items-center justify-center shadow-lg transition-transform hover:scale-110"
                title={currentLang === 'ja' ? 'ダウンロード' : currentLang.startsWith('zh') ? '下載此動漫' : 'Download Series'}
              >
                <Download className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onMoreInfo(anime); }}
                className="w-9 h-9 rounded-full bg-zinc-800/90 hover:bg-zinc-700 text-white flex items-center justify-center shadow-lg transition-transform hover:scale-110"
                title={currentLang === 'ja' ? '詳細・エピソード一覧' : currentLang.startsWith('zh') ? '詳細資訊與集數' : 'Details & Episodes'}
              >
                <Info className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default React.memo(AnimeCard);
