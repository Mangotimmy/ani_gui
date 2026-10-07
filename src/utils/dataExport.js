// src/utils/dataExport.js - Comprehensive User Data Backup, Export & Import Utility
// Supports JSON, XML, and CSV formats for AniFlix user data (Favorites, Watch History, Settings, Progress)

/**
 * Collects all current user data from browser localStorage
 */
export function collectUserData() {
  const data = {
    version: '2.0.0',
    exportedAt: new Date().toISOString(),
    settings: {
      lang: localStorage.getItem('aniflix_lang') || 'zh-TW',
      hideR18: localStorage.getItem('aniflix_hide_r18') === 'true',
    },
    favorites: [],
    watchHistory: [],
    playbackProgress: {}
  };

  try {
    const rawFavs = localStorage.getItem('aniflix_favorites');
    if (rawFavs) data.favorites = JSON.parse(rawFavs);
  } catch (e) {}

  try {
    const rawHistory = localStorage.getItem('aniflix_watch_history');
    if (rawHistory) data.watchHistory = JSON.parse(rawHistory);
  } catch (e) {}

  // Collect progress keys
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('aniflix_progress_')) {
      data.playbackProgress[key] = localStorage.getItem(key);
    }
  }

  return data;
}

/**
 * Escapes characters for XML safely
 */
function escapeXml(unsafe = '') {
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Converts user data object to XML format
 */
export function exportToXml(data = collectUserData()) {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<AniFlixBackup version="${data.version}" exportedAt="${data.exportedAt}">\n`;

  // Settings
  xml += `  <Settings>\n`;
  xml += `    <Language>${escapeXml(data.settings.lang)}</Language>\n`;
  xml += `    <HideR18>${data.settings.hideR18}</HideR18>\n`;
  xml += `  </Settings>\n`;

  // Favorites
  xml += `  <Favorites count="${data.favorites.length}">\n`;
  for (const item of data.favorites) {
    xml += `    <Anime id="${item.id}">\n`;
    xml += `      <TitleEnglish>${escapeXml(item.title?.english || '')}</TitleEnglish>\n`;
    xml += `      <TitleRomaji>${escapeXml(item.title?.romaji || '')}</TitleRomaji>\n`;
    xml += `      <TitleNative>${escapeXml(item.title?.native || '')}</TitleNative>\n`;
    xml += `      <TitleZhTW>${escapeXml(item.titleZhTW || item.titleZh || '')}</TitleZhTW>\n`;
    xml += `      <TitleZhCN>${escapeXml(item.titleZhCN || '')}</TitleZhCN>\n`;
    xml += `      <CoverImage>${escapeXml(item.coverImage?.large || item.coverImage?.extraLarge || '')}</CoverImage>\n`;
    xml += `      <Episodes>${item.episodes || 0}</Episodes>\n`;
    xml += `      <Format>${escapeXml(item.format || '')}</Format>\n`;
    xml += `      <AverageScore>${item.averageScore || 0}</AverageScore>\n`;
    xml += `    </Anime>\n`;
  }
  xml += `  </Favorites>\n`;

  // Watch History
  xml += `  <WatchHistory count="${data.watchHistory.length}">\n`;
  for (const item of data.watchHistory) {
    const a = item.anime || {};
    xml += `    <HistoryEntry timestamp="${item.timestamp || 0}" episode="${item.episode || 1}">\n`;
    xml += `      <AnimeId>${a.id || ''}</AnimeId>\n`;
    xml += `      <TitleEnglish>${escapeXml(a.title?.english || '')}</TitleEnglish>\n`;
    xml += `      <TitleRomaji>${escapeXml(a.title?.romaji || '')}</TitleRomaji>\n`;
    xml += `      <TitleZhTW>${escapeXml(a.titleZhTW || a.titleZh || '')}</TitleZhTW>\n`;
    xml += `      <LastWatched>${new Date(item.timestamp || Date.now()).toISOString()}</LastWatched>\n`;
    xml += `    </HistoryEntry>\n`;
  }
  xml += `  </WatchHistory>\n`;

  // Playback Progress
  xml += `  <PlaybackProgress>\n`;
  for (const [key, val] of Object.entries(data.playbackProgress)) {
    xml += `    <Item key="${escapeXml(key)}">${escapeXml(val)}</Item>\n`;
  }
  xml += `  </PlaybackProgress>\n`;

  xml += `</AniFlixBackup>\n`;
  return xml;
}

/**
 * Converts favorites and watch history to CSV format
 */
export function exportToCsv(data = collectUserData()) {
  const escapeCsv = (str = '') => `"${String(str).replace(/"/g, '""')}"`;

  let csv = 'TYPE,ANIME_ID,TITLE_ZH,TITLE_EN,TITLE_ROMAJI,EPISODE,TIMESTAMP_ISO,COVER_IMAGE\n';

  for (const item of data.favorites) {
    csv += [
      'FAVORITE',
      item.id || '',
      escapeCsv(item.titleZhTW || item.titleZh || ''),
      escapeCsv(item.title?.english || ''),
      escapeCsv(item.title?.romaji || ''),
      item.episodes || '',
      '',
      escapeCsv(item.coverImage?.large || item.coverImage?.extraLarge || '')
    ].join(',') + '\n';
  }

  for (const item of data.watchHistory) {
    const a = item.anime || {};
    csv += [
      'HISTORY',
      a.id || '',
      escapeCsv(a.titleZhTW || a.titleZh || ''),
      escapeCsv(a.title?.english || ''),
      escapeCsv(a.title?.romaji || ''),
      item.episode || 1,
      item.timestamp ? new Date(item.timestamp).toISOString() : '',
      escapeCsv(a.coverImage?.large || a.coverImage?.extraLarge || '')
    ].join(',') + '\n';
  }

  return csv;
}

