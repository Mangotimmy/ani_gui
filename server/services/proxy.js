// server/services/proxy.js - High-performance HLS & Subtitle Streaming Proxy with Disk Caching
import fs from 'fs';
import { Readable, PassThrough } from 'stream';
import { mediaCache } from './mediaCache.js';

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const DEFAULT_REFERER = 'https://zokoanime.video/';

/**
 * Rewrites an M3U8 playlist so all child playlists, video segments,
 * and key/init URLs route through the local proxy with proper Referer.
 */
function rewriteM3U8(content, baseUrl, referer) {
  const lines = content.split(/\r?\n/);
  const rewritten = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    // Rewrite tag attributes containing URI="..."
    if (trimmed.startsWith('#')) {
      return trimmed.replace(/URI="([^"]+)"/g, (match, uri) => {
        try {
          const resolvedUri = new URL(uri, baseUrl).href;
          const proxyUri = `/api/proxy?url=${encodeURIComponent(resolvedUri)}&referer=${encodeURIComponent(referer)}`;
          return `URI="${proxyUri}"`;
        } catch {
          return match;
        }
      });
    }

    // Playlist or segment URI line
    try {
      const resolvedUri = new URL(trimmed, baseUrl).href;
      return `/api/proxy?url=${encodeURIComponent(resolvedUri)}&referer=${encodeURIComponent(referer)}`;
    } catch {
      return line;
    }
  });

  return rewritten.join('\n');
}

/**
 * Express handler for /api/proxy
 * Proxies M3U8 playlists, TS segments (.ts / .ts.jpg), and VTT subtitles with Disk Caching.
 */
