// src/components/ScheduleView.jsx - Weekly (Mon-Sun) anime release timetable
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { CalendarDays, Loader2, RefreshCw } from 'lucide-react';
import {
  getWeekRange, getWeekStart, dayIndexOf, fetchSchedule,
  pickTitle, pickCover, formatAirTime
} from '../utils/schedule.js';
import { formatEpisode } from '../utils/i18nSchedule.js';

function ScheduleItem({ item, lang, nowSec, onOpen, t }) {
  const title = pickTitle(item.media, lang);
  const aired = item.airingAt <= nowSec;
  return (
    <button
      type="button"
      onClick={() => onOpen(item.media)}
      className="schedule-item group w-full flex items-center gap-3 p-2 rounded-xl bg-zinc-900/70 border border-white/[0.06] text-left transition-[background-color,scale] duration-150 enabled:active:scale-[0.96] hover:bg-zinc-800/80"
    >
      <img
        src={pickCover(item.media)}
        alt=""
        width="44"
        height="62"
        loading="lazy"
        decoding="async"
        className="w-11 h-[62px] rounded-md object-cover shrink-0 bg-zinc-800 outline outline-1 -outline-offset-1 outline-white/10"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-bold text-white line-clamp-2 text-pretty">{title}</span>
        <span className="mt-1 flex items-center gap-2 text-[11px] text-zinc-400">
          <span className="font-semibold text-cyan-300 tabular-nums">{formatAirTime(item.airingAt, lang)}</span>
          <span aria-hidden="true">·</span>
          <span>{formatEpisode(lang, item.episode)}</span>
          {aired && (
            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-400">{t('aired')}</span>
          )}
        </span>
      </span>
    </button>
  );
}

export default function ScheduleView({ currentLang = 'zh-TW', t, onOpenAnime }) {
  const weekStart = useMemo(() => getWeekStart(), []);
  const todayIdx = (new Date().getDay() + 6) % 7;
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [selectedDay, setSelectedDay] = useState(todayIdx);
  const tabRefs = useRef([]);
  const nowSec = Math.floor(Date.now() / 1000);

  const dayNames = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(currentLang, { weekday: 'long' });
    const short = new Intl.DateTimeFormat(currentLang, { weekday: 'short' });
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return { long: fmt.format(d), short: short.format(d), date: d.getDate() };
    });
  }, [currentLang, weekStart]);

  const load = useCallback((signal) => {
    setStatus('loading');
    const { start, end } = getWeekRange();
    fetchSchedule(start, end, signal)
      .then((data) => { setItems(data); setStatus('ready'); })
      .catch((err) => { if (err.name !== 'AbortError') setStatus('error'); });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const byDay = useMemo(() => {
    const days = Array.from({ length: 7 }, () => []);
    for (const it of items) days[dayIndexOf(it.airingAt)].push(it);
    return days;
  }, [items]);

  const onTabKeyDown = (e, i) => {
    let next = null;
    if (e.key === 'ArrowRight') next = (i + 1) % 7;
    else if (e.key === 'ArrowLeft') next = (i + 6) % 7;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 6;
    if (next === null) return;
    e.preventDefault();
    setSelectedDay(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="pt-24 px-4 md:px-12">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-6 h-6 text-cyan-400" aria-hidden="true" />
          <div>
            <h2 className="text-2xl font-black text-white text-balance">{t('scheduleTitle')}</h2>
            <p className="text-xs text-zinc-500">{t('scheduleSub')}</p>
          </div>
        </div>
      </div>

      {status === 'loading' && (
        <div className="h-64 flex flex-col items-center justify-center text-zinc-400" role="status">
          <Loader2 className="w-8 h-8 text-cyan-400 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          <p className="text-sm mt-3">{t('scheduleLoading')}</p>
        </div>
      )}

      {status === 'error' && (
        <div className="h-64 flex flex-col items-center justify-center text-zinc-400" role="alert">
          <p className="text-sm">{t('scheduleLoadError')}</p>
          <button
            type="button"
            onClick={() => load()}
            className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold border border-zinc-700 transition-[background-color,scale] duration-150 active:scale-[0.96]"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            {t('scheduleRetry')}
          </button>
        </div>
      )}

      {status === 'ready' && (
        <>
          {/* Day selector (mobile / tablet) */}
          <div role="tablist" aria-label={t('scheduleTitle')} className="lg:hidden flex gap-1.5 overflow-x-auto hide-scrollbar pb-3">
            {dayNames.map((d, i) => {
              const selected = selectedDay === i;
              return (
                <button
                  key={i}
                  ref={(el) => (tabRefs.current[i] = el)}
                  role="tab"
                  id={`schedule-tab-${i}`}
                  aria-selected={selected}
                  aria-controls="schedule-panel"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setSelectedDay(i)}
                  onKeyDown={(e) => onTabKeyDown(e, i)}
                  className={`shrink-0 min-w-[56px] px-3 py-2 rounded-xl text-xs font-bold border transition-[background-color,color] duration-150 ${
                    selected
                      ? 'bg-[#E50914] border-[#E50914] text-white'
                      : 'bg-zinc-900/80 border-white/[0.08] text-zinc-300'
                  }`}
                >
                  <span className="block">{d.short}</span>
                  <span className="block text-[10px] font-medium opacity-80 tabular-nums">
                    {i === todayIdx ? t('scheduleToday') : `${byDay[i].length}`}
                  </span>
                </button>
              );
            })}
          </div>

          <div
            id="schedule-panel"
            role="tabpanel"
            aria-labelledby={`schedule-tab-${selectedDay}`}
            className="lg:hidden space-y-2"
          >
            {byDay[selectedDay].length === 0 ? (
              <p className="py-12 text-center text-sm text-zinc-500">{t('scheduleEmpty')}</p>
            ) : (
              byDay[selectedDay].map((it) => (
                <ScheduleItem key={`${it.media.id}-${it.episode}`} item={it} lang={currentLang} nowSec={nowSec} onOpen={onOpenAnime} t={t} />
              ))
            )}
          </div>

          {/* Seven-column week board (desktop) */}
          <div className="hidden lg:grid grid-cols-7 gap-3 items-start">
            {dayNames.map((d, i) => (
              <section key={i} aria-label={d.long} className="min-w-0">
                <header
                  className={`mb-2 px-3 py-2 rounded-xl text-center border ${
                    i === todayIdx
                      ? 'bg-[#E50914]/15 border-[#E50914]/50 text-white'
                      : 'bg-zinc-900/70 border-white/[0.06] text-zinc-300'
                  }`}
                >
                  <span className="block text-sm font-bold">{d.long}</span>
                  <span className="block text-[10px] text-zinc-500 tabular-nums">
                    {i === todayIdx ? `${t('scheduleToday')} · ` : ''}{byDay[i].length}
                  </span>
                </header>
                <div className="space-y-2">
                  {byDay[i].length === 0 ? (
                    <p className="py-6 text-center text-[11px] text-zinc-600">{t('scheduleEmpty')}</p>
                  ) : (
                    byDay[i].map((it) => (
                      <ScheduleItem key={`${it.media.id}-${it.episode}`} item={it} lang={currentLang} nowSec={nowSec} onOpen={onOpenAnime} t={t} />
                    ))
                  )}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
