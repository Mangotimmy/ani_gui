// src/utils/image.js - Unified Image Caching & Multi-Format Thumbnail Resolver (JPG, AVIF, WebP)

/**
 * Ensures external images (AniList, TMDB, external CDNs) route through the local disk cache
 * to populate local disk cache, accelerate repeat views, and keep cache statistics accurate.
 * Supports requesting specific modern image formats (avif, webp, jpg).
 */
export function toCachedImageUrl(url, format = '') {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  const formatParam = format ? `&format=${encodeURIComponent(format)}` : '';

  // Return base64 data and blob URLs as-is
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return trimmed;
  }

  // Already proxied URL: append format if requested and not already present
  if (trimmed.startsWith('/api/proxy/image') || trimmed.startsWith('http://localhost:3001/api/proxy/image')) {
    if (format && !trimmed.includes('&format=') && !trimmed.includes('?format=')) {
      const sep = trimmed.includes('?') ? '&' : '?';
      return `${trimmed}${sep}format=${encodeURIComponent(format)}`;
    }
    return trimmed;
  }

  // Return other local assets as-is
  if (
    trimmed.startsWith('/api/') ||
    trimmed.startsWith('/build/') ||
    trimmed.startsWith('/assets/') ||
    trimmed.startsWith('http://localhost:3001/api/')
  ) {
    return trimmed;
  }

  // Route external HTTP/HTTPS images through backend disk caching proxy with optional format
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return `/api/proxy/image?url=${encodeURIComponent(trimmed)}${formatParam}`;
  }

  return trimmed;
}

/**
 * Safely resolves an anime object's cover image to a valid cached URL string.
 * Handles both plain URL strings and AniList's nested coverImage object.
 */
export function getAnimeCoverUrl(anime, preferred = 'large', format = '') {
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

  return toCachedImageUrl(rawUrl, format);
}

/**
 * Safely resolves an anime object's backdrop/banner image to a valid cached URL string.
 */
export function getAnimeBannerUrl(anime, format = '') {
  if (!anime) return '';
  if (typeof anime.bannerImage === 'string' && anime.bannerImage) {
    return toCachedImageUrl(anime.bannerImage, format);
  }
  return getAnimeCoverUrl(anime, 'extraLarge', format);
}

/**
 * Multi-format thumbnail source generator.
 * Produces structured AVIF, WebP, and JPG sources for <picture> tags.
 */
export function getThumbnailSources(target) {
  if (!target) {
    return { avif: '', webp: '', jpg: '', fallback: '' };
  }

  // If already an object containing precomputed thumbnails (e.g. from YouTube PV scraper)
  if (typeof target === 'object' && target.thumbnails) {
    const t = target.thumbnails;
    return {
      avif: toCachedImageUrl(t.avif || t.jpg || target.thumbnail, 'avif'),
      webp: toCachedImageUrl(t.webp || t.jpg || target.thumbnail, 'webp'),
      jpg: toCachedImageUrl(t.jpg || target.thumbnail, 'jpg'),
      fallback: toCachedImageUrl(t.jpg || target.thumbnail)
    };
  }

  // If an anime object was passed in
  if (typeof target === 'object') {
    return getAnimeCoverSources(target);
  }

  if (typeof target !== 'string') {
    return { avif: '', webp: '', jpg: '', fallback: '' };
  }

  const trimmed = target.trim();
  if (!trimmed) {
    return { avif: '', webp: '', jpg: '', fallback: '' };
  }

  // YouTube thumbnail URL pattern detection (extract 11-char video ID)
  const ytMatch = trimmed.match(/(?:i\.ytimg\.com\/(?:vi|vi_webp)\/|youtube\.com\/embed\/|youtu\.be\/|v=)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) {
    const videoId = ytMatch[1];
    const jpgUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    const webpUrl = `https://i.ytimg.com/vi_webp/${videoId}/hqdefault.webp`;
    return {
      avif: toCachedImageUrl(jpgUrl, 'avif'),
      webp: toCachedImageUrl(webpUrl, 'webp'),
      jpg: toCachedImageUrl(jpgUrl, 'jpg'),
      fallback: toCachedImageUrl(jpgUrl)
    };
  }

  // General image URL: return multi-format candidate proxy URLs
  return {
    avif: toCachedImageUrl(trimmed, 'avif'),
    webp: toCachedImageUrl(trimmed, 'webp'),
    jpg: toCachedImageUrl(trimmed, 'jpg'),
    fallback: toCachedImageUrl(trimmed)
  };
}

/**
 * Returns AVIF, WebP, and JPG thumbnail sources for an anime's cover.
 */
export function getAnimeCoverSources(anime, preferred = 'large') {
  const baseCover = getAnimeCoverUrl(anime, preferred);
  return getThumbnailSources(baseCover);
}

/**
 * Returns AVIF, WebP, and JPG thumbnail sources for an anime's banner.
 */
export function getAnimeBannerSources(anime) {
  const baseBanner = getAnimeBannerUrl(anime);
  return getThumbnailSources(baseBanner);
}
