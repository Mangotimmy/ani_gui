// server/services/subtitleTranslator.js - Fast, resilient WebVTT subtitle translation
//
// Design goals (all of them were violated by the previous version, which produced the
// HTTP 500 / HTTP 504 storms visible in the user reports):
//   1. Never crash on a relative URL. The player used to build AI tracks from
//      "/api/proxy?url=..." and the server called fetch('/api/proxy?...') which throws
//      "Failed to parse URL" -> 500 -> no subtitles at all.
//   2. Never time out. A whole episode used to be translated in hundreds of sequential
//      3-cue round trips, easily exceeding the reverse proxy's 60 s read timeout (504).
//      Now: big batches, bounded concurrency, a hard time budget and partial results.
//   3. Never lose the mapping. Translation providers collapse line breaks, which made the
//      parser drop every cue and return the original text ("translation not working").
//      Now: strict marker verification with a per-cue fallback.
//   4. Never re-translate. Results are cached in memory AND on disk, so replays and
//      repeated episodes are instant.
import fs from 'fs';
import * as OpenCC from 'opencc-js';
import { mediaCache } from './mediaCache.js';

const s2tw = OpenCC.Converter ? OpenCC.Converter({ from: 'cn', to: 'tw' }) : (s => s);
const s2cn = OpenCC.Converter ? OpenCC.Converter({ from: 'tw', to: 'cn' }) : (s => s);

const MEMORY_TTL_MS = 24 * 60 * 60 * 1000;
const DISK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_MEMORY_ENTRIES = 120;
const TIME_BUDGET_MS = Number(process.env.ANIFLIX_SUBTITLE_TIME_BUDGET_MS || 22000);
const BATCH_CHAR_LIMIT = Number(process.env.ANIFLIX_SUBTITLE_BATCH_CHARS || 1200);
const BATCH_CONCURRENCY = Number(process.env.ANIFLIX_SUBTITLE_CONCURRENCY || 6);

const vttCache = new Map();      // cacheKey -> { timestamp, content }
const inFlight = new Map();      // cacheKey -> Promise<string>

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function localBaseUrl() {
  const port = process.env.PORT || 3001;
  return `http://127.0.0.1:${port}`;
}

/**
 * Accepts absolute URLs as well as the same relative proxy paths the browser uses and
 * resolves them against this very server.
 */
export function resolveSubtitleSourceUrl(rawUrl) {
  if (!rawUrl) return null;
  let url = String(rawUrl).trim();
  if (!url) return null;
  // Unwrap our own translator endpoint to avoid an infinite self-request loop.
  if (url.includes('/api/subtitles/translate')) {
    try {
      const u = new URL(url, localBaseUrl());
      const inner = u.searchParams.get('url');
      if (inner) return resolveSubtitleSourceUrl(inner);
    } catch {}
  }
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('/')) return new URL(url, localBaseUrl()).href;
  if (!/^https?:\/\//i.test(url)) return null;
  return url;
}

function memoryGet(key) {
  const entry = vttCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > MEMORY_TTL_MS) {
    vttCache.delete(key);
    return null;
  }
  return entry.content;
}

function memorySet(key, content) {
  if (vttCache.size >= MAX_MEMORY_ENTRIES) {
    const oldest = vttCache.keys().next().value;
    if (oldest !== undefined) vttCache.delete(oldest);
  }
  vttCache.set(key, { timestamp: Date.now(), content });
}

function diskGet(cacheKey) {
  try {
    const filePath = mediaCache.getSubtitlePath(cacheKey);
    const stat = fs.statSync(filePath);
    if (Date.now() - stat.mtimeMs > DISK_TTL_MS) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    return content && content.length > 0 ? content : null;
  } catch {
    return null;
  }
}

