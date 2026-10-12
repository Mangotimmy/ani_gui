// server/services/db.js - Resilient Embedded Storage (Native SQLite with zero-crash fallback)
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Data directory at project server/data
const DATA_DIR = path.resolve(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'aniflix.db');
const FALLBACK_JSON_PATH = path.join(DATA_DIR, 'aniflix_store.json');
const SEARCH_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Pre-populate common anime aliases and abbreviations
const SEED_ALIASES = [
  { alias: 'sao', canonical: 'Sword Art Online', romaji: 'Sword Art Online', chinese: '刀劍神域', franchise: 'Sword Art Online' },
  { alias: 'konosuba', canonical: 'KonoSuba: God\'s Blessing on this Wonderful World!', romaji: 'Kono Subarashii Sekai ni Shukufuku wo!', chinese: '為美好的世界獻上祝福！', franchise: 'KonoSuba' },
  { alias: 'aot', canonical: 'Attack on Titan', romaji: 'Shingeki no Kyojin', chinese: '進擊的巨人', franchise: 'Attack on Titan' },
  { alias: 'snk', canonical: 'Attack on Titan', romaji: 'Shingeki no Kyojin', chinese: '進擊的巨人', franchise: 'Attack on Titan' },
  { alias: 'opm', canonical: 'One Punch Man', romaji: 'One Punch Man', chinese: '一拳超人', franchise: 'One Punch Man' },
  { alias: 'mha', canonical: 'My Hero Academia', romaji: 'Boku no Hero Academia', chinese: '我的英雄學院', franchise: 'My Hero Academia' },
  { alias: 'bnha', canonical: 'My Hero Academia', romaji: 'Boku no Hero Academia', chinese: '我的英雄學院', franchise: 'My Hero Academia' },
  { alias: 'jjk', canonical: 'Jujutsu Kaisen', romaji: 'Jujutsu Kaisen', chinese: '咒術迴戰', franchise: 'Jujutsu Kaisen' },
  { alias: 'ds', canonical: 'Demon Slayer', romaji: 'Kimetsu no Yaiba', chinese: '鬼滅之刃', franchise: 'Demon Slayer' },
  { alias: 'kny', canonical: 'Demon Slayer', romaji: 'Kimetsu no Yaiba', chinese: '鬼滅之刃', franchise: 'Demon Slayer' },
  { alias: 'fma', canonical: 'Fullmetal Alchemist', romaji: 'Hagane no Renkinjutsushi', chinese: '鋼之鍊金術師', franchise: 'Fullmetal Alchemist' },
  { alias: 'fmab', canonical: 'Fullmetal Alchemist: Brotherhood', romaji: 'Hagane no Renkinjutsushi: Brotherhood', chinese: '鋼之鍊金術師 FULLMETAL ALCHEMIST', franchise: 'Fullmetal Alchemist' },
  { alias: 'csm', canonical: 'Chainsaw Man', romaji: 'Chainsaw Man', chinese: '鏈鋸人', franchise: 'Chainsaw Man' },
  { alias: 'rezero', canonical: 'Re:Zero - Starting Life in Another World', romaji: 'Re:Zero kara Hajimeru Isekai Seikatsu', chinese: 'Re:從零開始的異世界生活', franchise: 'Re:Zero' },
  { alias: 'oregairu', canonical: 'My Teen Romantic Comedy SNAFU', romaji: 'Yahari Ore no Seishun Love Come wa Machigatteiru.', chinese: '果然我的青春戀愛喜劇搞錯了。', franchise: 'Oregairu' },
  { alias: 'danmachi', canonical: 'Is It Wrong to Try to Pick Up Girls in a Dungeon?', romaji: 'Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka', chinese: '在地下城尋求邂逅是否搞錯了什麼', franchise: 'Danmachi' },
  { alias: 'bocchi', canonical: 'BOCCHI THE ROCK!', romaji: 'Bocchi the Rock!', chinese: '孤獨搖滾！', franchise: 'Bocchi the Rock!' },
  { alias: 'frieren', canonical: 'Frieren: Beyond Journey\'s End', romaji: 'Sousou no Frieren', chinese: '葬送的芙莉蓮', franchise: 'Frieren' },
  { alias: 'slime', canonical: 'That Time I Got Reincarnated as a Slime', romaji: 'Tensei shitara Slime Datta Ken', chinese: '關於我轉生變成史萊姆這檔事', franchise: 'That Time I Got Reincarnated as a Slime' },
  { alias: 'tensura', canonical: 'That Time I Got Reincarnated as a Slime', romaji: 'Tensei shitara Slime Datta Ken', chinese: '關於我轉生變成史萊姆這檔事', franchise: 'That Time I Got Reincarnated as a Slime' },
  { alias: 'mushoku', canonical: 'Mushoku Tensei: Jobless Reincarnation', romaji: 'Mushoku Tensei: Isekai Ittara Honki Dasu', chinese: '無職轉生～到了異世界就拿出真本事～', franchise: 'Mushoku Tensei' },
  { alias: 'oshi no ko', canonical: 'Oshi no Ko', romaji: 'Oshi no Ko', chinese: '【我推的孩子】', franchise: 'Oshi no Ko' },
  { alias: 'bleach', canonical: 'Bleach', romaji: 'Bleach', chinese: '死神 / BLEACH 千年血戰篇', franchise: 'Bleach' },
  { alias: 'naruto', canonical: 'Naruto', romaji: 'Naruto', chinese: '火影忍者', franchise: 'Naruto' },
  { alias: 'one piece', canonical: 'One Piece', romaji: 'One Piece', chinese: '航海王 / 海賊王', franchise: 'One Piece' },
  { alias: 'gintama', canonical: 'Gintama', romaji: 'Gintama', chinese: '銀魂', franchise: 'Gintama' },
  { alias: 'eva', canonical: 'Neon Genesis Evangelion', romaji: 'Shin Seiki Evangelion', chinese: '新世紀福音戰士', franchise: 'Evangelion' }
];

