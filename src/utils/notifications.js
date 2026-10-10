// src/utils/notifications.js - Unified Anime Release & Publishing Notification Service
// Supports Web Notifications API (PC Browser, Mobile Chrome, Safari PWA, Electron) + In-App Notification Center

const NOTIFICATIONS_STORAGE_KEY = 'aniflix_notifications';
const NOTIFIED_EPISODES_KEY = 'aniflix_notified_episodes';

export function isNotificationSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationPermission() {
  if (!isNotificationSupported()) return 'unsupported';
  return Notification.permission;
}

export async function requestNotificationPermission() {
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
 * Dispatch an in-app and browser system notification
 */
export function sendAnimeNotification({ title, body, icon, animeId, episode }) {
  const notifId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const notificationItem = {
    id: notifId,
    title: title || 'AniFlix 動畫更新通知',
    body: body || '您關注的動漫有新的動態發布！',
    icon: icon || '/build/icon.png',
    animeId: animeId || null,
    episode: episode || null,
    timestamp: Date.now(),
    read: false
  };

  // 1. Save to local notification center history
  try {
    const existing = getStoredNotifications();
    const updated = [notificationItem, ...existing].slice(0, 50); // keep up to 50
    localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent('aniflix:notification', { detail: notificationItem }));
  } catch (e) {
    console.warn('Could not save notification to localStorage:', e);
  }

  // 2. Trigger native/browser Web Notification
  if (isNotificationSupported() && Notification.permission === 'granted') {
    try {
      const nativeNotif = new Notification(notificationItem.title, {
        body: notificationItem.body,
        icon: notificationItem.icon,
        badge: '/build/icon.png',
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
  }

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

/**
 * Periodically scan favorited anime to check for newly published or aired episodes
 */
export function checkFavoritesForNewAiring(favorites = []) {
  if (!Array.isArray(favorites) || favorites.length === 0) return;

  let notifiedMap = {};
  try {
    const raw = localStorage.getItem(NOTIFIED_EPISODES_KEY);
    if (raw) notifiedMap = JSON.parse(raw);
  } catch {}

  const nowSec = Math.floor(Date.now() / 1000);
  let updatedAny = false;

  favorites.forEach((anime) => {
    if (!anime || !anime.id) return;
    const animeTitle = anime.title?.chinese || anime.title?.romaji || anime.title?.english || '動漫';
    const nextAiring = anime.nextAiringEpisode;

    if (nextAiring && nextAiring.episode && nextAiring.airingAt) {
      const key = `${anime.id}-ep${nextAiring.episode}`;
      
      // If airingAt has arrived (or within the past 2 days) and hasn't notified yet:
      if (nextAiring.airingAt <= nowSec && (nowSec - nextAiring.airingAt) < 172800 && !notifiedMap[key]) {
        sendAnimeNotification({
          title: `🎬《${animeTitle}》第 ${nextAiring.episode} 集現已發布開播！`,
          body: `您收藏的每週新番最新集數已上線，點擊立即觀看。`,
          icon: anime.image || anime.coverImage || '/build/icon.png',
          animeId: anime.id,
          episode: nextAiring.episode
        });
        notifiedMap[key] = Date.now();
        updatedAny = true;
      }
    }
  });

  if (updatedAny) {
    try {
      localStorage.setItem(NOTIFIED_EPISODES_KEY, JSON.stringify(notifiedMap));
    } catch {}
  }
}
