// server/services/chineseTitleService.js - High-Performance Anime Chinese Title Resolver & Cache
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as OpenCC from 'opencc-js';
import { BoundedCache } from './cache.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.ANIFLIX_DATA_DIR || path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'chinese_titles_cache.json');

const s2tw = OpenCC.Converter ? OpenCC.Converter({ from: 'cn', to: 'tw' }) : (s => s);
const s2cn = OpenCC.Converter ? OpenCC.Converter({ from: 'tw', to: 'cn' }) : (s => s);

// Pre-seeded high-frequency popular anime title dictionary
export const POPULAR_TITLES_ZH = {
  // Classics & Shonen Jump hits
  'one piece': { tw: '航海王', cn: '航海王' },
  'hunter x hunter': { tw: '獵人', cn: '全职猎人' },
  'hunter x hunter (2011)': { tw: '獵人 (2011)', cn: '全职猎人 (2011)' },
  'fullmetal alchemist: brotherhood': { tw: '鋼之鍊金術師 BROTHERHOOD', cn: '钢之炼金术师 FULLMETAL ALCHEMIST' },
  'fullmetal alchemist': { tw: '鋼之鍊金術師', cn: '钢之炼金术师' },
  'black clover': { tw: '黑色五葉草', cn: '黑色五叶草' },
  'black clover season 2': { tw: '黑色五葉草 第二季', cn: '黑色五叶草 第二季' },
  'naruto': { tw: '火影忍者', cn: '火影忍者' },
  'naruto shippuden': { tw: '火影忍者 疾風傳', cn: '火影忍者 疾风传' },
  'bleach': { tw: '死神 / 境·界', cn: '死神 / 境·界' },
  'bleach: thousand-year blood war': { tw: '死神 千年血戰篇', cn: '境·界 千年血战篇' },
  'dragon ball z': { tw: '七龍珠Z', cn: '龙珠Z' },
  'dragon ball super': { tw: '七龍珠超', cn: '龙珠超' },

  // Modern Megahits
  'attack on titan': { tw: '進擊的巨人', cn: '进击的巨人' },
  'attack on titan season 2': { tw: '進擊的巨人 第二季', cn: '进击的巨人 第二季' },
  'attack on titan season 3': { tw: '進擊的巨人 第三季', cn: '进击的巨人 第三季' },
  'attack on titan final season': { tw: '進擊的巨人 最終季', cn: '进击的巨人 最终季' },
  'demon slayer: kimetsu no yaiba': { tw: '鬼滅之刃', cn: '鬼灭之刃' },
  'demon slayer: kimetsu no yaiba entertainment district arc': { tw: '鬼滅之刃 遊郭篇', cn: '鬼灭之刃 游郭篇' },
  'demon slayer: kimetsu no yaiba swordsmith village arc': { tw: '鬼滅之刃 刀匠村篇', cn: '鬼灭之刃 锻刀村篇' },
  'demon slayer: kimetsu no yaiba hashira training arc': { tw: '鬼滅之刃 柱訓練篇', cn: '鬼灭之刃 柱训练篇' },
  'jujutsu kaisen': { tw: '咒術迴戰', cn: '咒术回战' },
  'jujutsu kaisen season 2': { tw: '咒術迴戰 第二季', cn: '咒术回战 第二季' },
  'chainsaw man': { tw: '鏈鋸人', cn: '电锯人' },
  'solo leveling': { tw: '我獨自升級', cn: '我独自升级' },
  'solo leveling season 2': { tw: '我獨自升級 第二季', cn: '我独自升级 第二季' },
  'spy x family': { tw: '間諜家家酒', cn: '间谍过家家' },
  'spy x family season 2': { tw: '間諜家家酒 第二季', cn: '间谍过家家 第二季' },

  // Isekai & Fantasy
  're:zero -starting life in another world-': { tw: 'Re:從零開始的異世界生活', cn: 'Re:从零开始的异世界生活' },
  're:zero -starting life in another world- season 2': { tw: 'Re:從零開始的異世界生活 第二季', cn: 'Re:从零开始的异世界生活 第二季' },
  're:zero -starting life in another world- season 3': { tw: 'Re:從零開始的異世界生活 第三季', cn: 'Re:从零开始的异世界生活 第三季' },
  'frieren: beyond journey\'s end': { tw: '葬送的芙莉蓮', cn: '葬送的芙莉莲' },
  'mushoku tensei: jobless reincarnation': { tw: '無職轉生～到了異世界就拿出真本事～', cn: '无职转生～到了异世界就拿出真本事～' },
  'mushoku tensei: jobless reincarnation season 2': { tw: '無職轉生 第二季', cn: '无职转生 第二季' },
  'that time i got reincarnated as a slime': { tw: '關於我轉生變成史萊姆這檔事', cn: '关于我转生变成史莱姆这档事' },
  'reincarnated as a sword': { tw: '轉生成為魔劍', cn: '转生成为魔剑' },
  'the apothecary diaries': { tw: '藥師少女的獨語', cn: '药屋少女的呢喃' },
  'the apothecary diaries season 2': { tw: '藥師少女的獨語 第二季', cn: '药屋少女的呢喃 第二季' },
  'oshi no ko': { tw: '我推的孩子', cn: '我推的孩子' },
  'oshi no ko season 2': { tw: '我推的孩子 第二季', cn: '我推的孩子 第二季' },
  'cyberpunk: edgerunners': { tw: '電馭叛客：邊緣行者', cn: '赛博朋克：边缘行者' },
  'cyberpunk: edgerunners 2': { tw: '電馭叛客：邊緣行者 2', cn: '赛博朋克：边缘行者 2' },
  'made in abyss': { tw: '來自深淵', cn: '来自深渊' },
  'made in abyss: golden city of the scorching sun': { tw: '來自深淵 烈日的黃金鄉', cn: '来自深渊 烈日的黄金乡' },
  'blue lock': { tw: '藍色監獄', cn: '蓝色禁区' },
  'blue lock vs. u-20 japan': { tw: '藍色監獄 VS. U-20 日本代表隊', cn: '蓝色禁区 VS. U-20 日本代表队' },
  'kaiju no. 8': { tw: '怪獸8號', cn: '怪兽8号' },
  'dandadan': { tw: '膽大黨', cn: '胆大党' },
  'hell\'s paradise': { tw: '地獄樂', cn: '地狱乐' },
  'bocchi the rock!': { tw: '孤獨搖滾！', cn: '孤独摇滚！' },
  'sword art online': { tw: '刀劍神域', cn: '刀剑神域' },
  'overlord': { tw: '不死者之王', cn: '不死者之王' },
  'death note': { tw: '死亡筆記本', cn: '死亡笔记' },
  'code geass: lelouch of the rebellion': { tw: '反叛的魯路修', cn: '反叛的鲁路修' },
  'evangelion: 1.0 you are (not) alone': { tw: '福音戰士新劇場版：序', cn: '福音战士新剧场版：序' },
  'neon genesis evangelion': { tw: '新世紀福音戰士', cn: '新世纪福音战士' },
  'my hero academia': { tw: '我的英雄學院', cn: '我的英雄学院' },
  'vinland saga': { tw: '海盜戰記', cn: '冰海战记' },
  'mob psycho 100': { tw: '路人超能100', cn: '灵能百分百' },
  'steins;gate': { tw: '命運石之門', cn: '命运石之门' },
  'toradora!': { tw: 'TIGER×DRAGON！龍與虎', cn: '龙与虎' },
  'clannad': { tw: 'CLANNAD 家族', cn: 'CLANNAD' },
  'your lie in april': { tw: '四月是你的謊言', cn: '四月是你的谎言' },
  'violet evergarden': { tw: '紫羅蘭永恆花園', cn: '紫罗兰永恒花园' },
  'a silent voice': { tw: '聲之形', cn: '声之形' },
  'your name.': { tw: '你的名字。', cn: '你的名字。' },
  'suzume': { tw: '鈴芽之旅', cn: '铃芽之旅' },
  'spirited away': { tw: '神隱少女', cn: '千与千寻' },
  'howl\'s moving castle': { tw: '霍爾的移動城堡', cn: '哈尔的移动城堡' },
  'one punch man': { tw: '一拳超人', cn: '一拳超人' },
  'one punch man season 2': { tw: '一拳超人 第二季', cn: '一拳超人 第二季' },
  'tokyo ghoul': { tw: '東京喰種', cn: '东京喰种' },
  'haikyuu!!': { tw: '排球少年！！', cn: '排球少年！！' },
  'haikyu!!': { tw: '排球少年！！', cn: '排球少年！！' },
  'no game no life': { tw: '遊戲人生', cn: '游戏人生' },
  'kaguya-sama: love is war': { tw: '輝夜姬想讓人告白', cn: '辉夜大小姐想让我告白' }
};

