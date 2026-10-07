import React from 'react';
import { 
  X, Download, Folder, CheckCircle, AlertCircle, Clock, 
  Trash2, Play, Pause, ExternalLink, HardDrive 
} from 'lucide-react';

export default function DownloadManager({ 
  isOpen, 
  onClose, 
  tasks = [], 
  downloadDir,
  onCancelTask, 
  onClearCompleted,
  onOpenFolder 
}) {
  if (!isOpen) return null;

  const activeTasks = tasks.filter(t => t.status === 'DOWNLOADING' || t.status === 'QUEUED');
  const finishedTasks = tasks.filter(t => t.status === 'COMPLETED' || t.status === 'ERROR' || t.status === 'CANCELLED');

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div 
        className="w-full max-w-md h-full bg-[#181818] border-l border-zinc-800 shadow-2xl flex flex-col justify-between text-zinc-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#E50914] flex items-center justify-center text-white shadow-md shadow-red-600/30">
              <Download className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                Download Manager
                {activeTasks.length > 0 && (
                  <span className="bg-[#E50914] text-white text-[10px] px-1.5 py-0.2 rounded-full font-black animate-pulse">
                    {activeTasks.length} active
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-zinc-400">ani-cli • yt-dlp • aria2c</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={onOpenFolder}
              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors"
              title="Open Anime Downloads Folder in Explorer"
            >
              <Folder className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Task List Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
          {/* Active Tasks Section */}
          {activeTasks.length > 0 && (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2.5 flex items-center justify-between">
                <span>In Progress ({activeTasks.length})</span>
              </h3>
              <div className="space-y-2.5">
                {activeTasks.map((task) => (
                  <div
                    key={task.id}
                    className="bg-zinc-900/90 rounded-xl p-3 border border-zinc-800 space-y-2 relative overflow-hidden"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-xs font-bold text-white truncate">
                          {task.animeTitle}
                        </h4>
                        <div className="flex items-center gap-2 text-[11px] text-zinc-400 mt-0.5">
                          <span className="font-semibold text-zinc-300">Ep {task.episode}</span>
                          <span>•</span>
                          <span className="uppercase text-[10px] bg-zinc-800 px-1.5 py-0.2 rounded">
                            {task.audio}
                          </span>
                          <span>•</span>
                          <span className="text-[10px] text-zinc-400">{task.quality}</span>
                        </div>
                      </div>

                      <button
                        onClick={() => onCancelTask(task.id)}
                        className="text-zinc-500 hover:text-red-400 p-1 transition-colors"
                        title="Cancel Download"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-gradient-to-r from-red-600 to-[#E50914] h-full rounded-full transition-all duration-300"
                        style={{ width: `${Math.max(task.progress, 3)}%` }}
                      />
                    </div>

                    {/* Progress Details */}
                    <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-white">{task.progress.toFixed(1)}%</span>
                        {task.totalSize && task.totalSize !== 'Unknown' && (
                          <span className="text-[10px] text-zinc-500">({task.totalSize})</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-zinc-300">
                        <span className="text-emerald-400 font-semibold">{task.speed}</span>
                        <span>•</span>
                        <span className="bg-zinc-800/80 text-zinc-200 px-1.5 py-0.5 rounded text-[10px] font-bold border border-zinc-700/60">
                          ETA {task.eta}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Finished Tasks Section */}
          {finishedTasks.length > 0 && (
            <div className="pt-2">
              <div className="flex items-center justify-between mb-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                  History ({finishedTasks.length})
                </h3>
                <button
                  onClick={onClearCompleted}
                  className="text-[11px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear Finished
                </button>
              </div>

              <div className="space-y-2">
                {finishedTasks.map((task) => (
                  <div
                    key={task.id}
                    className="bg-zinc-900/50 rounded-lg p-2.5 border border-zinc-800/80 flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {task.status === 'COMPLETED' ? (
                        <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="font-semibold text-white truncate text-[11px]">
                          {task.animeTitle} - Ep {task.episode}
                        </p>
                        <p className="text-[10px] text-zinc-500">
                          {task.status === 'COMPLETED' ? 'Downloaded to folder' : (task.error || task.status)}
                        </p>
                      </div>
                    </div>

                    {task.status === 'COMPLETED' && (
                      <button
                        onClick={() => onOpenFolder(task.animeDir)}
                        className="text-zinc-400 hover:text-white p-1"
                        title="Show in Anime Folder"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tasks.length === 0 && (
            <div className="h-64 flex flex-col items-center justify-center text-center p-6 text-zinc-500">
              <Download className="w-10 h-10 mb-2 stroke-1 text-zinc-600" />
              <p className="text-sm font-semibold text-zinc-400">No active downloads</p>
              <p className="text-xs mt-1">Select an anime and queue episodes to start downloading.</p>
            </div>
          )}
        </div>

        {/* Footer: Destination Path & Open Explorer Button */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-900/80 space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-400 flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-zinc-500" />
              Destination:
            </span>
            <span className="text-zinc-300 truncate max-w-[220px] font-mono text-[11px]" title={downloadDir}>
              {downloadDir || 'Downloads/Anime'}
            </span>
          </div>

          <button
            onClick={onOpenFolder}
            className="w-full flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white font-semibold py-2 rounded-lg text-xs border border-zinc-700 transition-colors shadow-sm"
          >
            <Folder className="w-4 h-4 text-amber-400" />
            <span>Open Download Folder</span>
          </button>
        </div>
      </div>
    </div>
  );
}