/**
 * Triggers a file download in the browser
 */
export function downloadBackupFile(content, fileName, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Restores user data from parsed JSON backup
 */
export function restoreFromJson(jsonObj) {
  if (!jsonObj) return false;

  if (Array.isArray(jsonObj.favorites)) {
    localStorage.setItem('aniflix_favorites', JSON.stringify(jsonObj.favorites));
  }
  if (Array.isArray(jsonObj.watchHistory)) {
    localStorage.setItem('aniflix_watch_history', JSON.stringify(jsonObj.watchHistory));
  }
  if (jsonObj.settings) {
    if (jsonObj.settings.lang) localStorage.setItem('aniflix_lang', jsonObj.settings.lang);
    if (typeof jsonObj.settings.hideR18 === 'boolean') {
      localStorage.setItem('aniflix_hide_r18', String(jsonObj.settings.hideR18));
    }
  }
  if (jsonObj.playbackProgress && typeof jsonObj.playbackProgress === 'object') {
    for (const [k, v] of Object.entries(jsonObj.playbackProgress)) {
      if (k.startsWith('aniflix_progress_') && v) {
        localStorage.setItem(k, String(v));
      }
    }
  }

  return true;
}

/**
 * Restores user data from XML string
 */
export function restoreFromXml(xmlStr) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlStr, 'text/xml');

    const parserError = doc.querySelector('parsererror');
    if (parserError) throw new Error('Invalid XML markup');

    // Parse Settings
    const lang = doc.querySelector('Settings > Language')?.textContent;
    const hideR18 = doc.querySelector('Settings > HideR18')?.textContent;
    if (lang) localStorage.setItem('aniflix_lang', lang);
    if (hideR18) localStorage.setItem('aniflix_hide_r18', hideR18);

    // Parse Favorites
    const animeNodes = doc.querySelectorAll('Favorites > Anime');
    const favorites = [];
    animeNodes.forEach(node => {
      const id = parseInt(node.getAttribute('id') || '0', 10);
      if (id) {
        favorites.push({
          id,
          title: {
            english: node.querySelector('TitleEnglish')?.textContent || '',
            romaji: node.querySelector('TitleRomaji')?.textContent || '',
            native: node.querySelector('TitleNative')?.textContent || ''
          },
          titleZhTW: node.querySelector('TitleZhTW')?.textContent || '',
          titleZhCN: node.querySelector('TitleZhCN')?.textContent || '',
          coverImage: {
            large: node.querySelector('CoverImage')?.textContent || '',
            extraLarge: node.querySelector('CoverImage')?.textContent || ''
          },
          episodes: parseInt(node.querySelector('Episodes')?.textContent || '0', 10),
          format: node.querySelector('Format')?.textContent || 'TV',
          averageScore: parseInt(node.querySelector('AverageScore')?.textContent || '0', 10)
        });
      }
    });
    if (favorites.length > 0) {
      localStorage.setItem('aniflix_favorites', JSON.stringify(favorites));
    }

    // Parse History
    const historyNodes = doc.querySelectorAll('WatchHistory > HistoryEntry');
    const history = [];
    historyNodes.forEach(node => {
      const ep = parseInt(node.getAttribute('episode') || '1', 10);
      const timestamp = parseInt(node.getAttribute('timestamp') || '0', 10);
      const animeId = parseInt(node.querySelector('AnimeId')?.textContent || '0', 10);
      if (animeId) {
        history.push({
          episode: ep,
          timestamp: timestamp || Date.now(),
          anime: {
            id: animeId,
            title: {
              english: node.querySelector('TitleEnglish')?.textContent || '',
              romaji: node.querySelector('TitleRomaji')?.textContent || ''
            },
            titleZhTW: node.querySelector('TitleZhTW')?.textContent || ''
          }
        });
      }
    });
    if (history.length > 0) {
      localStorage.setItem('aniflix_watch_history', JSON.stringify(history));
    }

    return true;
  } catch (err) {
    console.error('XML restore failed:', err);
    return false;
  }
}
