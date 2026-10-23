// src/utils/notifications.js - In-app notification center + OS toasts
//
// Desktop builds go through the Electron preload bridge (native Windows toast with an
// AppUserModelID); browsers keep the Web Notification / ServiceWorker path.
import { getAnimeCoverUrl, toCachedImageUrl } from './image.js';
import { titleForNotification } from './titles.js';

const NOTIFICATIONS_STORAGE_KEY = 'aniflix_notifications';
const NOTIFIED_EPISODES_KEY = 'aniflix_notified_episodes';
const DESKTOP_NOTIFICATIONS_KEY = 'aniflix_desktop_notifications';

export function isDesktopApp() {
  return typeof window !== 'undefined' && Boolean(window.aniflixDesktop?.isDesktop);
}

export function isDesktopNotificationsEnabled() {
  try {
    const raw = localStorage.getItem(DESKTOP_NOTIFICATIONS_KEY);
    return raw === null ? true : raw === 'true';
  } catch {
    return true;
  }
}

export function setDesktopNotificationsEnabled(enabled) {
  try {
    localStorage.setItem(DESKTOP_NOTIFICATIONS_KEY, enabled ? 'true' : 'false');
    window.dispatchEvent(new CustomEvent('aniflix:notification_settings'));
  } catch {}
}

export function isNotificationSupported() {
  if (isDesktopApp()) return true;
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationPermission() {
  if (isDesktopApp()) return 'granted';
  if (!isNotificationSupported()) return 'unsupported';
  return Notification.permission;
}

export async function requestNotificationPermission() {
  if (isDesktopApp()) return 'granted';
  if (!isNotificationSupported()) return 'unsupported';
  try {
    const perm = await Notification.requestPermission();
    return perm;
  } catch (err) {
    console.warn('Failed to request notification permission:', err);
    return 'denied';
  }
}

/**
 * Dispatch an in-app notification item and, when permitted, an OS notification.
 */
export function sendAnimeNotification({ title, body, icon, animeId, episode, category = 'general' }) {
  const notifId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const notificationItem = {
    id: notifId,
    title: title || 'AniFlix 動畫更新通知',
    body: body || '您關注的動漫有新的動態發布！',
    icon: (typeof icon === 'string' && icon
      ? toCachedImageUrl(icon)
      : (icon && typeof icon === 'object' ? (icon.large || icon.medium || icon.extraLarge || '') : '')) || '/icon.png',
    animeId: animeId || null,
    episode: episode || null,
    category,
    timestamp: Date.now(),
    read: false
  };

  // 1. In-app notification center (always)
  try {
    const existing = getStoredNotifications();
    const updated = [notificationItem, ...existing].slice(0, 50);
    localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent('aniflix:notification', { detail: notificationItem }));
  } catch (e) {
    console.warn('Could not save notification to localStorage:', e);
  }

  // 2. OS notification
  const wantsOsNotification = isDesktopNotificationsEnabled() &&
    isNotificationSupported() &&
    getNotificationPermission() === 'granted';

  if (!wantsOsNotification) return notificationItem;

  if (isDesktopApp()) {
    try {
      window.aniflixDesktop.notify({
        title: notificationItem.title,
        body: notificationItem.body,
        icon: notificationItem.icon,
        animeId: notificationItem.animeId,
        episode: notificationItem.episode
      }).catch?.(() => {});
    } catch (err) {
      console.warn('Desktop notification failed:', err);
    }
    return notificationItem;
  }

  // Browser: prefer the ServiceWorker registration (mobile PWA), fall back to Notification
  const dispatchViaSW = async () => {
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        if (reg && typeof reg.showNotification === 'function') {
          await reg.showNotification(notificationItem.title, {
            body: notificationItem.body,
            icon: notificationItem.icon,
            badge: '/icon.png',
            tag: `anime-${animeId || notifId}`,
            data: { animeId: animeId || null, episode: episode || null },
            vibrate: [200, 100, 200],
            renotify: true,
            silent: false
          });
          return true;
        }
      }
    } catch (swErr) {
      console.warn('ServiceWorker showNotification failed, trying fallback:', swErr);
    }
    return false;
  };

  dispatchViaSW().then((dispatched) => {
    if (dispatched) return;
    try {
      const nativeNotif = new Notification(notificationItem.title, {
        body: notificationItem.body,
        icon: notificationItem.icon,
        badge: '/icon.png',
        tag: `anime-${animeId || notifId}`,
        silent: false
      });
      nativeNotif.onclick = () => {
        window.focus();
        if (animeId) {
          window.dispatchEvent(new CustomEvent('aniflix:open_anime', { detail: { animeId } }));
        }
        nativeNotif.close();
      };
    } catch (err) {
      console.warn('Failed to dispatch native Notification:', err);
    }
  });

  return notificationItem;
}