// ---------------------------------------------------------------------------
// Title resolver v3
//   1. exact dictionary  2. Chinese-script native/synonym  3. validated Bangumi match
//   4. machine translation (labelled)  5. original title (never a wrong one)
// Cache is keyed by AniList id ONLY (v1 title-text keys caused cross-anime poisoning).
// v3 also stores a fingerprint of the anime's own titles, so a translation that belongs
// to a DIFFERENT anime can never be served from the cache nor trusted from storage, and
// season markers are normalised to Chinese (第2期 -> 第二季) instead of being dropped.
// ---------------------------------------------------------------------------
const CACHE_VERSION = 3;

// In-memory bounded cache: animeId -> { v, tw, cn, source, bgmId, summaryTw, summaryCn }
const titleCache = new BoundedCache(5000, 30 * 24 * 60 * 60 * 1000);
const negativeCache = new BoundedCache(2000, 10 * 60 * 1000);

/** Atomic write: never leave a half-written cache behind on crash/power loss. */
function writeDiskCacheSync(entries) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const obj = {};
  for (const [k, v] of entries) obj[k] = v;
  const tmp = `${CACHE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj), 'utf-8');
  fs.renameSync(tmp, CACHE_FILE);
}

function loadDiskCache() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(CACHE_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    let kept = 0;
    let dropped = 0;
    for (const [k, v] of Object.entries(parsed)) {
      // Only current-version entries keyed by AniList id are trustworthy. Every legacy
      // entry (title-text keys, unversioned values) is poison: drop it for good.
      if (v && v.v === CACHE_VERSION && /^\d+$/.test(k) && typeof v.tw === 'string' && v.tw && v.key) {
        titleCache.set(k, v);
        kept++;
      } else {
        dropped++;
      }
    }
    console.log(`[ChineseTitleService] Loaded ${kept} validated title entries (${dropped} poisoned/legacy entries discarded).`);
    if (dropped > 0) {
      // Rewrite now so the poison cannot come back on the next boot.
      try {
        writeDiskCacheSync(titleCache.entries());
        console.log('[ChineseTitleService] Cache file rewritten in v' + CACHE_VERSION + ' format.');
      } catch (err) {
        console.warn('[ChineseTitleService] Failed to rewrite cache file:', err.message);
      }
    }
  } catch (err) {
    console.warn('[ChineseTitleService] Failed to load disk cache:', err.message);
  }
}

let saveTimeout = null;
function persistDiskCache() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      writeDiskCacheSync(titleCache.entries());
    } catch (err) {
      console.warn('[ChineseTitleService] Failed to save disk cache:', err.message);
    }
  }, 2000);
}

// ---- text helpers ----------------------------------------------------------
const HAS_KANA = /[\u3040-\u30FF]/;
const HAS_HAN = /[\u3400-\u9FFF]/;

export function decodeEntities(str) {
  if (!str || typeof str !== 'string') return str || '';
  return str
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&') // double-encoded (&amp;amp;)
    .trim();
}

/** Remove noise such as "(TV)" that AniList appends to some titles. */
export function cleanDisplayTitle(str) {
  return decodeEntities(str)
    .replace(/\s*[(（]\s*TV\s*[)）]\s*/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalizeTitle(str) {
  if (!str) return '';
  return decodeEntities(str).toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Base-name normalisation for Japanese comparison (season markers removed; the air date separates seasons). */
function normalizeJp(str) {
  if (!str) return '';
  return decodeEntities(str)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[(（][^)）]*[)）]/g, '')
    .replace(/第?\s*[0-9一二三四五六七八九十]+\s*(期|季|クール|シーズン|部)/g, '')
    .replace(/(season|シーズン)\s*\d+|\d+(st|nd|rd|th)\s*season/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

// ---- identity / season helpers ---------------------------------------------
const ZH_SEASON_SUFFIX = ['', '第一季', '第二季', '第三季', '第四季', '第五季', '第六季', '第七季', '第八季', '第九季', '第十季'];
const CN_SEASON_DIGITS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

function parseSeasonNumber(raw) {
  if (!raw) return null;
  if (/^[0-9]+$/.test(raw)) {
    const n = parseInt(raw, 10);
    return n > 0 && n < 100 ? n : null;
  }
  if (CN_SEASON_DIGITS[raw] !== undefined) return CN_SEASON_DIGITS[raw];
  const tens = raw.match(/^十([一二三四五六七八九])$/);
  if (tens) return 10 + CN_SEASON_DIGITS[tens[1]];
  const full = raw.match(/^([一二三四五六七八九])十([一二三四五六七八九])?$/);
  if (full) return CN_SEASON_DIGITS[full[1]] * 10 + (full[2] ? CN_SEASON_DIGITS[full[2]] : 0);
  return null;
}

/** Season number encoded in a title ("第2期", "第二季", "2nd Season"), or null when absent. */
export function seasonOfTitle(str) {
  if (!str || typeof str !== 'string') return null;
  const s = decodeEntities(str);
  let m = s.match(/第\s*([0-9]+|[一二三四五六七八九十]+)\s*(?:期|季|シーズン|クール|部)/u);
  if (m) return parseSeasonNumber(m[1]);
  m = s.match(/(?:season|シーズン)\s*([0-9]+)/iu);
  if (m) return parseSeasonNumber(m[1]);
  m = s.match(/([0-9]+)\s*(?:st|nd|rd|th)\s*season/iu);
  if (m) return parseSeasonNumber(m[1]);
  return null;
}

export function animeSeason(anime) {
  return seasonOfTitle(anime?.title?.native) ?? seasonOfTitle(anime?.title?.romaji) ?? seasonOfTitle(anime?.title?.english);
}

function stripTrailingSeasonMarker(str) {
  return decodeEntities(str)
    .replace(/[\s\-–—:：]*第\s*[0-9一二三四五六七八九十]+\s*(?:期|季|シーズン|クール)\s*$/u, '')
    .replace(/[\s\-–—:：]*(?:season|シーズン)\s*[0-9]+\s*$/iu, '')
    .replace(/[\s\-–—:：]*[0-9]+\s*(?:st|nd|rd|th)\s*season\s*$/iu, '')
    .trim();
}

/** Canonicalise the season suffix of a resolved Chinese title ("第2期" -> "第二季"), never dropping it. */
export function normalizeZhSeason(zh, season) {
  if (!zh || !season) return zh;
  const suffix = ZH_SEASON_SUFFIX[season] || `第${season}季`;
  const stripped = stripTrailingSeasonMarker(zh);
  if (stripped === zh && zh.includes(suffix)) return zh;
  const base = stripped !== zh ? stripped : zh;
  if (!base) return zh;
  // "..." + "第二季" reads wrong after a CJK punctuation mark ("出現了！ 第二季")
  const sep = /[\u3000-\u303F\uFF01\uFF09\uFF1F\u3001\u3002\uFF0C\uFF1B\uFF1A]$/.test(base) ? '' : ' ';
  return `${base}${sep}${suffix}`;
}

/** Stable fingerprint of an anime built from its own core titles (synonyms are not dependable). */
export function titleFingerprint(anime) {
  return [anime?.title?.native, anime?.title?.romaji, anime?.title?.english]
    .map(normalizeTitle)
    .filter(Boolean)
    .join('|');
}

/** A cached translation may only be used when it was resolved for this very anime. */
function entryMatchesAnime(entry, anime) {
  if (!entry || !entry.key) return false;
  return entry.key === titleFingerprint(anime);
}

// Exact-match dictionary (normalised key -> entry)
const DICT = new Map();
for (const [k, v] of Object.entries(POPULAR_TITLES_ZH)) DICT.set(normalizeTitle(k), v);

let machineTranslator = null;
/** metadata.js registers translateText here (avoids a circular import). */
export function setMachineTranslator(fn) {
  machineTranslator = fn;
}

function makeEntry(rawZh, source, anime, extra = {}) {
  const clean = normalizeZhSeason(cleanDisplayTitle(rawZh), animeSeason(anime));
  const tw = s2tw(clean);
  return { v: CACHE_VERSION, tw, cn: s2cn(tw), source, key: titleFingerprint(anime), ...extra };
}

// ---- user overrides (data/title_overrides.json) -----------------------------
// Hand-curated names beat every automatic source. Keys may be an AniList id ("214968") or a
// title (romaji / english / native). Values are a string or { tw, cn }.
const OVERRIDES_FILE = path.join(DATA_DIR, 'title_overrides.json');
let overridesById = new Map();
let overridesByTitle = new Map();
let overridesCheckedAt = 0;
let overridesCount = 0;

function normalizeOverrideValue(v) {
  if (!v) return null;
  const raw = typeof v === 'string' ? { tw: v } : v;
  const tw = decodeEntities(String(raw.tw || raw.cn || '')).trim();
  if (!tw) return null;
  return { tw, cn: String(raw.cn || s2cn(tw)).trim() };
}

/** Re-reads data/title_overrides.json at most once every 30s (force to bypass). */
export function reloadTitleOverrides(force = false) {
  const now = Date.now();
  if (!force && now - overridesCheckedAt < 30000) return;
  overridesCheckedAt = now;
  try {
    if (!fs.existsSync(OVERRIDES_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf-8'));
    const byId = new Map();
    const byTitle = new Map();
    for (const [k, v] of Object.entries(parsed || {})) {
      const entry = normalizeOverrideValue(v);
      if (!entry) continue;
      if (/^\d+$/.test(k)) byId.set(k, entry);
      else byTitle.set(normalizeTitle(k), entry);
    }
    overridesById = byId;
    overridesByTitle = byTitle;
    overridesCount = byId.size + byTitle.size;
  } catch (err) {
    console.warn('[ChineseTitleService] Failed to load title overrides:', err.message);
  }
}

export function getTitleOverrideCount() {
  return overridesCount;
}

// ---- synchronous (no network) sources --------------------------------------
function resolveSync(anime) {
  reloadTitleOverrides();

  // 0. hand-curated override (by AniList id, then by any of the anime's titles)
  const overrideById = overridesById.get(String(anime?.id || ''));
  if (overrideById) {
    return { v: CACHE_VERSION, tw: overrideById.tw, cn: overrideById.cn, source: 'override', key: titleFingerprint(anime) };
  }
  const overrideKeys = [anime.title?.english, anime.title?.romaji, anime.title?.native, ...(anime.synonyms || [])]
    .map(normalizeTitle)
    .filter(Boolean);
  for (const k of overrideKeys) {
    const ov = overridesByTitle.get(k);
    if (ov) return { v: CACHE_VERSION, tw: ov.tw, cn: ov.cn, source: 'override', key: titleFingerprint(anime) };
  }

  // 1. exact dictionary: strict equality only (no prefix matching)
  const candidates = [anime.title?.english, anime.title?.romaji, ...(anime.synonyms || [])]
    .map(normalizeTitle)
    .filter(Boolean);
  for (const c of candidates) {
    const hit = DICT.get(c);
    if (hit) return { v: CACHE_VERSION, tw: hit.tw, cn: hit.cn, source: 'dictionary', key: titleFingerprint(anime) };
  }

  // 2a. Chinese / Taiwanese / HK productions: native title is already Chinese
  const native = anime.title?.native || '';
  if (['CN', 'TW', 'HK'].includes(anime.countryOfOrigin) && HAS_HAN.test(native) && !HAS_KANA.test(native)) {
    return makeEntry(native, 'native', anime);
  }
  // 2b. A Chinese-script synonym (no kana)
  const syn = (anime.synonyms || []).find((s) => HAS_HAN.test(s) && !HAS_KANA.test(s));
  if (syn) return makeEntry(syn, 'synonym', anime);
  return null;
}

// ---- Bangumi (validated) ---------------------------------------------------
const BGM_HEADERS = {
  'User-Agent': 'AniFlix/2.0 (https://github.com/Mangotimmy/ani_gui)',
  'Content-Type': 'application/json'
};

// Tiny concurrency pool: max 4 in flight, 200ms spacing between starts
const POOL_MAX = 4;
let poolActive = 0;
const poolQueue = [];
let lastStart = 0;
function pooled(task) {
  return new Promise((resolve, reject) => {
    poolQueue.push({ task, resolve, reject });
    pumpPool();
  });
}
function pumpPool() {
  while (poolActive < POOL_MAX && poolQueue.length) {
    const job = poolQueue.shift();
    poolActive++;
    const wait = Math.max(0, lastStart + 200 - Date.now());
    lastStart = Date.now() + wait;
    setTimeout(() => {
      job.task().then(job.resolve, job.reject).finally(() => {
        poolActive--;
        pumpPool();
      });
    }, wait);
  }
}

function startTimestamp(sd) {
  if (!sd?.year) return null;
  return Date.UTC(sd.year, (sd.month || 1) - 1, sd.day || 15);
}

/**
 * Pick the Bangumi subject that really is this anime.
 * A candidate must match the Japanese base name; if both sides have a date it must be within ±62 days.
 */
export function pickBangumiMatch(anime, list) {
  const aniNative = normalizeJp(anime.title?.native);
  const aniRomaji = normalizeJp(anime.title?.romaji);
  const aniTs = startTimestamp(anime.startDate);
  let best = null;
  let bestScore = 0;

  const aniSeason = animeSeason(anime);

  for (const c of list || []) {
    const name = normalizeJp(c.name);
    if (!name) continue;

    // Never hand a different season of the same franchise to this anime.
    const candSeason = seasonOfTitle(c.name) ?? seasonOfTitle(c.name_cn);
    if (candSeason !== null && aniSeason !== null && candSeason !== aniSeason) continue;

    const cands = [aniNative, aniRomaji].filter((x) => x && x.length >= 2);
    const exact = cands.some((x) => x === name);
    const contains = cands.some((x) => x.length >= 3 && name.length >= 3 && (name.includes(x) || x.includes(name)));
    if (!exact && !contains) continue;

    let dateScore = 0;
    if (aniTs && c.date) {
      const diffDays = Math.abs(Date.parse(c.date) - aniTs) / 86400000;
      if (Number.isNaN(diffDays)) continue;
      if (diffDays > 62) continue; // wrong season / wrong show
      dateScore = 3;
    } else if (!exact) {
      continue; // no date to confirm and only a fuzzy name match: too risky
    }
    const score = (exact ? 3 : 1) + dateScore;
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

async function bangumiSubject(id) {
  const res = await fetch(`https://api.bgm.tv/v0/subjects/${id}`, {
    headers: BGM_HEADERS,
    signal: AbortSignal.timeout(5000)
  });
  if (!res.ok) throw new Error(`Bangumi HTTP ${res.status}`);
  return res.json();
}

