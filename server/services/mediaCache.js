// server/services/mediaCache.js - High-Performance Disk Cache for Video Segments & Thumbnails
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DATA_DIR = path.resolve('server/data');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const SEGMENTS_DIR = path.join(CACHE_DIR, 'segments');
const IMAGES_DIR = path.join(CACHE_DIR, 'images');

// Maximum video cache size: 4 GB
const MAX_VIDEO_CACHE_BYTES = 4 * 1024 * 1024 * 1024;
// Maximum image cache size: 500 MB
const MAX_IMAGE_CACHE_BYTES = 500 * 1024 * 1024;

// Ensure directories exist on module load
try {
  fs.mkdirSync(SEGMENTS_DIR, { recursive: true });
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
} catch (e) {
  console.warn('[MediaCache] Failed to create cache directories:', e.message);
}

function hashUrl(url) {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 32);
}

export const mediaCache = {
  getSegmentPath(url) {
    const key = hashUrl(url);
    return path.join(SEGMENTS_DIR, `${key}.ts`);
  },

  getImagePath(url) {
    const key = hashUrl(url);
    return path.join(IMAGES_DIR, `${key}.img`);
  },

  getImageMetaPath(url) {
    const key = hashUrl(url);
    return path.join(IMAGES_DIR, `${key}.json`);
  },

  /**
   * Check if a video segment is cached on disk and valid.
   */
  getSegment(url) {
    const filePath = this.getSegmentPath(url);
    try {
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (stat.size > 0) {
          // Touch access time for LRU eviction
          const now = new Date();
          fs.utimes(filePath, now, now, () => {});
          return { filePath, size: stat.size };
        }
      }
    } catch {}
    return null;
  },

  /**
   * Check if an image is cached on disk.
   */
  getImage(url) {
    const filePath = this.getImagePath(url);
    const metaPath = this.getImageMetaPath(url);
    try {
      if (fs.existsSync(filePath) && fs.existsSync(metaPath)) {
        const stat = fs.statSync(filePath);
        if (stat.size > 0) {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          const now = new Date();
          fs.utimes(filePath, now, now, () => {});
          return { filePath, size: stat.size, contentType: meta.contentType || 'image/jpeg' };
        }
      }
    } catch {}
    return null;
  },

  /**
   * Save an image buffer to disk cache.
   */
  saveImage(url, buffer, contentType = 'image/jpeg') {
    const filePath = this.getImagePath(url);
    const metaPath = this.getImageMetaPath(url);
    const tempPath = `${filePath}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tempPath, buffer);
      fs.renameSync(tempPath, filePath);
      fs.writeFileSync(metaPath, JSON.stringify({ contentType, url, cachedAt: Date.now() }));
    } catch (err) {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
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
        const files = fs.readdirSync(SEGMENTS_DIR);
        for (const file of files) {
          if (file.endsWith('.ts')) {
            try {
              const stat = fs.statSync(path.join(SEGMENTS_DIR, file));
              videoBytes += stat.size;
              videoCount++;
            } catch {}
          }
        }
      }
    } catch {}

    try {
      if (fs.existsSync(IMAGES_DIR)) {
        const files = fs.readdirSync(IMAGES_DIR);
        for (const file of files) {
          if (file.endsWith('.img')) {
            try {
              const stat = fs.statSync(path.join(IMAGES_DIR, file));
              imageBytes += stat.size;
              imageCount++;
            } catch {}
          }
        }
      }
    } catch {}

    return {
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
        try {
          const fullPath = path.join(SEGMENTS_DIR, file);
          const stat = fs.statSync(fullPath);
          totalSize += stat.size;
          fileStats.push({ path: fullPath, size: stat.size, atime: stat.atimeMs });
        } catch {}
      }

      if (totalSize > MAX_VIDEO_CACHE_BYTES) {
        // Sort oldest access time first
        fileStats.sort((a, b) => a.atime - b.atime);
        const targetSize = MAX_VIDEO_CACHE_BYTES * 0.75; // Evict down to 75%
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
          const files = fs.readdirSync(SEGMENTS_DIR);
          for (const f of files) {
            try { fs.unlinkSync(path.join(SEGMENTS_DIR, f)); } catch {}
          }
        }
      } catch {}
    }
    if (type === 'all' || type === 'image') {
      try {
        if (fs.existsSync(IMAGES_DIR)) {
          const files = fs.readdirSync(IMAGES_DIR);
          for (const f of files) {
            try { fs.unlinkSync(path.join(IMAGES_DIR, f)); } catch {}
          }
        }
      } catch {}
    }
    return this.getStats();
  }
};
