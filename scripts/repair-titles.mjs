#!/usr/bin/env node
// scripts/repair-titles.mjs - One-shot repair of poisoned Chinese anime titles.
//
// Why this exists: the v1 title cache was keyed by title TEXT, so a translation resolved
// for one anime could be stored under - and served for - a completely different anime
// (e.g. id 214968 "Nezumi-kun no Chokki 2nd Season" ended up titled "葬送的芙莉蓮 第二季").
// Those wrong values were persisted into the user profiles and were then re-served forever.
//
// This script re-resolves every stored anime title through the validated v3 pipeline
// (dictionary -> identity + season checked Bangumi match -> machine translation) and
// rewrites the profile fields with a matching identity key.
//
//   node scripts/repair-titles.mjs            # repair (writes backups first)
//   node scripts/repair-titles.mjs --dry-run  # report only, touch nothing
//
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveTitleZh, titleFingerprint } from '../server/services/chineseTitleService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');
const CONCURRENCY = 4;

const dataDir = process.env.ANIFLIX_DATA_DIR || path.join(ROOT, 'data');
const userDirs = [path.join(dataDir, 'users')];
const legacyDir = path.join(ROOT, 'server', 'data', 'users');
if (!userDirs.includes(legacyDir)) userDirs.push(legacyDir);

function listProfileFiles() {
  const files = [];
  for (const dir of userDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith('.json')) files.push(path.join(dir, name));
    }
  }
  return files;
}

/** Every anime object a profile stores, in place. */
function collectAnime(profile) {
  const found = [];
  if (Array.isArray(profile.favorites)) for (const f of profile.favorites) if (f && f.id) found.push(f);
  if (Array.isArray(profile.watchHistory)) {
    for (const h of profile.watchHistory) if (h && h.anime && h.anime.id) found.push(h.anime);
  }
  return found;
}

function needsRepair(anime) {
  const fingerprint = titleFingerprint(anime);
  const has = !!(anime.titleZhTW || anime.titleZhCN || anime.titleZh);
  return !has || anime.titleZhKey !== fingerprint || anime.titleZhStatus !== 'ok';
}

async function pooled(items, worker, limit = CONCURRENCY) {
  const queue = items.slice();
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function main() {
  const files = listProfileFiles();
  if (files.length === 0) {
    console.log('[repair-titles] No user profiles found under: ' + userDirs.join(', '));
    return;
  }
  console.log(`[repair-titles] ${DRY_RUN ? 'DRY RUN - ' : ''}${files.length} profile(s) found.`);

  let totalEntries = 0;
  let repaired = 0;
  let unresolved = 0;
  let profilesChanged = 0;

  for (const file of files) {
    let profile;
    try {
      profile = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (err) {
      console.warn(`[repair-titles] Skipping unreadable ${path.basename(file)}: ${err.message}`);
      continue;
    }

    const animeList = collectAnime(profile);
    totalEntries += animeList.length;
    const broken = animeList.filter(needsRepair);
    if (broken.length === 0) {
      console.log(`[repair-titles] ${path.basename(file)}: ${animeList.length} entries, all already validated.`);
      continue;
    }

    console.log(`[repair-titles] ${path.basename(file)}: repairing ${broken.length}/${animeList.length} entries...`);

    // Resolve each distinct anime once, then apply to every occurrence.
    const byId = new Map();
    for (const anime of broken) {
      const key = String(anime.id);
      if (!byId.has(key)) byId.set(key, { anime, copies: [] });
      byId.get(key).copies.push(anime);
    }

    const results = new Map();
    await pooled([...byId.entries()], async ([key, { anime }]) => {
      let entry = null;
      try {
        entry = await resolveTitleZh(anime);
      } catch (err) {
        console.warn(`[repair-titles] resolve failed for id ${key}: ${err.message}`);
      }
      results.set(key, entry);
    });

    for (const [key, { copies }] of byId.entries()) {
      const entry = results.get(key);
      for (const anime of copies) {
        const fingerprint = titleFingerprint(anime);
        if (entry) {
          const before = anime.titleZhTW || anime.titleZh || '';
          anime.titleZhTW = entry.tw;
          anime.titleZhCN = entry.cn;
          anime.titleZh = entry.tw;
          anime.titleZhSource = entry.source;
          anime.titleZhKey = fingerprint;
          anime.titleZhStatus = 'ok';
          if (entry.summaryTw || entry.summaryCn) {
            anime.summaryZh = entry.summaryTw || entry.summaryCn || '';
            anime.summaryZhTW = entry.summaryTw || '';
            anime.summaryZhCN = entry.summaryCn || '';
          }
          if (before !== entry.tw) {
            console.log(`  id ${key}: "${before || '(none)'}" -> "${entry.tw}" [${entry.source}]`);
          }
          repaired++;
        } else {
          // No validated translation available: drop the untrustworthy value rather than
          // keep showing a name that may belong to another anime.
          if (anime.titleZhTW || anime.titleZhCN || anime.titleZh) {
            console.log(`  id ${key}: dropped unverifiable title "${anime.titleZhTW || anime.titleZh}"`);
          }
          delete anime.titleZhTW;
          delete anime.titleZhCN;
          delete anime.titleZh;
          delete anime.titleZhSource;
          delete anime.summaryZh;
          delete anime.summaryZhTW;
          delete anime.summaryZhCN;
          anime.titleZhKey = fingerprint;
          anime.titleZhStatus = 'pending';
          unresolved++;
        }
      }
    }

    profilesChanged++;
    if (DRY_RUN) {
      console.log(`[repair-titles] ${path.basename(file)}: dry run, not written.`);
      continue;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(file, `${file}.${stamp}.bak`);
    fs.writeFileSync(file, JSON.stringify(profile, null, 2), 'utf-8');
    console.log(`[repair-titles] ${path.basename(file)}: written (backup: ${path.basename(file)}.${stamp}.bak)`);
  }

  console.log(
    `[repair-titles] Done. entries=${totalEntries} resolved=${repaired} unresolved=${unresolved} profiles=${profilesChanged}${DRY_RUN ? ' (dry run)' : ''}`
  );
}

main().catch((err) => {
  console.error('[repair-titles] Fatal:', err);
  process.exitCode = 1;
});
