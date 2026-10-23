// server/services/mediaCache.js - High-Performance Disk Cache for Video Segments & Thumbnails
//
// Everything lives under resolveWritableCacheDir() so the cache survives restarts and is
// actually reused on the next playback (previously path.resolve('server/data') depended on
// process.cwd(), so Docker/Electron wrote the cache to a path that was thrown away).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { resolveWritableCacheDir } from './paths.js';

const CACHE_ROOT = resolveWritableCacheDir();
const SEGMENTS_DIR = path.join(CACHE_ROOT, 'segments');
const IMAGES_DIR = path.join(CACHE_ROOT, 'images');
const SUBTITLES_DIR = path.join(CACHE_ROOT, 'subtitles');

// Maximum video cache size (env-tunable, default 4 GB)
const MAX_VIDEO_CACHE_BYTES = Number(process.env.ANIFLIX_VIDEO_CACHE_BYTES || 4 * 1024 * 1024 * 1024);
// Maximum image cache size: 500 MB
const MAX_IMAGE_CACHE_BYTES = Number(process.env.ANIFLIX_IMAGE_CACHE_BYTES || 500 * 1024 * 1024);
// Never keep a single cached media file larger than this (protects against one huge MP4
// eating the whole budget).
const MAX_SINGLE_FILE_BYTES = Number(process.env.ANIFLIX_MAX_CACHED_FILE_BYTES || 400 * 1024 * 1024);

for (const dir of [SEGMENTS_DIR, IMAGES_DIR, SUBTITLES_DIR]) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.warn('[MediaCache] Failed to create cache directory', dir, e.message);
  }
}

