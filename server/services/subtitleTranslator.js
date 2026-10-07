// server/services/subtitleTranslator.js - Real-time WebVTT Subtitle Translation & Caching Service
import * as OpenCC from 'opencc-js';

const s2tw = OpenCC.Converter ? OpenCC.Converter({ from: 'cn', to: 'tw' }) : (s => s);
const s2cn = OpenCC.Converter ? OpenCC.Converter({ from: 'tw', to: 'cn' }) : (s => s);

// In-memory cache for translated WebVTT subtitles (URL + targetLang -> VTT text)
const vttCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Translates a batch of cue texts using free translation APIs with OpenCC polish
 */
async function translateBatch(cuesBatch, targetLang = 'zh-TW') {
  if (!cuesBatch || cuesBatch.length === 0) return cuesBatch;

  const payloadLines = cuesBatch.map((cue, idx) => `[${idx}] ${cue.text.replace(/[\r\n]+/g, ' ').trim()}`);
  const joinedText = payloadLines.join('\n');

  const gLang = targetLang === 'zh-CN' ? 'zh-CN' : targetLang === 'ja' ? 'ja' : 'zh-TW';

  // 1. Try Google Translate client API
  try {
    const gUrl = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${gLang}&q=${encodeURIComponent(joinedText)}`;
    const res = await fetch(gUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(6000)
    });

    if (res.ok) {
      const data = await res.json();
      const rawTranslated = data?.[0]?.[0];
      if (rawTranslated && typeof rawTranslated === 'string') {
        let polished = rawTranslated;
        if (targetLang === 'zh-TW') polished = s2tw(rawTranslated);
        else if (targetLang === 'zh-CN') polished = s2cn(rawTranslated);

        const translatedMap = new Map();
        const lines = polished.split(/\r?\n/);
        for (const l of lines) {
          const match = l.match(/^\s*\[(\d+)\]\s*(.*)$/);
          if (match) {
            const idx = parseInt(match[1]);
            translatedMap.set(idx, match[2].trim());
          }
        }

        return cuesBatch.map((cue, idx) => ({
          ...cue,
          text: translatedMap.get(idx) || cue.text
        }));
      }
    }
  } catch (err) {
    // fallback to MyMemory
  }

  // 2. Fallback to MyMemory API
  try {
    const langpair = targetLang === 'zh-CN' ? 'en|zh-CN' : targetLang === 'ja' ? 'en|ja' : 'en|zh-TW';
    const mmUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(joinedText)}&langpair=${langpair}`;
    
    const res = await fetch(mmUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AniFlix/1.0'
      },
      signal: AbortSignal.timeout(5000)
    });

    if (res.ok) {
      const data = await res.json();
      const rawTranslated = data?.responseData?.translatedText;
      if (rawTranslated && !rawTranslated.includes('ALL AVAILABLE FREE TRANSLATIONS')) {
        let polished = rawTranslated;
        if (targetLang === 'zh-TW') polished = s2tw(rawTranslated);
        else if (targetLang === 'zh-CN') polished = s2cn(rawTranslated);

        const translatedMap = new Map();
        const lines = polished.split(/\r?\n/);
        for (const l of lines) {
          const match = l.match(/^\s*\[(\d+)\]\s*(.*)$/);
          if (match) {
            const idx = parseInt(match[1]);
            translatedMap.set(idx, match[2].trim());
          }
        }

        return cuesBatch.map((cue, idx) => ({
          ...cue,
          text: translatedMap.get(idx) || cue.text
        }));
      }
    }
  } catch (err) {
    console.warn('[SubtitleTranslator] Batch translation error:', err.message);
  }

  // Fallback: return original cues
  return cuesBatch;
}

/**
 * Downloads and translates an upstream WebVTT subtitle track into Traditional or Simplified Chinese
 */