export function getStoredNotifications() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function markAllNotificationsAsRead() {
  try {
    const items = getStoredNotifications().map(item => ({ ...item, read: true }));
    localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent('aniflix:notification_read'));
    return items;
  } catch {
    return [];
  }
}

export function clearAllNotifications() {
  try {
    localStorage.removeItem(NOTIFICATIONS_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('aniflix:notification_read'));
  } catch (e) {
    console.warn('Failed to clear notifications:', e);
  }
}

function loadNotifiedMap() {
  try {
    const raw = localStorage.getItem(NOTIFIED_EPISODES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveNotifiedMap(map) {
  try {
    // Keep at most 800 entries and drop anything older than 30 days.
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const entries = Object.entries(map)
      .filter(([, ts]) => typeof ts === 'number' && ts > cutoff)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 800);
    localStorage.setItem(NOTIFIED_EPISODES_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {}
}

/**
 * Ask the server which episodes of the user's favorites aired recently.
 * The old implementation read `nextAiringEpisode` from the saved favorite snapshot, which
 * was frozen at the moment the user favorited the show — so it almost never fired.
 * Favorites only (per product decision), 48h window, deduped per anime+episode.
 */
export async function checkFavoritesForNewAiring(favorites = []) {
  if (!Array.isArray(favorites) || favorites.length === 0) return 0;
  const ids = Array.from(new Set(favorites.map(f => f && f.id).filter(Boolean))).slice(0, 100);
  if (ids.length === 0) return 0;

  const notifiedMap = loadNotifiedMap();
  let created = 0;

  try {
    const res = await fetch(`/api/notifications/airing?ids=${ids.join(',')}&hours=48`);
    const data = await res.json();
    if (!data?.success || !Array.isArray(data.data)) return 0;

    const favoriteById = new Map(favorites.filter(Boolean).map(f => [String(f.id), f]));
    for (const row of data.data) {
      if (!row?.animeId || !row?.episode) continue;
      const key = `${row.animeId}-ep${row.episode}`;
      if (notifiedMap[key]) continue;
      const media = row.media || favoriteById.get(String(row.animeId)) || null;
      sendAnimeNotification({
        title: `🎬《${titleForNotification(media)}》第 ${row.episode} 集已開播！`,
        body: '您收藏的動漫有新集數上線，點擊立即觀看。',
        icon: getAnimeCoverUrl(media) || '/icon.png',
        animeId: row.animeId,
        episode: row.episode,
        category: 'airing'
      });
      notifiedMap[key] = Date.now();
      created++;
    }
  } catch (err) {
    console.warn('Airing notification check failed:', err?.message || err);
  }

  if (created > 0) saveNotifiedMap(notifiedMap);
  return created;
}

// Desktop notification click -> open the anime
if (typeof window !== 'undefined' && window.aniflixDesktop?.onNotificationClick) {
  window.aniflixDesktop.onNotificationClick((payload) => {
    if (payload?.animeId) {
      window.dispatchEvent(new CustomEvent('aniflix:open_anime', { detail: { animeId: payload.animeId } }));
    }
  });
}

// Receive background notification click message from ServiceWorker
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'aniflix:open_anime' && event.data.animeId) {
      window.dispatchEvent(new CustomEvent('aniflix:open_anime', { detail: { animeId: event.data.animeId } }));
    }
  });
}