// Fallback in-memory stores
const fallbackAliases = new Map();
const fallbackSearchCache = new Map();
const fallbackStudioCache = new Map();

for (const a of SEED_ALIASES) {
  fallbackAliases.set(a.alias.toLowerCase(), a);
}

// Debounced persistence helper for fallback mode
let saveTimeout = null;
function persistFallbackStore() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      const data = {
        aliases: Object.fromEntries(fallbackAliases),
        searchCache: Object.fromEntries(fallbackSearchCache),
        studioCache: Object.fromEntries(fallbackStudioCache)
      };
      fs.writeFileSync(FALLBACK_JSON_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch {}
  }, 1500);
}

// Attempt to load persisted fallback store if present
try {
  if (fs.existsSync(FALLBACK_JSON_PATH)) {
    const raw = fs.readFileSync(FALLBACK_JSON_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed.aliases) {
      for (const [k, v] of Object.entries(parsed.aliases)) {
        fallbackAliases.set(k.toLowerCase(), v);
      }
    }
    if (parsed.searchCache) {
      for (const [k, v] of Object.entries(parsed.searchCache)) {
        fallbackSearchCache.set(k.toLowerCase(), v);
      }
    }
    if (parsed.studioCache) {
      for (const [k, v] of Object.entries(parsed.studioCache)) {
        fallbackStudioCache.set(k.toLowerCase(), v);
      }
    }
  }
} catch {}

// Dynamically attempt to load native node:sqlite
let DatabaseSync = null;
try {
  const sqliteModule = await import('node:sqlite');
  DatabaseSync = sqliteModule.DatabaseSync || sqliteModule.default?.DatabaseSync || null;
} catch (err) {
  // node:sqlite is only available on Node.js v22.5.0+ and v24+
}

let db = null;
let isNativeSqlite = false;
let getAliasStmt = null;
let getAllAliasesStmt = null;
let getSearchCacheStmt = null;
let setSearchCacheStmt = null;
let deleteExpiredSearchStmt = null;

if (DatabaseSync) {
  try {
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
    isNativeSqlite = true;
  } catch (err) {
    console.warn('[SQLite] Failed to open disk database, falling back to in-memory SQLite:', err.message);
    try {
      db = new DatabaseSync(':memory:');
      isNativeSqlite = true;
    } catch {}
  }
}

