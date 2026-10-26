import React, { useState } from 'react';
import { X, Download, Film, CheckCircle2, Sliders, Server, Smartphone } from 'lucide-react';

export default function BatchDownloadModal({ 
  anime, 
  initialAudioMode = 'sub', 
  initialRange = '',
  onClose, 
  onStartDownload 
}) {
  const maxEpisodes = anime?.episodes || 24;
  const [rangeInput, setRangeInput] = useState(initialRange || `1-${Math.min(maxEpisodes, 12)}`);
  const [quality, setQuality] = useState('best');
  const [audioMode, setAudioMode] = useState(initialAudioMode);
  const [downloadTarget, setDownloadTarget] = useState('server'); // 'server' (NAS / Server) | 'device' (Local Device Browser)
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!anime) return null;

  const title = anime.title?.english || anime.title?.romaji || anime.title?.native || 'Anime';

  // Parse ranges like "1-12", "1, 2, 5", "1-5, 8-10"
  const parseRange = (str) => {
    const episodes = new Set();
    const parts = str.split(',').map(p => p.trim()).filter(Boolean);
    for (const part of parts) {
      if (part.includes('-')) {
        const [start, end] = part.split('-').map(n => parseInt(n.trim(), 10));
        if (!isNaN(start) && !isNaN(end)) {
          for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
            if (i > 0 && i <= 500) episodes.add(i);
          }
        }
      } else {
        const num = parseInt(part, 10);
        if (!isNaN(num) && num > 0 && num <= 500) episodes.add(num);
      }
    }
    return Array.from(episodes).sort((a, b) => a - b);
  };

  const parsedEpisodes = parseRange(rangeInput);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (parsedEpisodes.length === 0) return;

    setIsSubmitting(true);
    onStartDownload({
      animeTitle: title,
      episodeNumbers: parsedEpisodes,
      quality,
      audio: audioMode,
      downloadTarget
    });
    setIsSubmitting(false);
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm cursor-pointer overflow-y-auto"
      onClick={onClose}
    >
      <div 
        className="relative w-full max-w-lg bg-[#181818] rounded-xl overflow-hidden shadow-2xl border border-zinc-800 text-zinc-100 animate-in fade-in zoom-in duration-150 p-6 cursor-default max-h-[90vh] overflow-y-auto my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#E50914] flex items-center justify-center text-white shadow-md shadow-red-600/30">
              <Download className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Batch Downloader</h3>
              <p className="text-xs text-zinc-400 line-clamp-1">{title}</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-5">
          {/* Episode Range Input */}
          <div>
            <label htmlFor="batch-download-episode-range" className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">
              Episode Range (e.g. 1-12, 1-24, or 1, 3, 5):
            </label>
            <input
              id="batch-download-episode-range"
              name="episodeRange"
              type="text"
              autoComplete="off"
              value={rangeInput}
              onChange={(e) => setRangeInput(e.target.value)}
              placeholder="e.g. 1-12"
              aria-label="Episode Range"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-[#E50914] transition-colors"
            />

            {/* Quick Range Presets */}
            <div className="flex flex-wrap gap-2 mt-2.5">
              <button
                type="button"
                onClick={() => setRangeInput(`1-${Math.min(maxEpisodes, 12)}`)}
                className="text-[11px] bg-zinc-800 hover:bg-zinc-700 px-2.5 py-1 rounded-md text-zinc-300 font-medium transition-colors"
              >
                Episodes 1-12
              </button>
              {maxEpisodes > 12 && (
                <button
                  type="button"
                  onClick={() => setRangeInput(`13-${Math.min(maxEpisodes, 24)}`)}
                  className="text-[11px] bg-zinc-800 hover:bg-zinc-700 px-2.5 py-1 rounded-md text-zinc-300 font-medium transition-colors"
                >
                  Episodes 13-{Math.min(maxEpisodes, 24)}
                </button>
              )}
              <button
                type="button"
                onClick={() => setRangeInput(`1-${maxEpisodes}`)}
                className="text-[11px] bg-zinc-800 hover:bg-zinc-700 px-2.5 py-1 rounded-md text-zinc-300 font-medium transition-colors"
              >
                All ({maxEpisodes} Eps)
              </button>
            </div>
          </div>

          {/* Quality & Audio Selectors */}
          <div className="grid grid-cols-2 gap-4">
            {/* Video Quality */}
            <div>
              <label htmlFor="batch-download-quality-select" className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">
                Quality:
              </label>
              <select
                id="batch-download-quality-select"
                name="quality"
                aria-label="Quality"
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#E50914]"
              >
                <option value="best">Best Available (1080p)</option>
                <option value="1080p">1080p (FHD)</option>
                <option value="720p">720p (HD)</option>
                <option value="480p">480p (SD)</option>
                <option value="360p">360p (Low)</option>
              </select>
            </div>

            {/* Audio Mode */}
            <div>
              <span className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">
                Audio:
              </span>
              <div className="flex rounded-lg bg-zinc-900 p-1 border border-zinc-700">
                <button
                  type="button"
                  onClick={() => setAudioMode('sub')}
                  className={`flex-1 py-1.5 rounded text-xs font-bold transition-colors ${
                    audioMode === 'sub' ? 'bg-[#E50914] text-white shadow' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  SUB
                </button>
                <button
                  type="button"
                  onClick={() => setAudioMode('dub')}
                  className={`flex-1 py-1.5 rounded text-xs font-bold transition-colors ${
                    audioMode === 'dub' ? 'bg-[#E50914] text-white shadow' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  DUB
                </button>
              </div>
            </div>
          </div>

          {/* Download Destination (Device vs Server / NAS) */}
          <div>
            <span className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">
              下載儲存目標 (Download Destination):
            </span>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setDownloadTarget('server')}
                className={`flex items-center gap-2.5 p-3 rounded-xl border text-xs transition-all text-left ${
                  downloadTarget === 'server'
                    ? 'bg-red-950/50 border-red-500 text-white shadow-md ring-1 ring-red-500'
                    : 'bg-zinc-900/90 border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800/80'
                }`}
              >
                <Server className="w-5 h-5 text-red-400 shrink-0" />
                <div>
                  <div className="font-bold text-white">NAS / 伺服器</div>
                  <div className="text-[10px] text-zinc-400">儲存至伺服器目錄</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setDownloadTarget('device')}
                className={`flex items-center gap-2.5 p-3 rounded-xl border text-xs transition-all text-left ${
                  downloadTarget === 'device'
                    ? 'bg-red-950/50 border-red-500 text-white shadow-md ring-1 ring-red-500'
                    : 'bg-zinc-900/90 border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800/80'
                }`}
              >
                <Smartphone className="w-5 h-5 text-sky-400 shrink-0" />
                <div>
                  <div className="font-bold text-white">本機裝置 (Device)</div>
                  <div className="text-[10px] text-zinc-400">瀏覽器下載至本機</div>
                </div>
              </button>
            </div>
          </div>

          {/* Summary Banner */}
          <div className="bg-zinc-900/90 rounded-lg p-3 border border-zinc-800 flex items-center justify-between text-xs">
            <span className="text-zinc-400">Total episodes to queue:</span>
            <span className="font-bold text-white bg-zinc-800 px-2 py-0.5 rounded border border-zinc-700">
              {parsedEpisodes.length} episode{parsedEpisodes.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-zinc-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={parsedEpisodes.length === 0 || isSubmitting}
              className="flex items-center gap-2 bg-[#E50914] hover:bg-[#B81D24] disabled:opacity-50 text-white font-bold px-5 py-2.5 rounded-lg text-xs shadow-lg shadow-red-600/30 transition-transform hover:scale-105 motion-safe:active:scale-[0.96]"
            >
              <Download className="w-4 h-4" />
              <span>Queue {parsedEpisodes.length} Download{parsedEpisodes.length !== 1 ? 's' : ''}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
