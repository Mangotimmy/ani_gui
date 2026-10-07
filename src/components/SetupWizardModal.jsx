// src/components/SetupWizardModal.jsx - First-run Environment & Plugin Setup Wizard
import React, { useState, useRef, useEffect } from 'react';
import { DownloadCloud, CheckCircle2, Terminal, X, Sparkles, ShieldCheck } from 'lucide-react';

export default function SetupWizardModal({ isOpen, onClose, onComplete }) {
  const [isInstalling, setIsInstalling] = useState(false);
  const [logs, setLogs] = useState('');
  const [isDone, setIsDone] = useState(false);
  const logEndRef = useRef(null);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  if (!isOpen) return null;

  const startInstall = () => {
    setIsInstalling(true);
    setLogs('🚀 Initializing PowerShell & Scoop package setup...\n');

    const es = new EventSource('/api/environment/install/stream');

    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.text) {
          setLogs(prev => prev + d.text);
        }
        if (d.done) {
          es.close();
          setIsInstalling(false);
          setIsDone(true);
          if (onComplete) onComplete();
        }
      } catch {}
    };

    es.onerror = () => {
      es.close();
      setIsInstalling(false);
      setIsDone(true);
      if (onComplete) onComplete();
    };
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md cursor-pointer"
      onClick={!isInstalling ? onClose : undefined}
    >
      <div 
        className="w-full max-w-lg bg-[#181818] rounded-2xl border border-zinc-800 shadow-2xl p-6 text-zinc-100 animate-in fade-in zoom-in-95 cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#E50914]" />
            <h3 className="text-base font-bold text-white">Welcome to AniFlix</h3>
          </div>
          {!isInstalling && (
            <button onClick={onClose} className="p-1 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="mt-4 space-y-3">
          <p className="text-xs text-zinc-300 leading-relaxed">
            AniFlix uses high-performance open-source engines (<span className="text-emerald-400 font-mono">yt-dlp</span>, <span className="text-emerald-400 font-mono">mpv</span>, <span className="text-emerald-400 font-mono">ffmpeg</span>, and <span className="text-emerald-400 font-mono">aria2</span>) to stream and download anime with hardware acceleration.
          </p>

          <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-3.5 space-y-2 text-xs">
            <div className="flex items-center gap-2 text-zinc-200 font-semibold">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>1-Click Safe User-Space Installation</span>
            </div>
            <p className="text-[11px] text-zinc-400">
              Installs via Windows Scoop package manager directly in your user profile without modifying system files or requiring Administrator privileges.
            </p>
          </div>

          {logs && (
            <div className="mt-3">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-zinc-400 mb-1">
                <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                <span>Installation Console Output</span>
              </div>
              <pre className="bg-black/90 border border-zinc-800 rounded-xl p-3 text-[10px] font-mono text-zinc-300 max-h-40 overflow-y-auto custom-scrollbar whitespace-pre-wrap">
                {logs}
                <div ref={logEndRef} />
              </pre>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-zinc-800">
            {!isInstalling && !isDone && (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-bold text-zinc-400 hover:text-white"
              >
                Skip for Now
              </button>
            )}

            {isDone ? (
              <button
                type="button"
                onClick={onClose}
                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-5 py-2 rounded-lg text-xs shadow-md"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Ready to Watch!</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={startInstall}
                disabled={isInstalling}
                className="flex items-center gap-2 bg-[#E50914] hover:bg-red-700 text-white font-bold px-5 py-2.5 rounded-lg text-xs shadow-lg shadow-red-600/30 transition-transform hover:scale-105"
              >
                <DownloadCloud className={`w-4 h-4 ${isInstalling ? 'animate-bounce' : ''}`} />
                <span>{isInstalling ? 'Installing Plugins...' : 'Auto Install All Plugins'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
