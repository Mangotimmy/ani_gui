// src/utils/schedule.js - Helpers for the weekly airing schedule
import { getAnimeCoverUrl } from './image.js';
import { pickAnimeTitle } from './titles.js';

/** Monday 00:00 (local) of the week containing `date`. */
export function getWeekStart(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (d.getDay() + 6) % 7; // Mon=0 ... Sun=6
  d.setDate(d.getDate() - offset);
  return d;
}

/** Returns { start, end } unix seconds for the local Mon-Sun week. */
export function getWeekRange(date = new Date()) {
  const start = getWeekStart(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start: Math.floor(start.getTime() / 1000), end: Math.floor(end.getTime() / 1000) };
}

/** Returns { start, end } unix seconds for the local calendar day. */
export function getDayRange(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: Math.floor(start.getTime() / 1000), end: Math.floor(end.getTime() / 1000) };
}

/** Day index 0..6 (Mon..Sun) for a unix-seconds timestamp, in local time. */
export function dayIndexOf(unixSeconds) {
  return (new Date(unixSeconds * 1000).getDay() + 6) % 7;
}

export async function fetchSchedule(start, end, signal) {
  const res = await fetch(`/api/schedule?start=${start}&end=${end}`, { signal });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Schedule request failed');
  return json.data || [];
}

export function pickTitle(anime, lang) {
  // Shared ordering: Chinese -> English -> romaji -> Japanese native.
  return pickAnimeTitle(anime, lang);
}

export function pickCover(anime) {
  return getAnimeCoverUrl ? getAnimeCoverUrl(anime) : anime?.coverImage?.large || '';
}

export function formatAirTime(unixSeconds, lang) {
  return new Intl.DateTimeFormat(lang === 'zh-TW' ? 'zh-TW' : lang, {
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(unixSeconds * 1000));
}

/**
 * Return a live nextAiringEpisode object only if the episode has NOT aired yet,
 * recomputing `timeUntilAiring` dynamically from `airingAt` instead of trusting
 * stale snapshot values cached earlier.
 */
export function getActiveNextAiring(anime, nowSec = Math.floor(Date.now() / 1000)) {
  const next = anime?.nextAiringEpisode;
  if (!next || !next.episode) return null;
  if (typeof next.airingAt === 'number') {
    const remaining = next.airingAt - nowSec;
    if (remaining <= 0) return null;
    return { ...next, timeUntilAiring: remaining };
  }
  if (typeof next.timeUntilAiring === 'number' && next.timeUntilAiring > 0) {
    return next;
  }
  return null;
}

/**
 * Maximum episode number known to have aired, ignoring expired nextAiringEpisode snapshots.
 */
export function getMaxAiredCap(anime, nowSec = Math.floor(Date.now() / 1000)) {
  const active = getActiveNextAiring(anime, nowSec);
  return (active?.episode && active.episode > 1) ? (active.episode - 1) : undefined;
}

/**
 * Format remaining seconds until airing (e.g. "2d 3h", "5h 20m", "15m", "< 1m").
 */
export function formatTimeUntilAiring(secs) {
  if (typeof secs !== 'number' || !Number.isFinite(secs) || secs <= 0) return 'Soon';
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  if (mins > 0) return `${mins}m`;
  return '< 1m';
}
