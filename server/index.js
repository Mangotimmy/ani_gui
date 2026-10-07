// server/index.js - AniFlix Express backend server
import express from 'express';
import cors from 'cors';
import { 
  getTrending, 
  getPopular, 
  getTopRated, 
  getUpcoming,
  getByGenre, 
  searchAnime, 
  getAnimeDetails,
  getRecommendationsForAnime,
  getCatalog,
  getCurrentSeasonInfo,
  getAnimeMediaVideos,
  searchTorrents,
  getAnimeChineseInfo
} from './services/metadata.js';
import { resolveStream, getAvailableEpisodes } from './services/streamResolver.js';
import { launchMpv, openFolder, openMagnetLink } from './services/playerLauncher.js';
import { downloadManager } from './services/downloader.js';
import { handleProxyStream } from './services/proxy.js';
import { handleSubtitleTranslate } from './services/subtitleTranslator.js';
import { 
  getEnvironmentStatus, 
  installAllPlugins, 
  updateAllPlugins, 
  checkAppUpdate 
} from './services/environment.js';
import { computeRecommendations } from './services/recommendation.js';
import { findLocalSubtitles, assToVtt, srtToVtt } from './services/localSubtitleService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Always store settings in a writable user directory (survives Electron packaged asar)
const USER_DATA_DIR = process.env.ANIFLIX_USER_DATA || 
  (process.env.APPDATA ? path.join(process.env.APPDATA, 'aniflix') : 
   (process.env.HOME ? path.join(process.env.HOME, '.aniflix') : 
    path.join(__dirname, 'data')));

const SETTINGS_FILE = path.join(USER_DATA_DIR, 'settings.json');

const DEFAULT_SETTINGS = {
  gpuProfile: 'igpu',          // 'igpu' | 'standard' | 'software'
  enableUpscale: false,        // false = disable AI upscaling (prevents 98% 3D load on iGPU)
  enableBackdropBlur: false,   // false = low-power UI background without GPU blur
  mpvProfile: 'igpu'           // 'igpu' | 'high-quality'
};

let inMemorySettings = { ...DEFAULT_SETTINGS };

function getAppSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      inMemorySettings = {
        ...DEFAULT_SETTINGS,
        ...inMemorySettings,
        ...parsed,
        downloadDir: downloadManager.downloadDir,
        maxConcurrent: downloadManager.maxConcurrent
      };
      return inMemorySettings;
    }
  } catch (err) {
    console.warn('Failed to read settings.json:', err.message);
  }
  return {
    ...DEFAULT_SETTINGS,
    ...inMemorySettings,
    downloadDir: downloadManager.downloadDir,
    maxConcurrent: downloadManager.maxConcurrent
  };
}

