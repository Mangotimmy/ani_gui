// src/components/animata/BentoGrid.jsx
// Hand-crafted Bento Grid Dashboard inspired by Animata (https://github.com/codse/animata)
// Provides modular visual architecture inspection, system status, seasonal highlights, and quick PowerShell action triggers.

import React from 'react';
import GlowCard from './GlowCard.jsx';
import { 
  Server, Cpu, Zap, Terminal, ShieldCheck, Sparkles, 
  ExternalLink, Layers, Smartphone, Monitor, ChevronRight, Activity
} from 'lucide-react';

export default function BentoGrid({
  isContainer = false,
  containerType = 'Linux Alpine',
  onOpenArchitectureSettings,
  currentLang = 'zh-TW',
  trendingCount = 0,
  activeDownloadsCount = 0
}) {
  const isZh = currentLang.startsWith('zh');

  return (
    <section className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6" aria-label="System Architecture & Highlights">
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">

        {/* 1. Large Hero Bento Card: Architecture & Connection Status */}
        <GlowCard 
          className="md:col-span-2 lg:col-span-2 p-5 flex flex-col justify-between min-h-[220px]"
          spotlightColor="rgba(229, 9, 20, 0.2)"
        >
          <div>
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                </span>
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                  {isContainer ? 'Docker Server Online' : 'PC Client Active'}
                </span>
              </div>

              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                {isContainer ? 'Port 3000 (HTTP)' : 'Port 3001 (IPC)'}
              </span>
            </div>

            <h3 className="text-lg font-black text-white flex items-center gap-2">
              {isContainer ? (
                <>
                  <span className="text-xl">🐳</span>
                  <span>Docker 容器伺服器運行中</span>
                </>
              ) : (
                <>
                  <span className="text-xl">💻</span>
                  <span>AniFlix 桌面客戶端模式</span>
                </>
              )}
            </h3>

            <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
              {isContainer 
                ? '已成功連線至 Docker 容器端 (Synology NAS / Linux)。內建 ffmpeg、yt-dlp、aria2c 影音解碼引擎，支援跨平台手機與 PC 瀏覽器 HLS 極速串流。'
                : '本機桌面環境運行中。提供完整 Direct3D 11 / Intel QuickSync 硬體加速、MPV 外顯播放器、以及本機 Scoop 依賴組件熱更新。'
              }
            </p>
          </div>

          {/* Architecture Connection Mini-Diagram */}
          <div className="mt-4 pt-3 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-800/80 text-zinc-300">
                <Smartphone className="w-3.5 h-3.5 text-sky-400" />
                <span>Mobile</span>
              </span>
              <span>+</span>
              <span className="flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-800/80 text-zinc-300">
                <Monitor className="w-3.5 h-3.5 text-purple-400" />
                <span>PC Browser</span>
              </span>
              <span>➔</span>
              <span className="flex items-center gap-1 px-2 py-1 rounded-md bg-red-950/50 text-red-300 border border-red-800/40">
                <Server className="w-3.5 h-3.5 text-red-400" />
                <span>Server</span>
              </span>
            </div>

            <button
              onClick={onOpenArchitectureSettings}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-600/90 hover:bg-red-600 text-white text-xs font-bold shadow-md shadow-red-600/20 motion-safe:active:scale-[0.96] transition-all cursor-pointer"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>{isZh ? 'PowerShell 部署指南' : 'PowerShell Guide'}</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </GlowCard>

        {/* 2. Bento Card: GPU & Playback Acceleration */}
        <GlowCard 
          className="p-5 flex flex-col justify-between"
          spotlightColor="rgba(56, 189, 248, 0.16)"
          borderColor="rgba(56, 189, 248, 0.3)"
        >
          <div>
            <div className="p-2.5 rounded-xl bg-sky-950/40 text-sky-400 border border-sky-800/50 w-max mb-3">
              <Cpu className="w-5 h-5" />
            </div>
            <h4 className="text-sm font-bold text-white">GPU 效能優化 (iGPU)</h4>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              專為筆電核心顯卡設計。強制關閉 AI 升頻演算法，大幅降低 3D 著色器 98% 滿載發熱。
            </p>
          </div>

          <div className="mt-4 flex items-center justify-between text-xs text-zinc-400 pt-2 border-t border-zinc-800/60">
            <span className="text-[11px] text-zinc-400">3D GPU 負載</span>
            <span className="text-xs font-bold text-emerald-400 font-mono">~ 0 - 3% (極省電)</span>
          </div>
        </GlowCard>

        {/* 3. Bento Card: Mobile & Universal Streaming */}
        <GlowCard 
          className="p-5 flex flex-col justify-between"
          spotlightColor="rgba(168, 85, 247, 0.16)"
          borderColor="rgba(168, 85, 247, 0.3)"
        >
          <div>
            <div className="p-2.5 rounded-xl bg-purple-950/40 text-purple-400 border border-purple-800/50 w-max mb-3">
              <Zap className="w-5 h-5" />
            </div>
            <h4 className="text-sm font-bold text-white">跨平台串流解碼</h4>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              支援 iOS / iPadOS / Android 雙擊快進與即時縮圖預覽。支援外部 VLC、Infuse、PotPlayer 串流啟動。
            </p>
          </div>

          <div className="mt-4 flex items-center justify-between text-xs text-zinc-400 pt-2 border-t border-zinc-800/60">
            <span className="text-[11px] text-zinc-400">行動端手勢</span>
            <span className="text-xs font-bold text-purple-300">雙擊 ±10s 快進</span>
          </div>
        </GlowCard>

      </div>
    </section>
  );
}
