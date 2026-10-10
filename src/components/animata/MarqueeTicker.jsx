// src/components/animata/MarqueeTicker.jsx
// Hand-crafted Infinite Marquee Ticker inspired by Animata (https://github.com/codse/animata)
// Features hardware-accelerated smooth scrolling, pause on hover, edge gradient fades, and reduced-motion fallbacks.

import React from 'react';
import { Sparkles, Flame, Shield, Radio, Server, Cpu } from 'lucide-react';

export default function MarqueeTicker({
  items = [],
  speed = 40, // seconds for one loop
  pauseOnHover = true,
  className = '',
  currentLang = 'zh-TW',
  isContainer = false
}) {
  // Default announcements if none passed
  const defaultItems = [
    { id: '1', text: '🔥 2026/2027 新番情報已同步更新，支援多季預約與即時追番', tag: 'NEW' },
    { id: '2', text: isContainer ? '🐳 Docker 容器化伺服器運行中 (Synology NAS / Linux 原生影音解碼支援)' : '💻 PC 本地 App 模式運行中 (支援 Direct3D 11 / Intel QuickSync 硬體加速)', tag: 'STATUS' },
    { id: '3', text: '⚡ 內顯極限省電優化模式：停用 AI 超解析度升頻，大幅降低 GPU 3D 負載', tag: 'PERF' },
    { id: '4', text: '📱 支援 iPad / iPhone / Android 行動端瀏覽器串流與手勢快進 (±10s 觸控雙擊)', tag: 'MOBILE' },
    { id: '5', text: '🎬 支援外部高階播放器串流啟動 (VLC, Infuse, nPlayer, MPV Spline36)', tag: 'PLAYER' }
  ];

  const displayItems = items.length > 0 ? items : defaultItems;

  return (
    <div 
      className={`relative w-full overflow-hidden bg-zinc-950/70 border-y border-zinc-800/80 py-2.5 select-none ${className}`}
      role="region"
      aria-label="Anime Highlights Marquee"
    >
      {/* Left & Right Smooth Edge Fade Masks */}
      <div 
        aria-hidden="true" 
        className="pointer-events-none absolute left-0 top-0 bottom-0 w-12 sm:w-20 bg-gradient-to-r from-[#141414] to-transparent z-10" 
      />
      <div 
        aria-hidden="true" 
        className="pointer-events-none absolute right-0 top-0 bottom-0 w-12 sm:w-20 bg-gradient-to-l from-[#141414] to-transparent z-10" 
      />

      {/* Marquee Track Container */}
      <div 
        className={`flex w-max items-center gap-6 sm:gap-10 motion-safe:animate-marquee ${
          pauseOnHover ? 'hover:[animation-play-state:paused]' : ''
        } motion-reduce:animate-none motion-reduce:overflow-x-auto`}
        style={{
          animationDuration: `${speed}s`,
          animationTimingFunction: 'linear',
          animationIterationCount: 'infinite'
        }}
      >
        {/* First Loop Pass */}
        {displayItems.map((item, idx) => (
          <div key={`item-a-${item.id || idx}`} className="flex items-center gap-2 shrink-0">
            {item.tag && (
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-red-950/60 text-red-400 border border-red-800/50 uppercase tracking-wider">
                {item.tag}
              </span>
            )}
            <span className="text-xs font-medium text-zinc-300 hover:text-white transition-colors">
              {item.text}
            </span>
            <span className="text-zinc-600 ml-4 font-black">✦</span>
          </div>
        ))}

        {/* Second Loop Pass for Seamless Infinite Wrap */}
        {displayItems.map((item, idx) => (
          <div key={`item-b-${item.id || idx}`} className="flex items-center gap-2 shrink-0">
            {item.tag && (
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-red-950/60 text-red-400 border border-red-800/50 uppercase tracking-wider">
                {item.tag}
              </span>
            )}
            <span className="text-xs font-medium text-zinc-300 hover:text-white transition-colors">
              {item.text}
            </span>
            <span className="text-zinc-600 ml-4 font-black">✦</span>
          </div>
        ))}
      </div>
    </div>
  );
}
