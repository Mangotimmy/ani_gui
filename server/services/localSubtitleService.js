// server/services/localSubtitleService.js - Local Subtitle Discovery & ASS/SRT/VTT Conversion
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Converts ASS/SSA subtitle content to standard WebVTT
 */
export function assToVtt(assContent) {
  const lines = assContent.split(/\r?\n/);
  const cues = [];
  let inEvents = false;
  let formatKeys = ['Start', 'End', 'Text'];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[Events]')) {
      inEvents = true;
      continue;
    }
    if (inEvents && trimmed.startsWith('Format:')) {
      formatKeys = trimmed.replace(/^Format:\s*/, '').split(',').map(k => k.trim());
      continue;
    }
    if (inEvents && (trimmed.startsWith('Dialogue:') || trimmed.startsWith('Comment:'))) {
      if (trimmed.startsWith('Comment:')) continue;
      const rawValues = trimmed.replace(/^Dialogue:\s*/, '');
      const commaLimit = formatKeys.length - 1;
      let parts = [];
      let cur = '';
      for (let i = 0; i < rawValues.length; i++) {
        if (rawValues[i] === ',' && parts.length < commaLimit) {
          parts.push(cur.trim());
          cur = '';
        } else {
          cur += rawValues[i];
        }
      }
      parts.push(cur.trim());

      const startIdx = formatKeys.indexOf('Start');
      const endIdx = formatKeys.indexOf('End');
      const textIdx = formatKeys.indexOf('Text') !== -1 ? formatKeys.indexOf('Text') : parts.length - 1;

      if (startIdx !== -1 && endIdx !== -1 && parts[startIdx] && parts[endIdx]) {
        const toVttTime = (t) => {
          const p = t.split(':');
          if (p.length === 3) {
            const h = p[0].padStart(2, '0');
            const m = p[1].padStart(2, '0');
            const secParts = p[2].split('.');
            const s = secParts[0].padStart(2, '0');
            const ms = (secParts[1] || '0').padEnd(3, '0').slice(0, 3);
            return `${h}:${m}:${s}.${ms}`;
          }
          return t;
        };

        const cleanText = (parts[textIdx] || '')
          .replace(/\{[^\}]*\}/g, '') // remove ASS style tags {\...}
          .replace(/\\N/gi, '\n')     // line breaks
          .replace(/\\n/gi, '\n')
          .replace(/\\h/gi, ' ')
          .trim();

        if (cleanText) {
          cues.push(`${toVttTime(parts[startIdx])} --> ${toVttTime(parts[endIdx])}\n${cleanText}`);
        }
      }
    }
  }

  return 'WEBVTT\n\n' + cues.map((c, i) => `${i + 1}\n${c}`).join('\n\n');
}

/**
 * Converts SRT subtitle content to WebVTT
 */
export function srtToVtt(srtContent) {
  return 'WEBVTT\n\n' + srtContent
    .replace(/\r\n|\r/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
}

/**
 * Scans directories for subtitle files matching the anime title and episode
 */
export async function findLocalSubtitles({ animeTitle = '', episode = 1, baseDir = '' }) {
  const epNum = parseInt(episode, 10);
  const epPad = String(epNum).padStart(2, '0');
  const epRegex = new RegExp(`(^|\\D)(0*${epNum}|e0*${epNum}|ep0*${epNum}|e${epPad}|ep${epPad})(\\D|$)`, 'i');

  const supportedExts = new Set(['.vtt', '.srt', '.ass', '.ssa']);
  const matchedFiles = [];
  const visitedPaths = new Set();

  const searchDirs = [];
  if (baseDir && fs.existsSync(baseDir)) searchDirs.push({ dir: baseDir, maxDepth: 3 });
  
  const defaultAnimeDir = path.join(os.homedir(), 'Downloads', 'Anime');
  if (fs.existsSync(defaultAnimeDir) && defaultAnimeDir !== baseDir) {
    searchDirs.push({ dir: defaultAnimeDir, maxDepth: 3 });
  }

  const downloadsDir = path.join(os.homedir(), 'Downloads');
  if (fs.existsSync(downloadsDir) && downloadsDir !== baseDir && downloadsDir !== defaultAnimeDir) {
    searchDirs.push({ dir: downloadsDir, maxDepth: 2 });
  }

  // Keywords to prioritize matching anime title
  const cleanTitleWords = animeTitle
    ? animeTitle.toLowerCase().replace(/[:!?,._-]/g, ' ').split(/\s+/).filter(w => w.length >= 2)
    : [];

  for (const { dir, maxDepth } of searchDirs) {
    function scanDir(currentDir, depth = 0) {
      if (depth > maxDepth) return;
      try {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const ent of entries) {
          const fullPath = path.join(currentDir, ent.name);
          if (visitedPaths.has(fullPath)) continue;
          visitedPaths.add(fullPath);

          if (ent.isDirectory()) {
            scanDir(fullPath, depth + 1);
          } else if (ent.isFile()) {
            const ext = path.extname(ent.name).toLowerCase();
            if (supportedExts.has(ext)) {
              const nameLower = ent.name.toLowerCase();
              const fullLower = fullPath.toLowerCase();

              // Check if episode matches
              if (epRegex.test(nameLower)) {
                // Calculate match score
                let score = 0;
                for (const word of cleanTitleWords) {
                  if (nameLower.includes(word)) score += 10;
                  else if (fullLower.includes(word)) score += 5;
                }

                const isTw = /(繁|繁體|繁体|cht|tc|tw|hk)/i.test(nameLower) && !/\bdutch\b/i.test(nameLower);
                const isCn = /(简|簡|简体|簡體|chs|sc|cn)/i.test(nameLower);
                if (isTw) score += 20;
                else if (isCn) score += 15;

                matchedFiles.push({
                  fullPath,
                  filename: ent.name,
                  ext,
                  score,
                  isTw,
                  isCn
                });
              }
            }
          }
        }
      } catch {}
    }

    scanDir(dir);
  }

  // Sort by score descending
  matchedFiles.sort((a, b) => b.score - a.score);

  return matchedFiles.map(f => {
    let tag = `[本地字幕] ${f.filename}`;
    if (f.isTw) tag = `[本地繁中] ${f.filename}`;
    else if (f.isCn) tag = `[本地簡中] ${f.filename}`;

    return {
      lang: tag,
      filename: f.filename,
      fullPath: f.fullPath,
      url: `/api/subtitles/local/file?path=${encodeURIComponent(f.fullPath)}`,
      default: f.isTw || f.isCn
    };
  });
}

