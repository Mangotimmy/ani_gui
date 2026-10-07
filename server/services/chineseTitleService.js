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

// In-memory bounded cache: animeId (or normalized title) -> { tw, cn }
const titleCache = new BoundedCache(3000, 7 * 24 * 60 * 60 * 1000);

// Load persistent disk cache
function loadDiskCache() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      for (const [k, v] of Object.entries(parsed)) {
        titleCache.set(k, v);
      }
    }
  } catch (err) {
    console.warn('[ChineseTitleService] Failed to load disk cache:', err.message);
  }
}

// Save persistent disk cache debounced
let saveTimeout = null;
function persistDiskCache() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const obj = {};
      for (const [k, v] of titleCache.entries()) {
        obj[k] = v;
      }
      fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[ChineseTitleService] Failed to save disk cache:', err.message);
    }
  }, 2000);
}

loadDiskCache();

function normalizeTitle(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Resolves Chinese title for an anime item.
 * Synchronously returns cached/dictionary value or schedules background fetch.
 */
export function getCachedChineseTitle(anime) {
  if (!anime) return null;
  const idKey = String(anime.id || '');
  if (idKey && titleCache.has(idKey)) {
    return titleCache.get(idKey);
  }

  const eng = normalizeTitle(anime.title?.english);
  const rom = normalizeTitle(anime.title?.romaji);

  // Check pre-seeded dictionary
  for (const [key, val] of Object.entries(POPULAR_TITLES_ZH)) {
    const normKey = normalizeTitle(key);
    if ((eng && (eng === normKey || eng.startsWith(normKey))) ||
        (rom && (rom === normKey || rom.startsWith(normKey)))) {
      if (idKey) {
        titleCache.set(idKey, val);
        persistDiskCache();
      }
      return val;
    }
  }

  // Check titleCache with eng/rom key
  if (eng && titleCache.has(eng)) return titleCache.get(eng);
  if (rom && titleCache.has(rom)) return titleCache.get(rom);

  // Trigger background resolution
  resolveInBackground(anime);
  return null;
}

// Background resolution queue to avoid bursting Bangumi API
const pendingResolves = new Set();
async function resolveInBackground(anime) {
  const idKey = String(anime.id || '');
  if (!idKey || pendingResolves.has(idKey)) return;
  pendingResolves.add(idKey);

  const searchTarget = anime.title?.native || anime.title?.romaji || anime.title?.english;
  if (!searchTarget) return;

  try {
    const url = `https://api.bgm.tv/search/subject/${encodeURIComponent(searchTarget)}?type=2&responseGroup=small`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AniFlix/2.0 (contact: github.com/Atszl/aniflix)' }
    });
    if (res.ok) {
      const data = await res.json();
      const top = (data.list || [])[0];
      if (top) {
        const rawName = top.name_cn || top.name;
        const rawSummary = top.summary || '';
        if (rawName) {
          const tw = s2tw(rawName);
          const cn = s2cn(rawName);
          const entry = { 
            tw, 
            cn,
            summaryTw: rawSummary ? s2tw(rawSummary) : '',
            summaryCn: rawSummary ? s2cn(rawSummary) : ''
          };
          titleCache.set(idKey, entry);
          if (anime.title?.english) titleCache.set(normalizeTitle(anime.title.english), entry);
          if (anime.title?.romaji) titleCache.set(normalizeTitle(anime.title.romaji), entry);
          persistDiskCache();
        }
      }
    }
  } catch (err) {
    // Ignore background fetch error
  } finally {
    pendingResolves.delete(idKey);
  }
}

/**
 * Enriches an array of anime objects with Chinese titles
 */
export function enrichWithChineseTitles(animeList) {
  if (!Array.isArray(animeList)) return animeList;

  return animeList.map(anime => {
    if (!anime) return anime;
    const zh = getCachedChineseTitle(anime);
    if (zh) {
      return {
        ...anime,
        titleZhTW: zh.tw,
        titleZhCN: zh.cn,
        titleZh: zh.tw,
        summaryZh: zh.summaryTw || '',
        summaryZhTW: zh.summaryTw || '',
        summaryZhCN: zh.summaryCn || ''
      };
    }
    return anime;
  });
}