export async function translateVtt(vttUrl, targetLang = 'zh-TW', referer = 'https://zokoanime.video/') {
  const cacheKey = `${vttUrl}_${targetLang}`;
  const cached = vttCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    return cached.content;
  }

  // 1. Fetch original WebVTT
  const res = await fetch(vttUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AniFlix/1.0',
      'Referer': referer || 'https://zokoanime.video/'
    }
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch original VTT (${res.status}) from ${vttUrl}`);
  }

  const rawVtt = await res.text();

  // 2. Parse WebVTT blocks
  const lines = rawVtt.split(/\r?\n/);
  const cues = [];
  let headerLines = [];
  let currentTiming = null;
  let currentIdentifier = null;
  let currentTexts = [];
  let isHeader = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.includes('-->')) {
      isHeader = false;
      // If we had a prior cue accumulating
      if (currentTiming) {
        cues.push({
          identifier: currentIdentifier,
          timing: currentTiming,
          text: currentTexts.join('\n').trim()
        });
        currentIdentifier = null;
        currentTexts = [];
      }
      currentTiming = line;
    } else if (isHeader) {
      headerLines.push(line);
    } else if (currentTiming) {
      if (line.trim() === '') {
        // Blank line marks end of a cue block
        cues.push({
          identifier: currentIdentifier,
          timing: currentTiming,
          text: currentTexts.join('\n').trim()
        });
        currentTiming = null;
        currentIdentifier = null;
        currentTexts = [];
      } else {
        currentTexts.push(line);
      }
    } else if (line.trim() !== '') {
      // Could be cue identifier number / string before the '-->' line
      currentIdentifier = line.trim();
    }
  }

  // Push remaining cue if any
  if (currentTiming) {
    cues.push({
      identifier: currentIdentifier,
      timing: currentTiming,
      text: currentTexts.join('\n').trim()
    });
  }

  if (cues.length === 0) {
    return rawVtt; // Return raw if no parseable cues
  }

  // 3. Translate in character-bounded batches strictly under 350 characters
  const batches = [];
  let currentBatch = [];
  let currentChars = 0;

  for (const cue of cues) {
    const cueLen = (cue.text || '').length + 8;
    if (currentBatch.length >= 6 || (currentChars + cueLen > 350 && currentBatch.length > 0)) {
      batches.push(currentBatch);
      currentBatch = [cue];
      currentChars = cueLen;
    } else {
      currentBatch.push(cue);
      currentChars += cueLen;
    }
  }
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  const translatedCues = [];
  // Process in small batches with concurrency limit of 3
  const CONCURRENCY = 3;
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const chunk = batches.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(b => translateBatch(b, targetLang)));
    for (const r of results) {
      translatedCues.push(...r);
    }
  }

  // 4. Reconstruct clean WebVTT
  const outputLines = [
    'WEBVTT',
    'Kind: captions',
    `Language: ${targetLang === 'zh-TW' ? 'zh-TW' : targetLang === 'zh-CN' ? 'zh-CN' : 'ja'}`,
    `Comment: Translated to ${targetLang} by AniFlix`,
    ''
  ];

  for (let i = 0; i < translatedCues.length; i++) {
    const cue = translatedCues[i];
    if (cue.identifier) {
      outputLines.push(cue.identifier);
    } else {
      outputLines.push(String(i + 1));
    }
    outputLines.push(cue.timing);
    outputLines.push(cue.text || '');
    outputLines.push('');
  }

  const finalVtt = outputLines.join('\n');
  vttCache.set(cacheKey, { timestamp: Date.now(), content: finalVtt });
  return finalVtt;
}

/**
 * Express Route Handler for /api/subtitles/translate
 */
export async function handleSubtitleTranslate(req, res) {
  const { url, referer } = req.query;
  const target = req.query.targetLang || req.query.to || 'zh-TW';
  if (!url) {
    return res.status(400).send('Missing url parameter');
  }

  try {
    const vtt = await translateVtt(url, target, referer);
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(vtt);
  } catch (err) {
    console.error('[SubtitleTranslator] Translation error:', err.message);
    // Fallback: proxy the original VTT if translation encounters an issue
    try {
      const original = await fetch(url, {
        headers: {
          'Referer': referer || 'https://zokoanime.video/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AniFlix/1.0'
        }
      });
      const origText = await original.text();
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      res.send(origText);
    } catch (fallbackErr) {
      res.status(500).send(`Failed to process subtitles: ${fallbackErr.message}`);
    }
  }
}
