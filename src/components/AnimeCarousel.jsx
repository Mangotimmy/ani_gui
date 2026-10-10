// src/components/AnimeCarousel.jsx - Infinite Horizontal Scrolling Carousel with Auto-Load
import React, { useRef } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import AnimeCard from './AnimeCard';

function AnimeCarousel({ 
  title, 
  subtitle,
  icon: Icon, 
  animes = [], 
  onPlay, 
  onDownload, 
  onMoreInfo,
  favoriteIds = new Set(),
  onToggleFavorite,
  currentLang = 'zh-TW',
  onLoadMore,
  isLoadingMore = false,
  hasMore = false
}) {
  const rowRef = useRef(null);

  const scroll = (direction) => {
    if (rowRef.current) {
      const { scrollLeft, clientWidth, scrollWidth } = rowRef.current;
      const scrollAmount = clientWidth * 0.75;
      const targetLeft = direction === 'left' ? scrollLeft - scrollAmount : scrollLeft + scrollAmount;
      
      rowRef.current.scrollTo({
        left: targetLeft,
        behavior: 'smooth'
      });

      // Trigger load more if scrolling near the end
      if (direction === 'right' && onLoadMore && !isLoadingMore && hasMore) {
        if (targetLeft + clientWidth >= scrollWidth - 500) {
          onLoadMore();
        }
      }
    }
  };

  const handleScroll = () => {
    if (!rowRef.current || !onLoadMore || isLoadingMore || !hasMore) return;
    const { scrollLeft, clientWidth, scrollWidth } = rowRef.current;
    if (scrollLeft + clientWidth >= scrollWidth - 400) {
      onLoadMore();
    }
  };

  if (!animes || animes.length === 0) return null;

  return (
    <div 
      className="relative py-4 px-4 md:px-12 group/row"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '100% 340px' }}
    >
      {/* Category Row Title */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-5 h-5 text-[#E50914]" />}
          <div>
            <h2 className="text-lg md:text-xl font-bold text-white tracking-wide">
              {title}
            </h2>
            {subtitle && (
              <p className="text-xs text-zinc-400 mt-0.5">{subtitle}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-400 font-semibold font-mono">
            {animes.length} {currentLang === 'ja' ? '作品' : currentLang.startsWith('zh') ? '部作品' : 'titles'}
          </span>
          {hasMore && (
            <span className="text-[10px] font-bold text-red-400 bg-red-950/50 px-2 py-0.5 rounded-full border border-red-800/40 uppercase tracking-wider">
              ∞ 無限載入
            </span>
          )}
        </div>
      </div>

      {/* Relative Carousel Container with Arrows */}
      <div className="relative">
        {/* Left Arrow Button */}
        <button
          onClick={() => scroll('left')}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-30 w-10 h-28 bg-black/70 hover:bg-black/90 text-white rounded-r-md flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-all backdrop-blur-sm shadow-xl"
          aria-label="Scroll left"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>

        {/* Horizontal Scrolling Items */}
        <div
          ref={rowRef}
          onScroll={handleScroll}
          className="flex items-center gap-3.5 overflow-x-auto hide-scrollbar scroll-smooth py-2"
        >
          {animes.map((anime) => (
            <AnimeCard
              key={anime.id}
              anime={anime}
              onPlay={onPlay}
              onDownload={onDownload}
              onMoreInfo={onMoreInfo}
              isFavorite={favoriteIds.has(anime.id)}
              onToggleFavorite={onToggleFavorite}
              currentLang={currentLang}
            />
          ))}

          {/* Endless Scroll Loading Tile */}
          {isLoadingMore && (
            <div className="flex-none w-[120px] sm:w-[150px] aspect-[2/3] rounded-xl bg-zinc-900/60 border border-zinc-800 flex flex-col items-center justify-center text-zinc-500 gap-2 shrink-0 animate-pulse">
              <Loader2 className="w-6 h-6 text-[#E50914] animate-spin" />
              <span className="text-[11px] font-semibold text-zinc-400">載入更多...</span>
            </div>
          )}
        </div>

        {/* Right Arrow Button */}
        <button
          onClick={() => scroll('right')}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-30 w-10 h-28 bg-black/70 hover:bg-black/90 text-white rounded-l-md flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-all backdrop-blur-sm shadow-xl"
          aria-label="Scroll right"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
}

export default React.memo(AnimeCarousel);
