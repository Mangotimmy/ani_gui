// src/utils/platform.js - Device, Client & External Player Helper
// Provides accurate platform detection for iOS, iPadOS, Android, macOS, Windows, Linux
// and builds deep-links for external players (VLC, Infuse, IINA, PotPlayer, MX Player).

export function getPlatformInfo() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      isMobile: false,
      isIOS: false,
      isIPad: false,
      isAndroid: false,
      isMacOS: false,
      isWindows: false,
      isLinux: false,
      isLocalhost: true,
      supportsLocalMpv: true
    };
  }

  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const maxTouchPoints = navigator.maxTouchPoints || 0;

  // iOS detection (iPhone, iPod)
  const isIOS = /iPhone|iPod/.test(ua) || (platform === 'iPhone' || platform === 'iPod');

  // iPad / iPadOS detection (including modern iPads spoofing desktop Safari on MacIntel)
  const isIPad = /iPad/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1);

  // Android detection
  const isAndroid = /Android/.test(ua);

  // General mobile / tablet
  const isMobile = isIOS || isIPad || isAndroid || /Mobi|Tablet|Opera Mini/i.test(ua);

  // Desktop OS detection
  const isMacOS = !isIPad && (/Macintosh|Mac OS X/.test(ua) || platform.startsWith('Mac'));
  const isWindows = /Windows|Win32|Win64/.test(ua) || platform.startsWith('Win');
  const isLinux = !isAndroid && (/Linux/.test(ua) || platform.startsWith('Linux'));

  // Localhost / LAN check
  const hostname = window.location.hostname || '';
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

  // Server-side MPV execution is only sensible when the browser is running on the same local PC machine
  const supportsLocalMpv = !isMobile && isLocalhost;

  return {
    isMobile,
    isIOS,
    isIPad,
    isAndroid,
    isMacOS,
    isWindows,
    isLinux,
    isLocalhost,
    supportsLocalMpv
  };
}

/**
 * Generates playable deep-links for external media players
 */
export function getExternalPlayerLinks(rawStreamUrl, title = 'Anime') {
  if (!rawStreamUrl) return [];

  const encodedUrl = encodeURIComponent(rawStreamUrl);
  const cleanUrl = rawStreamUrl.replace(/^https?:\/\//i, '');
  const platform = getPlatformInfo();

  const links = [];

  // 1. VLC Player (Universal cross-platform)
  // On iOS/Android: vlc-x-callback or vlc://
  if (platform.isIOS || platform.isIPad) {
    links.push({
      id: 'vlc',
      name: 'VLC',
      scheme: `vlc-x-callback://x-callback-url/stream?url=${encodedUrl}`,
      fallback: `vlc://${cleanUrl}`,
      badge: 'iOS / iPad',
      icon: 'vlc'
    });
  } else if (platform.isAndroid) {
    links.push({
      id: 'vlc',
      name: 'VLC',
      scheme: `intent:${rawStreamUrl}#Intent;package=org.videolan.vlc;type=video/*;end`,
      fallback: `vlc://${cleanUrl}`,
      badge: 'Android',
      icon: 'vlc'
    });
  } else {
    links.push({
      id: 'vlc',
      name: 'VLC Media Player',
      scheme: `vlc://${rawStreamUrl}`,
      fallback: `vlc://${cleanUrl}`,
      badge: 'Desktop',
      icon: 'vlc'
    });
  }

  // 2. Infuse Player (Premier player on Apple devices)
  if (platform.isIOS || platform.isIPad || platform.isMacOS) {
    links.push({
      id: 'infuse',
      name: 'Infuse',
      scheme: `infuse://x-callback-url/play?url=${encodedUrl}`,
      badge: 'Apple',
      icon: 'infuse'
    });
  }

  // 3. IINA Player (macOS favorite)
  if (platform.isMacOS) {
    links.push({
      id: 'iina',
      name: 'IINA',
      scheme: `iina://weblink?url=${encodedUrl}`,
      badge: 'macOS',
      icon: 'iina'
    });
  }

  // 4. nPlayer (Popular iOS & Android player)
  if (platform.isIOS || platform.isIPad || platform.isAndroid) {
    links.push({
      id: 'nplayer',
      name: 'nPlayer',
      scheme: `nplayer-${rawStreamUrl}`,
      badge: 'Mobile',
      icon: 'nplayer'
    });
  }

  // 5. PotPlayer (Windows favorite)
  if (platform.isWindows) {
    links.push({
      id: 'potplayer',
      name: 'PotPlayer',
      scheme: `potplayer://${rawStreamUrl}`,
      badge: 'Windows',
      icon: 'potplayer'
    });
  }

  // 6. Generic Native Browser Stream
  links.push({
    id: 'stream',
    name: 'Direct Stream URL',
    scheme: rawStreamUrl,
    isDirect: true,
    badge: 'Universal',
    icon: 'link'
  });

  return links;
}