function saveAppSettings(newSettings) {
  inMemorySettings = { ...getAppSettings(), ...newSettings };
  try {
    const dataDir = path.dirname(SETTINGS_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(inMemorySettings, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Failed to save settings.json to disk (falling back to memory):', err.message);
  }
  return inMemorySettings;
}

// Ensure saved downloadDir is loaded into downloadManager upon startup
try {
  const initialSettings = getAppSettings();
  if (initialSettings.downloadDir) {
    downloadManager.setDownloadDir(initialSettings.downloadDir);
  }
} catch {}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// --- Metadata Routes ---

app.get('/api/trending', async (req, res) => {
  try {
    const list = await getTrending();
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/popular', async (req, res) => {
  try {
    const list = await getPopular();
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/top-rated', async (req, res) => {
  try {
    const list = await getTopRated();
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/upcoming', async (req, res) => {
  try {
    const list = await getUpcoming();
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Seasonal & Year Catalog Routes
app.get('/api/catalog', async (req, res) => {
  try {
    const { year, season, sort, page = 1, perPage = 24, isAdult } = req.query;
    const catalogData = await getCatalog({
      year: year || new Date().getFullYear(),
      season: season || null,
      sort: sort || 'POPULARITY_DESC',
      page: parseInt(page),
      perPage: parseInt(perPage),
      isAdult: isAdult === 'true' ? true : isAdult === 'false' ? false : (isAdult === 'all' ? 'all' : false)
    });
    res.json({ success: true, ...catalogData });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, media: [] });
  }
});

app.get('/api/catalog/current-season', (req, res) => {
  try {
    const info = getCurrentSeasonInfo();
    res.json({ success: true, ...info });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/genre/:genre', async (req, res) => {
  try {
    const list = await getByGenre(req.params.genre);
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    if (!q.trim()) {
      return res.json({ success: true, data: [] });
    }
    const results = await searchAnime(q);
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// BitTorrent / Magnet Search (DMHY + Nyaa) - Must be registered BEFORE /api/anime/:id
app.get('/api/torrents', async (req, res) => {
  try {
    const { q = '', lang = 'all', hideR18 } = req.query;
    const results = await searchTorrents(q, lang, hideR18 !== 'false');
    res.json(results);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, count: 0, items: [] });
  }
});

// Alias for backwards compatibility
app.get('/api/anime/torrents', async (req, res) => {
  try {
    const { q = '', lang = 'all', hideR18 } = req.query;
    const results = await searchTorrents(q, lang, hideR18 !== 'false');
    res.json(results);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, count: 0, items: [] });
  }
});

app.get('/api/anime/:id', async (req, res) => {
  try {
    const anime = await getAnimeDetails(req.params.id);
    if (!anime) return res.status(404).json({ success: false, error: 'Anime not found' });
    res.json({ success: true, data: anime });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Released episodes live sync with multi-candidate query and aired cap
app.get('/api/anime/:titleOrId/episodes', async (req, res) => {
  try {
    const title = decodeURIComponent(req.params.titleOrId);
    const forceRefresh = req.query.refresh === 'true';
    let candidates = [];
    if (req.query.candidates) {
      try {
        const parsed = JSON.parse(req.query.candidates);
        if (Array.isArray(parsed)) candidates = parsed;
        else candidates = [String(parsed)];
      } catch {
        candidates = req.query.candidates.split(/\|\||\|/);
      }
    }
    const maxAiredCap = req.query.maxAiredCap ? parseInt(req.query.maxAiredCap, 10) : null;
    const queryList = [title, ...candidates].filter(Boolean);
    const epData = await getAvailableEpisodes(queryList, forceRefresh, maxAiredCap);
    res.json(epData);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, uploadedEpisodes: [] });
  }
});

// Media Videos (PV Trailers, OP & ED Themes)
app.get('/api/anime/:id/media-videos', async (req, res) => {
  try {
    const { romaji = '', english = '' } = req.query;
    const mediaVideos = await getAnimeMediaVideos(req.params.id, romaji, english);
    res.json({ success: true, ...mediaVideos });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, trailers: [], themes: { op: [], ed: [] } });
  }
});

// Chinese Metadata & Summary
app.get('/api/anime/:id/chinese-info', async (req, res) => {
  try {
    const { romaji = '', native = '', english = '', description = '', lang = 'zh-TW' } = req.query;
    const info = await getAnimeChineseInfo(req.params.id, { romaji, native, english, description }, lang);
    res.json({ success: true, ...info });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Open Magnet Link in Default Client
app.post('/api/torrents/open', (req, res) => {
  const { magnetUrl } = req.body;
  if (!magnetUrl) {
    return res.status(400).json({ success: false, error: 'Magnet URL is required' });
  }
  const result = openMagnetLink(magnetUrl);
  res.json(result);
});

// Personalized recommendations
app.post('/api/recommendations', async (req, res) => {
  try {
    const { favoriteIds = [], favorites = [], watchHistory = [], limit = 18 } = req.body;
    const recommendations = await computeRecommendations({ favoriteIds, favorites, watchHistory, limit });
    res.json({ success: true, data: recommendations });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, data: [] });
  }
});

// --- Stream & Player Routes ---

app.get('/api/proxy', handleProxyStream);
app.get('/api/subtitles/translate', handleSubtitleTranslate);

// Auto-discover matching local subtitle files (.vtt, .srt, .ass, .ssa)
app.get('/api/subtitles/local', async (req, res) => {
  try {
    const { animeTitle = '', episode = 1 } = req.query;
    const baseDir = downloadManager.downloadDir;
    const subs = await findLocalSubtitles({ animeTitle, episode, baseDir });
    res.json({ success: true, subtitles: subs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, subtitles: [] });
  }
});

// Stream local subtitle file converted to WebVTT on the fly
app.get('/api/subtitles/local/file', (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).send('Subtitle file not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const raw = fs.readFileSync(filePath, 'utf-8');
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');

    if (ext === '.ass' || ext === '.ssa') {
      res.send(assToVtt(raw));
    } else if (ext === '.srt') {
      res.send(srtToVtt(raw));
    } else {
      res.send(raw);
    }
  } catch (err) {
    res.status(500).send(`Error reading subtitle: ${err.message}`);
  }
});

app.post('/api/stream', async (req, res) => {
  try {
    const { animeTitle, candidates, episode = 1, mode = 'sub', quality = 'best', maxAiredCap } = req.body;
    const streamData = await resolveStream({ animeTitle, candidates, episode, mode, quality, maxAiredCap });
    res.json({ success: true, data: streamData });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/play/mpv', (req, res) => {
  const { streamUrl, title, subtitleUrl, referer, profile, enableUpscale } = req.body;
  if (!streamUrl) {
    return res.status(400).json({ success: false, error: 'streamUrl is required' });
  }

  const appSettings = getAppSettings();
  const effectiveProfile = profile || appSettings.mpvProfile || 'igpu';
  const effectiveUpscale = enableUpscale !== undefined ? enableUpscale : (appSettings.enableUpscale || false);

  const result = launchMpv({
    streamUrl,
    title,
    subtitleUrl,
    referer,
    profile: effectiveProfile,
    enableUpscale: effectiveUpscale
  });
  res.json(result);
});

// --- Downloader Routes ---

app.get('/api/downloads/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  downloadManager.addSubscriber(res);
});

app.get('/api/downloads', (req, res) => {
  res.json({
    success: true,
    tasks: downloadManager.getAllTasks(),
    downloadDir: downloadManager.downloadDir
  });
});

app.post('/api/downloads/queue', (req, res) => {
  const { animeTitle, episodeNumbers, quality, audio, streamUrls } = req.body;
  if (!animeTitle || !Array.isArray(episodeNumbers) || episodeNumbers.length === 0) {
    return res.status(400).json({ success: false, error: 'animeTitle and episodeNumbers array are required' });
  }

  const tasks = downloadManager.queueDownloads({
    animeTitle,
    episodeNumbers,
    quality: quality || 'best',
    audio: audio || 'sub',
    streamUrls: streamUrls || {}
  });

  res.json({ success: true, queuedCount: tasks.length, tasks });
});

app.post('/api/downloads/cancel', (req, res) => {
  const { id } = req.body;
  const success = downloadManager.cancelTask(id);
  res.json({ success });
});

app.post('/api/downloads/clear', (req, res) => {
  downloadManager.clearCompleted();
  res.json({ success: true });
});

app.post('/api/downloads/open-folder', (req, res) => {
  const { folderPath } = req.body || {};
  const target = folderPath || downloadManager.downloadDir;
  const result = openFolder(target);
  res.json(result);
});

app.get('/api/settings', (req, res) => {
  res.json({
    success: true,
    ...getAppSettings()
  });
});

app.post('/api/settings', (req, res) => {
  const { downloadDir, gpuProfile, enableUpscale, enableBackdropBlur, mpvProfile } = req.body;
  if (downloadDir) {
    downloadManager.setDownloadDir(downloadDir);
  }
  const updated = saveAppSettings({
    ...(downloadDir ? { downloadDir } : {}),
    ...(gpuProfile !== undefined ? { gpuProfile } : {}),
    ...(enableUpscale !== undefined ? { enableUpscale } : {}),
    ...(enableBackdropBlur !== undefined ? { enableBackdropBlur } : {}),
    ...(mpvProfile !== undefined ? { mpvProfile } : {})
  });
  res.json({ success: true, ...updated });
});

// --- Environment & Plugins Routes ---

app.get('/api/environment/status', (req, res) => {
  try {
    const status = getEnvironmentStatus();
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// SSE endpoint for running installAllPlugins with live streaming terminal logs
app.get('/api/environment/install/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendLog = (text) => {
    res.write(`data: ${JSON.stringify({ text })}\n\n`);
  };

  try {
    const result = await installAllPlugins(sendLog);
    res.write(`data: ${JSON.stringify({ done: true, success: result.success })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ done: true, error: err.message })}\n\n`);
  }
  res.end();
});

// SSE endpoint for updating plugins with live streaming terminal logs
app.get('/api/environment/update/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendLog = (text) => {
    res.write(`data: ${JSON.stringify({ text })}\n\n`);
  };

  try {
    const result = await updateAllPlugins(sendLog);
    res.write(`data: ${JSON.stringify({ done: true, success: result.success })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ done: true, error: err.message })}\n\n`);
  }
  res.end();
});

app.get('/api/app/check-update', async (req, res) => {
  try {
    const updateInfo = await checkAppUpdate();
    res.json({ success: true, ...updateInfo });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const distPath = path.join(__dirname, '..', 'dist');

// Serve static build if dist exists
app.use(express.static(distPath));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(distPath, 'index.html'));
});

// Start Express server
app.listen(PORT, () => {
  console.log(`🎬 AniFlix server running on http://localhost:${PORT}`);
});