function diskSet(cacheKey, content) {
  try {
    const filePath = mediaCache.getSubtitlePath(cacheKey);
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, content, 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch {}
}

// ---------------------------------------------------------------------------
// WebVTT / SRT parsing
// ---------------------------------------------------------------------------
function parseSubtitleBlocks(rawText) {
  const text = String(rawText || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const cues = [];
  let identifier = null;
  let timing = null;
  let currentTexts = [];
  let isHeader = /^WEBVTT/.test(text.trim().slice(0, 10));

  const flush = () => {
    if (timing) {
      cues.push({
        identifier,
        timing: timing.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2'),
        text: currentTexts.join('\n').trim()
      });
    }
    identifier = null;
    timing = null;
    currentTexts = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.includes('-->')) {
      flush();
      isHeader = false;
      timing = trimmed;
    } else if (isHeader) {
      continue;
    } else if (timing) {
      if (trimmed === '') flush();
      else currentTexts.push(line);
    } else if (trimmed !== '') {
      identifier = trimmed;
    }
  }
  flush();
  return cues;
}

function isMostlyJapanese(text) {
  const sample = String(text || '').slice(0, 4000);
  if (!sample) return false;
  const kana = (sample.match(/[\u3040-\u30ff]/g) || []).length;
  const cjk = (sample.match(/[\u4e00-\u9fff]/g) || []).length;
  return kana > 0 && kana / Math.max(kana + cjk, 1) > 0.08;
}

function isMostlyChinese(text) {
  const sample = String(text || '').slice(0, 4000);
  if (!sample) return false;
  const kana = (sample.match(/[\u3040-\u30ff]/g) || []).length;
  const cjk = (sample.match(/[\u4e00-\u9fff]/g) || []).length;
  return cjk > 0 && kana === 0;
}

function normalizeTargetLang(targetLang) {
  const t = String(targetLang || 'zh-TW').toLowerCase();
  if (t === 'zh-cn' || t === 'zh_cn' || t === 'cn') return 'zh-CN';
  if (t === 'ja' || t === 'jp' || t === 'japanese') return 'ja';
  return 'zh-TW';
}

function polish(text, targetLang) {
  try {
    if (targetLang === 'zh-TW') return s2tw(text);
    if (targetLang === 'zh-CN') return s2cn(text);
  } catch {}
  return text;
}

// ---------------------------------------------------------------------------
// Translation providers
// ---------------------------------------------------------------------------
async function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const MARKER_SPLIT = /\n/;

/**
 * The unofficial endpoint answers in several shapes depending on locale:
 *   [["你好世界", "en"]]            <- dict-chrome-ex (translation, detected language)
 *   [["你好", "Hello"], [...]]      <- segment list
 *   ["你好世界"]                    <- legacy
 * Previously the detected-language token was concatenated onto the last cue ("早安en").
 */
function extractTranslatedText(data) {
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) {
    if (data.length === 0) return '';
    const first = data[0];
    if (typeof first === 'string') return first;
    if (Array.isArray(first)) {
      if (first.length === 0) return '';
      if (Array.isArray(first[0])) {
        return first.map(seg => (Array.isArray(seg) ? seg[0] : seg) || '').join('');
      }
      // [translatedText, detectedLanguage] — only take element 0.
      return typeof first[0] === 'string' ? first[0] : first.filter(s => typeof s === 'string').join('');
    }
    return '';
  }
  if (data && typeof data === 'object' && Array.isArray(data.sentences)) {
    return data.sentences.map(s => s.trans || '').join('');
  }
  return '';
}

/**
 * Translate a block of "\n"-separated cue texts through Google's free endpoint.
 * Returns null when the provider did not preserve one line per cue.
 */
