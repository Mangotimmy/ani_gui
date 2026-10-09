// src/components/SettingsModal.jsx - Settings & Universal Plugin Environment Manager
import React, { useState, useEffect, useRef } from 'react';
import { 
  X, Settings, Folder, Check, Terminal, Wrench, RefreshCw, 
  DownloadCloud, AlertTriangle, CheckCircle, ExternalLink, Sparkles,
  Shield, ShieldAlert, ShieldCheck, Database, FileText, UploadCloud, FileCode,
  Cpu, Zap, Gauge, Monitor, Sliders
} from 'lucide-react';
import { 
  collectUserData, exportToXml, exportToCsv, downloadBackupFile, 
  restoreFromJson, restoreFromXml 
} from '../utils/dataExport.js';

const I18N = {
  'zh-TW': {
    title: '系統設定與環境管理',
    tabContent: '內容偏好與分級',
    tabGpu: 'GPU 與播放效能',
    tabPlugins: '組件管理與更新',
    tabDownloads: '下載儲存路徑',
    tabBackup: '資料備份與匯出',
    r18Title: '過濾 R-18 成人內容 (安全模式)',
    r18Subtitle: '預設開啟隱藏。自動過濾 18禁、Hentai 及成人限制級動漫作品與種子資源。',
    r18Active: '安全防護中 (已隱藏 R-18 成人內容)',
    r18Inactive: '已解除限制 (顯示所有成人與全年齡作品)',
    r18Desc: '開啟此選項時，全站首頁推薦、每季新番、排行榜、搜尋結果以及 BT 磁力下載都會自動過濾並隱藏 R-18 成人限制級內容。',
    r18Warning: '注意：關閉此功能後，將會載入成人限制級動畫、封面及相關種子資源，請確保使用者已成年。',
    toggleOn: '已開啟隱藏',
    toggleOff: '已關閉隱藏 (允許成人內容)',
    saveDir: '下載目的地目錄：',
    saveBtn: '儲存設定',
    saved: '已儲存！',
    close: '關閉',
    openFolder: '開啟資料夾',
    gpuTitle: 'GPU 效能配置 (Performance Profile)',
    gpuDesc: '針對筆記型電腦與迷你主機之內顯 (Intel Iris Xe / Arc / UHD / AMD Radeon) 提供專門省電與效能優化。',
    gpuIgpu: '⚡ 內顯極限省電 (Intel QuickSync / AMD iGPU - 最低 3D 負載)',
    gpuStandard: '🚀 標準硬體加速 (Direct3D 11 / 獨立顯卡)',
    gpuSoftware: '💻 純 CPU 軟體相容模式 (停用 GPU)',
    upscaleTitle: '影片超解析度 AI 升頻 (Video Super Resolution)',
    upscaleSubtitle: '關閉可防止 Intel 驅動對全螢幕視訊強制啟用 AI 升頻演算法，徹底解決 GPU 3D 飆到 98% 與卡頓發熱問題。',
    upscaleOn: '已啟用 AI 升頻 (需要獨立顯卡)',
    upscaleOff: '已關閉升頻 (推薦內顯使用者使用)',
    blurTitle: '介面毛玻璃即時模糊特效 (UI Backdrop Blur)',
    blurSubtitle: '關閉可停止視窗即時高斯模糊著色器，將 3D GPU 資源全力留給視訊解碼。',
    blurOn: '開啟毛玻璃特效',
    blurOff: '關閉毛玻璃特效 (省電極速)',
    mpvTitle: 'MPV 外部播放器渲染引擎',
    mpvDesc: '設定由外部 MPV 播放器啟動時的縮放著色演算法。',
    mpvIgpu: '⚡ iGPU 雙線性 (Bilinear - 0% 3D 著色，純硬體解碼)',
    mpvHigh: '🎬 高畫質 Spline36 著色 (GPU 運算較高)',
    restartNotice: '提示：變更「GPU 效能配置」或「影片超解析度升頻」後，建議重新啟動 AniFlix 桌面版以確保 Chromium 旗標完整生效。',
    pluginsTitle: '串流組件狀態',
    pluginsSubtitle: '用於動畫串流解碼、MPV 硬體加速與批次下載的核心引擎。',
    updateAll: '更新所有組件',
    autoInstall: '一鍵自動安裝組件',
    checkUpdate: '檢查版本更新',
    checking: '檢查中...',
    backupTitle: '使用者資料備份與還原',
    backupSubtitle: '匯出或匯入您的動畫收藏清單、播放歷史紀錄、個人進度與系統設定。',
    exportJson: '匯出 JSON 格式',
    exportXml: '匯出 XML 格式',
    exportCsv: '匯出 CSV 表格',
    importBackup: '匯入備份檔案 (JSON / XML)',
    importSuccess: '備份資料已成功匯入！建議重新整理頁面以套用所有變更。',
    importFailed: '匯入失敗：請確認檔案是否為有效的 AniFlix JSON 或 XML 備份。',
  },
  'zh-CN': {
    title: '系统设置与环境管理',
    tabContent: '内容偏好与分级',
    tabGpu: 'GPU 与播放性能',
    tabPlugins: '组件管理与更新',
    tabDownloads: '下载存储路径',
    tabBackup: '数据备份与导出',
    r18Title: '过滤 R-18 成人内容 (安全模式)',
    r18Subtitle: '默认开启隐藏。自动过滤 18禁、Hentai 及成人限制级动漫作品与种子资源。',
    r18Active: '安全防护中 (已隐藏 R-18 成人内容)',
    r18Inactive: '已解除限制 (显示所有成人与全年龄作品)',
    r18Desc: '开启此选项时，全站首页推荐、每季新番、排行榜、搜索结果以及 BT 磁力下载都会自动过滤并隐藏 R-18 成人限制级内容。',
    r18Warning: '注意：关闭此功能后，将会加载成人限制级动画、封面及相关种子资源，请确保使用者已成年。',
    toggleOn: '已开启隐藏',
    toggleOff: '已关闭隐藏 (允许成人内容)',
    saveDir: '下载目的地目录：',
    saveBtn: '保存设置',
    saved: '已保存！',
    close: '关闭',
    openFolder: '打开文件夹',
    gpuTitle: 'GPU 性能配置 (Performance Profile)',
    gpuDesc: '针对笔记本与迷你主机核心显卡 (Intel Iris Xe / Arc / UHD / AMD Radeon) 提供专门省电与性能优化。',
    gpuIgpu: '⚡ 核显极限省电 (Intel QuickSync / AMD iGPU - 最低 3D 负载)',
    gpuStandard: '🚀 标准硬件加速 (Direct3D 11 / 独立显卡)',
    gpuSoftware: '💻 纯 CPU 软件兼容模式 (停用 GPU)',
    upscaleTitle: '视频超分辨率 AI 升频 (Video Super Resolution)',
    upscaleSubtitle: '关闭可防止 Intel 驱动对全屏视频强制启用 AI 升频算法，彻底解决 GPU 3D 飙到 98% 与卡顿发热问题。',
    upscaleOn: '已启用 AI 升频 (需要独立显卡)',
    upscaleOff: '已关闭升频 (推荐核显用户使用)',
    blurTitle: '界面毛玻璃实时模糊特效 (UI Backdrop Blur)',
    blurSubtitle: '关闭可停止窗口实时高斯模糊着色器，将 3D GPU 资源全力留给视频解码。',
    blurOn: '开启毛玻璃特效',
    blurOff: '关闭毛玻璃特效 (省电极速)',
    mpvTitle: 'MPV 外部播放器渲染引擎',
    mpvDesc: '设置由外部 MPV 播放器启动时的缩放着色算法。',
    mpvIgpu: '⚡ iGPU 双线性 (Bilinear - 0% 3D 着色，纯硬件解码)',
    mpvHigh: '🎬 高画质 Spline36 着色 (GPU 计算较高)',
    restartNotice: '提示：变更“GPU 性能配置”或“视频超分辨率升频”后，建议重启 AniFlix 桌面版以确保 Chromium 标志完整生效。',
    pluginsTitle: '串流组件状态',
    pluginsSubtitle: '用于动画串流解码、MPV 硬件加速与批量下载的核心引擎。',
    updateAll: '更新所有组件',
    autoInstall: '一键自动安装组件',
    checkUpdate: '检查版本更新',
    checking: '检查中...',
    backupTitle: '用户数据备份与还原',
    backupSubtitle: '导出或导入您的动画收藏清单、播放历史记录、个人进度与系统设置。',
    exportJson: '导出 JSON 格式',
    exportXml: '导出 XML 格式',
    exportCsv: '导出 CSV 表格',
    importBackup: '导入备份文件 (JSON / XML)',
    importSuccess: '备份数据已成功导入！建议刷新页面以应用所有变更。',
    importFailed: '导入失败：请确认文件是否为有效的 AniFlix JSON 或 XML 备份。',
  },
  'ja': {
    title: '設定と動作環境',
    tabContent: 'コンテンツと安全設定',
    tabGpu: 'GPU と画質設定',
    tabPlugins: 'プラグインと更新',
    tabDownloads: 'ダウンロード保存先',
    tabBackup: 'バックアップと復元',
    r18Title: 'R-18 成人向けコンテンツの制限 (セーフモード)',
    r18Subtitle: 'デフォルトで非表示。18禁・Hentai・成人向けアニメおよびトレントを自動的に非表示にします。',
    r18Active: 'セーフモード保護中 (R-18非表示)',
    r18Inactive: '制限解除 (すべての成人向け作品を表示)',
    r18Desc: '有効にすると、トップ画面、新作カタログ、ランキング、検索結果、トレントダウンロードから成人向けコンテンツが除外されます。',
    r18Warning: '注意：無効化すると成人向け作品が表示されます。18歳以上の方のみご利用ください。',
    toggleOn: '非表示（有効）',
    toggleOff: '表示を許可',
    saveDir: 'ダウンロード保存先フォルダ：',
    saveBtn: '設定を保存',
    saved: '保存完了！',
    close: '閉じる',
    openFolder: 'フォルダを開く',
    gpuTitle: 'GPU パフォーマンスモード',
    gpuDesc: '内蔵GPU（Intel Iris Xe / Arc / AMD Radeon）に特化した省電力・低負荷プロファイル。',
    gpuIgpu: '⚡ 内蔵GPU省電力 (Intel QuickSync / AMD iGPU - 3D負荷極小)',
    gpuStandard: '🚀 標準ハードウェア加速 (Direct3D 11 / 独立GPU)',
    gpuSoftware: '💻 ソフトウェア互換モード (CPUのみ)',
    upscaleTitle: '動画超解像 AI アップスケーリング',
    upscaleSubtitle: '無効化すると、Intel ドライバーによる強制 AI 処理を停止し、GPU負荷 98% とカクつきを解消します。',
    upscaleOn: 'AI アップスケーリング有効 (dGPU推奨)',
    upscaleOff: 'AI アップスケーリング無効 (iGPU推奨)',
    blurTitle: 'UI すりガラスぼかし効果 (Backdrop Blur)',
    blurSubtitle: '無効化するとリアルタイムぼかしシェーダーを停止し、内蔵GPUの負荷を低減します。',
    blurOn: 'ぼかし効果 有効',
    blurOff: 'ぼかし効果 無効 (高速・省電力)',
    mpvTitle: 'MPV 外部レンダラープロファイル',
    mpvDesc: 'MPV プレイヤー起動時の拡大アルゴリズムを指定します。',
    mpvIgpu: '⚡ iGPU バイリニア (低負荷・純ハードウェアデコード)',
    mpvHigh: '🎬 高画質 Spline36 (GPU負荷高)',
    restartNotice: '※注：GPU設定やアップスケーリングの変更は、アプリの再起動後に完全に適用されます。',
    pluginsTitle: 'プラグイン動作状況',
    pluginsSubtitle: 'ストリーミング再生、MPV ハードウェア再生、バッチダウンロードに必要なエンジンです。',
    updateAll: 'すべてのプラグインを更新',
    autoInstall: '不足プラグインを一括インストール',
    checkUpdate: 'アプリアップデートを確認',
    checking: '確認中...',
    backupTitle: 'ユーザーデータバックアップと復元',
    backupSubtitle: 'お気に入り、視聴履歴、進行状況、システム設定の入出力。',
    exportJson: 'JSON 形式で出力',
    exportXml: 'XML 形式で出力',
    exportCsv: 'CSV 表形式で出力',
    importBackup: 'バックアップファイルを復元 (JSON / XML)',
    importSuccess: 'データが正常に復元されました！反映するにはページを再読み込みしてください。',
    importFailed: '復元失敗：有効な AniFlix JSON または XML ファイルを指定してください。',
  },
  'en': {
    title: 'Settings & Environment',
    tabContent: 'Content & Safety',
    tabGpu: 'GPU & Playback',
    tabPlugins: 'Plugins & Auto-Updater',
    tabDownloads: 'Downloader Storage',
    tabBackup: 'Data & Backup',
    r18Title: 'Filter R-18 / Adult Content (Safe Mode)',
    r18Subtitle: 'Hidden by default. Automatically excludes 18+, Hentai, and adult anime titles and torrent resources.',
    r18Active: 'Safe Mode Active (R-18 content hidden)',
    r18Inactive: 'Restrictions Unlocked (Showing all adult content)',
    r18Desc: 'When enabled, adult anime is excluded from trending carousels, seasonal catalog, search results, and BitTorrent downloads.',
    r18Warning: 'Warning: Disabling this setting will load adult / NSFW content, banners, and magnet links. Must be 18+.',
    toggleOn: 'Hide R-18 (ON)',
    toggleOff: 'Allow R-18 (OFF)',
    saveDir: 'Downloads Destination Directory:',
    saveBtn: 'Save Settings',
    saved: 'Saved!',
    close: 'Close',
    openFolder: 'Open',
    gpuTitle: 'GPU Performance Profile',
    gpuDesc: 'Optimized profiles for laptops and mini PCs running integrated GPUs (Intel Iris Xe, Arc, AMD Radeon).',
    gpuIgpu: '⚡ iGPU Low-Power (Intel QuickSync / AMD iGPU - Minimized 3D Load)',
    gpuStandard: '🚀 Standard Hardware Acceleration (Direct3D 11 / Dedicated GPU)',
    gpuSoftware: '💻 CPU Software Compatibility (GPU Disabled)',
    upscaleTitle: 'Video Super Resolution (AI Upscaling)',
    upscaleSubtitle: 'Disabling prevents Intel driver from forcing AI scaling on video, dropping 3D engine load from 98% to ~0%.',
    upscaleOn: 'AI Upscaling ON (Requires Dedicated GPU)',
    upscaleOff: 'AI Upscaling OFF (Recommended for iGPU)',
    blurTitle: 'UI Backdrop Blur Effects',
    blurSubtitle: 'Disable to eliminate real-time CSS Gaussian blur shaders, freeing GPU shader cores.',
    blurOn: 'Backdrop Blur ON',
    blurOff: 'Backdrop Blur OFF (Fast & Low Power)',
    mpvTitle: 'MPV Player Rendering Profile',
    mpvDesc: 'Select video scaling algorithm for the external MPV player.',
    mpvIgpu: '⚡ iGPU Bilinear (0% 3D shader load, pure HW decode)',
    mpvHigh: '🎬 High Quality Spline36 (Demanding)',
    restartNotice: 'Note: Changing GPU Profile or Video Super Resolution requires restarting AniFlix Desktop to take effect.',
    pluginsTitle: 'Video Plugins Status',
    pluginsSubtitle: 'Core engines for anime stream decoding, MPV acceleration, and batch downloads.',
    updateAll: 'Update All Plugins',
    autoInstall: 'Auto Install Plugins',
    checkUpdate: 'Check App Update',
    checking: 'Connecting to GitHub...',
    backupTitle: 'User Data Backup & Restore',
    backupSubtitle: 'Export or import your favorites, watch history, playback progress, and settings.',
    exportJson: 'Export JSON Format',
    exportXml: 'Export XML Format',
    exportCsv: 'Export CSV Spreadsheet',
    importBackup: 'Import Backup File (JSON / XML)',
    importSuccess: 'Backup successfully restored! Refresh page to apply changes.',
    importFailed: 'Restore failed: Please check if the file is a valid AniFlix JSON or XML backup.',
  }
};

