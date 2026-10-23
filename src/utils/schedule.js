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
