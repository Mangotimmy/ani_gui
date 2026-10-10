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
  // Multilingual announcements
  const defaultItems = React.useMemo(() => {
    if (currentLang === 'ja') {
      return [
        { id: '1', text: '🔥 2026/2027年 新作アニメ情報を同期更新、シーズン予約＆追っかけ視聴対応', tag: 'NEW' },
        { id: '2', text: isContainer ? '🐳 Docker コンテナサーバー稼働中 (Synology NAS / Linux ハードウェアデコード対応)' : '💻 PC ネイティブ App モード稼働中 (Direct3D 11 / Intel QuickSync 加速)', tag: 'STATUS' },
        { id: '3', text: '⚡ 内蔵GPU超省電力モード：AI超解像度をバイパスし、GPU 3D 負荷を大幅軽減', tag: 'PERF' },
        { id: '4', text: '📱 iPad / iPhone / Android モバイルブラウザ視聴＆ジェスチャーシーク対応 (±10s 触控ダブルタップ)', tag: 'MOBILE' },
        { id: '5', text: '🎬 外部高画質プレーヤー起動対応 (VLC, Infuse, nPlayer, MPV Spline36)', tag: 'PLAYER' }
      ];
    }
    if (currentLang === 'zh-CN') {
      return [
        { id: '1', text: '🔥 2026/2027 新番情报已同步更新，支持多季预约与即时追番', tag: 'NEW' },
        { id: '2', text: isContainer ? '🐳 Docker 容器化服务器运行中 (Synology NAS / Linux 原生影音解码支持)' : '💻 PC 本地 App 模式运行中 (支持 Direct3D 11 / Intel QuickSync 硬件加速)', tag: 'STATUS' },
        { id: '3', text: '⚡ 核显极限省电优化模式：停用 AI 超分辨率升频，大幅降低 GPU 3D 负载', tag: 'PERF' },
        { id: '4', text: '📱 支持 iPad / iPhone / Android 移动端浏览器串流与手势快进 (±10s 触控双击)', tag: 'MOBILE' },
        { id: '5', text: '🎬 支持外部高级播放器串流启动 (VLC, Infuse, nPlayer, MPV Spline36)', tag: 'PLAYER' }
      ];
    }
    if (currentLang === 'en') {
      return [
        { id: '1', text: '🔥 2026/2027 Anime seasonal database synchronized with multi-season scheduling', tag: 'NEW' },
        { id: '2', text: isContainer ? '🐳 Docker container server running (Synology NAS / Linux native HW transcoding)' : '💻 PC Native App running (Direct3D 11 / Intel QuickSync acceleration)', tag: 'STATUS' },
        { id: '3', text: '⚡ iGPU power-saving mode active: AI super-resolution bypass to reduce GPU load', tag: 'PERF' },
        { id: '4', text: '📱 Mobile web streaming supported on iPad / iPhone / Android with gesture seek (±10s double-tap)', tag: 'MOBILE' },
        { id: '5', text: '🎬 External video player launching supported (VLC, Infuse, nPlayer, MPV Spline36)', tag: 'PLAYER' }
      ];
    }
    // Default Traditional Chinese (zh-TW)
    return [
      { id: '1', text: '🔥 2026/2027 新番情報已同步更新，支援多季預約與即時追番', tag: 'NEW' },
      { id: '2', text: isContainer ? '🐳 Docker 容器化伺服器運行中 (Synology NAS / Linux 原生影音解碼支援)' : '💻 PC 本地 App 模式運行中 (支援 Direct3D 11 / Intel QuickSync 硬體加速)', tag: 'STATUS' },
      { id: '3', text: '⚡ 內顯極限省電優化模式：停用 AI 超解析度升頻，大幅降低 GPU 3D 負載', tag: 'PERF' },
      { id: '4', text: '📱 支援 iPad / iPhone / Android 行動端瀏覽器串流與手勢快進 (±10s 觸控雙擊)', tag: 'MOBILE' },
      { id: '5', text: '🎬 支援外部高階播放器串流啟動 (VLC, Infuse, nPlayer, MPV Spline36)', tag: 'PLAYER' }
    ];
  }, [currentLang, isContainer]);

  const displayItems = items.length > 0 ? items : defaultItems;

  return (
    <div 
      className={`relative w-full overflow-hidden bg-[#0c0c10]/95 backdrop-blur-md border-b border-white/[0.06] py-2 sm:py-2.5 select-none ${className}`}
      role="region"
      aria-label="Anime Highlights Marquee"
    >
      {/* Left & Right Smooth Edge Fade Masks */}
      <div 
        aria-hidden="true" 
        className="pointer-events-none absolute left-0 top-0 bottom-0 w-12 sm:w-20 bg-gradient-to-r from-[#0c0c10] to-transparent z-10" 
      />
      <div 
        aria-hidden="true" 
        className="pointer-events-none absolute right-0 top-0 bottom-0 w-12 sm:w-20 bg-gradient-to-l from-[#0c0c10] to-transparent z-10" 
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
