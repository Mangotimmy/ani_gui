// src/utils/image.js - Unified Image Caching & Safe Anime Artwork Resolver

/**
 * Ensures external images (AniList, TMDB, external CDNs) route through the local disk cache
 * to populate local disk cache, accelerate repeat views, and keep cache statistics accurate.
 */
export function toCachedImageUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  // Return local assets, base64 data, blob URLs, and already-proxied URLs as-is
  if (
    trimmed.startsWith('/api/') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('/build/') ||
    trimmed.startsWith('/assets/') ||
    trimmed.startsWith('http://localhost:3001/api/')
  ) {
    return trimmed;
  }

  // Route external HTTP/HTTPS images through backend disk caching proxy
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return `/api/proxy/image?url=${encodeURIComponent(trimmed)}`;
  }

  return trimmed;
}

/**
 * Safely resolves an anime object's cover image to a valid cached URL string.
 * Handles both plain URL strings and AniList's nested coverImage object.
 */
export function getAnimeCoverUrl(anime, preferred = 'large') {
  if (!anime) return '';

  let rawUrl = '';
  if (typeof anime.image === 'string' && anime.image) {
    rawUrl = anime.image;
  } else if (typeof anime.coverImage === 'string' && anime.coverImage) {
    rawUrl = anime.coverImage;
  } else if (anime.coverImage && typeof anime.coverImage === 'object') {
    rawUrl = (preferred === 'extraLarge' ? anime.coverImage.extraLarge : null)
      || anime.coverImage.large
      || anime.coverImage.medium
      || anime.coverImage.extraLarge
      || '';
  } else if (typeof anime.bannerImage === 'string' && anime.bannerImage) {
    rawUrl = anime.bannerImage;
  }

  return toCachedImageUrl(rawUrl);
}

/**
 * Safely resolves an anime object's backdrop/banner image to a valid cached URL string.
 */
export function getAnimeBannerUrl(anime) {
  if (!anime) return '';
  if (typeof anime.bannerImage === 'string' && anime.bannerImage) {
    return toCachedImageUrl(anime.bannerImage);
  }
  return getAnimeCoverUrl(anime, 'extraLarge');
}
