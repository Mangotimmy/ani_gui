// src/components/AnimeInfoLinks.jsx - Official / info website links for an anime
import React from 'react';
import { ExternalLink, Globe } from 'lucide-react';

function isSafeHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export default function AnimeInfoLinks({ anime, t, chineseInfo }) {
  const links = [];
  if (anime?.siteUrl && isSafeHttpUrl(anime.siteUrl)) {
    links.push({ key: 'anilist', label: t('anilistPage') || 'AniList 頁面', url: anime.siteUrl });
  } else if (anime?.id) {
    links.push({ key: 'anilist', label: t('anilistPage') || 'AniList 頁面', url: `https://anilist.co/anime/${anime.id}` });
  }

  // MyAnimeList link
  if (anime?.idMal) {
    links.push({ key: 'mal', label: 'MyAnimeList', url: `https://myanimelist.net/anime/${anime.idMal}` });
  }

  // Bangumi link
  const bgmId = anime?.bgmId || chineseInfo?.bgmId;
  if (bgmId) {
    links.push({ key: 'bangumi', label: 'Bangumi 番組計劃', url: `https://bgm.tv/subject/${bgmId}` });
  }

  // Quick Cantonese anime streaming platforms
  const searchName = chineseInfo?.titleZh || anime?.titleZhTW || anime?.title?.romaji || anime?.title?.english || '';
  if (searchName) {
    links.push({
      key: 'viu-cantonese',
      label: '🇭🇰 Viu 粵語專區',
      url: `https://www.viu.com/ott/hk/zh/search?keyword=${encodeURIComponent(searchName)}`
    });
    links.push({
      key: 'ani-one-cantonese',
      label: 'Ani-One 官方粵配',
      url: `https://www.youtube.com/results?search_query=Ani-One+%E7%B2%B5%E8%AA%9E%E9%85%8D%E9%9F%B3+${encodeURIComponent(searchName)}`
    });
  }

  const seen = new Set(links.map((l) => l.url));
  for (const l of anime?.externalLinks || []) {
    if (!l?.url || !isSafeHttpUrl(l.url) || seen.has(l.url)) continue;
    // STREAMING links are shown too; label them by site name
    seen.add(l.url);
    links.push({
      key: `${l.site}-${l.url}`,
      label: l.type === 'INFO' && /official/i.test(l.site) ? `${t('officialSite') || '官方網站'}` : l.site,
      url: l.url
    });
  }
  if (links.length === 0) return null;

  return (
    <div>
      <span className="text-zinc-500 block mb-1 font-semibold uppercase text-[10px]">{t('infoLinks')}</span>
      <ul className="flex flex-wrap gap-1.5">
        {links.slice(0, 12).map((l) => (
          <li key={l.key}>
            <a
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-2.5 py-1 rounded-full text-[11px] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              {l.key === 'anilist' ? <Globe className="w-3 h-3" aria-hidden="true" /> : <ExternalLink className="w-3 h-3" aria-hidden="true" />}
              <span>{l.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