function hashUrl(url) {
  return crypto.createHash('sha256').update(String(url)).digest('hex').slice(0, 32);
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

export const mediaCache = {
  cacheRoot: CACHE_ROOT,
  segmentsDir: SEGMENTS_DIR,
  imagesDir: IMAGES_DIR,
  subtitlesDir: SUBTITLES_DIR,
  maxSingleFileBytes: MAX_SINGLE_FILE_BYTES,

  getSegmentPath(url) {
    return path.join(SEGMENTS_DIR, `${hashUrl(url)}.ts`);
  },

  getImagePath(url) {
    return path.join(IMAGES_DIR, `${hashUrl(url)}.img`);
  },

  getImageMetaPath(url) {
    return path.join(IMAGES_DIR, `${hashUrl(url)}.json`);
  },

  getSubtitlePath(cacheKey) {
    return path.join(SUBTITLES_DIR, `${hashUrl(cacheKey)}.vtt`);
  },

  /** True when a complete (non-temporary) segment already exists on disk. */
  hasSegment(url) {
    const filePath = this.getSegmentPath(url);
    const stat = safeStat(filePath);
    return Boolean(stat && stat.size > 0);
  },

  /**
   * Check if a video segment is cached on disk and valid.
   */
  getSegment(url) {
    const filePath = this.getSegmentPath(url);
    const stat = safeStat(filePath);
    if (stat && stat.size > 0) {
      // Touch access time for LRU eviction
      const now = new Date();
      fs.utimes(filePath, now, now, () => {});
      return { filePath, size: stat.size };
    }
    return null;
  },

  /**
   * Atomically persist a fully downloaded buffer as a cached segment.
   */
  saveSegmentBuffer(url, buffer) {
    if (!buffer || !buffer.length) return null;
    if (buffer.length > MAX_SINGLE_FILE_BYTES) return null;
    const filePath = this.getSegmentPath(url);
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tempPath, buffer);
      fs.renameSync(tempPath, filePath);
      return filePath;
    } catch {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
      return null;
    }
  },

  /** Rename a completed temporary segment file into the cache. */
  commitSegmentTemp(url, tempPath) {
    const filePath = this.getSegmentPath(url);
    try {
      const stat = safeStat(tempPath);
      if (!stat || stat.size === 0) {
        try { fs.unlinkSync(tempPath); } catch {}
        return null;
      }
      fs.renameSync(tempPath, filePath);
      return filePath;
    } catch {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
      return null;
    }
  },

  /**
   * Check if an image is cached on disk.
   */
  getImage(url) {
    const filePath = this.getImagePath(url);
    const metaPath = this.getImageMetaPath(url);
    const stat = safeStat(filePath);
    if (stat && stat.size > 0 && fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        const now = new Date();
        fs.utimes(filePath, now, now, () => {});
        return { filePath, size: stat.size, contentType: meta.contentType || 'image/jpeg' };
      } catch {}
    }
    return null;
  },

  /**
   * Save an image buffer to disk cache.
   */
  saveImage(url, buffer, contentType = 'image/jpeg') {
    const filePath = this.getImagePath(url);
    const metaPath = this.getImageMetaPath(url);
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tempPath, buffer);
      fs.renameSync(tempPath, filePath);
      fs.writeFileSync(metaPath, JSON.stringify({ contentType, url, cachedAt: Date.now() }));
    } catch {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
    }
  },

  /** Promote a streamed image temp file into the cache (used by the streaming proxy). */
  commitImageTemp(url, tempPath, contentType = 'image/jpeg') {
    const filePath = this.getImagePath(url);
    const metaPath = this.getImageMetaPath(url);
    try {
      const stat = safeStat(tempPath);
      if (!stat || stat.size === 0) {
        try { fs.unlinkSync(tempPath); } catch {}
        return null;
      }
      fs.renameSync(tempPath, filePath);
      fs.writeFileSync(metaPath, JSON.stringify({ contentType, url, cachedAt: Date.now() }));
      return filePath;
    } catch {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
      return null;
    }
  },

  /**
   * Calculate current cache sizes and file counts.
   */
  getStats() {
    let videoBytes = 0;
    let videoCount = 0;
    let imageBytes = 0;
    let imageCount = 0;

    try {
      if (fs.existsSync(SEGMENTS_DIR)) {
        for (const file of fs.readdirSync(SEGMENTS_DIR)) {
          if (!file.endsWith('.ts')) continue;
          const stat = safeStat(path.join(SEGMENTS_DIR, file));
          if (stat) { videoBytes += stat.size; videoCount++; }
        }
      }
    } catch {}

    try {
      if (fs.existsSync(IMAGES_DIR)) {
        for (const file of fs.readdirSync(IMAGES_DIR)) {
          if (!file.endsWith('.img')) continue;
          const stat = safeStat(path.join(IMAGES_DIR, file));
          if (stat) { imageBytes += stat.size; imageCount++; }
        }
      }
    } catch {}

    return {
      cacheRoot: CACHE_ROOT,
      videoBytes,
      videoMb: +(videoBytes / (1024 * 1024)).toFixed(1),
      videoCount,
      imageBytes,
      imageMb: +(imageBytes / (1024 * 1024)).toFixed(1),
      imageCount,
      totalMb: +((videoBytes + imageBytes) / (1024 * 1024)).toFixed(1),
    };
  },

  /**
   * Evict oldest segments if cache exceeds max size.
   */
  evictOldSegmentsIfNeeded() {
    try {
      if (!fs.existsSync(SEGMENTS_DIR)) return;
      const files = fs.readdirSync(SEGMENTS_DIR).filter(f => f.endsWith('.ts'));
      let totalSize = 0;
      const fileStats = [];

      for (const file of files) {
        const fullPath = path.join(SEGMENTS_DIR, file);
        const stat = safeStat(fullPath);
        if (!stat) continue;
        totalSize += stat.size;
        fileStats.push({ path: fullPath, size: stat.size, atime: stat.atimeMs });
      }

      // Remove orphaned .tmp files left by interrupted downloads.
      try {
        const now = Date.now();
        for (const file of fs.readdirSync(SEGMENTS_DIR)) {
          if (!file.endsWith('.tmp')) continue;
          const fullPath = path.join(SEGMENTS_DIR, file);
          const stat = safeStat(fullPath);
          if (stat && now - stat.mtimeMs > 10 * 60 * 1000) {
            try { fs.unlinkSync(fullPath); } catch {}
          }
        }
      } catch {}

      if (totalSize > MAX_VIDEO_CACHE_BYTES) {
        fileStats.sort((a, b) => a.atime - b.atime);
        const targetSize = MAX_VIDEO_CACHE_BYTES * 0.75;
        for (const f of fileStats) {
          if (totalSize <= targetSize) break;
          try {
            fs.unlinkSync(f.path);
            totalSize -= f.size;
          } catch {}
        }
      }
    } catch (e) {
      console.warn('[MediaCache] Eviction error:', e.message);
    }
  },

  /**
   * Clear all or specific cache.
   */
  clear(type = 'all') {
    if (type === 'all' || type === 'video') {
      try {
        if (fs.existsSync(SEGMENTS_DIR)) {
          for (const f of fs.readdirSync(SEGMENTS_DIR)) {
            try { fs.unlinkSync(path.join(SEGMENTS_DIR, f)); } catch {}
          }
        }
      } catch {}
    }
    if (type === 'all' || type === 'image') {
      try {
        if (fs.existsSync(IMAGES_DIR)) {
          for (const f of fs.readdirSync(IMAGES_DIR)) {
            try { fs.unlinkSync(path.join(IMAGES_DIR, f)); } catch {}
          }
        }
      } catch {}
    }
    if (type === 'all' || type === 'subtitle') {
      try {
        if (fs.existsSync(SUBTITLES_DIR)) {
          for (const f of fs.readdirSync(SUBTITLES_DIR)) {
            try { fs.unlinkSync(path.join(SUBTITLES_DIR, f)); } catch {}
          }
        }
      } catch {}
    }
    return this.getStats();
  }
};

// Periodic maintenance so the cache self-trims even during long playback sessions.
try {
  const timer = setInterval(() => mediaCache.evictOldSegmentsIfNeeded(), 5 * 60 * 1000);
  if (typeof timer.unref === 'function') timer.unref();
} catch {}

export default mediaCache;
