// src/utils/titles.js - Single source of truth for localized anime titles.
//
// Before this helper every component had its own fallback chain and most of them put
// `title.native` (Japanese) before English/romaji. A Chinese UI therefore showed kanji
// whenever the Chinese title had not been resolved yet. The order below keeps the
// requested language first and only falls back to Japanese last.
import { toCachedImageUrl } from './image.js';

function chineseTw(anime) {
  return anime?.titleZhTW || anime?.titleZh || anime?.titleZhCN || anime?.title?.chinese || '';
}

function chineseCn(anime) {
  return anime?.titleZhCN || anime?.titleZh || anime?.titleZhTW || anime?.title?.chinese || '';
}

/**
 * Localized display title for a list/card/hero.
 * zh-TW / zh-CN -> resolved Chinese; missing Chinese falls back to English, then romaji,
 * and only then the Japanese native title (the previous behaviour, reversed).
 */
export function pickAnimeTitle(anime, lang = 'zh-TW') {
  if (!anime) return '';
  const t = anime.title || {};
  let title = '';
  if (lang === 'ja') title = t.native || t.romaji || t.english;
  else if (lang === 'zh-CN') title = chineseCn(anime) || t.english || t.romaji || t.native;
  else if (lang === 'zh-TW') title = chineseTw(anime) || t.english || t.romaji || t.native;
  else title = t.english || t.romaji || t.native;
  return (title || '').trim();
}

/** Secondary title shown next to the localized one (never duplicates it). */
export function pickAnimeAltTitle(anime, lang = 'zh-TW') {
  if (!anime) return '';
  const primary = pickAnimeTitle(anime, lang);
  const t = anime.title || {};
  const pool = lang === 'ja'
    ? [t.romaji, t.english, chineseTw(anime)]
    : [t.romaji, t.english, t.native];
  return pool.find(candidate => candidate && candidate !== primary) || '';
}

/** Title used in notifications / toasts. */
export function titleForNotification(anime) {
  if (!anime) return '動漫';
  return chineseTw(anime) || anime?.title?.english || anime?.title?.romaji || anime?.title?.native || '動漫';
}

/** Synopsis for the detail sheet, honest about untranslated content. */
export function pickSynopsis(anime, chineseInfo, lang, synopsisLang = 'zh') {
  const original = (anime?.description || '').replace(/<[^>]*>/g, '').trim();
  if (lang !== 'zh-TW' && lang !== 'zh-CN') return original;
  if (synopsisLang === 'zh' && chineseInfo?.summaryZh && chineseInfo?.summaryOk !== false) {
    return chineseInfo.summaryZh;
  }
  return original;
}

/** Poster URL helper re-exported so cards share one cache path. */
export function coverUrl(anime) {
  return toCachedImageUrl(
    typeof anime?.coverImage === 'string'
      ? anime.coverImage
      : anime?.coverImage?.large || anime?.coverImage?.medium || anime?.image || ''
  );
}