async function bangumiSearch(keyword) {
  const res = await fetch('https://api.bgm.tv/v0/search/subjects?limit=10', {
    method: 'POST',
    headers: BGM_HEADERS,
    body: JSON.stringify({ keyword, filter: { type: [2] } }),
    signal: AbortSignal.timeout(5000)
  });
  if (!res.ok) throw new Error(`Bangumi HTTP ${res.status}`);
  const json = await res.json();
  return json.data || [];
}

async function resolveViaBangumi(anime) {
  const keywords = [
    cleanDisplayTitle(anime.title?.native).replace(/\s*第?\s*[0-9一二三四五六七八九十]+\s*(期|季)\s*$/, '').trim(),
    cleanDisplayTitle(anime.title?.romaji)
  ].filter((k, i, a) => k && a.indexOf(k) === i);

  let networkError = null;
  for (const kw of keywords) {
    try {
      const list = await pooled(() => bangumiSearch(kw));
      const match = pickBangumiMatch(anime, list);
      if (match) {
        let nameCn = (match.name_cn || '').trim();
        let summary = (match.summary || '').trim();
        if (!nameCn || !summary) {
          // The search response regularly omits name_cn / summary. The subject id has already
          // passed identity + season validation, so reading its detail cannot introduce a wrong show.
          try {
            const detail = await pooled(() => bangumiSubject(match.id));
            if (detail) {
              nameCn = nameCn || (detail.name_cn || '').trim();
              summary = summary || (detail.summary || '').trim();
            }
          } catch {
            /* keep whatever the search returned */
          }
        }
        return { bgmId: match.id, nameCn, summary };
      }
    } catch (err) {
      networkError = err;
    }
  }
  if (networkError) throw networkError;
  return null;
}