export default function SettingsModal({ 
  isOpen, 
  onClose, 
  currentDir, 
  onSaveSettings, 
  onOpenFolder,
  onOpenDownloadedFiles,
  hideR18 = true,
  onToggleHideR18,
  currentLang = 'zh-TW',
  gpuSettings,
  onUpdateGpuSettings
}) {
  const txt = I18N[currentLang] || I18N['zh-TW'];
  const [activeTab, setActiveTab] = useState('content'); // 'content' | 'gpu' | 'plugins' | 'downloads' | 'backup'
  const [downloadDir, setDownloadDir] = useState(currentDir || '');
  const [saved, setSaved] = useState(false);

  // GPU & Performance Profile states
  const [gpuProfile, setGpuProfile] = useState(gpuSettings?.gpuProfile || 'igpu');
  const [enableUpscale, setEnableUpscale] = useState(gpuSettings?.enableUpscale ?? false);
  const [enableBackdropBlur, setEnableBackdropBlur] = useState(gpuSettings?.enableBackdropBlur ?? false);
  const [mpvProfile, setMpvProfile] = useState(gpuSettings?.mpvProfile || 'igpu');
  const [gpuSavedNotice, setGpuSavedNotice] = useState(false);

  useEffect(() => {
    if (gpuSettings) {
      if (gpuSettings.gpuProfile) setGpuProfile(gpuSettings.gpuProfile);
      if (gpuSettings.enableUpscale !== undefined) setEnableUpscale(gpuSettings.enableUpscale);
      if (gpuSettings.enableBackdropBlur !== undefined) setEnableBackdropBlur(gpuSettings.enableBackdropBlur);
      if (gpuSettings.mpvProfile) setMpvProfile(gpuSettings.mpvProfile);
    }
  }, [gpuSettings]);

  const handleUpdateGpuOption = (key, value) => {
    const nextGpuProfile = key === 'gpuProfile' ? value : gpuProfile;
    const nextEnableUpscale = key === 'enableUpscale' ? value : enableUpscale;
    const nextEnableBackdropBlur = key === 'enableBackdropBlur' ? value : enableBackdropBlur;
    const nextMpvProfile = key === 'mpvProfile' ? value : mpvProfile;

    if (key === 'gpuProfile') setGpuProfile(value);
    if (key === 'enableUpscale') setEnableUpscale(value);
    if (key === 'enableBackdropBlur') setEnableBackdropBlur(value);
    if (key === 'mpvProfile') setMpvProfile(value);

    const updated = {
      gpuProfile: nextGpuProfile,
      enableUpscale: nextEnableUpscale,
      enableBackdropBlur: nextEnableBackdropBlur,
      mpvProfile: nextMpvProfile
    };

    onUpdateGpuSettings?.(updated);
    setGpuSavedNotice(true);
    setTimeout(() => setGpuSavedNotice(false), 2000);
  };

  // Backup & Export states
  const [backupStatus, setBackupStatus] = useState(null);
  const fileImportRef = useRef(null);

  const handleExport = (format) => {
    const data = collectUserData();
    const dateStr = new Date().toISOString().split('T')[0];
    if (format === 'json') {
      downloadBackupFile(JSON.stringify(data, null, 2), `aniflix_backup_${dateStr}.json`, 'application/json');
    } else if (format === 'xml') {
      const xml = exportToXml(data);
      downloadBackupFile(xml, `aniflix_backup_${dateStr}.xml`, 'application/xml');
    } else if (format === 'csv') {
      const csv = exportToCsv(data);
      downloadBackupFile(csv, `aniflix_library_${dateStr}.csv`, 'text/csv');
    }
  };

  const handleFileImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result;
        let ok = false;
        if (typeof content === 'string') {
          if (content.trim().startsWith('<')) {
            ok = restoreFromXml(content);
          } else {
            const parsed = JSON.parse(content);
            ok = restoreFromJson(parsed);
          }
        }
        if (ok) {
          setBackupStatus({ type: 'success', message: txt.importSuccess });
        } else {
          setBackupStatus({ type: 'error', message: txt.importFailed });
        }
      } catch (err) {
        setBackupStatus({ type: 'error', message: `${txt.importFailed} (${err.message})` });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Environment & Plugin states
  const [envStatus, setEnvStatus] = useState(null);
  const [isLoadingEnv, setIsLoadingEnv] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [terminalLogs, setTerminalLogs] = useState('');
  const [showLogModal, setShowLogModal] = useState(false);
  const [appUpdateInfo, setAppUpdateInfo] = useState(null);
  const [isCheckingApp, setIsCheckingApp] = useState(false);

  const logBottomRef = useRef(null);

  // Fetch Environment Status
  const fetchEnvStatus = async () => {
    setIsLoadingEnv(true);
    try {
      const res = await fetch('/api/environment/status');
      const data = await res.json();
      if (data.success) {
        setEnvStatus(data);
      }
    } catch (err) {
      console.warn('Failed to fetch environment status:', err);
    } finally {
      setIsLoadingEnv(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchEnvStatus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (showLogModal && logBottomRef.current) {
      logBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalLogs, showLogModal]);

  if (!isOpen) return null;

  // Handle Update All Plugins via SSE
  const handleUpdatePlugins = () => {
    setIsUpdating(true);
    setTerminalLogs('Connecting to plugin updater...\n');
    setShowLogModal(true);

    const es = new EventSource('/api/environment/update/stream');

    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.text) {
          setTerminalLogs(prev => prev + d.text);
        }
        if (d.done) {
          es.close();
          setIsUpdating(false);
          fetchEnvStatus();
        }
      } catch {}
    };

    es.onerror = () => {
      es.close();
      setIsUpdating(false);
      setTerminalLogs(prev => prev + '\n[Stream closed or disconnected]\n');
      fetchEnvStatus();
    };
  };

  // Handle 1-Click Install via SSE
  const handleInstallPlugins = () => {
    setIsInstalling(true);
    setTerminalLogs('Starting automated Windows environment installer...\n');
    setShowLogModal(true);

    const es = new EventSource('/api/environment/install/stream');

    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.text) {
          setTerminalLogs(prev => prev + d.text);
        }
        if (d.done) {
          es.close();
          setIsInstalling(false);
          fetchEnvStatus();
        }
      } catch {}
    };

    es.onerror = () => {
      es.close();
      setIsInstalling(false);
      setTerminalLogs(prev => prev + '\n[Installer process finished]\n');
      fetchEnvStatus();
    };
  };

  // Handle Check App Update
  const handleCheckAppUpdate = async () => {
    setIsCheckingApp(true);
    try {
      const res = await fetch('/api/app/check-update');
      const data = await res.json();
      if (data.success) {
        setAppUpdateInfo(data);
      }
    } catch {} finally {
      setIsCheckingApp(false);
    }
  };

  const handleSaveDownloads = (e) => {
    e.preventDefault();
    onSaveSettings({ downloadDir });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm cursor-pointer"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-2xl bg-[#181818] rounded-3xl border border-zinc-800 shadow-2xl p-4 sm:p-6 text-zinc-100 animate-in fade-in zoom-in-95 cursor-default max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 sm:pb-4 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <Settings className="w-5 h-5 text-[#E50914]" />
            <h3 className="text-base sm:text-lg font-bold text-white">{txt.title}</h3>
          </div>
          <button 
            onClick={onClose} 
            className="p-1 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selection (Horizontally scrollable on mobile) */}
        <div className="flex items-center gap-1.5 sm:gap-2 mt-3 sm:mt-4 border-b border-zinc-800 pb-3 overflow-x-auto no-scrollbar scroll-smooth flex-nowrap shrink-0">
          <button
            onClick={() => setActiveTab('content')}
            className={`flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 whitespace-nowrap ${
              activeTab === 'content'
                ? 'bg-[#E50914] text-white shadow-md shadow-red-600/30'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>{txt.tabContent}</span>
          </button>

          <button
            onClick={() => setActiveTab('gpu')}
            className={`flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 whitespace-nowrap ${
              activeTab === 'gpu'
                ? 'bg-[#E50914] text-white shadow-md shadow-red-600/30'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>{txt.tabGpu}</span>
          </button>

          <button
            onClick={() => setActiveTab('plugins')}
            className={`flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 whitespace-nowrap ${
              activeTab === 'plugins'
                ? 'bg-[#E50914] text-white shadow-md shadow-red-600/30'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>{txt.tabPlugins}</span>
          </button>

          <button
            onClick={() => setActiveTab('downloads')}
            className={`flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 whitespace-nowrap ${
              activeTab === 'downloads'
                ? 'bg-[#E50914] text-white shadow-md shadow-red-600/30'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
          >
            <Folder className="w-3.5 h-3.5" />
            <span>{txt.tabDownloads}</span>
          </button>

          <button
            onClick={() => setActiveTab('backup')}
            className={`flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 whitespace-nowrap ${
              activeTab === 'backup'
                ? 'bg-[#E50914] text-white shadow-md shadow-red-600/30'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>{txt.tabBackup}</span>
          </button>
        </div>

        {/* Scrollable Tab Body Area */}
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 mt-2">

        {/* Tab 0: Content & Safety Preferences */}
        {activeTab === 'content' && (
          <div className="mt-5 space-y-4">
            <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 shadow-inner space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  <div className={`p-2.5 rounded-xl border mt-0.5 shrink-0 ${
                    hideR18 
                      ? 'bg-emerald-950/40 border-emerald-700/50 text-emerald-400' 
                      : 'bg-amber-950/40 border-amber-700/50 text-amber-400'
                  }`}>
                    {hideR18 ? <ShieldCheck className="w-6 h-6" /> : <ShieldAlert className="w-6 h-6" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h4 className="text-sm font-bold text-white">{txt.r18Title}</h4>
                      <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
                        hideR18
                          ? 'bg-emerald-900/40 border-emerald-600/50 text-emerald-300'
                          : 'bg-amber-900/40 border-amber-600/50 text-amber-300'
                      }`}>
                        {hideR18 ? txt.r18Active : txt.r18Inactive}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                      {txt.r18Subtitle}
                    </p>
                  </div>
                </div>

                {/* Modern iOS / Netflix Style Toggle Switch */}
                <button
                  type="button"
                  onClick={() => onToggleHideR18 && onToggleHideR18(!hideR18)}
                  className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none shadow-md ${
                    hideR18 ? 'bg-emerald-500' : 'bg-zinc-700'
                  }`}
                  role="switch"
                  aria-checked={hideR18}
                  title={hideR18 ? txt.toggleOn : txt.toggleOff}
                >
                  <span
                    className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                      hideR18 ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="pt-3 border-t border-zinc-800 text-xs text-zinc-400 space-y-2.5">
                <p className="leading-relaxed">{txt.r18Desc}</p>
                {!hideR18 && (
                  <div className="flex items-center gap-2.5 p-3 rounded-xl bg-amber-950/30 border border-amber-800/40 text-amber-300 text-xs">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                    <span>{txt.r18Warning}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 0.5: GPU & Playback Performance */}
        {activeTab === 'gpu' && (
          <div className="mt-5 space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            {/* Header info with instant saved toast */}
            <div className="flex items-center justify-between pb-1">
              <span className="text-xs text-zinc-400">
                即時套用變更 (Changes apply immediately)
              </span>
              {gpuSavedNotice && (
                <span className="text-xs font-bold text-emerald-400 bg-emerald-950/40 border border-emerald-600/50 px-2.5 py-0.5 rounded-full flex items-center gap-1.5 animate-in fade-in">
                  <Check className="w-3.5 h-3.5" />
                  已儲存設定 (Saved)
                </span>
              )}
            </div>

            {/* 1. GPU Performance Profile */}
            <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-red-950/40 border border-red-700/50 text-red-400">
                  <Gauge className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">{txt.gpuTitle}</h4>
                  <p className="text-xs text-zinc-400 mt-0.5">{txt.gpuDesc}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                {[
                  { id: 'igpu', title: 'iGPU 極限省電', badge: '推薦內顯', desc: 'Intel QuickSync / AMD 內顯，0% 3D 負載', icon: Zap },
                  { id: 'standard', title: '標準硬體加速', badge: 'Direct3D 11', desc: '適合 NVIDIA / AMD 獨立顯卡', icon: Monitor },
                  { id: 'software', title: 'CPU 軟體相容', badge: '停用 GPU', desc: '純軟體渲染，相容性除錯', icon: Cpu },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleUpdateGpuOption('gpuProfile', item.id)}
                    className={`flex flex-col text-left p-3.5 rounded-xl border transition-all cursor-pointer select-none active:scale-95 ${
                      gpuProfile === item.id
                        ? 'bg-red-950/40 border-red-500 ring-2 ring-red-500/70 text-white shadow-xl shadow-red-950/50 scale-[1.01]'
                        : 'bg-zinc-800/40 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 hover:bg-zinc-800/60'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <item.icon className={`w-4 h-4 ${gpuProfile === item.id ? 'text-red-400' : 'text-zinc-500'}`} />
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold ${
                        gpuProfile === item.id ? 'bg-red-500/20 text-red-300' : 'bg-zinc-800 text-zinc-500'
                      }`}>
                        {item.badge}
                      </span>
                    </div>
                    <span className="text-xs font-bold text-white flex items-center justify-between">
                      <span>{item.title}</span>
                      {gpuProfile === item.id && <Check className="w-3.5 h-3.5 text-red-400" />}
                    </span>
                    <span className="text-[11px] text-zinc-400 mt-1 leading-snug">{item.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 2. Video Super Resolution (AI Upscaling) Toggle */}
            <div 
              onClick={() => handleUpdateGpuOption('enableUpscale', !enableUpscale)}
              className={`bg-zinc-900/90 border rounded-2xl p-4 space-y-3 cursor-pointer select-none transition-all hover:bg-zinc-800/40 ${
                enableUpscale ? 'border-amber-600/70 shadow-lg shadow-amber-950/20' : 'border-zinc-800'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-xl border mt-0.5 shrink-0 ${
                    enableUpscale
                      ? 'bg-amber-950/40 border-amber-700/50 text-amber-400'
                      : 'bg-emerald-950/40 border-emerald-700/50 text-emerald-400'
                  }`}>
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-bold text-white">{txt.upscaleTitle}</h4>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        enableUpscale
                          ? 'bg-amber-900/40 border-amber-600/50 text-amber-300'
                          : 'bg-emerald-900/40 border-emerald-600/50 text-emerald-300'
                      }`}>
                        {enableUpscale ? txt.upscaleOn : txt.upscaleOff}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                      {txt.upscaleSubtitle}
                    </p>
                  </div>
                </div>

                {/* Toggle switch */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleUpdateGpuOption('enableUpscale', !enableUpscale);
                  }}
                  className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none shadow-md ${
                    enableUpscale ? 'bg-amber-500' : 'bg-zinc-700'
                  }`}
                  role="switch"
                  aria-checked={enableUpscale}
                  title={enableUpscale ? '關閉 AI 升頻' : '開啟 AI 升頻'}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                      enableUpscale ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Tip alert */}
              <div className="bg-zinc-800/40 border border-zinc-700/60 rounded-xl p-3 text-[11px] text-zinc-400 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed">
                  若使用 Intel Iris Xe / Arc 內顯，關閉此選項可防止驅動強制執行 AI 畫質超取樣，將 Task Manager 的 3D 負載從 98% 降低至 0%~3%，並完整釋放 QuickSync 硬體解碼器。
                </span>
              </div>
            </div>

            {/* 3. Backdrop Blur Toggle */}
            <div 
              onClick={() => handleUpdateGpuOption('enableBackdropBlur', !enableBackdropBlur)}
              className={`bg-zinc-900/90 border rounded-2xl p-4 cursor-pointer select-none transition-all hover:bg-zinc-800/40 ${
                enableBackdropBlur ? 'border-sky-600/70 shadow-lg shadow-sky-950/20' : 'border-zinc-800'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-xl border mt-0.5 shrink-0 ${
                    enableBackdropBlur
                      ? 'bg-sky-950/40 border-sky-700/50 text-sky-400'
                      : 'bg-emerald-950/40 border-emerald-700/50 text-emerald-400'
                  }`}>
                    <Sliders className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-bold text-white">{txt.blurTitle}</h4>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        enableBackdropBlur
                          ? 'bg-sky-900/40 border-sky-600/50 text-sky-300'
                          : 'bg-emerald-900/40 border-emerald-600/50 text-emerald-300'
                      }`}>
                        {enableBackdropBlur ? txt.blurOn : txt.blurOff}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                      {txt.blurSubtitle}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleUpdateGpuOption('enableBackdropBlur', !enableBackdropBlur);
                  }}
                  className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none shadow-md ${
                    enableBackdropBlur ? 'bg-sky-500' : 'bg-zinc-700'
                  }`}
                  role="switch"
                  aria-checked={enableBackdropBlur}
                  title={enableBackdropBlur ? '關閉毛玻璃特效' : '開啟毛玻璃特效'}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                      enableBackdropBlur ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* 4. MPV Player Video Scaler Profile */}
            <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 space-y-3">
              <div>
                <h4 className="text-sm font-bold text-white">{txt.mpvTitle}</h4>
                <p className="text-xs text-zinc-400 mt-0.5">{txt.mpvDesc}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {[
                  { id: 'igpu', title: '⚡ iGPU 雙線性 (Bilinear)', sub: '0% 3D 著色，純 QuickSync 硬體解碼，省電不卡' },
                  { id: 'high-quality', title: '🎬 高畫質 Spline36 (進階)', sub: 'gpu-next 渲染與重取樣，適合獨立顯卡' }
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleUpdateGpuOption('mpvProfile', item.id)}
                    className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer select-none active:scale-95 ${
                      mpvProfile === item.id
                        ? 'bg-red-950/40 border-red-500 ring-2 ring-red-500/70 text-white shadow-xl shadow-red-950/50 scale-[1.01]'
                        : 'bg-zinc-800/40 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 hover:bg-zinc-800/60'
                    }`}
                  >
                    <span className="text-xs font-bold text-white flex items-center justify-between">
                      <span>{item.title}</span>
                      {mpvProfile === item.id && <Check className="w-3.5 h-3.5 text-red-400" />}
                    </span>
                    <span className="text-[11px] text-zinc-400 mt-1 block leading-snug">{item.sub}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Restart notice banner */}
            <div className="p-3 rounded-xl bg-zinc-800/60 border border-zinc-700/60 text-xs text-zinc-300 flex items-center gap-2.5">
              <RefreshCw className="w-4 h-4 text-red-400 shrink-0" />
              <span>{txt.restartNotice}</span>
            </div>
          </div>
        )}


        {/* Tab 1: Plugins & Environment */}
        {activeTab === 'plugins' && (
          <div className="mt-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-white">{txt.pluginsTitle}</h4>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {txt.pluginsSubtitle}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={fetchEnvStatus}
                  disabled={isLoadingEnv}
                  className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700 text-xs"
                  title="Refresh status"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingEnv ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={handleUpdatePlugins}
                  disabled={isUpdating}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-emerald-400 hover:text-emerald-300 border border-zinc-700 text-xs font-bold transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isUpdating ? 'animate-spin' : ''}`} />
                  <span>{txt.updateAll}</span>
                </button>
              </div>
            </div>

            {/* Docker Container Status Banner */}
            {envStatus?.isContainer && (
              <div className="bg-sky-950/40 border border-sky-600/50 rounded-2xl p-3.5 flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center font-bold text-base shrink-0">
                    🐳
                  </div>
                  <div>
                    <span className="font-bold text-sky-300 block">Docker 容器環境化運行 ({envStatus.containerType || 'Linux Alpine / Synology NAS'})</span>
                    <p className="text-[11px] text-zinc-300 mt-0.5">影音解碼組件 (ffmpeg, yt-dlp, aria2) 均已由 Docker 容器內置就緒，無需另行安裝。</p>
                  </div>
                </div>
              </div>
            )}

            {/* Plugin Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {envStatus?.tools && Object.values(envStatus.tools).map((tool) => (
                <div 
                  key={tool.name}
                  className={`p-3 rounded-xl border flex items-center justify-between ${
                    tool.installed 
                      ? 'bg-zinc-900/80 border-zinc-800' 
                      : 'bg-red-950/20 border-red-800/40'
                  }`}
                >
                  <div className="min-w-0 pr-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs text-white">{tool.name}</span>
                      {tool.critical && (
                        <span className="text-[10px] bg-zinc-800 text-zinc-400 px-1.5 py-0.2 rounded font-semibold">
                          Required
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-400 truncate mt-0.5 font-mono">
                      {tool.version || (tool.installed ? 'Installed' : 'Missing')}
                    </p>
                  </div>

                  <div>
                    {tool.installed ? (
                      <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Missing Tools Alert & 1-Click Install */}
            {envStatus && !envStatus.allInstalled && (
              <div className="bg-amber-950/30 border border-amber-600/40 rounded-xl p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                  <div>
                    <h5 className="text-xs font-bold text-amber-300">Missing Video Dependencies</h5>
                    <p className="text-[11px] text-zinc-300">
                      Install missing plugins automatically via PowerShell & Scoop in 1 click.
                    </p>
                  </div>
                </div>

                <button
                  onClick={handleInstallPlugins}
                  disabled={isInstalling}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#E50914] hover:bg-red-700 text-white rounded-lg text-xs font-bold shadow-md shrink-0"
                >
                  <DownloadCloud className="w-4 h-4" />
                  <span>Auto Install Plugins</span>
                </button>
              </div>
            )}

            {/* App Updates Section */}
            <div className="pt-3 border-t border-zinc-800 flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-white block">AniFlix Application</span>
                <span className="text-[11px] text-zinc-400">Current version: v{appUpdateInfo?.currentVersion || '2.0.0'}</span>
              </div>

              <button
                onClick={handleCheckAppUpdate}
                disabled={isCheckingApp}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white rounded-lg text-xs font-bold border border-zinc-700 transition-colors disabled:opacity-50"
              >
                <Sparkles className={`w-3.5 h-3.5 text-amber-400 ${isCheckingApp ? 'animate-spin' : ''}`} />
                <span>{isCheckingApp ? 'Connecting to GitHub...' : 'Check App Update'}</span>
              </button>
            </div>

            {appUpdateInfo && (
              <div className={`rounded-xl p-3.5 text-xs space-y-2 border ${
                appUpdateInfo.hasUpdate
                  ? 'bg-amber-950/30 border-amber-500/40'
                  : 'bg-zinc-900 border-zinc-700'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {appUpdateInfo.hasUpdate ? (
                      <span className="font-bold text-amber-400">Update Available: v{appUpdateInfo.latestVersion}</span>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <CheckCircle className="w-4 h-4 text-emerald-400" />
                        <span className="font-bold text-emerald-400">Up to date: v{appUpdateInfo.currentVersion}</span>
                      </div>
                    )}
                    {appUpdateInfo.connectedToGitHub && (
                      <span className="text-[10px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded font-mono border border-zinc-700/60">
                        GitHub Connected
                      </span>
                    )}
                  </div>

                  {appUpdateInfo.releaseUrl && (
                    <a
                      href={appUpdateInfo.releaseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 font-semibold"
                    >
                      <span>View Release</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>

                <p className="text-zinc-300 text-[11px] whitespace-pre-wrap">{appUpdateInfo.releaseNotes}</p>
                
                {appUpdateInfo.checkedAt && (
                  <p className="text-[10px] text-zinc-500 font-mono">
                    Checked at {new Date(appUpdateInfo.checkedAt).toLocaleTimeString()}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Downloader Settings */}
        {activeTab === 'downloads' && (
          <form onSubmit={handleSaveDownloads} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">
                {txt.saveDir}
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={downloadDir}
                  onChange={(e) => setDownloadDir(e.target.value)}
                  placeholder="C:\Users\...\Downloads\Anime 或 /downloads"
                  className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-3.5 py-2.5 text-xs font-mono text-white focus:outline-none focus:border-[#E50914] shadow-inner"
                />
                <button
                  type="button"
                  onClick={() => onOpenFolder && onOpenFolder(downloadDir)}
                  className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-xs font-semibold text-zinc-200 border border-zinc-700 flex items-center justify-center gap-2 shrink-0 transition-colors"
                  title={txt.openFolder}
                >
                  <Folder className="w-4 h-4 text-amber-400" />
                  <span>{txt.openFolder}</span>
                </button>
              </div>

              {/* In-App Mobile & Web Download File Manager Helper */}
              <div className="mt-3.5 p-3.5 bg-zinc-900/60 border border-zinc-800 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
                <div className="text-zinc-400">
                  <span className="text-zinc-200 font-bold block mb-0.5">行動裝置 / 網頁下載檔案管理</span>
                  <span className="text-[11px] text-zinc-400">在 iOS / Android 或 Docker 網頁環境免接傳輸線，直接瀏覽、串流播放或保存已下載檔案。</span>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenDownloadedFiles && onOpenDownloadedFiles()}
                  className="px-3.5 py-2 bg-[#E50914]/20 hover:bg-[#E50914] text-[#E50914] hover:text-white border border-red-500/40 rounded-xl text-xs font-bold transition-all shrink-0 flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <Folder className="w-3.5 h-3.5" />
                  <span>瀏覽已下載影片</span>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-zinc-800">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-bold text-zinc-400 hover:text-white"
              >
                {txt.close}
              </button>
              <button
                type="submit"
                className="flex items-center gap-1.5 bg-[#E50914] hover:bg-[#B81D24] text-white font-bold px-5 py-2 rounded-lg text-xs shadow-md transition-transform hover:scale-105"
              >
                {saved ? <Check className="w-4 h-4" /> : null}
                <span>{saved ? txt.saved : txt.saveBtn}</span>
              </button>
            </div>
          </form>
        )}

        {/* Tab 3: Data Backup & Export */}
        {activeTab === 'backup' && (
          <div className="mt-5 space-y-4">
            <div>
              <h4 className="text-sm font-bold text-white">{txt.backupTitle}</h4>
              <p className="text-xs text-zinc-400 mt-0.5">
                {txt.backupSubtitle}
              </p>
            </div>

            {backupStatus && (
              <div className={`p-3 rounded-xl border text-xs flex items-center gap-2.5 ${
                backupStatus.type === 'success'
                  ? 'bg-emerald-950/40 border-emerald-700/50 text-emerald-300'
                  : 'bg-red-950/40 border-red-700/50 text-red-300'
              }`}>
                {backupStatus.type === 'success' ? (
                  <CheckCircle className="w-4 h-4 shrink-0 text-emerald-400" />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
                )}
                <span className="flex-1">{backupStatus.message}</span>
              </div>
            )}

            {/* Export Section */}
            <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 space-y-3">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                <DownloadCloud className="w-4 h-4 text-[#E50914]" />
                Export Data / 匯出資料
              </span>
              <p className="text-[11px] text-zinc-400">
                將您的最愛收藏、觀看紀錄、播放進度與設定打包備份為不同格式檔案。
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => handleExport('json')}
                  className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-zinc-800/90 hover:bg-zinc-700 text-xs font-bold text-white border border-zinc-700 transition-all hover:scale-[1.02]"
                >
                  <FileCode className="w-4 h-4 text-emerald-400" />
                  <span>{txt.exportJson}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExport('xml')}
                  className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-zinc-800/90 hover:bg-zinc-700 text-xs font-bold text-white border border-zinc-700 transition-all hover:scale-[1.02]"
                >
                  <FileText className="w-4 h-4 text-amber-400" />
                  <span>{txt.exportXml}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExport('csv')}
                  className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-zinc-800/90 hover:bg-zinc-700 text-xs font-bold text-white border border-zinc-700 transition-all hover:scale-[1.02]"
                >
                  <Database className="w-4 h-4 text-sky-400" />
                  <span>{txt.exportCsv}</span>
                </button>
              </div>
            </div>

            {/* Import / Restore Section */}
            <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 space-y-3">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                <UploadCloud className="w-4 h-4 text-indigo-400" />
                Import / Restore Backup / 還原備份
              </span>
              <p className="text-[11px] text-zinc-400">
                支援匯入本站導出的 JSON 或 XML 格式備份檔，自動還原或合併個人收藏與觀看紀錄。
              </p>
              <input 
                type="file" 
                ref={fileImportRef} 
                onChange={handleFileImport} 
                accept=".json,.xml" 
                className="hidden" 
              />
              <button
                type="button"
                onClick={() => fileImportRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white shadow-lg transition-all hover:scale-[1.01]"
              >
                <UploadCloud className="w-4 h-4" />
                <span>{txt.importBackup}</span>
              </button>
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Terminal Live Output Modal */}
      {showLogModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
          <div className="bg-[#141414] border border-zinc-700 rounded-2xl w-full max-w-xl p-5 shadow-2xl flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800 mb-3">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                  PowerShell Environment Console
                </h4>
              </div>
              <button
                onClick={() => setShowLogModal(false)}
                className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <pre className="flex-1 bg-black/80 rounded-xl p-3.5 text-[11px] font-mono text-zinc-300 overflow-y-auto custom-scrollbar whitespace-pre-wrap leading-relaxed border border-zinc-800">
              {terminalLogs}
              <div ref={logBottomRef} />
            </pre>

            <div className="pt-3 flex items-center justify-end">
              <button
                onClick={() => setShowLogModal(false)}
                className="px-4 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold"
              >
                Close Console
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
