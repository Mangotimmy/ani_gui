import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, Download, X, Settings, Heart, 
  Clock, Trash2, Flame, History, Compass, Globe, ChevronDown, Check,
  Clipboard, Sparkles, Swords, Star, Menu
} from 'lucide-react';
import { SUPPORTED_LANGS } from '../utils/i18n';

const POPULAR_SEARCHES = [
  'Solo Leveling',
  'Demon Slayer',
  'One Piece',
  'Jujutsu Kaisen',
  'Attack on Titan',
  'Chainsaw Man',
  'Bleach'
];

function Navbar({ 
  onSearch, 
  searchQuery, 
  activeDownloadsCount, 
  onOpenDownloads,
  onOpenSettings,
  activeTab,
  setActiveTab,
  favoritesCount = 0,
  watchHistoryCount = 0,
  currentLang = 'zh-TW',
  onSelectLang = () => {},
  t = (k) => k
}) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showDiscoverMenu, setShowDiscoverMenu] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const langContainerRef = useRef(null);
  const discoverContainerRef = useRef(null);
  const [searchHistory, setSearchHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('aniflix_search_history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [showHistoryDropdown, setShowHistoryDropdown] = useState(false);
  const searchContainerRef = useRef(null);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 25);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
        setShowHistoryDropdown(false);
        if (!searchQuery) {
          setIsSearchOpen(false);
        }
      }
      if (langContainerRef.current && !langContainerRef.current.contains(e.target)) {
        setShowLangMenu(false);
      }
      if (discoverContainerRef.current && !discoverContainerRef.current.contains(e.target)) {
        setShowDiscoverMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [searchQuery]);

  const saveToHistory = (query) => {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2) return;
    setSearchHistory(prev => {
      const filtered = prev.filter(item => item.toLowerCase() !== trimmed.toLowerCase());
      const updated = [trimmed, ...filtered].slice(0, 10);
      try {
        localStorage.setItem('aniflix_search_history', JSON.stringify(updated));
      } catch (e) {
        console.error(e);
      }
      return updated;
    });
  };

  // Auto-save search history when user pauses typing a query >= 2 chars
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed || trimmed.length < 2) return;
    const timer = setTimeout(() => {
      saveToHistory(trimmed);
    }, 1200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      saveToHistory(searchQuery);
      setShowHistoryDropdown(false);
    }
  };

  const handleSelectHistory = (item) => {
    onSearch(item);
    saveToHistory(item);
    setShowHistoryDropdown(false);
  };

  const handleRemoveHistoryItem = (e, itemToRemove) => {
    e.stopPropagation();
    setSearchHistory(prev => {
      const updated = prev.filter(item => item !== itemToRemove);
      try {
        localStorage.setItem('aniflix_search_history', JSON.stringify(updated));
      } catch (e) {
        console.error(e);
      }
      return updated;
    });
  };

  const handleClearHistory = (e) => {
    e.stopPropagation();
    setSearchHistory([]);
    try {
      localStorage.removeItem('aniflix_search_history');
    } catch (e) {
      console.error(e);
    }
  };

  const matchingHistory = searchQuery.trim()
    ? searchHistory.filter(item => item.toLowerCase().includes(searchQuery.toLowerCase()))
    : searchHistory;

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        const query = text.trim();
        onSearch(query);
        saveToHistory(query);
        setIsSearchOpen(true);
        setShowHistoryDropdown(false);
      }
    } catch (err) {
      console.warn('Clipboard read failed:', err);
    }
  };

  const isDiscoverActive = ['trending', 'upcoming', 'top-rated', 'Action', 'Fantasy'].includes(activeTab);
  const discoverLabels = {
    'trending': t('trending'),
    'upcoming': t('upcoming'),
    'top-rated': t('topRated'),
    'Action': t('action'),
    'Fantasy': t('fantasy')
  };

  return (
    <>
    <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 px-3 sm:px-5 md:px-10 ${
      isScrolled 
        ? 'py-2 bg-[#0e0e11]/95 backdrop-blur-2xl border-b border-white/[0.08] shadow-[0_12px_40px_rgba(0,0,0,0.7)]' 
        : 'py-3 bg-[#121216]/90 backdrop-blur-xl border-b border-white/[0.05] shadow-[0_4px_30px_rgba(0,0,0,0.4)]'
    } flex items-center justify-between gap-2`}>
      {/* Top subtle ambient highlight */}
      <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-red-500/30 to-transparent pointer-events-none" />

      {/* Brand + Left Nav */}
      <div className="flex items-center gap-3 min-w-0 shrink-0">
        {/* Hamburger - mobile only */}
        <button
          className="md:hidden p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors shrink-0"
          onClick={() => setShowMobileMenu(v => !v)}
          aria-label="Menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div 
          onClick={() => { setActiveTab('home'); onSearch(''); setShowMobileMenu(false); }}
          className="flex items-center gap-2 cursor-pointer group select-none shrink-0"
        >
          <div className="relative">
            <img 
              src="/icon.png" 
              alt="AniFlix Logo" 
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl shadow-md shadow-red-600/20 group-hover:scale-105 group-hover:shadow-red-600/40 transition-all object-cover ring-1 ring-white/10" 
            />
          </div>
          <span className="text-xl sm:text-2xl font-black tracking-wider bg-gradient-to-r from-red-500 via-rose-400 to-amber-200 bg-clip-text text-transparent uppercase drop-shadow group-hover:brightness-110 transition-all">
            AniFlix
          </span>
          <span className="hidden sm:inline-flex items-center text-[10px] tracking-wider bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full border border-red-500/25 font-bold font-mono shadow-sm">
            v2.0.0
          </span>
        </div>

        {/* Primary Navigation Pills — desktop only */}
        <nav className="hidden md:flex items-center gap-1.5 p-1 rounded-full bg-white/[0.03] border border-white/[0.06] backdrop-blur-md">
          <button 
            onClick={() => { setActiveTab('home'); onSearch(''); }}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
              activeTab === 'home' && !searchQuery 
                ? 'bg-white/15 text-white font-bold shadow-sm ring-1 ring-white/20' 
                : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            {t('home')}
          </button>

          {/* Discover Dropdown */}
          <div className="relative" ref={discoverContainerRef}>
            <button
              onClick={() => setShowDiscoverMenu(!showDiscoverMenu)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
                isDiscoverActive 
                  ? 'bg-white/15 text-white font-bold shadow-sm ring-1 ring-white/20' 
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
              }`}
            >
              <span>{isDiscoverActive ? discoverLabels[activeTab] || t('discover') || 'Discover' : (t('discover') || 'Discover')}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${showDiscoverMenu ? 'rotate-180 text-white' : 'text-zinc-400'}`} />
            </button>

            {showDiscoverMenu && (
              <div className="absolute left-0 top-full mt-2 w-48 bg-[#16161a]/95 border border-white/[0.1] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.8)] backdrop-blur-2xl p-1.5 z-50 animate-in fade-in zoom-in-95">
                <button
                  onClick={() => { setActiveTab('trending'); onSearch(''); setShowDiscoverMenu(false); }}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs transition-colors flex items-center gap-2.5 ${
                    activeTab === 'trending' ? 'bg-[#E50914] text-white font-bold shadow-md shadow-red-600/30' : 'text-zinc-300 hover:bg-white/[0.08]'
                  }`}
                >
                  <Flame className="w-3.5 h-3.5 text-amber-400" />
                  <span>{t('trending')}</span>
                </button>
                <button
                  onClick={() => { setActiveTab('upcoming'); onSearch(''); setShowDiscoverMenu(false); }}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs transition-colors flex items-center gap-2.5 ${
                    activeTab === 'upcoming' ? 'bg-[#E50914] text-white font-bold shadow-md shadow-red-600/30' : 'text-zinc-300 hover:bg-white/[0.08]'
                  }`}
                >
                  <Clock className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{t('upcoming')}</span>
                </button>
                <button
                  onClick={() => { setActiveTab('top-rated'); onSearch(''); setShowDiscoverMenu(false); }}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs transition-colors flex items-center gap-2.5 ${
                    activeTab === 'top-rated' ? 'bg-[#E50914] text-white font-bold shadow-md shadow-red-600/30' : 'text-zinc-300 hover:bg-white/[0.08]'
                  }`}
                >
                  <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
                  <span>{t('topRated')}</span>
                </button>
                <div className="border-t border-white/[0.08] my-1 mx-1"></div>
                <button
                  onClick={() => { setActiveTab('Action'); onSearch(''); setShowDiscoverMenu(false); }}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs transition-colors flex items-center gap-2.5 ${
                    activeTab === 'Action' ? 'bg-[#E50914] text-white font-bold shadow-md shadow-red-600/30' : 'text-zinc-300 hover:bg-white/[0.08]'
                  }`}
                >
                  <Swords className="w-3.5 h-3.5 text-rose-400" />
                  <span>{t('action')}</span>
                </button>
                <button
                  onClick={() => { setActiveTab('Fantasy'); onSearch(''); setShowDiscoverMenu(false); }}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs transition-colors flex items-center gap-2.5 ${
                    activeTab === 'Fantasy' ? 'bg-[#E50914] text-white font-bold shadow-md shadow-red-600/30' : 'text-zinc-300 hover:bg-white/[0.08]'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                  <span>{t('fantasy')}</span>
                </button>
              </div>
            )}
          </div>

          <button 
            onClick={() => { setActiveTab('catalog'); onSearch(''); }}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
              activeTab === 'catalog' 
                ? 'bg-white/15 text-white font-bold shadow-sm ring-1 ring-white/20' 
                : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            <Compass className="w-3.5 h-3.5 text-amber-400" />
            <span>{t('catalog')}</span>
          </button>
          <button 
            onClick={() => { setActiveTab('favorites'); onSearch(''); }}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
              activeTab === 'favorites' 
                ? 'bg-white/15 text-white font-bold shadow-sm ring-1 ring-white/20' 
                : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            <Heart className={`w-3.5 h-3.5 ${favoritesCount > 0 ? 'text-red-500 fill-red-500' : 'text-zinc-400'}`} />
            <span>{t('favorites')}</span>
            {favoritesCount > 0 && (
              <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.2 rounded-full font-bold ring-1 ring-red-500/30">
                {favoritesCount}
              </span>
            )}
          </button>
          <button 
            onClick={() => { setActiveTab('history'); onSearch(''); }}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
              activeTab === 'history' 
                ? 'bg-white/15 text-white font-bold shadow-sm ring-1 ring-white/20' 
                : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            <History className={`w-3.5 h-3.5 ${watchHistoryCount > 0 ? 'text-indigo-400' : 'text-zinc-400'}`} />
            <span>{t('history')}</span>
            {watchHistoryCount > 0 && (
              <span className="text-[10px] bg-indigo-500/20 text-indigo-400 px-1.5 py-0.2 rounded-full font-bold ring-1 ring-indigo-500/30">
                {watchHistoryCount}
              </span>
            )}
          </button>
        </nav>
      </div>

      {/* Right Side: Search, Downloader, Language & Settings */}
      <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
        {/* Search Bar & Dropdown */}
        <div className="relative flex items-center" ref={searchContainerRef}>
          <div className={`flex items-center transition-all duration-300 rounded-full ${
            isSearchOpen || searchQuery 
              ? 'w-44 sm:w-72 bg-zinc-900/95 border border-white/20 px-3 py-1.5 shadow-xl ring-2 ring-red-500/20 backdrop-blur-xl' 
              : 'w-8 h-8 sm:w-9 sm:h-9 justify-center cursor-pointer bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] hover:border-white/20 rounded-full transition-all text-zinc-300 hover:text-white shadow-sm'
          }`}>
            <Search 
              className={`w-4 h-4 cursor-pointer shrink-0 transition-colors ${isSearchOpen || searchQuery ? 'text-[#E50914]' : 'text-zinc-400 hover:text-white'}`} 
              onClick={() => {
                setIsSearchOpen(true);
                setShowHistoryDropdown(true);
              }}
            />
            {(isSearchOpen || searchQuery) && (
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearch(e.target.value)}
                onFocus={() => setShowHistoryDropdown(true)}
                onKeyDown={handleKeyDown}
                placeholder={t('searchPlaceholder')}
                autoFocus
                className="w-full bg-transparent text-xs sm:text-sm text-white placeholder-zinc-500 focus:outline-none ml-2 font-medium"
              />
            )}
            {(isSearchOpen || searchQuery) && (
              <button
                type="button"
                onClick={handlePasteFromClipboard}
                className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-colors shrink-0 ml-1"
                title="貼上剪貼簿內容 / Paste from clipboard"
              >
                <Clipboard className="w-3.5 h-3.5" />
              </button>
            )}
            {searchQuery && (
              <X 
                className="w-4 h-4 text-zinc-400 hover:text-white cursor-pointer shrink-0 ml-1 transition-colors"
                onClick={() => { onSearch(''); setIsSearchOpen(false); setShowHistoryDropdown(false); }}
              />
            )}
          </div>

          {/* Search History & Trending Suggestions Dropdown */}
          {showHistoryDropdown && (
            <div className="absolute right-0 top-full mt-2 w-72 sm:w-80 bg-[#16161a]/98 border border-white/[0.12] rounded-2xl shadow-[0_25px_50px_rgba(0,0,0,0.8)] backdrop-blur-2xl overflow-hidden z-50 p-2.5 animate-in fade-in zoom-in-95">
              {/* Recent Searches Section */}
              {matchingHistory.length > 0 ? (
                <>
                  <div className="flex items-center justify-between px-2.5 py-1 text-xs text-zinc-400 border-b border-white/[0.08] pb-2 mb-1.5">
                    <span className="flex items-center gap-1.5 font-bold text-zinc-300">
                      <Clock className="w-3.5 h-3.5 text-zinc-400" /> {t('recentSearches')}
                    </span>
                    <button 
                      onClick={handleClearHistory}
                      className="hover:text-red-400 transition-colors text-[11px] flex items-center gap-1 text-zinc-500 font-medium"
                    >
                      <Trash2 className="w-3 h-3" /> Clear
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto custom-scrollbar">
                    {matchingHistory.map((item, idx) => (
                      <div 
                        key={idx}
                        onClick={() => handleSelectHistory(item)}
                        className="flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs text-zinc-200 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-colors group"
                      >
                        <div className="flex items-center gap-2 truncate pr-2">
                          <Clock className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                          <span className="truncate">{item}</span>
                        </div>
                        <button
                          onClick={(e) => handleRemoveHistoryItem(e, item)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-white hover:bg-white/10 rounded-lg transition-all"
                          title="Remove from history"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="px-2.5 py-2 text-xs text-zinc-400 flex items-center gap-2 border-b border-white/[0.08] pb-2 mb-2">
                  <Clock className="w-3.5 h-3.5 text-zinc-500" />
                  <span>{searchQuery ? `No matching searches` : 'No recent searches yet'}</span>
                </div>
              )}

              {/* Trending / Popular Suggestions Quick Chips */}
              <div className="px-2.5 pt-2">
                <span className="text-[11px] uppercase tracking-wider font-bold text-zinc-400 flex items-center gap-1 mb-2">
                  <Flame className="w-3.5 h-3.5 text-[#E50914]" /> {t('trendingSearches')}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {POPULAR_SEARCHES.map((query) => (
                    <button
                      key={query}
                      onClick={() => handleSelectHistory(query)}
                      className="text-xs bg-white/[0.06] hover:bg-[#E50914] text-zinc-300 hover:text-white px-2.5 py-1 rounded-full transition-colors border border-white/[0.08] font-medium"
                    >
                      {query}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Download Manager Launcher Button */}
        <button
          onClick={onOpenDownloads}
          className="relative flex items-center gap-1.5 bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 hover:text-white p-2 sm:px-3.5 sm:py-1.5 rounded-full border border-white/[0.08] hover:border-white/20 transition-all shadow-sm group"
          title="Download Manager & Queue"
        >
          <Download className="w-4 h-4 text-[#E50914] group-hover:scale-110 transition-transform" />
          <span className="text-xs font-semibold hidden lg:inline">{t('downloads')}</span>
          {activeDownloadsCount > 0 && (
            <span className="flex items-center justify-center w-4 h-4 bg-[#E50914] text-white text-[10px] font-black rounded-full animate-pulse shadow-md shadow-red-600/50">
              {activeDownloadsCount}
            </span>
          )}
        </button>

        {/* Language Switcher Dropdown */}
        <div className="relative" ref={langContainerRef}>
          <button
            onClick={() => setShowLangMenu(!showLangMenu)}
            className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 hover:text-white text-xs font-semibold border border-white/[0.08] hover:border-white/20 transition-all shadow-sm group"
            title="Switch Language / 切換語言"
          >
            <Globe className="w-3.5 h-3.5 text-rose-400 group-hover:rotate-45 transition-transform" />
            <span className="tracking-wide font-medium hidden sm:inline">{SUPPORTED_LANGS.find(l => l.code === currentLang)?.short || '繁中'}</span>
            <ChevronDown className="w-3 h-3 text-zinc-400 group-hover:text-white transition-colors hidden sm:block" />
          </button>

          {showLangMenu && (
            <div className="absolute right-0 top-full mt-2 bg-[#18181c] border border-zinc-700/90 rounded-2xl p-1.5 shadow-[0_25px_60px_rgba(0,0,0,0.95)] z-50 min-w-[180px] animate-in fade-in zoom-in-95">
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-800 mb-1">
                Language / 介面語言 / 言語
              </div>
              {SUPPORTED_LANGS.map((langItem) => (
                <button
                  key={langItem.code}
                  onClick={() => {
                    onSelectLang(langItem.code);
                    setShowLangMenu(false);
                  }}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs flex items-center justify-between transition-colors ${
                    currentLang === langItem.code 
                      ? 'bg-red-600/20 text-[#E50914] font-bold' 
                      : 'text-zinc-300 hover:bg-white/[0.08] hover:text-white'
                  }`}
                >
                  <span>{langItem.label}</span>
                  {currentLang === langItem.code && <Check className="w-3.5 h-3.5" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Settings & Plugins Button */}
        <button
          onClick={onOpenSettings}
          className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] hover:border-white/20 text-zinc-300 hover:text-white transition-all shadow-sm group"
          title={t('settings')}
        >
          <Settings className="w-4 h-4 group-hover:rotate-90 transition-transform duration-300" />
        </button>
      </div>
    </header>

    {/* Mobile Navigation Drawer */}
    {showMobileMenu && (
      <div className="fixed top-[52px] left-0 right-0 z-40 md:hidden bg-[#0e0e11]/98 backdrop-blur-2xl border-b border-white/[0.08] shadow-2xl px-4 py-3 flex flex-col gap-1 animate-in fade-in slide-in-from-top-2">
        <button onClick={() => { setActiveTab('home'); onSearch(''); setShowMobileMenu(false); }} className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${activeTab === 'home' && !searchQuery ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'}`}>{t('home')}</button>
        <button onClick={() => { setActiveTab('trending'); onSearch(''); setShowMobileMenu(false); }} className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${activeTab === 'trending' ? 'bg-red-600/20 text-[#E50914]' : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'}`}><Flame className="w-4 h-4 text-amber-400" />{t('trending')}</button>
        <button onClick={() => { setActiveTab('upcoming'); onSearch(''); setShowMobileMenu(false); }} className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${activeTab === 'upcoming' ? 'bg-red-600/20 text-[#E50914]' : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'}`}><Clock className="w-4 h-4 text-cyan-400" />{t('upcoming')}</button>
        <button onClick={() => { setActiveTab('top-rated'); onSearch(''); setShowMobileMenu(false); }} className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${activeTab === 'top-rated' ? 'bg-red-600/20 text-[#E50914]' : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'}`}><Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />{t('topRated')}</button>
        <button onClick={() => { setActiveTab('catalog'); onSearch(''); setShowMobileMenu(false); }} className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${activeTab === 'catalog' ? 'bg-red-600/20 text-[#E50914]' : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'}`}><Compass className="w-4 h-4 text-amber-400" />{t('catalog')}</button>
        <button onClick={() => { setActiveTab('favorites'); onSearch(''); setShowMobileMenu(false); }} className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${activeTab === 'favorites' ? 'bg-red-600/20 text-[#E50914]' : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'}`}><Heart className={`w-4 h-4 ${favoritesCount > 0 ? 'text-red-500 fill-red-500' : ''}`} />{t('favorites')}{favoritesCount > 0 && <span className="ml-auto text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full font-bold">{favoritesCount}</span>}</button>
        <button onClick={() => { setActiveTab('history'); onSearch(''); setShowMobileMenu(false); }} className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${activeTab === 'history' ? 'bg-red-600/20 text-[#E50914]' : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'}`}><History className={`w-4 h-4 ${watchHistoryCount > 0 ? 'text-indigo-400' : ''}`} />{t('history')}{watchHistoryCount > 0 && <span className="ml-auto text-[10px] bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded-full font-bold">{watchHistoryCount}</span>}</button>
      </div>
    )}
    </>
  );
}

export default React.memo(Navbar);