if (isNativeSqlite && db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS aliases (
        alias TEXT PRIMARY KEY,
        canonical TEXT NOT NULL,
        romaji TEXT,
        chinese TEXT,
        franchise TEXT
      );

      CREATE TABLE IF NOT EXISTS search_cache (
        query TEXT PRIMARY KEY,
        results_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS studio_cache (
        studio TEXT PRIMARY KEY,
        data_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    const insertAliasStmt = db.prepare(`
      INSERT OR REPLACE INTO aliases (alias, canonical, romaji, chinese, franchise)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const a of SEED_ALIASES) {
      insertAliasStmt.run(a.alias.toLowerCase(), a.canonical, a.romaji, a.chinese, a.franchise);
    }

    getAliasStmt = db.prepare('SELECT * FROM aliases WHERE alias = ?');
    getAllAliasesStmt = db.prepare('SELECT * FROM aliases');
    getSearchCacheStmt = db.prepare('SELECT results_json, updated_at FROM search_cache WHERE query = ?');
    setSearchCacheStmt = db.prepare('INSERT OR REPLACE INTO search_cache (query, results_json, updated_at) VALUES (?, ?, ?)');
    deleteExpiredSearchStmt = db.prepare('DELETE FROM search_cache WHERE updated_at < ?');
    console.log('[DB] Native Node.js SQLite (WAL mode) successfully initialized.');
  } catch (e) {
    console.warn('[SQLite] Table initialization warning:', e.message);
  }
} else {
  console.log(`[DB] Running on Node ${process.version} without native node:sqlite. Using resilient persistent fallback store.`);
}

export function lookupAlias(rawAlias) {
  if (!rawAlias) return null;
  const clean = rawAlias.trim().toLowerCase();
  if (isNativeSqlite && getAliasStmt) {
    try {
      return getAliasStmt.get(clean) || null;
    } catch (e) {
      console.warn('[SQLite] Error looking up alias:', e.message);
    }
  }
  return fallbackAliases.get(clean) || null;
}

export function getAllAliases() {
  if (isNativeSqlite && getAllAliasesStmt) {
    try {
      return getAllAliasesStmt.all();
    } catch (e) {
      console.warn('[SQLite] Error fetching all aliases:', e.message);
    }
  }
  return Array.from(fallbackAliases.values());
}

export function getCachedSearch(query) {
  if (!query) return null;
  const key = query.trim().toLowerCase();
  if (isNativeSqlite && getSearchCacheStmt) {
    try {
      const row = getSearchCacheStmt.get(key);
      if (!row) return null;
      if (Date.now() - Number(row.updated_at) > SEARCH_TTL_MS) {
        return null;
      }
      return JSON.parse(row.results_json);
    } catch {
      return null;
    }
  }

  const item = fallbackSearchCache.get(key);
  if (!item) return null;
  if (Date.now() - Number(item.updatedAt || item.updated_at || 0) > SEARCH_TTL_MS) {
    fallbackSearchCache.delete(key);
    return null;
  }
  return item.results || item;
}

export function setCachedSearch(query, results) {
  if (!query || !results) return;
  const key = query.trim().toLowerCase();
  if (isNativeSqlite && setSearchCacheStmt) {
    try {
      setSearchCacheStmt.run(key, JSON.stringify(results), Date.now());
      return;
    } catch (e) {
      console.warn('[SQLite] Error saving search cache:', e.message);
    }
  }

  fallbackSearchCache.set(key, { results, updatedAt: Date.now() });
  persistFallbackStore();
}

export function cleanExpiredCache() {
  if (isNativeSqlite && deleteExpiredSearchStmt) {
    try {
      const expiry = Date.now() - SEARCH_TTL_MS;
      deleteExpiredSearchStmt.run(expiry);
      return;
    } catch {}
  }

  const now = Date.now();
  let changed = false;
  for (const [k, item] of fallbackSearchCache.entries()) {
    if (now - Number(item.updatedAt || 0) > SEARCH_TTL_MS) {
      fallbackSearchCache.delete(k);
      changed = true;
    }
  }
  if (changed) persistFallbackStore();
}

export default {
  lookupAlias,
  getAllAliases,
  getCachedSearch,
  setCachedSearch,
  cleanExpiredCache
};