// ---- Wikipedia interlanguage links (free, no key, no quota) ----------------
// Queried with an EXACT title (not a fuzzy search), so a hit is inherently the right
// article. Many Bangumi subjects carry no name_cn at all; their ja/en article usually
// still has an official Chinese title.
async function wikipediaLanglink(host, title) {
  const url = 'https://' + host + '/w/api.php?action=query&prop=langlinks&lllang=zh&format=json&redirects=1&titles='
    + encodeURIComponent(title);
  const res = await fetch(url, { headers: BGM_HEADERS, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error('Wikipedia HTTP ' + res.status);
  const json = await res.json();
  for (const page of Object.values(json?.query?.pages || {})) {
    if (!page || page.missing !== undefined) continue;
    const link = page.langlinks?.[0]?.['*'];
    if (link) return String(link).trim();
  }
  return null;
}

export async function resolveViaWikipedia(anime) {
  const candidates = [
    ['ja.wikipedia.org', cleanDisplayTitle(anime.title?.native)],
    ['en.wikipedia.org', cleanDisplayTitle(anime.title?.english)]
  ].filter((pair) => pair[1] && pair[1].length >= 2);

  let networkError = null;
  for (const [host, title] of candidates) {
    try {
      const zh = await pooled(() => wikipediaLanglink(host, title));
      if (zh && zh !== title && HAS_HAN.test(zh)) return zh;
    } catch (err) {
      networkError = err;
    }
  }
  if (networkError) throw networkError;
  return null;
}

// ---- machine translation fallback -----------------------------------------
async function resolveViaMachine(anime) {
  if (!machineTranslator) return null;
  const sources = [anime.title?.native, anime.title?.english, anime.title?.romaji]
    .map(cleanDisplayTitle)
    .filter((s, i, a) => s && a.indexOf(s) === i);
  for (const src of sources) {
    try {
      const out = cleanDisplayTitle(await pooled(() => machineTranslator(src, 'zh-TW')));
      // Accept only a real Chinese rendering (must contain Han and differ from the input)
      if (out && out !== src && HAS_HAN.test(out) && !/QUERY LENGTH|MYMEMORY/i.test(out)) {
        return out;
      }
    } catch {
      /* try next source */
    }
  }
  return null;
}

// ---- main resolver ---------------------------------------------------------
const inflight = new Map();

export function resolveTitleZh(anime) {
  const idKey = String(anime?.id || '');
  if (!idKey) return Promise.resolve(null);
  if (titleCache.has(idKey)) {
    const cached = titleCache.get(idKey);
    if (entryMatchesAnime(cached, anime)) return Promise.resolve(cached);
    // Cached translation belongs to another anime (legacy poisoning): drop it, re-resolve.
    titleCache.delete(idKey);
    persistDiskCache();
  }
  if (negativeCache.has(idKey)) return Promise.resolve(null);
  if (inflight.has(idKey)) return inflight.get(idKey);

  const job = (async () => {
    let entry = resolveSync(anime);
    let transientFailure = false;

    if (!entry) {
      let bgm = null;
      try {
        bgm = await resolveViaBangumi(anime);
      } catch {
        transientFailure = true;
      }
      if (bgm?.nameCn) {
        entry = makeEntry(bgm.nameCn, 'bangumi', anime, {
          bgmId: bgm.bgmId,
          summaryTw: bgm.summary ? s2tw(decodeEntities(bgm.summary)) : '',
          summaryCn: bgm.summary ? s2cn(decodeEntities(bgm.summary)) : ''
        });
      } else {
        let wikiZh = null;
        try {
          wikiZh = await resolveViaWikipedia(anime);
        } catch {
          /* fall through to machine translation */
        }
        if (wikiZh) {
          entry = makeEntry(wikiZh, 'wikipedia', anime, bgm?.bgmId ? { bgmId: bgm.bgmId } : {});
        } else {
          const mt = await resolveViaMachine(anime);
          if (mt) {
            entry = makeEntry(mt, 'mt', anime, bgm?.bgmId ? { bgmId: bgm.bgmId } : {});
          }
        }
      }
    }

    if (entry) {
      titleCache.set(idKey, entry);
      persistDiskCache();
    } else if (transientFailure) {
      negativeCache.set(idKey, true); // retry in 10 minutes, never persisted
    }
    return entry;
  })().finally(() => inflight.delete(idKey));

  inflight.set(idKey, job);
  return job;
}

/** Cache-only lookup by AniList id (used by the client title patch endpoint). */
export function getCachedTitleEntry(animeId) {
  if (!animeId) return null;
  const cached = titleCache.get(String(animeId));
  if (!cached) return null;
  return { titleZhTW: cached.tw || '', titleZhCN: cached.cn || '' };
}

/** Synchronous lookup; kicks off a background resolve on a miss. */
export function getCachedChineseTitle(anime) {
  if (!anime) return null;
  const idKey = String(anime.id || '');
  if (idKey && titleCache.has(idKey)) {
    const cached = titleCache.get(idKey);
    if (entryMatchesAnime(cached, anime)) return cached;
    titleCache.delete(idKey);
    persistDiskCache();
  }
  const sync = resolveSync(anime);
  if (sync) {
    if (idKey) {
      titleCache.set(idKey, sync);
      persistDiskCache();
    }
    return sync;
  }
  resolveTitleZh(anime).catch(() => {});
  return null;
}

function applyEntry(anime, zh) {
  const base = { ...anime };
  if (base.title) {
    base.title = {
      ...base.title,
      english: cleanDisplayTitle(base.title.english) || base.title.english,
      romaji: cleanDisplayTitle(base.title.romaji) || base.title.romaji,
      native: cleanDisplayTitle(base.title.native) || base.title.native
    };
  }
  if (zh) {
    return {
      ...base,
      titleZhTW: zh.tw,
      titleZhCN: zh.cn,
      titleZh: zh.tw,
      titleZhSource: zh.source,
      titleZhKey: titleFingerprint(anime),
      titleZhStatus: 'ok',
      summaryZh: zh.summaryTw || '',
      summaryZhTW: zh.summaryTw || '',
      summaryZhCN: zh.summaryCn || ''
    };
  }

  // Nothing validated in this pass. A stored translation is only kept when it is
  // provably the one this anime resolved to before; otherwise it is a legacy value
  // that may belong to a completely different show -> drop it rather than display it.
  const fingerprint = titleFingerprint(anime);
  const storedKey = anime?.titleZhKey;
  const hasStored = !!(anime?.titleZhTW || anime?.titleZhCN || anime?.titleZh);
  if (hasStored && storedKey && storedKey === fingerprint) {
    return { ...base, titleZhKey: fingerprint, titleZhStatus: 'ok' };
  }
  if (hasStored) {
    delete base.titleZhTW;
    delete base.titleZhCN;
    delete base.titleZh;
    delete base.titleZhSource;
    delete base.summaryZh;
    delete base.summaryZhTW;
    delete base.summaryZhCN;
  }
  return { ...base, titleZhKey: fingerprint, titleZhStatus: 'pending' };
}

/** Synchronous enrichment from whatever is already resolved. */
export function enrichWithChineseTitles(animeList) {
  if (!Array.isArray(animeList)) return animeList;
  return animeList.map((anime) => (anime ? applyEntry(anime, getCachedChineseTitle(anime)) : anime));
}

/**
 * Enrichment that waits (up to budgetMs) for unresolved titles so the first response is already translated.
 * Anything still pending continues in the background and is served from cache next time.
 */
export async function enrichWithChineseTitlesAsync(animeList, { budgetMs = 2500 } = {}) {
  if (!Array.isArray(animeList)) return animeList;
  const pending = animeList
    .filter((a) => a && !titleCache.has(String(a.id || '')) && !resolveSync(a))
    .map((a) => resolveTitleZh(a).catch(() => null));
  if (pending.length > 0) {
    let timer;
    await Promise.race([
      Promise.allSettled(pending),
      new Promise((resolve) => { timer = setTimeout(resolve, budgetMs); })
    ]);
    clearTimeout(timer);
  }
  return enrichWithChineseTitles(animeList);
}

loadDiskCache();
reloadTitleOverrides(true);