async function translateBlockBatch(payload, targetLang) {
  const gLang = targetLang === 'zh-CN' ? 'zh-CN' : targetLang === 'ja' ? 'ja' : 'zh-TW';
  const gUrl = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${gLang}&q=${encodeURIComponent(payload)}`;

  try {
    const res = await fetchWithTimeout(gUrl, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' }
    }, 7000);
    if (!res.ok) return null;
    const data = await res.json();

    const raw = extractTranslatedText(data);
    if (!raw) return null;
    return raw;
  } catch {
    return null;
  }
}

/**
 * Translate one cue on its own (slow path, used when batch alignment fails).
 */
async function translateSingleCue(text, targetLang) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  const gLang = targetLang === 'zh-CN' ? 'zh-CN' : targetLang === 'ja' ? 'ja' : 'zh-TW';
  try {
    const res = await fetchWithTimeout(
      `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${gLang}&q=${encodeURIComponent(trimmed)}`,
      { headers: { 'User-Agent': UA, 'Accept': 'application/json' } },
      6000
    );
    if (!res.ok) return null;
    return extractTranslatedText(await res.json());
  } catch {
    return null;
  }
}

async function runPool(items, worker, concurrency) {
  let cursor = 0;
  const results = new Array(items.length);
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await worker(items[index], index);
      } catch {
        results[index] = null;
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Translate all cues. Aligned, budgeted, and always returns something usable.
 */
async function translateCues(cues, targetLang, deadline) {
  // Group cues into character-bounded batches (a whole block, not 3 cues).
  const batches = [];
  let current = [];
  let currentChars = 0;
  for (const cue of cues) {
    const len = (cue.text || '').length + 1;
    if (current.length > 0 && (currentChars + len > BATCH_CHAR_LIMIT || current.length >= 24)) {
      batches.push(current);
      current = [cue];
      currentChars = len;
    } else {
      current.push(cue);
      currentChars += len;
    }
  }
  if (current.length) batches.push(current);

  const translated = new Map(); // cue object -> translated text

  await runPool(batches, async (batch) => {
    if (Date.now() > deadline) return; // budget exhausted: keep originals
    const payload = batch.map(c => (c.text || '').replace(/\n/g, ' ').trim()).join('\n');
    let raw = await translateBlockBatch(payload, targetLang);

    if (raw) {
      const pieces = polish(raw, targetLang).split(MARKER_SPLIT).map(s => s.trim());
      if (pieces.length === batch.length) {
        batch.forEach((cue, i) => translated.set(cue, pieces[i] || cue.text));
        return;
      }
    }

    // Alignment failed (provider collapsed/merged lines). Translate cue by cue.
    if (Date.now() > deadline) return;
    const single = await runPool(batch, async (cue) => {
      if (Date.now() > deadline) return null;
      const result = await translateSingleCue(cue.text, targetLang);
      return result ? polish(result, targetLang) : null;
    }, 4);
    batch.forEach((cue, i) => {
      if (single[i]) translated.set(cue, single[i]);
    });
  }, BATCH_CONCURRENCY);

  return cues.map(cue => ({
    ...cue,
    text: translated.get(cue) || cue.text
  }));
}

function buildVtt(cues, targetLang) {
  const output = [
    'WEBVTT',
    'Kind: captions',
    `Language: ${targetLang}`,
    'Comment: Translated by AniFlix',
    ''
  ];
  cues.forEach((cue, index) => {
    output.push(String(cue.identifier || index + 1));
    output.push(cue.timing);
    output.push(cue.text || '');
    output.push('');
  });
  return output.join('\n');
}

async function fetchSourceVtt(url, referer) {
  const sourceUrl = resolveSubtitleSourceUrl(url);
  if (!sourceUrl) throw new Error('Invalid subtitle URL');
  const res = await fetchWithTimeout(sourceUrl, {
    headers: {
      'User-Agent': UA,
      'Referer': referer || 'https://zokoanime.video/',
      'Accept': '*/*'
    }
  }, 15000);
  if (!res.ok) throw new Error(`Failed to fetch original subtitles (${res.status})`);
  return await res.text();
}

async function doTranslate(vttUrl, targetLang, referer) {
  const startedAt = Date.now();
  const deadline = startedAt + TIME_BUDGET_MS;
  const rawVtt = await fetchSourceVtt(vttUrl, referer);
  const cues = parseSubtitleBlocks(rawVtt);

  if (cues.length === 0) {
    // Nothing to translate (e.g. empty track) — hand back the original untouched.
    return rawVtt;
  }

  const sample = cues.map(c => c.text).join(' ');

  // Source already matches the requested language: no round trip, no mangling.
  if (targetLang === 'ja' && isMostlyJapanese(sample)) return rawVtt;
  if ((targetLang === 'zh-TW' || targetLang === 'zh-CN') && isMostlyChinese(sample)) {
    // Traditional <-> Simplified conversion is local and instant.
    const converted = cues.map(cue => ({ ...cue, text: polish(cue.text, targetLang) }));
    return buildVtt(converted, targetLang);
  }

  const translatedCues = await translateCues(cues, targetLang, deadline);
  return buildVtt(translatedCues, targetLang);
}

/**
 * Downloads + translates an upstream WebVTT track, with memory/disk caching and
 * request coalescing so N concurrent players only trigger one translation.
 */
export async function translateVtt(vttUrl, targetLang = 'zh-TW', referer = 'https://zokoanime.video/') {
  const lang = normalizeTargetLang(targetLang);
  const sourceUrl = resolveSubtitleSourceUrl(vttUrl);
  if (!sourceUrl) throw new Error('Invalid subtitle URL');

  const cacheKey = `${sourceUrl}_${lang}`;

  const cached = memoryGet(cacheKey) || diskGet(cacheKey);
  if (cached) {
    memorySet(cacheKey, cached);
    return cached;
  }

  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);

  const promise = (async () => {
    try {
      const result = await doTranslate(sourceUrl, lang, referer);
      if (result && result.length > 0) {
        memorySet(cacheKey, result);
        diskSet(cacheKey, result);
      }
      return result;
    } finally {
      inFlight.delete(cacheKey);
    }
  })();

  inFlight.set(cacheKey, promise);
  return promise;
}

/**
 * Express route handler for /api/subtitles/translate.
 * Always answers with a WebVTT body (200): a broken translation must degrade to the
 * original track, never surface as a 500/504 and leave the player without subtitles.
 */
export async function handleSubtitleTranslate(req, res) {
  const { url, referer } = req.query;
  const targetLang = normalizeTargetLang(req.query.targetLang || req.query.to || req.query.lang);

  res.setHeader('Content-Type', 'text/vtt; charset=utf-8');

  if (!url) {
    res.status(400).send('WEBVTT\n\n');
    return;
  }

  try {
    const vtt = await translateVtt(url, targetLang, referer);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(vtt || 'WEBVTT\n\n');
  } catch (err) {
    console.warn('[SubtitleTranslator] Translation failed, serving original track:', err.message);
    try {
      const sourceUrl = resolveSubtitleSourceUrl(url);
      const original = await fetchSourceVtt(sourceUrl, referer);
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.send(original);
    } catch (fallbackErr) {
      // Last resort: an empty but valid track beats a broken request.
      res.status(200).send('WEBVTT\n\n');
    }
  }
}
