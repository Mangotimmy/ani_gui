// src/components/AnimeCarousel.jsx - Horizontal Scrolling Carousel with Favorites Support
import React, { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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
  currentLang = 'zh-TW'
}) {
  const rowRef = useRef(null);

  const scroll = (direction) => {
    if (rowRef.current) {
      const { scrollLeft, clientWidth } = rowRef.current;
      const scrollAmount = clientWidth * 0.75;
      rowRef.current.scrollTo({
        left: direction === 'left' ? scrollLeft - scrollAmount : scrollLeft + scrollAmount,
        behavior: 'smooth'
      });
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
        <span className="text-xs text-zinc-500 font-medium">
          {animes.length} {currentLang === 'ja' ? '作品' : currentLang.startsWith('zh') ? '部作品' : 'titles'}
        </span>
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
