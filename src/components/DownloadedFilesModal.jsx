import React, { useState, useEffect } from 'react';
import { 
  X, Folder, Play, Download, Trash2, RefreshCw, HardDrive, 
  Film, Search, Check, AlertCircle, FileVideo, ExternalLink 
} from 'lucide-react';

export default function DownloadedFilesModal({
  isOpen,
  onClose,
  onPlayFile,
  currentLang = 'zh-TW',
  t = (k) => k
}) {
  const [files, setFiles] = useState([]);
  const [baseDir, setBaseDir] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deletingPath, setDeletingPath] = useState(null);

  const fetchFiles = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/downloads/files');
      const data = await res.json();
      if (data.success) {
        setFiles(data.files || []);
        setBaseDir(data.baseDir || '');
      }
    } catch (err) {
      console.warn('Failed to load downloaded files:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchFiles();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDelete = async (relativePath) => {
    setDeletingPath(relativePath);
    try {
      const res = await fetch(`/api/downloads/file?path=${encodeURIComponent(relativePath)}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        setFiles(prev => prev.filter(f => f.relativePath !== relativePath));
        setDeleteConfirm(null);
      }
    } catch (err) {
      console.error('Failed to delete file:', err);
    } finally {
      setDeletingPath(null);
    }
  };

  const filteredFiles = searchQuery.trim()
    ? files.filter(f => 
        f.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        f.folder.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : files;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-2xl bg-[#16161a] border border-zinc-800 rounded-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-zinc-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-zinc-800/80 flex items-center justify-between bg-zinc-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#E50914]/20 border border-[#E50914]/40 flex items-center justify-center text-[#E50914] shadow-md shadow-red-600/20">
              <Folder className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                <span>下載檔案管理員</span>
                <span className="text-[10px] bg-red-600/20 text-red-400 font-mono px-2 py-0.5 rounded-full border border-red-500/30">
                  {files.length} 部影片
                </span>
              </h2>
              <p className="text-[11px] text-zinc-400 font-mono truncate max-w-xs sm:max-w-md">
                {baseDir || '儲存路徑'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchFiles}
              disabled={loading}
              className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors"
              title="重新整理 / Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search Bar */}
        {files.length > 0 && (
          <div className="p-3 sm:px-5 border-b border-zinc-800/60 bg-zinc-900/20">
            <div className="relative flex items-center">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜尋已下載的動畫名稱或集數..."
                className="w-full bg-zinc-800/60 border border-zinc-700/60 rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-[#E50914] transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 text-zinc-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Content List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 sm:p-5 space-y-2.5">
          {loading && files.length === 0 ? (
            <div className="py-16 text-center text-zinc-500 flex flex-col items-center gap-3">
              <RefreshCw className="w-8 h-8 animate-spin text-[#E50914]" />
              <span className="text-xs">讀取下載資料夾中...</span>
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="py-16 text-center text-zinc-400 flex flex-col items-center gap-3">
              <div className="w-14 h-14 rounded-full bg-zinc-800/80 flex items-center justify-center text-zinc-500">
                <FileVideo className="w-7 h-7" />
              </div>
              <h3 className="text-sm font-bold text-zinc-200">
                {searchQuery ? '沒有符合搜尋條件的檔案' : '目前尚無已下載的動畫檔案'}
              </h3>
              <p className="text-xs text-zinc-500 max-w-sm leading-relaxed">
                {searchQuery 
                  ? '請嘗試使用其他關鍵字搜尋' 
                  : '在動畫詳情頁點選「批量下載」或在播放器點選下載，影片將自動儲存於此，支援 iOS / Android 手機免傳輸線直接串流觀看或儲存至本機。'}
              </p>
            </div>
          ) : (
            filteredFiles.map((file) => (
              <div
                key={file.relativePath}
                className="bg-zinc-900/70 hover:bg-zinc-900 border border-zinc-800/80 hover:border-zinc-700 rounded-2xl p-3 sm:p-3.5 transition-all flex items-center justify-between gap-3 group"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-red-950/40 border border-red-800/40 text-[#E50914] flex items-center justify-center shrink-0">
                    <Film className="w-4 h-4 sm:w-5 sm:h-5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white truncate block">
                        {file.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[10px] text-zinc-400 mt-1">
                      {file.folder && file.folder !== 'Downloads' && (
                        <span className="bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-300 font-medium">
                          {file.folder}
                        </span>
                      )}
                      <span className="font-mono text-emerald-400 font-bold bg-emerald-950/40 border border-emerald-800/30 px-1.5 py-0.5 rounded">
                        {file.sizeFormatted}
                      </span>
                      <span className="text-zinc-500">
                        {new Date(file.modifiedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                  {/* Play in App */}
                  <button
                    onClick={() => {
                      if (onPlayFile) {
                        onPlayFile({
                          title: file.name.replace(/\.[^/.]+$/, ''),
                          streamUrl: file.streamUrl,
                          episode: 1,
                          isLocalFile: true
                        });
                        onClose();
                      }
                    }}
                    className="flex items-center gap-1 px-3 py-1.5 bg-[#E50914] hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-red-600/30"
                    title="在播放器中播放 / Play Stream"
                  >
                    <Play className="w-3.5 h-3.5 fill-white" />
                    <span className="hidden sm:inline">播放</span>
                  </button>

                  {/* Direct Download Link for Mobile */}
                  <a
                    href={file.downloadUrl}
                    download={file.name}
                    className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors"
                    title="下載儲存至本機裝置 / Save to Device"
                  >
                    <Download className="w-4 h-4" />
                  </a>

                  {/* Delete Button */}
                  {deleteConfirm === file.relativePath ? (
                    <div className="flex items-center gap-1 bg-red-950/80 border border-red-700/60 p-1 rounded-xl">
                      <button
                        onClick={() => handleDelete(file.relativePath)}
                        disabled={deletingPath === file.relativePath}
                        className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold rounded-lg transition-colors"
                      >
                        確認刪除
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        className="px-1.5 py-1 text-zinc-400 hover:text-white text-[10px]"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirm(file.relativePath)}
                      className="p-2 rounded-xl bg-zinc-800/60 hover:bg-red-950/60 hover:text-red-400 text-zinc-400 transition-colors"
                      title="刪除檔案 / Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-3 sm:p-4 border-t border-zinc-800/80 bg-zinc-900/60 flex items-center justify-between text-xs text-zinc-400">
          <span className="flex items-center gap-1.5">
            <HardDrive className="w-4 h-4 text-zinc-500" />
            <span>支援 iOS Safari / iPad / Android 串流與下載</span>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white font-semibold transition-colors"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
