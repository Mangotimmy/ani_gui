// server/services/migrateData.js - One-way, non-destructive data migration
//
// 2.6.0 moved every persistent path (SQLite DB, user profiles, media cache) under
// ANIFLIX_DATA_DIR. Existing installs may still have that data in the legacy locations:
//   * <server>/data          (repository checkout)
//   * <cwd>/data             (older desktop builds, which resolved users against cwd)
//
// This module copies anything missing into the new data directory once, without ever
// overwriting newer files, so upgrading does not lose favourites, history or comments.
import fs from 'fs';
import path from 'path';
import { DATA_DIR, SERVER_ROOT } from './paths.js';

const CANDIDATE_LEGACY_DIRS = [
  path.join(SERVER_ROOT, 'data'),
  path.join(process.cwd(), 'data')
];

const ENTRIES = [
  'aniflix.db',
  'aniflix.db-wal',
  'aniflix.db-shm',
  'aniflix_store.json',
  'chinese_titles_cache.json',
  'title_overrides.json',
  'settings.json'
];

const SUB_DIRECTORIES = ['users', 'comments'];

function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

function copyFileIfMissing(sourceFile, destinationFile) {
  try {
    if (!fs.existsSync(sourceFile) || fs.existsSync(destinationFile)) return false;
    fs.copyFileSync(sourceFile, destinationFile);
    return true;
  } catch {
    return false;
  }
}

export function migrateLegacyData() {
  const target = path.resolve(DATA_DIR);
  const summary = { target, copied: [] };

  // When the data dir is the legacy server/data there is nothing to migrate.
  const legacyDirs = CANDIDATE_LEGACY_DIRS
    .map(dir => path.resolve(dir))
    .filter(dir => dir !== target && fs.existsSync(dir));

  if (legacyDirs.length === 0) return summary;
  if (!ensureDir(target)) return summary;

  for (const legacy of legacyDirs) {
    for (const entry of ENTRIES) {
      if (copyFileIfMissing(path.join(legacy, entry), path.join(target, entry))) {
        summary.copied.push(path.join(legacy, entry));
      }
    }
    for (const sub of SUB_DIRECTORIES) {
      const legacySub = path.join(legacy, sub);
      if (!fs.existsSync(legacySub)) continue;
      ensureDir(path.join(target, sub));
      let files = [];
      try {
        files = fs.readdirSync(legacySub).filter(name => name.endsWith('.json'));
      } catch {
        continue;
      }
      for (const name of files) {
        if (copyFileIfMissing(path.join(legacySub, name), path.join(target, sub, name))) {
          summary.copied.push(path.join(legacySub, name));
        }
      }
    }
  }

  if (summary.copied.length > 0) {
    console.log(`[DataMigration] Copied ${summary.copied.length} legacy file(s) into ${target}`);
  }
  return summary;
}

// Run on import, before the database / cache modules open their handles.
migrateLegacyData();

export default migrateLegacyData;
