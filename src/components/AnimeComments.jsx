// src/components/AnimeComments.jsx - Local (per-server) comments area for an anime
import React, { useEffect, useState, useCallback } from 'react';
import { Loader2, Trash2, MessageSquare } from 'lucide-react';

const MAX_LEN = 500;

function formatRelative(ts, lang, t) {
  const diffSec = Math.round((ts - Date.now()) / 1000);
  if (Math.abs(diffSec) < 60) return t('justNow');
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const abs = Math.abs(diffSec);
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), 'day');
  return new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(new Date(ts));
}

export default function AnimeComments({ animeId, username = 'Guest', currentLang = 'zh-TW', t }) {
  const [comments, setComments] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);

  const load = useCallback(async (signal) => {
    setStatus('loading');
    try {
      const res = await fetch(`/api/anime/${encodeURIComponent(animeId)}/comments`, { signal });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setComments(json.data || []);
      setStatus('ready');
    } catch (err) {
      if (err.name !== 'AbortError') setStatus('error');
    }
  }, [animeId]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean || posting) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/anime/${encodeURIComponent(animeId)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author: username, text: clean })
      });
      const json = await res.json();
      if (json.success) {
        setComments((prev) => [json.data, ...prev]);
        setText('');
      }
    } finally {
      setPosting(false);
    }
  };

  const remove = async (id) => {
    const res = await fetch(
      `/api/anime/${encodeURIComponent(animeId)}/comments/${encodeURIComponent(id)}?author=${encodeURIComponent(username)}`,
      { method: 'DELETE' }
    );
    if (res.ok) setComments((prev) => prev.filter((c) => c.id !== id));
  };

  return (
    <div className="mt-4 space-y-4">
      <form onSubmit={submit} className="bg-zinc-900/80 p-3 rounded-xl border border-zinc-800 space-y-2">
        <label htmlFor="anime-comment-input" className="sr-only">{t('commentsPlaceholder')}</label>
        <textarea
          id="anime-comment-input"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
          placeholder={t('commentsPlaceholder')}
          rows={3}
          maxLength={MAX_LEN}
          className="w-full resize-y rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#E50914]"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-zinc-500 tabular-nums">
            {username} · {text.length}/{MAX_LEN}
          </span>
          <button
            type="submit"
            disabled={!text.trim() || posting}
            className="px-4 py-1.5 rounded-lg bg-[#E50914] text-white text-xs font-bold transition-[background-color,opacity,scale] duration-150 enabled:hover:bg-red-600 enabled:active:scale-[0.96] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {posting ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : t('postComment')}
          </button>
        </div>
        <p className="text-[10px] text-zinc-600">{t('commentsNote')}</p>
      </form>

      <div aria-live="polite">
        {status === 'loading' && (
          <div className="py-8 flex justify-center" role="status">
            <Loader2 className="w-6 h-6 text-zinc-500 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          </div>
        )}
        {status === 'error' && <p className="py-6 text-center text-sm text-zinc-500">{t('commentsLoadError')}</p>}
        {status === 'ready' && comments.length === 0 && (
          <div className="py-10 flex flex-col items-center text-zinc-500">
            <MessageSquare className="w-8 h-8 mb-2 text-zinc-600" aria-hidden="true" />
            <p className="text-sm">{t('commentsEmpty')}</p>
          </div>
        )}
        {status === 'ready' && comments.length > 0 && (
          <ul className="space-y-2">
            {comments.map((c) => (
              <li key={c.id} className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3">
                <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500">
                  <span>
                    <span className="font-bold text-zinc-300">{c.author}</span>
                    <span aria-hidden="true"> · </span>
                    <time dateTime={new Date(c.createdAt).toISOString()}>{formatRelative(c.createdAt, currentLang, t)}</time>
                  </span>
                  {c.author === username && (
                    <button
                      type="button"
                      onClick={() => remove(c.id)}
                      aria-label={t('deleteComment')}
                      title={t('deleteComment')}
                      className="p-2 -m-1 rounded-md text-zinc-500 hover:text-red-400 transition-colors duration-150"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-sm text-zinc-200 whitespace-pre-wrap break-words text-pretty">{c.text}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