export async function handleProxyStream(req, res) {
  const targetUrl = req.query.url;
  const referer = req.query.referer || DEFAULT_REFERER;

  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing "url" query parameter' });
  }

  try {
    const isM3U8Url = targetUrl.toLowerCase().includes('.m3u8');
    const isVttUrl = targetUrl.toLowerCase().includes('.vtt');
    const isVideoSegment = targetUrl.includes('.ts') || 
                           targetUrl.includes('.jpg') || 
                           targetUrl.includes('.mp4') || 
                           targetUrl.includes('.m4s');

    // 1. Check Disk Cache for Video Segments (Instant HIT)
    if (isVideoSegment && !isM3U8Url && !isVttUrl) {
      const cached = mediaCache.getSegment(targetUrl);
      if (cached) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
        const isFmp4 = targetUrl.includes('.mp4') || targetUrl.includes('.m4s');
        res.setHeader('Content-Type', isFmp4 ? 'video/mp4' : 'video/mp2t');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('X-Cache-Status', 'HIT');

        if (req.headers.range) {
          const parts = req.headers.range.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : cached.size - 1;
          res.status(206);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${cached.size}`);
          res.setHeader('Content-Length', end - start + 1);
          return fs.createReadStream(cached.filePath, { start, end }).pipe(res);
        } else {
          res.status(200);
          res.setHeader('Content-Length', cached.size);
          return fs.createReadStream(cached.filePath).pipe(res);
        }
      }
    }

    const headers = {
      'User-Agent': DEFAULT_USER_AGENT,
      'Referer': referer,
      'Accept': '*/*'
    };

    if (req.query.cookies) {
      headers['Cookie'] = req.query.cookies;
    }

    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const upstreamRes = await fetch(targetUrl, {
      headers,
      redirect: 'follow'
    });

    if (!upstreamRes.ok && upstreamRes.status !== 206) {
      console.warn(`[Proxy] Upstream error ${upstreamRes.status} for ${targetUrl}`);
      return res.status(upstreamRes.status).send(`Upstream returned ${upstreamRes.status}`);
    }

    const contentType = (upstreamRes.headers.get('content-type') || '').toLowerCase();
    const effectiveUrl = upstreamRes.url || targetUrl;
    const isM3U8 = isM3U8Url ||
                   effectiveUrl.toLowerCase().includes('.m3u8') ||
                   contentType.includes('mpegurl') ||
                   contentType.includes('application/x-mpegurl');

    const isVtt = isVttUrl ||
                  effectiveUrl.toLowerCase().includes('.vtt') ||
                  contentType.includes('text/vtt');

    // Enable CORS for all proxied assets
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

    // 1. M3U8 Playlist
    if (isM3U8) {
      const text = await upstreamRes.text();
      const rewritten = rewriteM3U8(text, effectiveUrl, referer);

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      return res.status(upstreamRes.status).send(rewritten);
    }

    // 2. VTT Subtitles
    if (isVtt) {
      const text = await upstreamRes.text();
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(upstreamRes.status).send(text);
    }

    // 3. Video Segments (MPEG-TS, MP4, etc.)
    if (targetUrl.includes('.mp4') || contentType.includes('video/mp4') || contentType.includes('mp4')) {
      res.setHeader('Content-Type', 'video/mp4');
    } else if (targetUrl.includes('.ts') || targetUrl.includes('.jpg') || contentType.includes('video') || contentType.includes('octet-stream')) {
      res.setHeader('Content-Type', 'video/mp2t');
    } else {
      res.setHeader('Content-Type', contentType || 'application/octet-stream');
    }

    res.setHeader('Accept-Ranges', 'bytes');
    const contentLength = upstreamRes.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    const contentRange = upstreamRes.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);

    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Cache-Status', 'MISS');
    res.status(upstreamRes.status);

    // Stream and cache segment simultaneously (only cache complete 200 OK responses, not 206 Partial Content)
    const nodeStream = Readable.fromWeb(upstreamRes.body);
    const shouldCache = upstreamRes.status === 200 && !req.headers.range && !targetUrl.includes('.mp4');

    if (shouldCache) {
      const cacheFilePath = mediaCache.getSegmentPath(targetUrl);
      const tempFilePath = `${cacheFilePath}.${Date.now()}.tmp`;
      const fileWriteStream = fs.createWriteStream(tempFilePath);

      let isAborted = false;
      req.on('close', () => {
        if (!res.writableEnded) {
          isAborted = true;
        }
        nodeStream.destroy();
      });

      fileWriteStream.on('finish', () => {
        if (!isAborted) {
          try {
            fs.renameSync(tempFilePath, cacheFilePath);
            mediaCache.evictOldSegmentsIfNeeded();
          } catch {}
        } else {
          try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch {}
        }
      });

      fileWriteStream.on('error', () => {
        try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch {}
      });

      nodeStream.on('error', (err) => {
        try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch {}
        if (!res.headersSent) {
          res.status(500).end();
        }
      });

      // Feed client response
      nodeStream.pipe(res);
      // Tee to disk cache file
      nodeStream.pipe(fileWriteStream);
    } else {
      req.on('close', () => {
        nodeStream.destroy();
      });

      nodeStream.on('error', (err) => {
        if (!res.headersSent) {
          res.status(500).end();
        }
      });

      nodeStream.pipe(res);
    }

  } catch (err) {
    console.error(`[Proxy] Failed to proxy stream for ${targetUrl}:`, err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
}

/**
 * Express handler for /api/proxy/image
 * High-performance image and thumbnail proxy with 30-day disk caching.
 */
export async function handleProxyImage(req, res) {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing "url" query parameter' });
  }

  try {
    // 1. Check disk cache
    const cached = mediaCache.getImage(targetUrl);
    if (cached) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', cached.contentType);
      res.setHeader('Content-Length', cached.size);
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
      res.setHeader('X-Cache-Status', 'HIT');
      return fs.createReadStream(cached.filePath).pipe(res);
    }

    // 2. Fetch upstream
    const upstreamRes = await fetch(targetUrl, {
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    });

    if (!upstreamRes.ok) {
      return res.status(upstreamRes.status).send('Image fetch failed');
    }

    const contentType = upstreamRes.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await upstreamRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Save to disk cache
    mediaCache.saveImage(targetUrl, buffer, contentType);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    res.setHeader('X-Cache-Status', 'MISS');
    return res.send(buffer);

  } catch (err) {
    console.warn(`[ProxyImage] Failed for ${targetUrl}:`, err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
}
